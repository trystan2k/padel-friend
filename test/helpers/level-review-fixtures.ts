import { createClient } from '@supabase/supabase-js';
import { expect } from 'vitest';
import {
  decodeLevelReviewCommand,
  decodeLevelReviewResolution
} from '../../src/features/level-reviews/level-review-decoders';
import type { LevelReviewResolutionResult } from '../../src/features/level-reviews/level-review-contracts';
import { parseRatingSummaryResult } from '../../src/features/player/rating-contracts';
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
import {
  executeTrustedSql,
  queryTrustedSql,
  sqlErrorMessage,
  type DedicatedSqlConnection,
  type SqlRow
} from './sql-transport';
import { ratingProjectionControl, type RatingWorld } from './rating-fixtures';

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

// --- PAF-148: approval, adjustment evidence and projection probes ---------------------

export type ReliabilityArgs =
  | { mode: 'preserve' }
  | { mode: 'reset'; justification: string }
  | { mode: 'reduce'; target: number; justification: string };

export type ApproveOptions = {
  commandId?: string;
  note?: string;
  target?: number;
  expectedRevision?: number;
  reliability?: ReliabilityArgs;
};

export async function committedRevision(): Promise<number> {
  return Number((await ratingProjectionControl())['revision']);
}

/** RPC arguments of an approval; the revision defaults to the committed one at call time. */
export async function approveArgs(requestId: string, options: ApproveOptions = {}) {
  const reliability = options.reliability;
  return {
    p_request_id: requestId,
    p_command_id: options.commandId ?? crypto.randomUUID(),
    p_decision: 'approve',
    p_note: options.note ?? 'Level confirmed after review.',
    p_target_level: options.target ?? 5,
    p_expected_revision: options.expectedRevision ?? (await committedRevision()),
    ...(reliability && reliability.mode !== 'preserve'
      ? {
          p_reliability_mode: reliability.mode,
          p_exception_justification: reliability.justification,
          ...(reliability.mode === 'reduce' ? { p_reliability_target: reliability.target } : {})
        }
      : {})
  };
}

export async function approveRequest(
  admin: LevelReviewActor,
  requestId: string,
  options: ApproveOptions = {}
) {
  return admin.client.rpc('resolve_level_review_request', await approveArgs(requestId, options));
}

/** Approves through the real RPC and returns the decoded resolution (fails the test on error). */
export async function approveOk(
  admin: LevelReviewActor,
  requestId: string,
  options: ApproveOptions = {}
): Promise<LevelReviewResolutionResult> {
  const result = await approveRequest(admin, requestId, options);
  expect(result.error).toBeNull();
  return decodeLevelReviewResolution(result.data);
}

/** Owner submits a request for the exact level (min = max) through the real RPC. */
export async function submitExact(owner: LevelReviewActor, level: number): Promise<string> {
  return submitRequest(owner, { p_requested_min_level: level, p_requested_max_level: level });
}

export async function adjustmentRowFor(requestId: string): Promise<SqlRow | undefined> {
  const result = await queryTrustedSql(
    'select * from public.player_rating_admin_adjustments where level_review_request_id = $1',
    { values: [requestId] }
  );
  return result.rows[0];
}

export async function adjustmentCount(userId: string): Promise<number> {
  const result = await queryTrustedSql(
    'select count(*)::int as count from public.player_rating_admin_adjustments where user_id = $1',
    { values: [userId] }
  );
  return Number(result.rows[0]?.['count']);
}

export async function adjustmentStates(userId: string): Promise<SqlRow[]> {
  const result = await queryTrustedSql(
    `select s.* from public.player_rating_adjustment_states s
       join public.player_rating_admin_adjustments a on a.id = s.adjustment_id
      where a.user_id = $1 order by a.boundary_played_at, s.projection_revision`,
    { values: [userId] }
  );
  return result.rows;
}

/** Whole-row fingerprint of the immutable adjustment evidence of a user. */
export async function adjustmentFingerprint(userId: string): Promise<string> {
  const result = await queryTrustedSql(
    `select md5(coalesce(jsonb_agg(to_jsonb(a) order by a.boundary_played_at)::text, '')) as fingerprint
       from public.player_rating_admin_adjustments a where a.user_id = $1`,
    { values: [userId] }
  );
  return String(result.rows[0]?.['fingerprint']);
}

/** League standings are never replayed by a level review: snapshots and receipts must not move. */
export async function leagueFingerprint(): Promise<string> {
  const result = await queryTrustedSql(
    `select md5(
        coalesce((select jsonb_agg(to_jsonb(s) order by to_jsonb(s)::text) from public.league_standings_snapshots s)::text, '')
        || coalesce((select jsonb_agg(to_jsonb(c) order by to_jsonb(c)::text) from public.league_projection_confirmations c)::text, '')
      ) as fingerprint`
  );
  return String(result.rows[0]?.['fingerprint']);
}

/** Statistics and rank publication stay aligned with the committed rating revision. */
export async function statisticsAlignment(): Promise<{
  rating: number;
  statisticsRating: number;
  rankRating: number;
  dirty: number;
}> {
  const result = await queryTrustedSql(
    `select (select committed_revision::int from public.player_rating_projection_control) as rating,
            (select rating_revision::int from public.statistics_projection_control) as stats,
            (select rating_revision::int from public.statistics_rank_control) as rank,
            (select count(*)::int from public.statistics_rank_dirty) as dirty`
  );
  const row = result.rows[0]!;
  return {
    rating: Number(row['rating']),
    statisticsRating: Number(row['stats']),
    rankRating: Number(row['rank']),
    dirty: Number(row['dirty'])
  };
}

export async function ratingRow(userId: string): Promise<SqlRow> {
  const result = await queryTrustedSql(
    `select mu::float8 as mu, sigma::float8 as sigma, display_level::float8 as display_level,
            reliability_percent::int as reliability, confirmed_competitive_game_groups as groups,
            highest_display_level::float8 as highest, initial_display_level::float8 as initial_level,
            last_rating_at::text as last_rating_at, rating_engine_version as version,
            projection_revision::int as revision
       from public.global_player_ratings where user_id = $1`,
    { values: [userId] }
  );
  return result.rows[0]!;
}

export async function ownRatingSummary(actor: LevelReviewActor) {
  const result = await actor.client.rpc('get_my_rating_summary');
  expect(result.error).toBeNull();
  return parseRatingSummaryResult(result.data)!;
}

/**
 * Pure SQL kernel on a hand-built input: the golden/exception probe. Never a TypeScript
 * calculator; the arithmetic is the database's.
 */
export type KernelState = { mu: number; reliability: number; groups: number; highest?: number };
export async function kernelRows(
  version: '1.0.0' | '1.1.0',
  classification: 'team_a' | 'team_b' | 'draw',
  players: readonly [string, string, string, string],
  states: readonly [KernelState, KernelState, KernelState, KernelState]
): Promise<SqlRow[]> {
  const inputs = {
    classification,
    played_at: '2026-01-01T10:00:00.000000Z',
    teams: { team_a: [players[0], players[1]], team_b: [players[2], players[3]] },
    states: Object.fromEntries(
      players.map((id, index) => {
        const state = states[index]!;
        return [
          id,
          {
            mu: state.mu,
            sigma: 1,
            display_level: state.mu,
            reliability_percent: state.reliability,
            confirmed_competitive_game_groups: state.groups,
            highest_display_level: state.highest ?? state.mu
          }
        ];
      })
    )
  };
  const result = await queryTrustedSql(
    `select ordinal::int as ordinal, before_mu::float8 as before_mu, after_mu::float8 as after_mu,
            before_reliability_percent::int as before_rel, after_reliability_percent::int as after_rel,
            after_confirmed_groups as after_groups, rounded_delta::float8 as rounded_delta,
            raw_delta::text as raw_delta, rating_engine_version as version, after_sigma::float8 as sigma
       from public.rating_v1_calculate_group('app-wide-level', $1, 1, $2::jsonb) order by ordinal`,
    { values: [version, JSON.stringify(inputs)] }
  );
  return result.rows;
}

/**
 * Past-dated fixture events are due for the global registration-cutoff batch; suites that
 * create many of them drain the slate so the (global, bounded) cutoff batch suite still sees
 * the small slate it measures. Bounded loop, never an open-ended wait.
 */
export async function drainDueRegistrationCutoffs(): Promise<void> {
  for (let round = 0; round < 20; round += 1) {
    const result = await queryTrustedSql(
      "select (public.process_due_match_event_registration_cutoffs(100) ->> 'selected')::int as selected"
    );
    if (Number(result.rows[0]?.['selected']) === 0) return;
  }
}

/** Activates a community membership so rank publication has a community to refresh. */
export async function addActiveMember(communityId: string, userId: string): Promise<void> {
  await executeTrustedSql(
    `insert into public.community_members(community_id, user_id, role, status, valid_from, activated_at)
      values (${sqlText(communityId)}, ${sqlText(userId)}, 'member', 'active',
        now() - interval '1 minute', now() - interval '1 minute') on conflict do nothing`
  );
}

/** A Platform Admin player of a rating world, provisioned through trusted SQL. */
export async function platformAdminPlayer(world: RatingWorld, label = 'padmin') {
  const admin = await world.player(label, 4);
  await grantPlatformAdmin(admin.id);
  return admin;
}

export type ConnectionResolution = { ok: true; data: unknown } | { ok: false; message: string };

type SqlScalar = string | number | null | undefined;
const literal = (value: SqlScalar) =>
  value === undefined || value === null ? 'null' : sqlText(String(value));

/**
 * Runs one SELECT on a dedicated backend as an authenticated user (JWT claims + role set
 * inside the transaction), so races use real separate transactions and the production grants.
 */
export async function callOnConnection(
  connection: DedicatedSqlConnection,
  userId: string,
  selectSql: string
): Promise<ConnectionResolution> {
  await connection.query('begin');
  try {
    await connection.query(
      `select set_config('request.jwt.claims', ${sqlText(JSON.stringify({ sub: userId, role: 'authenticated' }))}, true)`
    );
    await connection.query('set local role authenticated');
    const result = await connection.query(`select (${selectSql})::text as result`);
    await connection.query('commit');
    return { ok: true, data: JSON.parse(String(result.rows[0]?.['result'])) };
  } catch (error) {
    await connection.query('rollback').catch(() => undefined);
    return { ok: false, message: sqlErrorMessage(error) };
  }
}

/** The production approval/rejection (resolve_level_review_request) on a dedicated backend. */
export function resolveOnConnection(
  connection: DedicatedSqlConnection,
  adminId: string,
  args: Record<string, SqlScalar>
): Promise<ConnectionResolution> {
  return callOnConnection(
    connection,
    adminId,
    `public.resolve_level_review_request(${literal(args.p_request_id)}::uuid, ${literal(args.p_command_id)}::uuid,
      ${literal(args.p_decision)}, ${literal(args.p_note)}, ${literal(args.p_target_level)}::numeric,
      ${literal(args.p_expected_revision)}::bigint, ${literal(args.p_reliability_mode)},
      ${literal(args.p_reliability_target)}::integer, ${literal(args.p_exception_justification)})`
  );
}

export function cancelOnConnection(
  connection: DedicatedSqlConnection,
  ownerId: string,
  requestId: string
): Promise<ConnectionResolution> {
  return callOnConnection(
    connection,
    ownerId,
    `public.cancel_level_review_request(${literal(requestId)}::uuid)`
  );
}
