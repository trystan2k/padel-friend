import type { ManagementActor } from './match-management-fixtures';
import { asRecord, fixtureSql, sqlRows } from './match-registration-sql';
import {
  createRankedResultFixtures,
  playedAt,
  rankedSets,
  type RankedResultKit
} from './ranked-result-fixtures';
import { sqlText } from './provisional-player-fixtures';

export const DRAW_SETS = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
  { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
];
export const INCOMPLETE_SETS = [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }];

export type Result = 'win' | 'draw' | 'incomplete';
export type WorldGroup = {
  key: string;
  community: 'main' | 'other';
  type: 'competitive' | 'friendly';
  league: 'active' | 'closed' | null;
  result: Result;
  /** Player indexes (0-7) per team; team_a wins a 'win'. */
  teamA: number[];
  teamB: number[];
  day: string;
  groupId: string;
};

/** Normal-set contribution of one group (both teams together) and per team, independent of any reader. */
export const SCORES: Record<
  Result,
  { setsA: number; setsB: number; gamesA: number; gamesB: number }
> = {
  win: { setsA: 2, setsB: 0, gamesA: 12, gamesB: 7 },
  draw: { setsA: 1, setsB: 1, gamesA: 11, gamesB: 11 },
  incomplete: { setsA: 1, setsB: 0, gamesA: 6, gamesB: 4 }
};

const SETS: Record<Result, unknown> = {
  win: rankedSets,
  draw: DRAW_SETS,
  incomplete: INCOMPLETE_SETS
};
const HOUR = 3600;

type Spec = Omit<WorldGroup, 'day' | 'groupId'> & { ageSeconds: number; groupNumber?: number };

/**
 * Plan: nine groups in the main community (two Leagues, Friendly, Draw, Incomplete, rotated teams)
 * and two in a second community the first player also belongs to. The same quartet meets six times
 * so a closest rivalry (>= 5 decided meetings) exists.
 */
const SPECS: Spec[] = [
  {
    key: 'g1',
    community: 'main',
    type: 'competitive',
    league: 'closed',
    result: 'win',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 72 * HOUR
  },
  {
    key: 'g7',
    community: 'main',
    type: 'competitive',
    league: null,
    result: 'win',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 71 * HOUR
  },
  {
    key: 'g8',
    community: 'main',
    type: 'competitive',
    league: null,
    result: 'win',
    teamA: [2, 3],
    teamB: [0, 1],
    ageSeconds: 70 * HOUR
  },
  {
    key: 'g9',
    community: 'main',
    type: 'competitive',
    league: null,
    result: 'draw',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 69 * HOUR
  },
  {
    key: 'g2',
    community: 'main',
    type: 'competitive',
    league: 'active',
    result: 'win',
    teamA: [0, 2],
    teamB: [1, 3],
    ageSeconds: 25 * HOUR
  },
  {
    key: 'g3',
    community: 'main',
    type: 'friendly',
    league: null,
    result: 'win',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 24 * HOUR + 1800
  },
  {
    key: 'g4',
    community: 'main',
    type: 'competitive',
    league: null,
    result: 'draw',
    teamA: [4, 5],
    teamB: [6, 7],
    ageSeconds: 20 * HOUR,
    groupNumber: 2
  },
  {
    key: 'g5',
    community: 'main',
    type: 'competitive',
    league: null,
    result: 'incomplete',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 18 * HOUR
  },
  {
    key: 'g6',
    community: 'main',
    type: 'competitive',
    league: 'active',
    result: 'win',
    teamA: [6, 7],
    teamB: [4, 5],
    ageSeconds: 600,
    groupNumber: 2
  },
  {
    key: 'h1',
    community: 'other',
    type: 'competitive',
    league: null,
    result: 'win',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 2 * HOUR
  },
  {
    key: 'h2',
    community: 'other',
    type: 'friendly',
    league: null,
    result: 'win',
    teamA: [0, 1],
    teamB: [2, 3],
    ageSeconds: 3 * HOUR
  }
];

/**
 * Real confirmed history for the community statistics suites. Player 0 belongs to both communities;
 * the other main players only to the main one. Cleans up its own projection rows afterwards.
 */
export async function buildCommunityWorld(env: { url: string; key: string }) {
  const main = await createRankedResultFixtures(env);
  const other = await createRankedResultFixtures(env);
  const memberships = (kit: RankedResultKit) =>
    fixtureSql(`do $$ begin
      alter table public.community_members disable trigger community_member_guard;
      update public.community_members set valid_from = now() - interval '10 days',
        activated_at = now() - interval '10 days' where community_id = ${sqlText(kit.communityId)};
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  await memberships(main);
  await memberships(other);
  // The first main player also belongs to the second community.
  await fixtureSql(`insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
    values (${sqlText(other.communityId)}, ${sqlText(main.players[0]!.id)}, 'member', 'active',
      now() - interval '10 days', now() - interval '10 days');`);
  const leagues = {
    active: await main.league({
      status: 'active',
      endMode: 'manual',
      endAt: null,
      name: 'Active League'
    }),
    closed: await main.league({
      status: 'closed',
      name: 'Closed League',
      startAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() - 60 * HOUR * 1000).toISOString(),
      closedAt: new Date(Date.now() - 60 * HOUR * 1000).toISOString()
    })
  };
  const outsider = await main.actor();

  const groups: WorldGroup[] = [];
  for (const spec of SPECS) {
    const kit = spec.community === 'main' ? main : other;
    const pick = (indexes: number[]): ManagementActor[] =>
      indexes.map((index) => kit.players[index]!);
    const teamA = pick(spec.teamA);
    const teamB = pick(spec.teamB);
    const leagueId = spec.league ? leagues[spec.league] : null;
    const event = await kit.event(leagueId, spec.type);
    const played = playedAt(spec.ageSeconds);
    // The event creator submits (players[0]); the approval comes from the side opposing the submitter.
    // The creator submits; a participant of the opposing side (or, for a group the creator does not
    // play in, of the first team) approves.
    const submitter = kit.players[0]!;
    const approvers = teamA.includes(submitter)
      ? [teamB[0]!]
      : teamB.includes(submitter)
        ? [teamA[0]!]
        : [teamA[0]!, teamB[0]!];
    const submitted = await kit.rpc(submitter, 'submit_match_event_result', {
      p_match_event_id: event,
      p_group_number: spec.groupNumber ?? 1,
      p_teams: { team_a: teamA.map((p) => p.id), team_b: teamB.map((p) => p.id) },
      p_sets: SETS[spec.result],
      p_played_local: played.played,
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
    if (submitted.error) throw new Error(`${spec.key}: ${submitted.error.message}`);
    const groupId = String(asRecord(submitted.data)['proposal_id']);
    for (const approver of approvers) {
      const approved = await kit.approve(groupId, 1, approver);
      if (approved.error) throw new Error(`${spec.key} approve: ${approved.error.message}`);
    }
    const [fact] = await sqlRows(
      `select count(*)::int as n from public.statistics_group_facts where game_group_id = ${sqlText(groupId)}`
    );
    if (fact?.['n'] !== 1) throw new Error(`${spec.key}: result was not confirmed`);
    const { community, key, type, league, result, teamA: a, teamB: b } = spec;
    groups.push({
      key,
      community,
      type,
      league,
      result,
      teamA: a,
      teamB: b,
      day: played.iso.slice(0, 10),
      groupId
    });
  }

  const cleanup = async () => {
    for (const kit of [main, other]) {
      await fixtureSql(
        `delete from public.statistics_scope_summaries where scope_id = ${sqlText(kit.communityId)}
           or subject_a = ${sqlText(kit.communityId)} or scope_id = any (array(select id from public.leagues where community_id = ${sqlText(kit.communityId)}));
         delete from public.statistics_daily_buckets where scope_id = ${sqlText(kit.communityId)}
           or subject_a = ${sqlText(kit.communityId)} or scope_id = any (array(select id from public.leagues where community_id = ${sqlText(kit.communityId)}));`
      );
    }
    await other.cleanup();
    await main.cleanup();
  };

  return {
    main,
    other,
    leagues,
    outsider,
    groups,
    cleanup,
    players: main.players,
    otherPlayers: other.players
  };
}
export type CommunityWorld = Awaited<ReturnType<typeof buildCommunityWorld>>;
