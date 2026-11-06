import type { LocalSupabaseEnv } from './local-supabase-env';
import { fixtureSql, sqlRows } from './match-registration-sql';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText,
  type ProvisionalFixtureActor
} from './provisional-player-fixtures';
import { queryTrustedSql } from './sql-transport';

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number' || typeof value === 'boolean') return `${value}`;
  throw new Error('Expected a scalar database value');
}

export type Quartet = readonly [string, string, string, string];
/** Four player ids as a Quartet (team_a pair, then team_b pair). */
export function toQuartet(ids: readonly string[], offset = 0): Quartet {
  const [a, b, c, d] = ids.slice(offset, offset + 4);
  if (a === undefined || b === undefined || c === undefined || d === undefined)
    throw new Error('A quartet needs four player ids');
  return [a, b, c, d];
}

export type Classification = 'team_a' | 'team_b' | 'draw' | 'incomplete';
export type RatedClassification = Exclude<Classification, 'incomplete'>;

export const SETS: Record<Classification, string> = {
  team_a: '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]',
  team_b: '[{"position":1,"team_a_games":4,"team_b_games":6,"completed":true}]',
  draw: '[{"position":1,"team_a_games":6,"team_b_games":6,"completed":true}]',
  incomplete: '[{"position":1,"team_a_games":3,"team_b_games":2,"completed":false}]'
};

/** Projection is dormant when off: confirmations are recorded but nothing is ledgered. */
export async function setRatingProjectionActive(active: boolean): Promise<void> {
  await queryTrustedSql(
    'update public.player_rating_projection_control set activation_enabled = $1',
    {
      values: [active]
    }
  );
}

/**
 * A played_at later than every group processed so far (and than the wall clock), so the
 * confirmed group sorts after the whole stream and takes the chronological tail path.
 */
export async function nextTailPlayedAt(): Promise<string> {
  const [row] = await sqlRows(
    `select greatest(coalesce(last_processed_played_at, '-infinity'::timestamptz), clock_timestamp()) as latest
       from public.player_rating_projection_control`
  );
  const value = row?.['latest'];
  const latest = value instanceof Date ? value.getTime() : Date.parse(text(value));
  return new Date(Math.max(latest, Date.now()) + 60_000).toISOString();
}

export type ActivationResult = { groups: number; changed: boolean; revision: number };

/** Runs the internal activation/backfill; idempotent, so a repeat reports changed=false. */
export async function activateRatingProjection(connection?: {
  query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>;
}): Promise<ActivationResult> {
  const sql = 'select public.activate_global_rating_projection()::text as result';
  const [row] = connection ? (await connection.query(sql)).rows : await sqlRows(sql);
  const value: unknown = JSON.parse(String(row?.['result']));
  if (
    typeof value !== 'object' ||
    value === null ||
    !('groups' in value) ||
    !('changed' in value) ||
    !('revision' in value) ||
    typeof value.groups !== 'number' ||
    typeof value.changed !== 'boolean' ||
    typeof value.revision !== 'number'
  )
    throw new Error('Unexpected activation result');
  return { groups: value.groups, changed: value.changed, revision: value.revision };
}

export async function ratingProjectionControl() {
  const [row] = await sqlRows(
    `select activation_enabled, committed_revision::int as revision,
            last_processed_played_at::text as watermark_at, last_processed_game_group_id::text as watermark_group
       from public.player_rating_projection_control`
  );
  return row!;
}

/** Runs the callback with projection dormant and always restores it, even on failure. */
export async function withDormantProjection<T>(run: () => Promise<T>): Promise<T> {
  await setRatingProjectionActive(false);
  try {
    return await run();
  } finally {
    await setRatingProjectionActive(true);
  }
}

export type RatingWorld = {
  env: LocalSupabaseEnv;
  admin: ProvisionalFixtureActor;
  communityId: string;
  /** Past competitive event in the given (default: world) community. */
  newEvent: (communityId?: string) => Promise<string>;
  /** Second community with its own admin sharing nothing but players. */
  newCommunity: () => Promise<{ communityId: string; adminId: string }>;
  player: (label: string, level: number) => Promise<ProvisionalFixtureActor>;
  provisional: (label: string, estimatedLevel: number) => Promise<ProvisionalFixtureActor>;
};

export async function ratingWorld(env: LocalSupabaseEnv, label: string): Promise<RatingWorld> {
  const admin = await signUpFixtureActor(env, `${label}-admin`, {
    displayName: `Rating Admin ${label}`.slice(0, 40),
    level: 4
  });
  const communityId: string = crypto.randomUUID();
  await insertFixtureCommunity({ id: communityId, visibility: 'public', adminId: admin.id });
  let sourceEventId: string | undefined;
  const newEvent = async (inCommunity = communityId) => {
    const id = crypto.randomUUID();
    const creator = inCommunity === communityId ? admin.id : await communityAdmin(inCommunity);
    await insertFixtureEvent({
      id,
      communityId: inCommunity,
      creatorId: creator,
      visibility: 'community_open',
      past: true
    });
    sourceEventId ??= id;
    return id;
  };
  return {
    env,
    admin,
    communityId,
    newEvent,
    newCommunity: async () => {
      const other = await signUpFixtureActor(env, `${label}-admin2`, {
        displayName: `Rating Admin2 ${label}`.slice(0, 40),
        level: 4
      });
      const id = crypto.randomUUID();
      await insertFixtureCommunity({ id, visibility: 'private', adminId: other.id });
      return { communityId: id, adminId: other.id };
    },
    player: (name, level) =>
      signUpFixtureActor(env, `${label}-${name}`, {
        displayName: `${name} ${label}`.slice(0, 40),
        level
      }),
    provisional: async (name, estimatedLevel) => {
      const actor = await signUpFixtureActor(env, `${label}-${name}`);
      const eventId = sourceEventId ?? (await newEvent());
      const created = await provisionProvisionalPlayer({
        userId: actor.id,
        displayName: `Provisional ${name}`.slice(0, 40),
        estimatedLevel,
        invitedBy: admin.id,
        sourceEventId: eventId
      });
      if (!created) throw new Error('Provisional fixture was not created');
      return actor;
    }
  };
}

async function communityAdmin(communityId: string): Promise<string> {
  const [row] = await sqlRows(
    `select created_by::text as id from public.communities where id = ${sqlText(communityId)}`
  );
  return String(row!['id']);
}

export type GroupSpec = {
  eventId: string;
  groupNumber?: number;
  players: Quartet;
  playedAt: string;
  submittedBy: string;
  classification?: Classification;
};

export type PendingGroup = {
  proposalId: string;
  eventId: string;
  players: Quartet;
  playedAt: string;
  classification: Classification;
  submittedBy: string;
};

/**
 * Pending proposal v1 with the review window aged: `49` hours puts it past the 48-hour
 * deadline (AUTO_48H eligible); `1` hour keeps manual confirmation open.
 */
export async function submitPendingGroup(
  spec: GroupSpec,
  ageHours: 49 | 1 = 49
): Promise<PendingGroup> {
  const proposalId = crypto.randomUUID();
  const classification = spec.classification ?? 'team_a';
  const [a1, a2, b1, b2] = spec.players;
  await fixtureSql(`do $proposal$
    declare
      v_submitted_at timestamptz := clock_timestamp() - interval '${ageHours} hours';
      v_deadline timestamptz := v_submitted_at + interval '48 hours';
    begin
      insert into public.match_event_result_proposals(
        id, match_event_id, group_number, status, active_version, review_deadline_at, submitted_by, submitted_at
      ) values ('${proposalId}', '${spec.eventId}', ${spec.groupNumber ?? 1}, 'pending', 1, v_deadline,
        '${spec.submittedBy}', v_submitted_at);
      insert into public.match_event_result_proposal_versions(
        proposal_id, version, submitted_by, submitted_at, review_deadline_at, teams, sets, classification,
        played_at_utc, played_at_local, played_at_offset_seconds, court_label
      ) values ('${proposalId}', 1, '${spec.submittedBy}', v_submitted_at, v_deadline,
        jsonb_build_object('team_a', jsonb_build_array('${a1}', '${a2}'), 'team_b', jsonb_build_array('${b1}', '${b2}')),
        '${SETS[classification]}'::jsonb, '${classification}', '${spec.playedAt}'::timestamptz,
        ('${spec.playedAt}'::timestamptz at time zone 'UTC'), 0, 'Court 1');
    end $proposal$;`);
  return {
    proposalId,
    eventId: spec.eventId,
    players: spec.players,
    playedAt: spec.playedAt,
    classification,
    submittedBy: spec.submittedBy
  };
}

export function finalizeSql(proposalId: string, source: 'MANUAL' | 'AUTO_48H', actorId?: string) {
  const actor = source === 'MANUAL' ? `'${actorId}'::uuid` : 'null';
  return `select public.finalize_match_event_result_locked('${proposalId}', 1, '${source}', ${actor})::text as id`;
}

/** AUTO_48H confirmation through the production finalizer. Returns the confirmation id. */
export async function confirmAuto(group: PendingGroup): Promise<string> {
  const [row] = await sqlRows(finalizeSql(group.proposalId, 'AUTO_48H'));
  if (typeof row?.['id'] !== 'string') throw new Error('Auto confirmation did not confirm');
  return row['id'];
}

/** MANUAL confirmation: approval coverage from one reviewer per team, inside the open window. */
export async function confirmManual(group: PendingGroup): Promise<string> {
  const [a1, , b1] = group.players;
  for (const reviewer of [a1, b1]) {
    await fixtureSql(`insert into public.match_event_result_reviews(
      proposal_id, proposal_version, reviewer_user_id, decision, request_id
    ) values ('${group.proposalId}', 1, '${reviewer}', 'approve', '${crypto.randomUUID()}')`);
  }
  const [row] = await sqlRows(finalizeSql(group.proposalId, 'MANUAL', a1));
  if (typeof row?.['id'] !== 'string') throw new Error('Manual confirmation did not confirm');
  return row['id'];
}

/** Pending proposal confirmed through the AUTO_48H finalizer. */
export async function confirmedGroup(
  spec: GroupSpec
): Promise<PendingGroup & { confirmationId: string }> {
  const group = await submitPendingGroup(spec);
  return { ...group, confirmationId: await confirmAuto(group) };
}

export async function setEventType(
  eventId: string,
  type: 'friendly' | 'competitive'
): Promise<void> {
  await fixtureSql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
    update public.match_events set event_type = '${type}' where id = '${eventId}';
    alter table public.match_events enable trigger match_event_immutable;
  end $$;`);
}

// --- Oracle: clean sorted replay through the approved SQL kernel -----------------------

export type OracleState = {
  mu: number;
  groups: number;
  reliability: number;
  highest: number;
};
export type OracleGroup = {
  id: string;
  playedAt: string;
  classification: RatedClassification;
  players: Quartet;
};
export type OracleStep = Record<string, { before: number; after: number; groupsAfter: number }>;

export function sortedForReplay<T extends { id: string; playedAt: string }>(
  groups: readonly T[]
): T[] {
  return [...groups].sort(
    (left, right) =>
      Date.parse(left.playedAt) - Date.parse(right.playedAt) || (left.id < right.id ? -1 : 1)
  );
}

/**
 * Independent replay oracle: walks the groups in canonical (played_at, uuid) order and
 * feeds each one to the pure kernel with the previous states, exactly like a fresh
 * full recomputation would. Never touches ledger or projection tables.
 */
export async function oracleReplay(
  groups: readonly OracleGroup[],
  startLevels: Readonly<Record<string, number>>
): Promise<{ states: Record<string, OracleState>; steps: Map<string, OracleStep> }> {
  const states: Record<string, OracleState> = {};
  const steps = new Map<string, OracleStep>();
  const stateOf = (id: string): OracleState =>
    (states[id] ??= (() => {
      const level = startLevels[id];
      if (level === undefined) throw new Error(`Oracle has no initial level for ${id}`);
      return { mu: level, groups: 0, reliability: 10, highest: level };
    })());
  for (const group of sortedForReplay(groups)) {
    const [a1, a2, b1, b2] = group.players;
    const inputs = {
      classification: group.classification,
      played_at: group.playedAt,
      teams: { team_a: [a1, a2], team_b: [b1, b2] },
      states: Object.fromEntries(
        group.players.map((id) => {
          const s = stateOf(id);
          return [
            id,
            {
              mu: s.mu,
              sigma: 1,
              display_level: s.mu,
              reliability_percent: s.reliability,
              confirmed_competitive_game_groups: s.groups,
              highest_display_level: s.highest
            }
          ];
        })
      )
    };
    const result = await queryTrustedSql(
      `select user_id::text as user_id, before_mu::float8 as before_mu, after_mu::float8 as after_mu,
              after_reliability_percent::int as reliability, after_confirmed_groups as groups,
              after_highest_display_level::float8 as highest
         from public.rating_v1_calculate_group('app-wide-level', '1.0.0', 1, $1::jsonb) order by ordinal`,
      { values: [JSON.stringify(inputs)] }
    );
    const step: OracleStep = {};
    for (const row of result.rows) {
      const id = text(row['user_id']);
      step[id] = {
        before: Number(row['before_mu']),
        after: Number(row['after_mu']),
        groupsAfter: Number(row['groups'])
      };
      states[id] = {
        mu: Number(row['after_mu']),
        groups: Number(row['groups']),
        reliability: Number(row['reliability']),
        highest: Number(row['highest'])
      };
    }
    steps.set(group.id, step);
  }
  return { states, steps };
}

// --- Observed state -------------------------------------------------------------------

export type ObservedState = OracleState & { revision: number; lastRatingAt: string | null };

export async function ratingStates(
  userIds: readonly string[]
): Promise<Record<string, ObservedState>> {
  const result = await queryTrustedSql(
    `select user_id::text as user_id, mu::float8 as mu, confirmed_competitive_game_groups as groups,
            reliability_percent::int as reliability, highest_display_level::float8 as highest,
            projection_revision::int as revision, last_rating_at::text as last_rating_at
       from public.global_player_ratings where user_id = any($1::uuid[])`,
    { values: [userIds] }
  );
  return Object.fromEntries(
    result.rows.map((row) => [
      text(row['user_id']),
      {
        mu: Number(row['mu']),
        groups: Number(row['groups']),
        reliability: Number(row['reliability']),
        highest: Number(row['highest']),
        revision: Number(row['revision']),
        lastRatingAt: row['last_rating_at'] === null ? null : text(row['last_rating_at'])
      }
    ])
  );
}

export function stripRevision(states: Record<string, ObservedState>): Record<string, OracleState> {
  return Object.fromEntries(
    Object.entries(states).map(([id, s]) => [
      id,
      { mu: s.mu, groups: s.groups, reliability: s.reliability, highest: s.highest }
    ])
  );
}

export type LedgerCalculation = {
  revision: number;
  beforeMu: number;
  afterMu: number;
  beforeGroups: number;
  afterGroups: number;
};
export type LedgerEntry = { groupId: string; userId: string; calculations: LedgerCalculation[] };

/** Every logical event of the groups with ALL its calculation revisions, sorted stably. */
export async function ledgerOf(groupIds: readonly string[]): Promise<LedgerEntry[]> {
  const result = await queryTrustedSql(
    `select e.game_group_id::text as group_id, e.user_id::text as user_id, c.projection_revision::int as revision,
            c.before_mu::float8 as before_mu, c.after_mu::float8 as after_mu,
            c.before_confirmed_groups as before_groups, c.after_confirmed_groups as after_groups
       from public.player_rating_events e
       join public.player_rating_event_calculations c on c.rating_event_id = e.id
      where e.game_group_id = any($1::uuid[])
      order by e.game_group_id, e.user_id, c.projection_revision`,
    { values: [groupIds] }
  );
  const entries = new Map<string, LedgerEntry>();
  for (const row of result.rows) {
    const key = `${text(row['group_id'])}:${text(row['user_id'])}`;
    const entry = entries.get(key) ?? {
      groupId: text(row['group_id']),
      userId: text(row['user_id']),
      calculations: []
    };
    entry.calculations.push({
      revision: Number(row['revision']),
      beforeMu: Number(row['before_mu']),
      afterMu: Number(row['after_mu']),
      beforeGroups: Number(row['before_groups']),
      afterGroups: Number(row['after_groups'])
    });
    entries.set(key, entry);
  }
  return [...entries.values()];
}

/** Latest calculation per event: what current-state readers see. */
export function currentCalculations(entries: readonly LedgerEntry[]) {
  return entries.map((entry) => ({
    groupId: entry.groupId,
    userId: entry.userId,
    ...entry.calculations[entry.calculations.length - 1]!
  }));
}

/**
 * Byte-exact fingerprint of every ledger row of the given users (events + all calculation
 * columns + frozen inputs + explanation), used to prove rows are not re-keyed or rewritten.
 */
export async function ledgerFingerprint(userIds: readonly string[]): Promise<string> {
  const result = await queryTrustedSql(
    `select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(x) order by x.game_group_id, x.user_id, x.projection_revision), '[]'::jsonb)::text as dump
       from (select e.id as event_id, e.game_group_id, e.user_id, e.created_at, c.*
               from public.player_rating_events e
               join public.player_rating_event_calculations c on c.rating_event_id = e.id
              where e.user_id = any($1::uuid[])) x`,
    { values: [userIds] }
  );
  return String(result.rows[0]?.['dump']);
}

export async function eventCountFor(groupIds: readonly string[]): Promise<number> {
  const [row] = await sqlRows(
    `select count(*)::int as count from public.player_rating_events
      where game_group_id in (${groupIds.map(sqlText).join(',') || 'null'})`
  );
  return Number(row!['count']);
}

/** Frozen starting levels by user (effective latest initialization). */
export async function initialLevels(userIds: readonly string[]): Promise<Record<string, number>> {
  const result = await queryTrustedSql(
    `select user_id::text as user_id, initial_display_level::float8 as level
       from public.global_player_ratings where user_id = any($1::uuid[])`,
    { values: [userIds] }
  );
  return Object.fromEntries(result.rows.map((row) => [text(row['user_id']), Number(row['level'])]));
}

export function toOracleGroup(group: PendingGroup): OracleGroup {
  if (group.classification === 'incomplete') throw new Error('Incomplete groups are not rated');
  return {
    id: group.proposalId,
    playedAt: group.playedAt,
    classification: group.classification,
    players: group.players
  };
}
