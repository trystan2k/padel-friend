import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { LeagueStandingEntry } from '../src/features/leagues/league-standings-contracts';
import { decodeLeagueStandings } from '../src/features/leagues/league-standings-decoders';
import { insertLeague, leagueWorld, type LeagueWorld } from './helpers/league-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const teamAWins = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];
// Draw whose third set was never completed: it contributes no set to either side.
const drawnUnfinishedThird = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
  { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
];

type Record5 = { w: number; l: number; d?: number; sw: number; sl: number };

/**
 * PAF-12 U2: deterministic standings over the materialized counters plus the zero overlay, shared
 * competition positions, threshold-only award state and the reader's authorization.
 */
describe.skipIf(!environment.env)('League standings reader', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    // Opposite app-wide strengths: standings must follow records, never level.
    kit = await createRankedResultFixtures(environment.env!, {
      levels: [7, 7, 6, 6, 1, 1, 0, 0]
    });
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });

  const id = (index: number) => kit.players[index]!.id;
  const standingsOf = async (leagueId: string, actor = kit.creator) => {
    const response = await kit.rpc(actor, 'get_league_standings', { p_league_id: leagueId });
    expect(response.error).toBeNull();
    return decodeLeagueStandings(response.data);
  };
  /** Trusted direct counters: used ONLY to isolate the rank function from the projection. */
  async function seedCounters(leagueId: string, records: Record<number, Record5>) {
    const values = Object.entries(records).map(([index, r]) => {
      const draws = r.d ?? 0;
      return `(${sqlText(leagueId)}::uuid, ${sqlText(kit.communityId)}::uuid, ${sqlText(id(Number(index)))}::uuid,
        ${r.w + r.l + draws}, ${r.w}, ${r.l}, ${draws}, ${r.sw}, ${r.sl})`;
    });
    await fixtureSql(
      `insert into public.league_player_counters(league_id, community_id, user_id, matches, wins, losses, draws, sets_won, sets_lost)
         values ${values.join(',')};`
    );
  }
  const indexOf = (userId: string) => kit.players.findIndex((player) => player.id === userId);
  const summary = (entries: LeagueStandingEntry[]) =>
    entries.map((entry) => [indexOf(entry.user_id), entry.position]);
  /** Rows sharing a position are presented by UUID, which is not a sporting order. */
  const byUuid = (indexes: number[]) => [...indexes].sort((a, b) => id(a).localeCompare(id(b)));

  // Records: wins desc, losses asc, set diff desc, sets won desc.
  const ladder: Record<string, Record5> = {
    top: { w: 3, l: 0, sw: 6, sl: 0 },
    moreSetsWon: { w: 2, l: 1, sw: 5, sl: 3 }, // diff +2, sets won 5
    fewerSetsWon: { w: 2, l: 1, sw: 4, sl: 2 }, // diff +2, sets won 4
    moreLosses: { w: 2, l: 2, sw: 8, sl: 2 }, // best diff, but a second loss
    tiedA: { w: 1, l: 0, d: 2, sw: 3, sl: 1 }, // 3 matches
    tiedB: { w: 1, l: 0, sw: 3, sl: 1 }, // 1 match, same four keys
    zeroA: { w: 0, l: 0, sw: 0, sl: 0 },
    zeroB: { w: 0, l: 0, sw: 0, sl: 0 }
  };
  const names = Object.keys(ladder);

  it.each([
    ['level order', [0, 1, 2, 3, 4, 5, 6, 7]],
    ['reversed level order', [7, 6, 5, 4, 3, 2, 1, 0]]
  ])('orders Wins, Losses, Set Diff, Sets Won and shares full ties (%s)', async (_label, seats) => {
    const leagueId = await kit.league();
    // seats[n] is the player who holds ladder rung n; rungs map to players regardless of level.
    await seedCounters(
      leagueId,
      Object.fromEntries(names.map((name, rung) => [seats[rung]!, ladder[name]!]))
    );
    const standings = await standingsOf(leagueId);
    const seat = (name: string) => seats[names.indexOf(name)]!;
    expect(summary(standings.entries)).toEqual([
      [seat('top'), 1],
      [seat('moreSetsWon'), 2],
      [seat('fewerSetsWon'), 3],
      [seat('moreLosses'), 4],
      ...byUuid([seat('tiedA'), seat('tiedB')]).map((index) => [index, 5]),
      ...byUuid([seat('zeroA'), seat('zeroB')]).map((index) => [index, 7])
    ]);
    // Repeated reads are identical (deterministic presentation inside shared positions).
    expect(await standingsOf(leagueId)).toEqual(standings);
  });

  it('breaks a Wins and Losses tie by Set Diff before Sets Won', async () => {
    const leagueId = await kit.league();
    await seedCounters(leagueId, {
      0: { w: 1, l: 0, sw: 4, sl: 3 }, // diff +1, more sets won
      1: { w: 1, l: 0, sw: 3, sl: 1 }, // diff +2
      2: { w: 0, l: 1, sw: 1, sl: 2 }
    });
    const entries = (await standingsOf(leagueId)).entries;
    // Players 3-7 are zero rows (no wins, no losses) and outrank the one-loss player 2.
    expect(summary(entries)).toEqual([
      [1, 1],
      [0, 2],
      ...byUuid([3, 4, 5, 6, 7]).map((index) => [index, 3]),
      [2, 8]
    ]);
  });

  it('shares position 1 among everyone when no result is confirmed (all zero)', async () => {
    const leagueId = await kit.league();
    const { entries } = await standingsOf(leagueId);
    expect(entries).toHaveLength(8);
    expect(entries.every((entry) => entry.position === 1 && entry.matches === 0)).toBe(true);
    expect(entries.map((entry) => entry.user_id)).toEqual(byUuid([0, 1, 2, 3, 4, 5, 6, 7]).map(id));
  });

  it('ranks real confirmations: Win totals per side and zero overlay between winners and losers', async () => {
    const leagueId = await kit.league();
    const submitted = await kit.submit(await kit.event(leagueId), playedAt(120).played, {
      sets: teamAWins
    });
    expect(submitted.error).toBeNull();
    expect((await kit.approve(String(asRecord(submitted.data)['proposal_id']))).error).toBeNull();

    const { entries } = await standingsOf(leagueId);
    expect(entries.map((entry) => entry.position)).toEqual([1, 1, 3, 3, 3, 3, 7, 7]);
    expect(new Set(entries.slice(0, 2).map((entry) => indexOf(entry.user_id)))).toEqual(
      new Set([0, 1])
    );
    expect(entries[0]).toMatchObject({
      matches: 1,
      wins: 1,
      losses: 0,
      draws: 0,
      sets_won: 2,
      sets_lost: 0,
      set_differential: 2
    });
    expect(entries[7]).toMatchObject({ wins: 0, losses: 1, sets_won: 0, sets_lost: 2 });
    expect(new Set(entries.slice(6).map((entry) => indexOf(entry.user_id)))).toEqual(
      new Set([2, 3])
    );
  });

  it('counts Draw set totals from completed sets only and ranks them above zero rows', async () => {
    const leagueId = await kit.league();
    const submitted = await kit.submit(await kit.event(leagueId), playedAt(120).played, {
      sets: drawnUnfinishedThird
    });
    expect(submitted.error).toBeNull();
    expect((await kit.approve(String(asRecord(submitted.data)['proposal_id']))).error).toBeNull();

    const { entries } = await standingsOf(leagueId);
    expect(entries.map((entry) => entry.position)).toEqual([1, 1, 1, 1, 5, 5, 5, 5]);
    for (const entry of entries.slice(0, 4))
      expect(entry).toMatchObject({
        matches: 1,
        wins: 0,
        losses: 0,
        draws: 1,
        sets_won: 1,
        sets_lost: 1,
        set_differential: 0
      });
    for (const entry of entries.slice(4)) expect(entry.matches).toBe(0);
  });

  it('flags minimum-match eligibility at threshold -1, exact, +1, zero and the maximum', async () => {
    const records: Record<number, Record5> = {
      0: { w: 2, l: 0, d: 1, sw: 4, sl: 1 }, // 3 matches: exact
      1: { w: 1, l: 0, d: 1, sw: 2, sl: 1 }, // 2 matches: threshold - 1
      2: { w: 2, l: 2, sw: 6, sl: 5 } // 4 matches: threshold + 1
    };
    const thresholds: Record<number, { eligible: boolean; remaining: number }[]> = {};
    let baselineOrder: string[] = [];
    for (const minimum of [1, 3, 100]) {
      const leagueId = await kit.league({ minimumMatches: minimum });
      await seedCounters(leagueId, records);
      const { entries, minimum_matches_for_final_award } = await standingsOf(leagueId);
      expect(minimum_matches_for_final_award).toBe(minimum);
      const order = entries.map((entry) => entry.user_id);
      // The threshold never filters (all 8 stay visible) nor reorders.
      expect(entries).toHaveLength(8);
      if (minimum === 1) baselineOrder = order;
      expect(order).toEqual(baselineOrder);
      thresholds[minimum] = [0, 1, 2, 3].map((index) => {
        const entry = entries.find((row) => row.user_id === id(index))!;
        return { eligible: entry.award_eligible, remaining: entry.matches_remaining };
      });
    }
    // Default threshold 1: played members qualify, a zero member needs one more match.
    expect(thresholds[1]).toEqual([
      { eligible: true, remaining: 0 },
      { eligible: true, remaining: 0 },
      { eligible: true, remaining: 0 },
      { eligible: false, remaining: 1 }
    ]);
    expect(thresholds[3]).toEqual([
      { eligible: true, remaining: 0 },
      { eligible: false, remaining: 1 },
      { eligible: true, remaining: 0 },
      { eligible: false, remaining: 3 }
    ]);
    expect(thresholds[100]).toEqual([
      { eligible: false, remaining: 97 },
      { eligible: false, remaining: 98 },
      { eligible: false, remaining: 96 },
      { eligible: false, remaining: 100 }
    ]);
  });

  it('reflects a changed threshold immediately without touching counters or ratings', async () => {
    const leagueId = await kit.league({ minimumMatches: 2 });
    await seedCounters(leagueId, { 0: { w: 1, l: 0, sw: 2, sl: 0 } });
    const count = async () =>
      (
        await sqlRows(
          `select (select count(*) from public.player_rating_events)::int as events,
                  (select count(*) from public.league_player_counters where league_id = ${sqlText(leagueId)})::int as counters`
        )
      )[0];
    const before = await count();
    const first = await standingsOf(leagueId);
    expect(first.entries[0]).toMatchObject({ award_eligible: false, matches_remaining: 1 });

    await fixtureSql(
      `update public.leagues set minimum_matches_for_final_award = 1 where id = ${sqlText(leagueId)};`
    );
    const second = await standingsOf(leagueId);
    expect(second.entries[0]).toMatchObject({ award_eligible: true, matches_remaining: 0 });
    expect(second.entries.map((entry) => entry.user_id)).toEqual(
      first.entries.map((entry) => entry.user_id)
    );
    expect(await count()).toEqual(before);
  });

  it('keeps earned rows of former members and drops the zero overlay once the League closes', async () => {
    // A real Win by players 0-3, then player 3 leaves; closing publishes the earned rows only.
    const leagueId = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    const submitted = await kit.submit(await kit.event(leagueId), playedAt(120).played);
    expect(submitted.error).toBeNull();
    expect((await kit.approve(String(asRecord(submitted.data)['proposal_id']))).error).toBeNull();
    await setMembershipHistory(kit.communityId, id(3), [
      {
        activatedAt: new Date(Date.now() - 86_400_000).toISOString(),
        validUntil: new Date().toISOString()
      }
    ]);
    const closed = await kit.rpc(kit.creator, 'close_league', {
      p_league_id: leagueId,
      p_expected_version: 1
    });
    expect(closed.error).toBeNull();
    const { entries, status, source, standings_version } = await standingsOf(leagueId);
    expect(status).toBe('closed');
    expect({ source, standings_version }).toEqual({ source: 'final', standings_version: 1 });
    expect(new Set(summary(entries).map(([index]) => index))).toEqual(new Set([0, 1, 2, 3]));
    expect(entries.every((entry) => entry.matches === 1)).toBe(true);
  });

  it('carries no skill fields and exposes the reader only to authenticated callers', async () => {
    const leagueId = await kit.league();
    await seedCounters(leagueId, { 0: { w: 1, l: 0, sw: 2, sl: 0 } });
    const response = await kit.rpc(kit.creator, 'get_league_standings', { p_league_id: leagueId });
    const payload = asRecord(response.data);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'cause',
        'entries',
        'generated_at',
        'latest_standings_version',
        'league_id',
        'minimum_matches_for_final_award',
        'source',
        'standings_version',
        'status'
      ].sort()
    );
    const rows = payload['entries'];
    for (const row of Array.isArray(rows) ? rows.map(asRecord) : [])
      expect(Object.keys(row).sort()).toEqual(
        [
          'award_eligible',
          'display_name',
          'draws',
          'is_provisional',
          'losses',
          'matches',
          'matches_remaining',
          'position',
          'set_differential',
          'sets_lost',
          'sets_won',
          'user_id',
          'wins'
        ].sort()
      );
    const [privileges] = await sqlRows(
      `select has_function_privilege('anon','public.get_league_standings(uuid,integer)','EXECUTE') as anon,
              has_function_privilege('authenticated','public.get_league_standings(uuid,integer)','EXECUTE') as authenticated,
              has_function_privilege('authenticated','public.league_standings_entries(uuid)','EXECUTE') as internal,
              (select provolatile from pg_proc where proname = 'get_league_standings') as volatility`
    );
    expect(privileges).toEqual({
      anon: false,
      authenticated: true,
      internal: false,
      volatility: 's'
    });
    const outsider = await kit.actor();
    expect(
      (await kit.rpc(outsider, 'get_league_standings', { p_league_id: leagueId })).error?.message
    ).toBe('LEAGUE_NOT_FOUND');
    expect(
      (await kit.rpc(kit.creator, 'get_league_standings', { p_league_id: crypto.randomUUID() }))
        .error?.message
    ).toBe('LEAGUE_NOT_FOUND');
    expect(
      (
        await kit.rpc({ token: environment.env!.key }, 'get_league_standings', {
          p_league_id: leagueId
        })
      ).error
    ).not.toBeNull();
  });
});

describe.skipIf(!environment.env)('League standings reader roles', { timeout: 300_000 }, () => {
  let world: LeagueWorld;
  let leagueId: string;

  beforeAll(async () => {
    world = await leagueWorld(environment.env!, 'lg-stand');
    leagueId = await insertLeague({
      communityId: world.communityId,
      ownerId: world.owner.id,
      status: 'upcoming',
      startAt: new Date(Date.now() - 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 86_400_000).toISOString()
    });
  });

  it('serves members and Admin, hides the League from outsiders and former members, restricts provisional actors', async () => {
    for (const actor of [world.owner, world.member, world.admin]) {
      const response = await actor.client.rpc('get_league_standings', { p_league_id: leagueId });
      expect(response.error).toBeNull();
      expect(decodeLeagueStandings(response.data).entries.length).toBeGreaterThan(0);
    }
    const hidden = await world.outsider.client.rpc('get_league_standings', {
      p_league_id: leagueId
    });
    const unknown = await world.outsider.client.rpc('get_league_standings', {
      p_league_id: crypto.randomUUID()
    });
    expect(hidden.error?.message).toBe('LEAGUE_NOT_FOUND');
    expect(unknown.error?.message).toBe(hidden.error?.message);
    expect(
      (await world.former.client.rpc('get_league_standings', { p_league_id: leagueId })).error
        ?.message
    ).toBe('LEAGUE_NOT_FOUND');
    expect(
      (await world.provisional.client.rpc('get_league_standings', { p_league_id: leagueId })).error
        ?.message
    ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
  });
});
