import { expect } from 'vitest';
import { parseCommunityAdminDefaults } from '../../src/features/community/community-settings';
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

export type LeagueActor = ProvisionalFixtureActor;
export type LeagueTimezone = 'Europe/Madrid' | 'UTC';

/**
 * Role matrix over one real community: an Admin, the member who owns Leagues, a second ordinary
 * member, a former (inactive) member, a never-member, and a provisional member (restricted actor
 * whose session still exists).
 */
export type LeagueWorld = {
  env: LocalSupabaseEnv;
  communityId: string;
  admin: LeagueActor;
  owner: LeagueActor;
  member: LeagueActor;
  former: LeagueActor;
  outsider: LeagueActor;
  provisional: LeagueActor;
  setMemberCreation: (enabled: boolean) => Promise<void>;
  setTimezone: (timezone: LeagueTimezone) => Promise<void>;
  removeMember: (actor: LeagueActor) => Promise<void>;
  newCommunity: (adminId: string) => Promise<string>;
};

export async function leagueWorld(env: LocalSupabaseEnv, label: string): Promise<LeagueWorld> {
  const onboard = (name: string) => ({ displayName: `${name} ${label}`.slice(0, 40), level: 4 });
  const [admin, owner, member, former, outsider, provisional] = await Promise.all([
    signUpFixtureActor(env, `${label}-admin`, onboard('Admin')),
    signUpFixtureActor(env, `${label}-owner`, onboard('Owner')),
    signUpFixtureActor(env, `${label}-member`, onboard('Member')),
    signUpFixtureActor(env, `${label}-former`, onboard('Former')),
    signUpFixtureActor(env, `${label}-outsider`, onboard('Outsider')),
    signUpFixtureActor(env, `${label}-provisional`)
  ]);
  const communityId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'public',
    adminId: admin.id,
    memberIds: [owner.id, member.id, former.id]
  });
  const sourceEventId = crypto.randomUUID();
  await insertFixtureEvent({
    id: sourceEventId,
    communityId,
    creatorId: admin.id,
    visibility: 'community_open'
  });
  await provisionProvisionalPlayer({
    userId: provisional.id,
    displayName: `Provisional ${label}`.slice(0, 40),
    estimatedLevel: 3.5,
    invitedBy: admin.id,
    sourceEventId
  });
  await ensureProvisionalMembership({
    communityId,
    userId: provisional.id,
    addedBy: admin.id,
    sourceEventId
  });

  const world: LeagueWorld = {
    env,
    communityId,
    admin,
    owner,
    member,
    former,
    outsider,
    provisional,
    setMemberCreation: async (enabled) => {
      const current = await readAdminDefaults(communityId);
      const result = await admin.client.rpc('update_community_admin_defaults', {
        p_community_id: communityId,
        p_defaults: { ...current, member_created_leagues_enabled: enabled }
      });
      expect(result.error).toBeNull();
    },
    setTimezone: async (timezone) => {
      const current = await readAdminDefaults(communityId);
      const result = await admin.client.rpc('update_community_admin_defaults', {
        p_community_id: communityId,
        p_defaults: { ...current, timezone }
      });
      expect(result.error).toBeNull();
    },
    removeMember: async (actor) => {
      const rows = await sqlRows(
        `select id::text as id from public.community_members
          where community_id = ${sqlText(communityId)} and user_id = ${sqlText(actor.id)}
            and valid_until is null`
      );
      const result = await admin.client.rpc('govern_community_member', {
        p_community_id: communityId,
        p_membership_id: String(rows[0]?.['id']),
        p_action: 'remove'
      });
      expect(result.error).toBeNull();
    },
    newCommunity: async (adminId) => {
      const id = crypto.randomUUID();
      await insertFixtureCommunity({ id, visibility: 'private', adminId });
      return id;
    }
  };
  await world.removeMember(former);
  return world;
}

async function readAdminDefaults(communityId: string) {
  const [row] = await sqlRows(
    `select public.get_effective_community_admin_defaults(settings) as defaults
       from public.communities where id = ${sqlText(communityId)}`
  );
  return parseCommunityAdminDefaults(row?.['defaults']);
}

/** Narrows an arbitrary SQL/JSON value to a plain object. */
export function recordOf(value: unknown): SqlRow {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('Expected an object from SQL');
  return Object.fromEntries(Object.entries(value));
}

export async function sqlRows(sql: string): Promise<SqlRow[]> {
  return (await queryTrustedSql(sql)).rows;
}

export type LeagueSeed = {
  id?: string;
  communityId: string;
  ownerId: string;
  name?: string;
  timezone?: LeagueTimezone;
  endMode?: 'fixed_date' | 'manual';
  status?: 'upcoming' | 'active' | 'closed';
  /** SQL timestamptz expressions or ISO instants. */
  startAt: string;
  endAt?: string | null;
  blocked?: boolean;
  closedAt?: string;
  closedBy?: string | null;
  closedReason?: 'manual' | 'fixed_end_reached' | 'expired_before_activation';
  minimumMatches?: number;
};

const instant = (value: string) => `${sqlText(value)}::timestamptz`;

/**
 * Inserts a League row directly (trusted SQL) in any state, bypassing the commands so lifecycle
 * tests control the stored period exactly. Ordinary behavior is exercised through the RPCs.
 */
export async function insertLeague(seed: LeagueSeed): Promise<string> {
  const id = seed.id ?? crypto.randomUUID();
  const endMode = seed.endMode ?? (seed.endAt ? 'fixed_date' : 'manual');
  const status = seed.status ?? 'upcoming';
  const closedAt = seed.closedAt ?? seed.endAt ?? seed.startAt;
  await executeTrustedSql(`
    insert into public.leagues(id, community_id, owner_id, name, timezone, start_at, end_mode, end_at, status,
        minimum_matches_for_final_award, activation_blocked_at, activated_at, closed_at, closed_by, closed_reason,
        create_request_id, create_input)
      values (${sqlText(id)}, ${sqlText(seed.communityId)}, ${sqlText(seed.ownerId)},
        ${sqlText(seed.name ?? `League ${id.slice(0, 8)}`)}, ${sqlText(seed.timezone ?? 'UTC')},
        ${instant(seed.startAt)}, ${sqlText(endMode)}, ${seed.endAt ? instant(seed.endAt) : 'null'},
        ${sqlText(status)}, ${seed.minimumMatches ?? 1},
        ${seed.blocked ? 'now()' : 'null'},
        ${status === 'active' || status === 'closed' ? instant(seed.startAt) : 'null'},
        ${status === 'closed' ? instant(closedAt) : 'null'},
        ${status === 'closed' && seed.closedBy ? sqlText(seed.closedBy) : 'null'},
        ${status === 'closed' ? sqlText(seed.closedReason ?? (seed.closedBy ? 'manual' : 'fixed_end_reached')) : 'null'},
        gen_random_uuid(), '{}'::jsonb);`);
  return id;
}

export async function leagueRow(id: string): Promise<SqlRow> {
  const [row] = await sqlRows(
    `select id::text, status::text, version, activation_blocked_at, activated_at, closed_at,
        closed_by::text, closed_reason, start_at, end_at, end_mode::text, name, description, timezone,
        minimum_matches_for_final_award, owner_id::text
       from public.leagues where id = ${sqlText(id)}`
  );
  if (!row) throw new Error(`League ${id} not found`);
  return row;
}

export async function leagueEventActions(id: string): Promise<string[]> {
  return (
    await sqlRows(
      `select action || coalesce(':' || system_reason, '') as entry from public.league_events
        where league_id = ${sqlText(id)} order by occurred_at, id`
    )
  ).map((row) => String(row['entry']));
}

/** Runs the internal lifecycle processor at an exact instant. */
export async function processLeaguesAt(asOf: string, limit = 25): Promise<SqlRow> {
  const [row] = await sqlRows(
    `select public.process_due_leagues(${limit}, ${instant(asOf)}) as result`
  );
  return recordOf(row?.['result']);
}

/** Local calendar day offset from today in the given zone, as `YYYY-MM-DD`. */
export function localDate(offsetDays: number, timezone: LeagueTimezone = 'Europe/Madrid'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date(Date.now() + offsetDays * 86_400_000));
  return parts;
}

export type CreateLeagueArgs = Database['public']['Functions']['create_league']['Args'];

export function createLeagueArgs(
  communityId: string,
  overrides: Partial<CreateLeagueArgs> = {}
): CreateLeagueArgs {
  return {
    p_request_id: crypto.randomUUID(),
    p_community_id: communityId,
    p_name: `League ${crypto.randomUUID().slice(0, 8)}`,
    p_end_mode: 'fixed_date',
    p_start_date: localDate(30),
    p_end_date: localDate(60),
    p_minimum_matches: 1,
    ...overrides
  };
}
