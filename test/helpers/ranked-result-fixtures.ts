import { insertLeague, type LeagueSeed } from './league-fixtures';
import { localSupabaseEnv } from './local-supabase-env';
import { createMatchManagementFixtures, type ManagementActor } from './match-management-fixtures';
import { fixtureSql, sqlRows } from './match-registration-sql';
import { sqlText } from './provisional-player-fixtures';
import {
  communityMemberGuard,
  matchEventImmutable,
  matchEventLeagueBinding,
  withTriggersDisabled
} from './trigger-state-sql';

/** Two completed sets: team A wins, so the group classifies (and rates) as a decided result. */
export const rankedSets = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];

/** Whole-second UTC instant (the result protocol is second-granular), as the three played forms. */
export function playedAt(secondsAgo: number) {
  const instant = new Date(Math.floor((Date.now() - secondsAgo * 1000) / 1000) * 1000);
  const iso = instant.toISOString();
  return {
    iso: iso.replace('.000Z', 'Z'),
    played: {
      local: iso.slice(0, 19).replace('T', ' '),
      offset_seconds: 0,
      instant: iso
    }
  };
}

/** `instant` moved by whole microseconds, computed by PostgreSQL (JS Dates stop at ms). */
export async function shiftInstant(instant: string, microseconds: number): Promise<string> {
  const [row] = await sqlRows(
    `select to_char((${sqlText(instant)}::timestamptz + (${microseconds} * interval '1 microsecond')) at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as instant`
  );
  return String(row?.['instant']);
}

export type MembershipSpec = {
  /** ISO instant; null makes a pending (never activated) interval. */
  activatedAt: string | null;
  /** ISO instant the interval ended; null keeps it open (active). */
  validUntil?: string | null;
};

/**
 * Rewrites a player's membership history through trusted SQL: one interval per spec, in order.
 * The community-member guard is disabled only for this statement batch.
 */
export async function setMembershipHistory(
  communityId: string,
  userId: string,
  intervals: MembershipSpec[]
): Promise<void> {
  const rows = intervals.map((interval) => {
    const closed = interval.validUntil != null;
    const from = interval.activatedAt ?? '1970-01-01T00:00:00Z';
    const status = closed ? 'inactive' : interval.activatedAt === null ? 'pending' : 'active';
    return `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at,valid_until)
      values (${sqlText(communityId)},${sqlText(userId)},coalesce(v_role,'member'),'${status}',
        ${sqlText(from)}::timestamptz,
        ${interval.activatedAt ? `${sqlText(interval.activatedAt)}::timestamptz` : 'null'},
        ${closed ? `${sqlText(interval.validUntil!)}::timestamptz` : 'null'});`;
  });
  await withTriggersDisabled(
    [communityMemberGuard],
    `declare v_role public.community_member_role; begin
      select role into v_role from public.community_members
       where community_id=${sqlText(communityId)} and user_id=${sqlText(userId)}
       order by valid_from desc limit 1;
      delete from public.community_members where community_id=${sqlText(communityId)} and user_id=${sqlText(userId)};
      ${rows.join('\n')}
    end;`
  );
}

/**
 * Real actors + FK-safe result fixtures for Ranked (League-bound) and Unranked Competitive groups.
 * Memberships are backdated one day so any played instant in the last hours is covered by default;
 * individual tests rewrite a player's history to probe the interval edges.
 */
export async function createRankedResultFixtures(
  env: { url: string; key: string },
  options: { levels?: number[] } = {}
) {
  const base = await createMatchManagementFixtures(env);
  const players: ManagementActor[] = [
    base.creator,
    ...(await Promise.all(Array.from({ length: 7 }, () => base.member())))
  ];
  // Decided Ranked/Unranked groups feed the app-wide rating projection, which needs a rating
  // state for every participant (the usual onboarding outcome).
  await fixtureSql(
    players
      .map(
        (player, index) =>
          `insert into public.player_profiles(user_id, display_name, preferred_side)
             values (${sqlText(player.id)}, ${sqlText(`Ranked Player ${index + 1}`)}, 'EITHER');
           select public.initialize_global_player_rating_locked(${sqlText(player.id)}, ${options.levels?.[index] ?? 4.0}, 'onboarding');`
      )
      .join('\n')
  );
  await withTriggersDisabled(
    [communityMemberGuard],
    `update public.community_members
       set valid_from = now() - interval '1 day', activated_at = now() - interval '1 day'
     where community_id = ${sqlText(base.communityId)};`
  );

  const league = (overrides: Partial<LeagueSeed> = {}) =>
    insertLeague({
      communityId: base.communityId,
      ownerId: base.creator.id,
      // Eligibility is window-based, so Upcoming leagues avoid the one-Active-per-community limit.
      status: 'upcoming',
      startAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
      ...overrides
    });

  /** Competitive event with the first two quartets frozen; League-bound when `leagueId` is given. */
  async function event(
    leagueId: string | null = null,
    eventType: 'competitive' | 'friendly' = 'competitive',
    protect = true
  ) {
    const created = await base.event({ accepted: players.slice(1) });
    // One transaction for the retype/league bind and the overdue cutoff. The binding guard is
    // re-enabled between the two updates so the cutoff update still runs under it, exactly as
    // the former separate setCutoff transaction did; the final restore keeps the original state.
    await withTriggersDisabled(
      [matchEventImmutable, matchEventLeagueBinding],
      [
        `update public.match_events set event_type='${eventType}',
          league_id=${leagueId ? sqlText(leagueId) : 'null'} where id=${sqlText(created.id)};`,
        'alter table public.match_events enable trigger match_event_league_binding;',
        `update public.match_events set registration_cutoff_at=now()-interval '1 minute' where id=${sqlText(created.id)};`
      ]
    );
    if (protect) await base.protectResults(created.id);
    return created.id;
  }

  const group = (groupNumber = 1) => players.slice((groupNumber - 1) * 4, groupNumber * 4);
  const teamsOf = (groupNumber = 1) => {
    const ids = group(groupNumber).map((p) => p.id);
    return { team_a: ids.slice(0, 2), team_b: ids.slice(2) };
  };

  function submit(
    eventId: string,
    played: ReturnType<typeof playedAt>['played'],
    submission: { groupNumber?: number; sets?: unknown } = {}
  ) {
    return base.rpc(players[0]!, 'submit_match_event_result', {
      p_match_event_id: eventId,
      p_group_number: submission.groupNumber ?? 1,
      p_teams: teamsOf(submission.groupNumber ?? 1),
      p_sets: submission.sets ?? rankedSets,
      p_played_local: played,
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
  }

  function correct(
    proposal: string,
    version: number,
    played: ReturnType<typeof playedAt>['played'],
    actor: ManagementActor = players[0]!
  ) {
    return base.rpc(actor, 'correct_match_event_result', {
      p_proposal_id: proposal,
      p_expected_version: version,
      p_teams: teamsOf(1),
      p_sets: rankedSets,
      p_played_local: played,
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
  }

  /** Opposing-team approval (players[2] is on the team opposite the creator). */
  function approve(proposal: string, version = 1, actor: ManagementActor = players[2]!) {
    return base.rpc(actor, 'review_match_event_result', {
      p_proposal_id: proposal,
      p_expected_version: version,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
  }

  async function proposalId(eventId: string, groupNumber = 1): Promise<string> {
    const [row] = await sqlRows(
      `select id::text from public.match_event_result_proposals
        where match_event_id = ${sqlText(eventId)} and group_number = ${groupNumber}`
    );
    return String(row?.['id']);
  }

  /** Everything a rejected or blocked command must leave untouched. */
  async function sideEffects(eventId: string) {
    const [row] = await sqlRows(
      `select
        (select count(*)::int from public.match_event_result_proposals where match_event_id = ${sqlText(eventId)}) as proposals,
        (select count(*)::int from public.match_event_result_proposal_versions v
           join public.match_event_result_proposals p on p.id = v.proposal_id
          where p.match_event_id = ${sqlText(eventId)}) as versions,
        (select count(*)::int from public.match_event_result_reviews r
           join public.match_event_result_proposals p on p.id = r.proposal_id
          where p.match_event_id = ${sqlText(eventId)}) as reviews,
        (select count(*)::int from public.match_event_result_confirmations where match_event_id = ${sqlText(eventId)}) as confirmations,
        (select count(*)::int from public.player_rating_events e
           join public.match_event_result_confirmations c on c.proposal_id = e.game_group_id
          where c.match_event_id = ${sqlText(eventId)}) as rating_events,
        (select count(*)::int from public.match_event_audit_log
          where match_event_id = ${sqlText(eventId)} and action like 'result\\_%') as audits`
    );
    return row!;
  }

  async function setLeagueClosedAt(leagueId: string, closedAt: string) {
    await fixtureSql(
      `update public.leagues set closed_at=${sqlText(closedAt)}::timestamptz where id=${sqlText(leagueId)};`
    );
  }

  /** Restores every player to one open, long-standing membership (roles preserved). */
  async function resetMemberships() {
    const since = new Date(Date.now() - 86_400_000).toISOString();
    for (const player of players)
      await setMembershipHistory(base.communityId, player.id, [{ activatedAt: since }]);
  }

  return {
    ...base,
    players,
    resetMemberships,
    league,
    event,
    group,
    teamsOf,
    submit,
    correct,
    approve,
    proposalId,
    sideEffects,
    setLeagueClosedAt
  };
}

export type RankedResultKit = Awaited<ReturnType<typeof createRankedResultFixtures>>;

/** Local Supabase env for a test file, or null when none is configured (suites then skip). */
export const rankedKitEnv = () => localSupabaseEnv().env;
