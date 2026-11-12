import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodeDailyBucket,
  decodeSummaryRow
} from '../src/features/statistics/statistics-decoders';
import { mergeDailyBuckets } from '../src/features/statistics/statistics-model';
import type {
  StatisticsMatchType,
  StatisticsScopeKind,
  StatisticsSubjectKind
} from '../src/features/statistics/statistics-contracts';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const NIL = '00000000-0000-0000-0000-000000000000';

const set = (position: number, a: number, b: number, completed = true) => ({
  position,
  team_a_games: a,
  team_b_games: b,
  completed
});
const teamAWins = [set(1, 6, 4), set(2, 6, 3)];
// Draw: the unfinished third contributes games but neither a set nor a winner.
const drawnUnfinishedThird = [set(1, 6, 4), set(2, 3, 6), set(3, 2, 1, false)];
const incompleteOneSet = [set(1, 6, 4)];

/**
 * PAF-13 U1: facts, summaries and buckets are projected by the shared finalizer, are idempotent,
 * replace old dimension keys when the official source changes and rebuild to identical values.
 */
describe.skipIf(!environment.env)('Statistics projection', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;
  let leagueId: string;
  type Group = { eventId: string; proposalId: string };
  const unset: Group = { eventId: '', proposalId: '' };
  const groups: Record<'win' | 'draw' | 'incomplete' | 'league', Group> = {
    win: unset,
    draw: unset,
    incomplete: unset,
    league: unset
  };

  const P = (index: number) => kit.players[index]!.id;
  const L = (id: string) => sqlText(id);

  async function confirm(eventId: string, sets: unknown, secondsAgo: number) {
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played, { sets });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    const approved = await kit.approve(proposalId);
    expect(approved.error).toBeNull();
    return proposalId;
  }
  const control = async () =>
    asRecord(
      (
        await sqlRows('select revision, rating_revision from public.statistics_projection_control')
      )[0]
    );

  const summaryJson = async (
    kind: StatisticsSubjectKind,
    a: string,
    b: string,
    scope: StatisticsScopeKind,
    scopeId: string,
    type: StatisticsMatchType
  ) => {
    const [row] = await sqlRows(
      `select to_jsonb(s) as r from public.statistics_scope_summaries s
        where subject_kind = ${L(kind)} and subject_a = ${L(a)} and subject_b = ${L(b)}
          and scope_kind = ${L(scope)} and scope_id = ${L(scopeId)} and match_type = ${L(type)}`
    );
    return row ? decodeSummaryRow(row['r']) : undefined;
  };
  const dailyBuckets = async (
    kind: StatisticsSubjectKind,
    a: string,
    b: string,
    scope: StatisticsScopeKind,
    scopeId: string,
    type: StatisticsMatchType
  ) =>
    (
      await sqlRows(
        `select to_jsonb(d) as r from public.statistics_daily_buckets d
          where subject_kind = ${L(kind)} and subject_a = ${L(a)} and subject_b = ${L(b)}
            and scope_kind = ${L(scope)} and scope_id = ${L(scopeId)} and match_type = ${L(type)}`
      )
    ).map((row) => decodeDailyBucket(row['r']));

  /** Business values only (no operational timestamps) of everything this fixture projected. */
  async function snapshot() {
    const players = kit.players.map((player) => L(player.id)).join(',');
    const [row] = await sqlRows(
      `select
        (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from (
           select to_jsonb(f) - 'projected_at' - 'updated_at' as x from public.statistics_group_facts f
            where f.community_id = ${L(kit.communityId)}) q) as facts,
        (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from (
           select to_jsonb(f) - 'updated_at' as x from public.statistics_participant_facts f where f.community_id = ${L(kit.communityId)}
           union all select to_jsonb(f) - 'updated_at' from public.statistics_pair_facts f where f.community_id = ${L(kit.communityId)}
           union all select to_jsonb(f) - 'updated_at' from public.statistics_opponent_facts f where f.community_id = ${L(kit.communityId)}) q) as children,
        (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from (
           select to_jsonb(s) - 'updated_at' as x from public.statistics_scope_summaries s
            where s.subject_players && array[${players}]::uuid[] or s.subject_a = ${L(kit.communityId)}) q) as summaries,
        (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from (
           select to_jsonb(d) - 'updated_at' as x from public.statistics_daily_buckets d
            where d.subject_players && array[${players}]::uuid[] or d.subject_a = ${L(kit.communityId)}) q) as buckets`
    );
    return row!;
  }

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!, { levels: [4, 4, 4, 4, 4, 4, 4, 4] });
    leagueId = await kit.league();
    const win = await kit.event();
    const draw = await kit.event(null, 'friendly');
    const incomplete = await kit.event();
    const league = await kit.event(leagueId);
    groups.win = { eventId: win, proposalId: await confirm(win, teamAWins, 400) };
    groups.draw = { eventId: draw, proposalId: await confirm(draw, drawnUnfinishedThird, 300) };
    groups.incomplete = {
      eventId: incomplete,
      proposalId: await confirm(incomplete, incompleteOneSet, 200)
    };
    groups.league = { eventId: league, proposalId: await confirm(league, teamAWins, 100) };
  });
  afterAll(async () => {
    if (!kit) return;
    const players = kit.players.map((player) => L(player.id)).join(',');
    await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};`);
    await kit.cleanup();
  });

  it('backfills confirmed Friendly, Competitive and Incomplete groups as one fact each', async () => {
    const rows = await sqlRows(
      `select game_group_id::text, match_type, classification, league_eligible, rating_expected,
              sets_a, sets_b, games_a, games_b, three_set, incomplete_decider, straight_winner
         from public.statistics_group_facts where community_id = ${L(kit.communityId)} order by played_at`
    );
    expect(rows).toEqual([
      expect.objectContaining({
        game_group_id: groups.win.proposalId,
        match_type: 'competitive',
        classification: 'team_a',
        league_eligible: false,
        rating_expected: true,
        sets_a: 2,
        sets_b: 0,
        games_a: 12,
        games_b: 7,
        straight_winner: 'team_a'
      }),
      expect.objectContaining({
        game_group_id: groups.draw.proposalId,
        match_type: 'friendly',
        classification: 'draw',
        rating_expected: false,
        sets_a: 1,
        sets_b: 1,
        games_a: 11,
        games_b: 11,
        three_set: true,
        incomplete_decider: true,
        straight_winner: null
      }),
      expect.objectContaining({
        game_group_id: groups.incomplete.proposalId,
        match_type: 'competitive',
        classification: 'incomplete',
        rating_expected: false,
        sets_a: 1,
        sets_b: 0,
        games_a: 6,
        games_b: 4
      }),
      expect.objectContaining({
        game_group_id: groups.league.proposalId,
        match_type: 'competitive',
        classification: 'team_a',
        league_eligible: true,
        rating_expected: true
      })
    ]);
  });

  it('keys the logical group by proposal id, never the confirmation id, with exact source evidence', async () => {
    const rows = await sqlRows(
      `select f.game_group_id::text, f.confirmation_id::text, f.proposal_version::int, f.confirmation_source,
              c.id::text as source_confirmation, c.proposal_id::text as source_proposal, f.audit_event_id is not null as audited
         from public.statistics_group_facts f
         join public.match_event_result_confirmations c on c.proposal_id = f.game_group_id
        where f.community_id = ${L(kit.communityId)}`
    );
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row['game_group_id']).toBe(row['source_proposal']);
      expect(row['confirmation_id']).toBe(row['source_confirmation']);
      expect(row['game_group_id']).not.toBe(row['confirmation_id']);
      expect(row).toMatchObject({
        proposal_version: 1,
        confirmation_source: 'MANUAL',
        audited: true
      });
    }
  });

  it('projects the actual quartet: four players, two canonical pairs, four opposing edges, no teammate edge', async () => {
    const { proposalId } = groups.win;
    const teams = kit.teamsOf();
    const [group] = await sqlRows(
      `select team_a_players::text[] as a, team_b_players::text[] as b,
              team_a_pair_id = public.statistics_pair_id(${L(teams.team_a[1]!)}, ${L(teams.team_a[0]!)}) as pair_a,
              team_b_pair_id = public.statistics_pair_id(${L(teams.team_b[1]!)}, ${L(teams.team_b[0]!)}) as pair_b,
              matchup_id = public.statistics_matchup_id(team_b_pair_id, team_a_pair_id) as matchup,
              quartet_id = public.statistics_quartet_id(array[${[...teams.team_a, ...teams.team_b].map(L).join(',')}]::uuid[]) as quartet
         from public.statistics_group_facts where game_group_id = ${L(proposalId)}`
    );
    expect(group).toMatchObject({
      a: teams.team_a,
      b: teams.team_b,
      pair_a: true,
      pair_b: true,
      matchup: true,
      quartet: true
    });
    const [counts] = await sqlRows(
      `select (select count(*)::int from public.statistics_participant_facts where game_group_id = ${L(proposalId)}) as participants,
              (select count(*)::int from public.statistics_pair_facts where game_group_id = ${L(proposalId)}) as pairs,
              (select count(*)::int from public.statistics_opponent_facts where game_group_id = ${L(proposalId)}) as opponents,
              (select count(*)::int from public.statistics_opponent_facts o
                where o.game_group_id = ${L(proposalId)}
                  and ((o.player_low = any (array[${teams.team_a.map(L).join(',')}]::uuid[]) and o.player_high = any (array[${teams.team_a.map(L).join(',')}]::uuid[]))
                    or (o.player_low = any (array[${teams.team_b.map(L).join(',')}]::uuid[]) and o.player_high = any (array[${teams.team_b.map(L).join(',')}]::uuid[])))) as teammate_edges`
    );
    expect(counts).toEqual({ participants: 4, pairs: 2, opponents: 4, teammate_edges: 0 });
    // Reserve-not-playing registrations (players 4-7 here) never get participant facts in this group.
    const reserve = await sqlRows(
      `select 1 from public.statistics_participant_facts
        where game_group_id = ${L(proposalId)} and user_id = any (array[${[4, 5, 6, 7].map((i) => L(P(i))).join(',')}]::uuid[])`
    );
    expect(reserve).toEqual([]);
  });

  it('counts sets, games, outcomes and Incomplete exactly for a team A player', async () => {
    const all = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    expect(all).toMatchObject({
      confirmed_groups: 4,
      wins: 2,
      losses: 0,
      draws: 1,
      incomplete_groups: 1,
      competitive_groups: 3,
      friendly_groups: 1,
      sets_won: 6,
      sets_lost: 1,
      games_won: 41,
      games_lost: 29,
      straight_set_wins: 2,
      three_set_groups: 1,
      incomplete_decider_groups: 1,
      deciding_set_wins: 0,
      deciding_set_losses: 0,
      first_set_won_groups: 3,
      first_set_won_converted: 2,
      first_set_lost_groups: 0,
      rated_groups: 2
    });
    expect(all?.sequence).toMatchObject({ n: 3, best_win: 1, best_loss: 0 });
    expect(all?.recent.map((item) => item.o)).toEqual(['W', 'D', 'W']);
    const loser = await summaryJson('player', P(2), NIL, 'all', NIL, 'all');
    expect(loser).toMatchObject({
      wins: 0,
      losses: 2,
      draws: 1,
      incomplete_groups: 1,
      sets_won: 1,
      sets_lost: 6,
      first_set_lost_groups: 3,
      first_set_lost_converted: 0,
      straight_set_losses: 2
    });
    expect(loser?.sequence).toMatchObject({ n: 3, best_loss: 1 });
  });

  it('splits the same history by type and League without leaking sibling scopes', async () => {
    const competitive = await summaryJson('player', P(0), NIL, 'all', NIL, 'competitive');
    const friendly = await summaryJson('player', P(0), NIL, 'all', NIL, 'friendly');
    expect(competitive).toMatchObject({
      confirmed_groups: 3,
      wins: 2,
      incomplete_groups: 1,
      friendly_groups: 0
    });
    expect(friendly).toMatchObject({ confirmed_groups: 1, draws: 1, competitive_groups: 0 });
    const community = await summaryJson('player', P(0), NIL, 'community', kit.communityId, 'all');
    expect(community?.confirmed_groups).toBe(4);
    const league = await summaryJson('player', P(0), NIL, 'league', leagueId, 'all');
    expect(league).toMatchObject({ confirmed_groups: 1, wins: 1, incomplete_groups: 0 });
    expect(await summaryJson('player', P(0), NIL, 'league', leagueId, 'friendly')).toBeUndefined();
    // A player outside the groups has no subject at all.
    expect(await summaryJson('player', P(5), NIL, 'all', NIL, 'all')).toBeUndefined();
  });

  it('records each Game Group once at community level, not once per player or pair', async () => {
    const community = await summaryJson(
      'community',
      kit.communityId,
      NIL,
      'community',
      kit.communityId,
      'all'
    );
    expect(community).toMatchObject({
      confirmed_groups: 4,
      wins: 2,
      draws: 1,
      incomplete_groups: 1,
      sets_won: 7,
      games_won: 70,
      competitive_groups: 3,
      friendly_groups: 1
    });
    const players = community?.relations['players'];
    expect(typeof players === 'object' ? Object.keys(players) : []).toHaveLength(4);
    expect(await summaryJson('community', kit.communityId, NIL, 'all', NIL, 'all')).toBeUndefined();
    const league = await summaryJson('community', kit.communityId, NIL, 'league', leagueId, 'all');
    expect(league?.confirmed_groups).toBe(1);
  });

  it('builds pair, directed opponent and matchup subjects from the same facts', async () => {
    const teams = kit.teamsOf();
    const [pair] = await sqlRows(
      `select public.statistics_pair_id(${L(teams.team_a[0]!)}, ${L(teams.team_a[1]!)})::text as id`
    );
    const pairSummary = await summaryJson('pair', String(pair?.['id']), NIL, 'all', NIL, 'all');
    expect(pairSummary).toMatchObject({
      confirmed_groups: 4,
      wins: 2,
      draws: 1,
      incomplete_groups: 1
    });
    const against = await summaryJson('opponent', P(0), P(2), 'all', NIL, 'all');
    const reverse = await summaryJson('opponent', P(2), P(0), 'all', NIL, 'all');
    expect(against).toMatchObject({ confirmed_groups: 4, wins: 2, losses: 0, draws: 1 });
    expect(reverse).toMatchObject({ confirmed_groups: 4, wins: 0, losses: 2, draws: 1 });
    // Teammates never meet as opponents.
    expect(await summaryJson('opponent', P(0), P(1), 'all', NIL, 'all')).toBeUndefined();
    const [matchup] = await sqlRows(
      `select matchup_low_pair_id::text as low, matchup_high_pair_id::text as high, matchup_low_side
         from public.statistics_group_facts where game_group_id = ${L(groups.win.proposalId)}`
    );
    const matchupSummary = await summaryJson(
      'matchup',
      String(matchup?.['low']),
      String(matchup?.['high']),
      'all',
      NIL,
      'all'
    );
    expect(matchupSummary?.confirmed_groups).toBe(4);
    const lowWins = matchup?.['matchup_low_side'] === 'team_a';
    expect(matchupSummary?.wins).toBe(lowWins ? 2 : 0);
    expect(matchupSummary?.losses).toBe(lowWins ? 0 : 2);
  });

  it('takes rating-derived fields from one committed revision and matches the ledger', async () => {
    const [aligned] = await sqlRows(
      `select k.rating_revision = r.committed_revision as aligned
         from public.statistics_projection_control k, public.player_rating_projection_control r`
    );
    expect(aligned?.['aligned']).toBe(true);
    const [row] = await sqlRows(
      `select
        (select coalesce(sum(rating_delta), 0)::text from public.statistics_participant_facts
          where user_id = ${L(P(0))} and community_id = ${L(kit.communityId)}) as stats_delta,
        (select coalesce(sum((c.explanation ->> 'applied_delta')::numeric), 0)::text
           from public.player_rating_events e
           join lateral (select k.* from public.player_rating_event_calculations k where k.rating_event_id = e.id
                          order by k.projection_revision desc limit 1) c on true
          where e.user_id = ${L(P(0))}) as ledger_delta`
    );
    expect(Number(row?.['stats_delta'])).toBeCloseTo(Number(row?.['ledger_delta']), 6);
    const summary = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    expect(summary?.rating_delta_sum).toBeCloseTo(Number(row?.['ledger_delta']), 6);
    // Friendly and Incomplete groups carry no rating evidence.
    const none = await sqlRows(
      `select 1 from public.statistics_participant_facts
        where game_group_id in (${L(groups.draw.proposalId)}, ${L(groups.incomplete.proposalId)}) and rating_calc_revision is not null`
    );
    expect(none).toEqual([]);
  });

  it('equals the ordered merge of its daily buckets', async () => {
    const summary = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    const buckets = await dailyBuckets('player', P(0), NIL, 'all', NIL, 'all');
    expect(buckets.length).toBeGreaterThan(0);
    const merged = mergeDailyBuckets(buckets);
    const {
      subject_kind,
      subject_a,
      subject_b,
      scope_kind,
      scope_id,
      match_type,
      subject_players,
      ...expected
    } = summary!;
    void [subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type, subject_players];
    const { rating_delta_sum, opponent_strength_sum, ...exact } = expected;
    const {
      rating_delta_sum: mergedDelta,
      opponent_strength_sum: mergedStrength,
      ...mergedExact
    } = merged;
    expect(mergedExact).toEqual(exact);
    expect(mergedDelta).toBeCloseTo(rating_delta_sum, 6);
    expect(mergedStrength).toBeCloseTo(opponent_strength_sum, 6);
  });

  it('is a no-op on duplicated finalization: same revision, same rows', async () => {
    const before = { control: await control(), snapshot: await snapshot() };
    const [stamp] = await sqlRows(
      `select max(updated_at)::text as at from public.statistics_group_facts where community_id = ${L(kit.communityId)}`
    );
    for (const group of Object.values(groups))
      await fixtureSql(
        `select public.finalize_match_event_result_locked(${L(group.proposalId)}::uuid, 1, 'MANUAL', ${L(P(2))}::uuid);`
      );
    expect(await control()).toEqual(before.control);
    expect(await snapshot()).toEqual(before.snapshot);
    const [after] = await sqlRows(
      `select max(updated_at)::text as at from public.statistics_group_facts where community_id = ${L(kit.communityId)}`
    );
    expect(after?.['at']).toBe(stamp?.['at']);
  });

  it('rebuilds to identical business values with no revision churn', async () => {
    // A first global rebuild may legitimately clear rows other suites left behind; baseline after it.
    await sqlRows('select public.rebuild_statistics(null) as r');
    const before = { control: await control(), snapshot: await snapshot() };
    await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    expect(await snapshot()).toEqual(before.snapshot);
    expect(await control()).toEqual(before.control);
    await sqlRows('select public.rebuild_statistics(null) as r');
    await sqlRows('select public.rebuild_statistics(null) as r');
    expect(await snapshot()).toEqual(before.snapshot);
    expect(await control()).toEqual(before.control);
  });

  it('repairs a corrupted derived row on rebuild and publishes the repair once', async () => {
    const before = await snapshot();
    const revision = Number((await control())['revision']);
    await fixtureSql(
      `update public.statistics_scope_summaries set competitive_groups = competitive_groups - 1, friendly_groups = friendly_groups + 1
        where subject_kind = 'player' and subject_a = ${L(P(0))} and scope_kind = 'all' and match_type = 'all'`
    );
    expect(await snapshot()).not.toEqual(before);
    await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    expect(await snapshot()).toEqual(before);
    expect(Number((await control())['revision'])).toBe(revision + 1);
    await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    expect(Number((await control())['revision'])).toBe(revision + 1);
  });

  it('removes old dimension keys and adds new ones when the official teams change', async () => {
    const { proposalId } = groups.league;
    const teams = kit.teamsOf();
    const oldPair = String(
      (
        await sqlRows(
          `select public.statistics_pair_id(${L(teams.team_a[0]!)}, ${L(teams.team_a[1]!)})::text as id`
        )
      )[0]?.['id']
    );
    const newPair = String(
      (
        await sqlRows(
          `select public.statistics_pair_id(${L(teams.team_a[0]!)}, ${L(teams.team_b[0]!)})::text as id`
        )
      )[0]?.['id']
    );
    const pairLeague = (id: string) => summaryJson('pair', id, NIL, 'league', leagueId, 'all');
    expect(await pairLeague(oldPair)).toMatchObject({ confirmed_groups: 1 });
    expect(await pairLeague(newPair)).toBeUndefined();

    // Trusted test seam: a replacement official version swaps one player of each side.
    const swapped = JSON.stringify({
      team_a: [teams.team_a[0], teams.team_b[0]],
      team_b: [teams.team_a[1], teams.team_b[1]]
    });
    const original = JSON.stringify(teams);
    const setTeams = (value: string) =>
      fixtureSql(`do $$ begin
        alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
        update public.match_event_result_proposal_versions set teams = ${L(value)}::jsonb where proposal_id = ${L(proposalId)};
        alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;
      end $$;`);
    try {
      await setTeams(swapped);
      await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
      expect(await pairLeague(oldPair)).toBeUndefined();
      expect(await pairLeague(newPair)).toMatchObject({ confirmed_groups: 1 });
      const league = await summaryJson('player', P(0), NIL, 'league', leagueId, 'all');
      expect(league).toMatchObject({ confirmed_groups: 1, wins: 1, losses: 0 });
      // The old opponent edge (P0 vs P1 teammates now opposed) appears; the new teammates (P0, P2) lose theirs.
      expect(await summaryJson('opponent', P(0), P(1), 'league', leagueId, 'all')).toMatchObject({
        confirmed_groups: 1
      });
      expect(await summaryJson('opponent', P(0), P(3), 'league', leagueId, 'all')).toMatchObject({
        confirmed_groups: 1
      });
      expect(await summaryJson('opponent', P(0), P(2), 'league', leagueId, 'all')).toBeUndefined();
    } finally {
      await setTeams(original);
      await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    }
    expect(await pairLeague(oldPair)).toMatchObject({ confirmed_groups: 1 });
    expect(await pairLeague(newPair)).toBeUndefined();
  });

  it('moves a group between type scopes when the event type changes', async () => {
    const { eventId, proposalId } = groups.win;
    const setType = (type: string) =>
      fixtureSql(`do $$ begin
        alter table public.match_events disable trigger match_event_immutable;
        alter table public.match_events disable trigger match_event_league_binding;
        update public.match_events set event_type = '${type}' where id = ${L(eventId)};
        alter table public.match_events enable trigger match_event_league_binding;
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    const before = await summaryJson('player', P(0), NIL, 'all', NIL, 'friendly');
    expect(before?.confirmed_groups).toBe(1);
    try {
      await setType('friendly');
      await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
      expect(
        (await summaryJson('player', P(0), NIL, 'all', NIL, 'friendly'))?.confirmed_groups
      ).toBe(2);
      const [fact] = await sqlRows(
        `select match_type from public.statistics_group_facts where game_group_id = ${L(proposalId)}`
      );
      expect(fact?.['match_type']).toBe('friendly');
    } finally {
      await setType('competitive');
      await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    }
    expect((await summaryJson('player', P(0), NIL, 'all', NIL, 'friendly'))?.confirmed_groups).toBe(
      1
    );
  });

  it('backfills existing confirmed history from nothing, equal to the online projection', async () => {
    const before = { control: await control(), snapshot: await snapshot() };
    const players = kit.players.map((player) => L(player.id)).join(',');
    // A pre-feature database: confirmations exist, no statistics rows do.
    await fixtureSql(`delete from public.statistics_group_facts where community_id = ${L(kit.communityId)};
      delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};`);
    const [empty] = await sqlRows(
      `select count(*)::int as n from public.statistics_group_facts where community_id = ${L(kit.communityId)}`
    );
    expect(empty?.['n']).toBe(0);
    await sqlRows('select public.rebuild_statistics(null) as r');
    expect(await snapshot()).toEqual(before.snapshot);
    expect(Number((await control())['revision'])).toBeGreaterThan(
      Number(before.control['revision'])
    );
  });

  it('refreshes rating-derived fields of earlier groups when a late confirmation replays the ledger', async () => {
    const late = await kit.event();
    // Played before every existing group: the rating projector replays the whole stream.
    const proposalId = await confirm(late, teamAWins, 5_000);
    const [stale] = await sqlRows(
      `select count(*)::int as n
         from public.statistics_participant_facts pf
         left join lateral (
           select c.projection_revision, (c.explanation ->> 'applied_delta')::numeric as delta
             from public.player_rating_events e
             join public.player_rating_event_calculations c on c.rating_event_id = e.id
            where e.game_group_id = pf.game_group_id and e.user_id = pf.user_id
            order by c.projection_revision desc limit 1) l on true
        where pf.community_id = ${L(kit.communityId)} and pf.rating_expected
          and (pf.rating_calc_revision is distinct from l.projection_revision or pf.rating_delta is distinct from l.delta)`
    );
    expect(stale?.['n']).toBe(0);
    const [aligned] = await sqlRows(
      `select k.rating_revision = r.committed_revision as aligned
         from public.statistics_projection_control k, public.player_rating_projection_control r`
    );
    expect(aligned?.['aligned']).toBe(true);
    const [fact] = await sqlRows(
      `select classification from public.statistics_group_facts where game_group_id = ${L(proposalId)}`
    );
    expect(fact?.['classification']).toBe('team_a');
    // The replayed group sorts first, so the player's resolved sequence now starts with its win.
    const summary = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    expect(summary?.confirmed_groups).toBe(5);
    expect(summary?.recent[0]?.g).toBe(proposalId);
    const before = await snapshot();
    await sqlRows(`select public.rebuild_statistics(${L(kit.communityId)}) as r`);
    expect(await snapshot()).toEqual(before);
  });

  it('collapses the same matchup arranged with swapped team sides into one subject', async () => {
    const before = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    const event = await kit.event();
    const teams = kit.teamsOf();
    const submitted = await kit.rpc(kit.players[0]!, 'submit_match_event_result', {
      p_match_event_id: event,
      p_group_number: 1,
      p_teams: { team_a: teams.team_b, team_b: teams.team_a },
      p_sets: teamAWins,
      p_played_local: playedAt(50).played,
      p_court_label: 'Court 1',
      p_request_id: crypto.randomUUID()
    });
    expect(submitted.error).toBeNull();
    const approved = await kit.approve(String(asRecord(submitted.data)['proposal_id']));
    expect(approved.error).toBeNull();
    const [matchup] = await sqlRows(
      `select matchup_low_pair_id::text as low, matchup_high_pair_id::text as high, count(*)::int as groups,
              count(distinct matchup_id)::int as matchups, count(distinct quartet_id)::int as quartets
         from public.statistics_group_facts where community_id = ${L(kit.communityId)}
        group by 1, 2`
    );
    expect(matchup).toMatchObject({ groups: 6, matchups: 1, quartets: 1 });
    const subject = await summaryJson(
      'matchup',
      String(matchup?.['low']),
      String(matchup?.['high']),
      'all',
      NIL,
      'all'
    );
    expect(subject?.confirmed_groups).toBe(6);
    // P0 now also lost a group from the swapped side; the new group is a win for P2/P3's side.
    const after = await summaryJson('player', P(0), NIL, 'all', NIL, 'all');
    expect(after?.confirmed_groups).toBe((before?.confirmed_groups ?? 0) + 1);
    expect(after?.losses).toBe((before?.losses ?? 0) + 1);
    expect(after?.relations['combos']).toBeDefined();
    expect(Object.keys(after?.relations['combos'] ?? {})).toHaveLength(1);
  });

  it('rejects a rebuild of an unknown community', async () => {
    await expect(
      sqlRows(`select public.rebuild_statistics(${L(crypto.randomUUID())})`)
    ).rejects.toThrow('COMMUNITY_NOT_FOUND');
  });
});
