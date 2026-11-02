import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeLeagueCounters } from '../src/features/leagues/league-decoders';
import type { LeagueCounterEntry } from '../src/features/leagues/league-contracts';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows, withDeadline } from './helpers/match-registration-sql';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const teamAWins = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];
const drawn = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true }
];
const teamBWins = [
  { position: 1, team_a_games: 4, team_b_games: 6, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true }
];
const unfinished = [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }];

/**
 * U4 / AC9, AC12 + U4.2: per-UUID counters over confirmed eligible Ranked facts; zero-based for
 * every active member; independent of the app-wide rating; whole-group eligibility gate.
 */
describe.skipIf(!environment.env)('League counters', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    // Player 1 carries the highest app-wide level, player 2 the lowest: counters must ignore both.
    kit = await createRankedResultFixtures(environment.env!, { levels: [7, 0, 4, 4, 4, 4, 4, 4] });
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });

  const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();
  const countersOf = async (leagueId: string, actor = kit.creator) => {
    const response = await kit.rpc(actor, 'get_league_counters', { p_league_id: leagueId });
    expect(response.error).toBeNull();
    return decodeLeagueCounters(response.data);
  };
  const entryOf = (value: { participants: LeagueCounterEntry[] }, index: number) =>
    value.participants.find((item) => item.user_id === kit.players[index]!.id)!;
  /** Submits and confirms the first quartet's result on `eventId` (player 2 is on the other team). */
  async function confirm(eventId: string, sets: unknown) {
    const submitted = await kit.submit(eventId, playedAt(120).played, { sets });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    const confirmed = await kit.approve(proposalId);
    expect(confirmed.error).toBeNull();
    return proposalId;
  }
  const zero = {
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    sets_won: 0,
    sets_lost: 0,
    set_differential: 0
  };

  it('zero-initialises every active member, whatever their app-wide level', async () => {
    const leagueId = await kit.league();
    const value = await countersOf(leagueId);
    expect(value.participants).toHaveLength(kit.players.length);
    for (const participant of value.participants) expect(participant).toMatchObject(zero);
    expect(value.excluded_group_count).toBe(0);
    // The strongest and weakest players are indistinguishable: no skill input, no skill order.
    expect(entryOf(value, 0)).toMatchObject(zero);
    expect(entryOf(value, 1)).toMatchObject(zero);
  });

  it('aggregates wins, draws, losses and sets from confirmed Ranked groups only', async () => {
    const leagueId = await kit.league();
    const otherLeague = await kit.league({
      startAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 3 * 86_400_000).toISOString()
    });
    await confirm(await kit.event(leagueId), teamAWins);
    await confirm(await kit.event(leagueId), drawn);
    await confirm(await kit.event(leagueId), teamBWins);
    // Never counted: an Unranked group, another League's group, and an unfinished (unrated) one.
    await confirm(await kit.event(null), teamAWins);
    await confirm(await kit.event(otherLeague), teamAWins);
    const submittedIncomplete = await kit.submit(await kit.event(leagueId), playedAt(120).played, {
      sets: unfinished
    });
    expect(submittedIncomplete.error).toBeNull();

    const value = await countersOf(leagueId);
    // Team A = players 0,1; team B = players 2,3. One win, one draw, one loss each.
    for (const index of [0, 1])
      expect(entryOf(value, index)).toMatchObject({
        matches: 3,
        wins: 1,
        draws: 1,
        losses: 1,
        sets_won: 3,
        sets_lost: 3,
        set_differential: 0
      });
    for (const index of [2, 3])
      expect(entryOf(value, index)).toMatchObject({
        matches: 3,
        wins: 1,
        draws: 1,
        losses: 1,
        sets_won: 3,
        sets_lost: 3
      });
    for (const index of [4, 5, 6, 7]) expect(entryOf(value, index)).toMatchObject(zero);

    const other = await countersOf(otherLeague);
    expect(entryOf(other, 0)).toMatchObject({
      matches: 1,
      wins: 1,
      sets_won: 2,
      sets_lost: 0,
      set_differential: 2
    });
    expect(entryOf(other, 2)).toMatchObject({
      matches: 1,
      losses: 1,
      sets_won: 0,
      sets_lost: 2,
      set_differential: -2
    });
  });

  it('drops a whole confirmed group, never one player, when the all-four gate fails', async () => {
    const leagueId = await kit.league({
      startAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
      endAt: new Date(Date.now() + 4 * 86_400_000).toISOString()
    });
    await confirm(await kit.event(leagueId), teamAWins);
    expect(entryOf(await countersOf(leagueId), 0)).toMatchObject({ matches: 1, wins: 1 });

    // Retroactively invalidate one participant's membership at the played instant.
    const played = playedAt(120);
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [
      { activatedAt: dayAgo(), validUntil: new Date(Date.parse(played.iso) - 60_000).toISOString() }
    ]);
    const value = await countersOf(leagueId);
    expect(value.excluded_group_count).toBe(1);
    for (const index of [0, 1, 2]) expect(entryOf(value, index)).toMatchObject(zero);
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [{ activatedAt: dayAgo() }]);
  });

  it('lists only earned entries for a closed League and keeps removed players who earned counters', async () => {
    const closed = await kit.league({
      endMode: 'manual',
      endAt: null,
      status: 'closed',
      closedAt: new Date(Date.now() - 30_000).toISOString(),
      closedBy: kit.creator.id
    });
    await confirm(await kit.event(closed), teamAWins);
    const value = await countersOf(closed);
    expect(value.participants.map((item) => item.user_id).sort()).toEqual(
      kit
        .group(1)
        .map((player) => player.id)
        .sort()
    );

    // Removal after the play keeps the earned entry visible in an open League as well.
    const open = await kit.league();
    await confirm(await kit.event(open), teamAWins);
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [
      { activatedAt: dayAgo(), validUntil: new Date(Date.now() - 1_000).toISOString() }
    ]);
    expect(entryOf(await countersOf(open), 3)).toMatchObject({ matches: 1, losses: 1 });
    await setMembershipHistory(kit.communityId, kit.players[3]!.id, [{ activatedAt: dayAgo() }]);
  });

  it('is community-scoped, privacy-safe and unavailable to anonymous callers', async () => {
    const leagueId = await kit.league();
    await confirm(await kit.event(leagueId), teamAWins);
    const response = await kit.rpc(kit.creator, 'get_league_counters', { p_league_id: leagueId });
    const payload = asRecord(response.data);
    expect(Object.keys(payload).sort()).toEqual([
      'excluded_group_count',
      'league_id',
      'participants'
    ]);
    const listed = payload['participants'];
    for (const participant of Array.isArray(listed) ? listed.map(asRecord) : [])
      expect(Object.keys(participant).sort()).toEqual(
        [
          'display_name',
          'draws',
          'is_provisional',
          'losses',
          'matches',
          'set_differential',
          'sets_lost',
          'sets_won',
          'user_id',
          'wins'
        ].sort()
      );

    const outsider = await kit.actor();
    expect(
      (await kit.rpc(outsider, 'get_league_counters', { p_league_id: leagueId })).error?.message
    ).toBe('LEAGUE_NOT_FOUND');
    const unknown = await kit.rpc(kit.creator, 'get_league_counters', {
      p_league_id: crypto.randomUUID()
    });
    expect(unknown.error?.message).toBe('LEAGUE_NOT_FOUND');
    const anonymous = await kit.rpc({ token: environment.env!.key }, 'get_league_counters', {
      p_league_id: leagueId
    });
    expect(anonymous.error).not.toBeNull();
    const [privileges] = await sqlRows(
      `select has_function_privilege('anon','public.get_league_counters(uuid)','EXECUTE') as anon,
              has_function_privilege('authenticated','public.get_league_counters(uuid)','EXECUTE') as authenticated,
              has_function_privilege('authenticated','public.match_result_ranked_ineligibility(uuid,uuid[],timestamptz)','EXECUTE') as helper,
              (select provolatile from pg_proc where proname = 'get_league_counters') as volatility`
    );
    expect(privileges).toEqual({
      anon: false,
      authenticated: true,
      helper: false,
      volatility: 's'
    });
  });

  it('is read-only and never waits on the app-wide rating lock', async () => {
    const leagueId = await kit.league();
    const holder = await openDedicatedSqlConnection();
    try {
      await holder.query('begin');
      await holder.query('select public.lock_global_rating_projection()');
      const value = await withDeadline(countersOf(leagueId), 10_000, 'counters under rating lock');
      expect(value.participants.length).toBeGreaterThan(0);
      await holder.query('commit');
    } finally {
      await holder.close();
    }
    const [before] = await sqlRows(
      `select (select count(*) from public.match_event_result_confirmations)::int as confirmations,
              (select count(*) from public.player_rating_events)::int as events`
    );
    await countersOf(leagueId);
    const [after] = await sqlRows(
      `select (select count(*) from public.match_event_result_confirmations)::int as confirmations,
              (select count(*) from public.player_rating_events)::int as events`
    );
    expect(after).toEqual(before);
    // Counters never read rating state: no projection function is referenced by the reader.
    const [source] = await sqlRows(
      `select pg_get_functiondef(p.oid) ilike '%global_player_ratings%' or pg_get_functiondef(p.oid) ilike '%player_rating_events%' as reads_rating
         from pg_proc p where p.proname = 'get_league_counters'`
    );
    expect(source?.['reads_rating']).toBe(false);
  });
});
