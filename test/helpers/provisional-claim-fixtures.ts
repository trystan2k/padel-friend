import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { expect } from 'vitest';
import type { Database } from '../../src/lib/supabase/database.types';
import type { LocalSupabaseEnv } from './local-supabase-env';
import { addPlayer, authUsersByEmail, mailFor, uniqueEmail } from './match-add-player-fixtures';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  signUpFixtureActor,
  type ProvisionalFixtureActor
} from './provisional-player-fixtures';
import { queryTrustedSql } from './sql-transport';

const AUTH_OPTIONS = { auth: { persistSession: false, autoRefreshToken: false } } as const;

export type ClaimScenario = {
  env: LocalSupabaseEnv;
  owner: ProvisionalFixtureActor;
  communityId: string;
  eventId: string;
};

/** Private community, an admin and an owner with a future community-open event. */
export async function claimScenario(
  env: LocalSupabaseEnv,
  label = 'claim'
): Promise<ClaimScenario> {
  const [admin, owner] = await Promise.all([
    signUpFixtureActor(env, `${label}-admin`, { displayName: 'Claim Admin', level: 4 }),
    signUpFixtureActor(env, `${label}-owner`, { displayName: 'Claim Owner', level: 4 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'private',
    adminId: admin.id,
    memberIds: [owner.id]
  });
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  return { env, owner, communityId, eventId };
}

export function sessionClient(env: LocalSupabaseEnv, session: Session): SupabaseClient<Database> {
  return createClient<Database>(env.url, env.key, {
    ...AUTH_OPTIONS,
    global: { headers: { Authorization: `Bearer ${session.access_token}` } }
  });
}

export function authenticationMethods(session: Session): string[] {
  const payload: unknown = JSON.parse(
    Buffer.from(session.access_token.split('.')[1]!, 'base64url').toString('utf8')
  );
  const amr: unknown =
    typeof payload === 'object' && payload !== null ? Reflect.get(payload, 'amr') : [];
  return Array.isArray(amr) ? amr.map((entry) => String(Reflect.get(Object(entry), 'method'))) : [];
}

/** The single claim link of an invitation mail, entity-decoded the way a mail client opens it. */
export function invitationTokenHash(html: string): string {
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&')
  );
  expect(links).toHaveLength(1);
  const hash = new URL(links[0]!).searchParams.get('token_hash');
  expect(hash).toBeTruthy();
  return hash!;
}

export type InvitedPlayer = {
  id: string;
  email: string;
  tokenHash: string;
  communityId: string;
  eventId: string;
};

/** Real add -> real Auth invite -> real Mailpit message; returns the link's token hash. */
export async function addInvitedPlayer(
  scenario: ClaimScenario,
  input: { displayName: string; level: number; label: string; eventId?: string }
): Promise<InvitedPlayer> {
  const email = uniqueEmail(input.label);
  const eventId = input.eventId ?? scenario.eventId;
  const { result } = await addPlayer(scenario.env, scenario.owner, {
    eventId,
    displayName: input.displayName,
    email,
    level: input.level
  });
  expect(result).toEqual({ status: 'ok' });
  const [user] = await authUsersByEmail(email);
  const mails = await mailFor(email);
  expect(mails).toHaveLength(1);
  return {
    id: String(user!.id),
    email,
    tokenHash: invitationTokenHash(mails[0]!.html),
    communityId: scenario.communityId,
    eventId
  };
}

/** The /auth/callback invite step: Auth verifies the single-use hash and returns a session. */
export async function verifyInvitation(env: LocalSupabaseEnv, tokenHash: string) {
  return createClient(env.url, env.key, AUTH_OPTIONS).auth.verifyOtp({
    token_hash: tokenHash,
    type: 'invite'
  });
}

/** Opens the recovery email's verify link and returns the session Auth issues (implicit flow). */
export async function recoverySession(
  env: LocalSupabaseEnv,
  email: string
): Promise<{ session: Session; auth: SupabaseClient<Database>['auth'] }> {
  const anon = createClient(env.url, env.key, AUTH_OPTIONS);
  const before = (await mailFor(email)).length;
  const requested = await anon.auth.resetPasswordForEmail(email, {
    redirectTo: 'http://127.0.0.1:3000/auth/callback?next=/reset-password'
  });
  expect(requested.error).toBeNull();
  const mails = await mailFor(email);
  expect(mails).toHaveLength(before + 1);
  const link = /href="([^"]*\/auth\/v1\/verify[^"]*)"/
    .exec(mails.at(-1)!.html)?.[1]
    ?.replaceAll('&amp;', '&');
  expect(link, 'recovery mail carries a verify link').toBeTruthy();
  const verified = await fetch(link!, { redirect: 'manual' });
  const location = verified.headers.get('location') ?? '';
  const fragment = new URLSearchParams(location.split('#')[1] ?? '');
  const access = fragment.get('access_token');
  const refresh = fragment.get('refresh_token');
  expect(
    access && refresh,
    `recovery redirect carries a session: ${location.split('#')[0]}`
  ).toBeTruthy();
  const holder = createClient<Database>(env.url, env.key, AUTH_OPTIONS);
  const { data, error } = await holder.auth.setSession({
    access_token: access!,
    refresh_token: refresh!
  });
  expect(error).toBeNull();
  return { session: data.session!, auth: holder.auth };
}

export async function profileState(userId: string) {
  const result = await queryTrustedSql(
    `select p.is_provisional, p.display_name, p.preferred_side, p.rating_input_source,
            p.estimated_level::float8 as estimated_level, r.initial_display_level::float8 as initial_level,
            r.mu::float8 as mu, r.display_level::float8 as display_level, r.highest_display_level::float8 as highest_level
       from public.player_profiles p join public.global_player_ratings r on r.user_id = p.user_id
      where p.user_id = $1`,
    { values: [userId] }
  );
  return result.rows[0];
}

export async function claimAudits(userId: string) {
  const result = await queryTrustedSql(
    `select match_event_id, actor_id, target_user_id, community_id, after_data
       from public.match_event_audit_log where target_user_id = $1 and action = 'player_claimed'`,
    { values: [userId] }
  );
  return result.rows;
}

export const CLAIM_PROFILE = {
  p_display_name: 'Claimed Carla',
  p_preferred_side: 'LEFT',
  p_initial_level: 4.2
} as const;
