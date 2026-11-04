import { createClient } from '@supabase/supabase-js';
import { expect } from 'vitest';
import { decodeLevelReviewCommand } from '../../src/features/level-reviews/level-review-decoders';
import type { Database } from '../../src/lib/supabase/database.types';
import type { LocalSupabaseEnv } from './local-supabase-env';
import {
  ensureProvisionalMembership,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText,
  type ProvisionalFixtureActor
} from './provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql, type SqlRow } from './sql-transport';

export type LevelReviewActor = ProvisionalFixtureActor;

/**
 * Role matrix for level reviews: the request owner, an unrelated player, a Platform Admin
 * (provisioned through trusted SQL, exactly like production), a Community Admin and a Match
 * Creator of a community the owner belongs to, and a provisional actor.
 */
export type LevelReviewWorld = {
  env: LocalSupabaseEnv;
  owner: LevelReviewActor;
  other: LevelReviewActor;
  platformAdmin: LevelReviewActor;
  communityAdmin: LevelReviewActor;
  matchCreator: LevelReviewActor;
  provisional: LevelReviewActor;
};

export async function levelReviewWorld(
  env: LocalSupabaseEnv,
  label: string
): Promise<LevelReviewWorld> {
  const onboard = (name: string, level = 4) => ({
    displayName: `${name} ${label}`.slice(0, 40),
    level
  });
  const [owner, other, platformAdmin, communityAdmin, matchCreator, provisional] =
    await Promise.all([
      signUpFixtureActor(env, `${label}-owner`, onboard('Owner')),
      signUpFixtureActor(env, `${label}-other`, onboard('Other')),
      signUpFixtureActor(env, `${label}-padmin`, onboard('Platform')),
      signUpFixtureActor(env, `${label}-cadmin`, onboard('Community')),
      signUpFixtureActor(env, `${label}-creator`, onboard('Creator')),
      signUpFixtureActor(env, `${label}-prov`)
    ]);
  const communityId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'public',
    adminId: communityAdmin.id,
    memberIds: [owner.id, matchCreator.id]
  });
  const eventId = crypto.randomUUID();
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: matchCreator.id,
    visibility: 'community_open'
  });
  await provisionProvisionalPlayer({
    userId: provisional.id,
    displayName: `Provisional ${label}`.slice(0, 40),
    estimatedLevel: 3.5,
    invitedBy: communityAdmin.id,
    sourceEventId: eventId
  });
  await ensureProvisionalMembership({
    communityId,
    userId: provisional.id,
    addedBy: communityAdmin.id,
    sourceEventId: eventId
  });
  await grantPlatformAdmin(platformAdmin.id);
  return { env, owner, other, platformAdmin, communityAdmin, matchCreator, provisional };
}

/** Trusted operator provisioning; there is no runtime path to this table. */
export async function grantPlatformAdmin(userId: string): Promise<void> {
  await executeTrustedSql(
    `insert into public.platform_admins(user_id) values (${sqlText(userId)}) on conflict do nothing`
  );
}

export async function revokePlatformAdmin(userId: string): Promise<void> {
  await executeTrustedSql(`delete from public.platform_admins where user_id = ${sqlText(userId)}`);
}

export type SubmitOverrides = {
  p_command_id?: string;
  p_requested_min_level?: number;
  p_requested_max_level?: number;
  p_reason?: string;
  p_evidence?: string;
};

export function submitArgs(overrides: SubmitOverrides = {}) {
  return {
    p_command_id: crypto.randomUUID(),
    p_requested_min_level: 4.5,
    p_requested_max_level: 5,
    p_reason: 'I have been winning against stronger players.',
    ...overrides
  };
}

/** Submits through the real RPC and returns the new request id. */
export async function submitRequest(
  actor: LevelReviewActor,
  overrides: SubmitOverrides = {}
): Promise<string> {
  const result = await actor.client.rpc('submit_level_review_request', submitArgs(overrides));
  expect(result.error).toBeNull();
  return decodeLevelReviewCommand(result.data).request.id;
}

export async function levelReviewRow(requestId: string): Promise<SqlRow> {
  const result = await queryTrustedSql(
    'select * from public.player_level_review_requests where id = $1',
    { values: [requestId] }
  );
  return result.rows[0] ?? {};
}

export async function ratingFingerprint(userId: string): Promise<string> {
  const result = await queryTrustedSql(
    `select md5(coalesce((select to_jsonb(r)::text from public.global_player_ratings r where r.user_id = $1), '')
        || (select count(*)::text from public.player_rating_events e where e.user_id = $1)
        || (select committed_revision::text from public.player_rating_projection_control)) as fingerprint`,
    { values: [userId] }
  );
  return String(result.rows[0]?.['fingerprint']);
}

/**
 * A client whose JWT was minted AFTER the account's metadata was forged: proves role
 * metadata in a token never grants Platform Admin.
 */
export async function forgedRoleClient(
  env: LocalSupabaseEnv,
  actor: LevelReviewActor
): Promise<LevelReviewActor['client']> {
  await executeTrustedSql(
    `update auth.users set
        raw_app_meta_data = raw_app_meta_data || '{"role":"platform_admin","platform_admin":true}'::jsonb,
        raw_user_meta_data = raw_user_meta_data || '{"role":"platform_admin","platform_admin":true}'::jsonb
      where id = ${sqlText(actor.id)}`
  );
  const login = await createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signInWithPassword({ email: actor.email, password: 'Password123!' });
  expect(login.error).toBeNull();
  const claims = login.data.session!.access_token.split('.')[1]!;
  expect(JSON.parse(atob(claims.replaceAll('-', '+').replaceAll('_', '/')))).toMatchObject({
    app_metadata: { platform_admin: true }
  });
  return createClient<Database>(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${login.data.session!.access_token}` } }
  });
}
