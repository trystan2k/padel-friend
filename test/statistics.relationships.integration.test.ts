import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import type { ManagementActor } from './helpers/match-management-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  rankedSets,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  readOpponentRecords,
  readOpponentStatistics,
  readPairStatistics,
  readPartnerRecords
} from '../src/features/statistics/statistics-relationships.server';
import { validateStatisticsFilters } from '../src/features/statistics/statistics.validators';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const FUNCTIONS = [
  'get_pair_statistics(uuid,uuid,uuid,uuid,text,date,date)',
  'get_opponent_statistics(uuid,uuid,uuid,uuid,text,date,date)',
  'get_player_partner_records(uuid,uuid,uuid,text,date,date,integer,integer)',
  'get_player_opponent_records(uuid,uuid,uuid,text,date,date,integer,integer)'
];
const DRAW_SETS = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
  { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
];
const INCOMPLETE_SETS = [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }];

describe.skipIf(!environment.env)(
  'pair, partner and opponent SQL readers',
  { timeout: 600_000 },
  () => {
    let kit: RankedResultKit;
    let a: ManagementActor;
    let b: ManagementActor;
    let c: ManagementActor;
    let d: ManagementActor;
    let age = 800;
    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      const player = (index: number) => {
        const actor = kit.players[index];
        if (!actor) throw new Error('Missing fixture player');
        return actor;
      };
      a = player(0);
      b = player(1);
      c = player(2);
      d = player(3);
    });
    afterAll(async () => {
      if (!kit) return;
      const players = kit.players.map((player) => sqlText(player.id)).join(',');
      await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`);
      await kit.cleanup();
    });

    /** Plays one confirmed group with explicit actual teams (team_a first), submitted by player 0. */
    async function play(
      teamA: ManagementActor[],
      teamB: ManagementActor[],
      options: { sets?: unknown; type?: 'competitive' | 'friendly' } = {}
    ) {
      age -= 50;
      const event = await kit.event(null, options.type ?? 'competitive');
      const teams = { team_a: teamA.map((p) => p.id), team_b: teamB.map((p) => p.id) };
      const submitted = await kit.rpc(a, 'submit_match_event_result', {
        p_match_event_id: event,
        p_group_number: 1,
        p_teams: teams,
        p_sets: options.sets ?? rankedSets,
        p_played_local: playedAt(age).played,
        p_court_label: 'Court 1',
        p_request_id: crypto.randomUUID()
      });
      if (submitted.error) throw submitted.error;
      const proposal = String(asRecord(submitted.data)['proposal_id']);
      const opposing = teamA.includes(a) ? teamB : teamA;
      const approved = await kit.approve(proposal, 1, opposing[0]);
      if (approved.error) throw approved.error;
      return { event, group: proposal };
    }
    const pair = async (
      actor: ManagementActor,
      x: ManagementActor,
      y: ManagementActor,
      extra = {}
    ) => {
      const result = await kit.rpc(actor, 'get_pair_statistics', {
        p_player_id: x.id,
        p_partner_id: y.id,
        p_community_id: kit.communityId,
        ...extra
      });
      if (result.error) throw result.error;
      return asRecord(result.data);
    };
    const versus = async (
      actor: ManagementActor,
      x: ManagementActor,
      y: ManagementActor,
      extra = {}
    ) => {
      const result = await kit.rpc(actor, 'get_opponent_statistics', {
        p_player_id: x.id,
        p_opponent_id: y.id,
        p_community_id: kit.communityId,
        ...extra
      });
      if (result.error) throw result.error;
      return asRecord(result.data);
    };
    const records = async (fn: string, actor: ManagementActor, extra = {}) => {
      const result = await kit.rpc(actor, fn, {
        p_player_id: actor.id,
        p_community_id: kit.communityId,
        ...extra
      });
      if (result.error) throw result.error;
      return asRecord(result.data);
    };
    const recordOf = (page: Record<string, unknown>) => asRecord(page['record']);
    const matchesOf = (page: Record<string, unknown>) => asRecord(recordOf(page)['matches']);
    const recentOf = (page: Record<string, unknown>) => {
      const recent = page['recent'];
      if (!Array.isArray(recent)) throw new Error('Expected recent matches');
      return recent.map(asRecord);
    };
    const list = (value: unknown): Record<string, unknown>[] => {
      if (!Array.isArray(value)) throw new Error('Expected an array');
      return value.map(asRecord);
    };
    const sortedIds = (...players: ManagementActor[]) => players.map((p) => p.id).sort();

    it('reads projections only, with whitelisted authenticated grants', async () => {
      for (const signature of FUNCTIONS) {
        const name = signature.slice(0, signature.indexOf('('));
        const [definition] = await sqlRows(
          `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = ${sqlText(name)}`
        );
        expect(String(definition?.['definition'])).not.toMatch(
          /statistics_official_|rebuild_statistics/
        );
        const [grants] = await sqlRows(
          `select has_function_privilege('anon', 'public.${signature}', 'execute') as anon,
          has_function_privilege('service_role', 'public.${signature}', 'execute') as service,
          has_function_privilege('authenticated', 'public.${signature}', 'execute') as authenticated`
        );
        expect(grants).toMatchObject({ anon: false, service: false, authenticated: true });
      }
      const [prepare] = await sqlRows(
        `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'statistics_relationship_prepare'`
      );
      expect(String(prepare?.['definition'])).toContain('assert_actor_not_provisional');
      const helpers = await sqlRows(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as runnable,
          p.prosecdef, coalesce(array_to_string(p.proconfig, ','), '') as config
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and (p.proname like 'statistics_relationship_%' or p.proname = 'statistics_leader_metric')`
      );
      expect(helpers.length).toBeGreaterThanOrEqual(7);
      for (const helper of helpers) expect(helper['runnable']).toBe(false);
      for (const helper of helpers.filter((row) => row['prosecdef']))
        expect(String(helper['config'])).toContain('search_path=""');
    });

    it('keeps a one-match pair visible but not eligible for a best claim', async () => {
      await play([a, b], [c, d]);
      const result = await pair(a, a, b);
      expect(result['pairId']).toBeTruthy();
      expect(matchesOf(result)).toMatchObject({
        played: 1,
        wins: 1,
        losses: 0,
        winRate: { state: 'ready', value: 1 }
      });
      expect(recordOf(result)).toMatchObject({
        sets: { won: 2, lost: 0, differential: 2 },
        games: { won: 12, lost: 7, differential: 5 },
        streaks: { current: { kind: 'W', length: 1 }, longestWins: 1, longestLosses: 0 },
        leaderEligibility: {
          state: 'insufficient',
          reason: 'minimum_matches',
          observed: 1,
          required: 5
        }
      });
      const partners = await records('get_player_partner_records', a);
      expect(partners).toMatchObject({
        total: 1,
        items: [{ playerId: b.id, played: 1, wins: 1 }],
        best: { state: 'insufficient', reason: 'minimum_matches', observed: 1, required: 5 }
      });
      expect(asRecord(partners['mostFrequent'])).toMatchObject({
        state: 'ready',
        value: { groups: 1, players: [{ userId: b.id }] }
      });
    });

    it('is independent of player order: A+B equals B+A', async () => {
      const forward = await pair(a, a, b);
      const reverse = await pair(a, b, a);
      expect(reverse['pairId']).toBe(forward['pairId']);
      expect(reverse['record']).toEqual(forward['record']);
      expect(reverse['recent']).toEqual(forward['recent']);
      expect(reverse['players']).toEqual(forward['players']);
      const ids = list(forward['players']).map((p) => p['userId']);
      expect(ids).toEqual(sortedIds(a, b));
      const [expected] = await sqlRows(
        `select public.statistics_pair_id(${sqlText(a.id)}, ${sqlText(b.id)}) = public.statistics_pair_id(${sqlText(b.id)}, ${sqlText(a.id)}) as same,
        public.statistics_pair_id(${sqlText(a.id)}, ${sqlText(b.id)})::text as id`
      );
      expect(expected?.['same']).toBe(true);
      expect(forward['pairId']).toBe(expected?.['id']);
    });

    it('creates opposing edges only: A vs C exists, A vs B (teammates) does not', async () => {
      const aVsC = await versus(a, a, c);
      expect(matchesOf(aVsC)).toMatchObject({ played: 1, wins: 1, losses: 0 });
      const teammates = await versus(a, a, b);
      expect(matchesOf(teammates)).toMatchObject({
        played: 0,
        winRate: { state: 'insufficient', reason: 'no_denominator' }
      });
      expect(recentOf(teammates)).toEqual([]);
      const neverPartners = await pair(a, a, c);
      expect(matchesOf(neverPartners)).toMatchObject({ played: 0 });
      const [facts] = await sqlRows(
        `select count(*)::int as n from public.statistics_opponent_facts
        where least(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid) = player_low and greatest(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid) = player_high`
      );
      expect(facts?.['n']).toBe(0);
    });

    it('reverses outcome, sets, games and rating delta for the other focal player', async () => {
      const aVsC = await versus(a, a, c);
      const cVsA = await versus(c, c, a);
      expect(recordOf(aVsC)).toMatchObject({
        matches: { wins: 1, losses: 0 },
        sets: { won: 2, lost: 0 },
        games: { won: 12, lost: 7, differential: 5 }
      });
      expect(recordOf(cVsA)).toMatchObject({
        matches: { wins: 0, losses: 1 },
        sets: { won: 0, lost: 2 },
        games: { won: 7, lost: 12, differential: -5 }
      });
      const [first] = recentOf(aVsC);
      const [reversed] = recentOf(cVsA);
      expect(first).toMatchObject({
        outcome: 'W',
        setsFor: 2,
        setsAgainst: 0,
        gamesFor: 12,
        gamesAgainst: 7
      });
      expect(reversed).toMatchObject({
        outcome: 'L',
        setsFor: 0,
        setsAgainst: 2,
        gamesFor: 7,
        gamesAgainst: 12
      });
      expect(first?.['groupId']).toBe(reversed?.['groupId']);
      const deltas = await sqlRows(
        `select user_id::text, rating_delta, expected_score from public.statistics_participant_facts
        where game_group_id = ${sqlText(String(first?.['groupId']))} and user_id in (${sqlText(a.id)}, ${sqlText(c.id)})`
      );
      const byUser = new Map(deltas.map((row) => [String(row['user_id']), row]));
      expect(Number(first?.['ratingDelta'])).toBeCloseTo(
        Number(byUser.get(a.id)?.['rating_delta']),
        8
      );
      expect(Number(reversed?.['ratingDelta'])).toBeCloseTo(
        Number(byUser.get(c.id)?.['rating_delta']),
        8
      );
      expect(Number(first?.['ratingDelta'])).toBeGreaterThan(0);
      expect(Number(reversed?.['ratingDelta'])).toBeLessThan(0);
      expect(Number(first?.['expectedScore'])).toBeCloseTo(
        Number(byUser.get(a.id)?.['expected_score']),
        8
      );
      expect(recordOf(aVsC)['biggestGain']).toMatchObject({ state: 'ready' });
      expect(recordOf(cVsA)['biggestLoss']).toMatchObject({ state: 'ready' });
      expect(recordOf(cVsA)['biggestGain']).toMatchObject({
        state: 'insufficient',
        reason: 'no_applicable_result'
      });
    });

    it('yields the same pair record when team_a and team_b are swapped', async () => {
      const { event, group } = await play([c, d], [a, b]);
      const ab = await pair(a, a, b);
      const cd = await pair(c, c, d);
      expect(matchesOf(ab)).toMatchObject({ played: 2, wins: 1, losses: 1 });
      expect(matchesOf(cd)).toMatchObject({ played: 2, wins: 1, losses: 1 });
      expect(recordOf(ab)).toMatchObject({
        sets: { won: 2, lost: 2 },
        games: { won: 19, lost: 19, differential: 0 }
      });
      expect(recordOf(ab)['games']).toEqual(recordOf(cd)['games']);
      expect(ab['pairId']).not.toBe(cd['pairId']);
      const recent = recentOf(ab);
      expect(recent.map((match) => match['outcome'])).toEqual(['L', 'W']);
      expect(recent[0]).toMatchObject({
        eventId: event,
        groupId: group,
        setsFor: 0,
        setsAgainst: 2
      });
      const aVsC = await versus(a, a, c);
      expect(recordOf(aVsC)).toMatchObject({
        matches: { played: 2, wins: 1, losses: 1 },
        sets: { won: 2, lost: 2 },
        games: { won: 19, lost: 19 }
      });
      expect(recentOf(aVsC).map((match) => match['outcome'])).toEqual(['L', 'W']);
      expect(Number(recentOf(aVsC)[0]?.['ratingDelta'])).toBeLessThan(0);
      const [facts] = await sqlRows(
        `select count(distinct pair_id)::int as pairs from public.statistics_pair_facts
        where player_low = least(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid) and player_high = greatest(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid)`
      );
      expect(facts?.['pairs']).toBe(1);
    });

    it('applies the draw and incomplete streak rules and the 4-vs-5 threshold boundary', async () => {
      await play([a, b], [c, d], { sets: DRAW_SETS });
      await play([a, b], [c, d], { sets: INCOMPLETE_SETS });
      await play([a, b], [c, d]);
      const beforeFifth = await pair(a, a, b);
      expect(matchesOf(beforeFifth)).toMatchObject({
        played: 5,
        wins: 2,
        losses: 1,
        draws: 1,
        incomplete: 1
      });
      expect(recordOf(beforeFifth)['leaderEligibility']).toMatchObject({
        state: 'insufficient',
        observed: 4,
        required: 5
      });
      const partnersBefore = await records('get_player_partner_records', a);
      expect(partnersBefore).toMatchObject({
        items: [{ playerId: b.id, played: 5, incomplete: 1 }],
        best: { state: 'insufficient', observed: 4, required: 5 }
      });
      const opponentsBefore = await records('get_player_opponent_records', a);
      expect(opponentsBefore).toMatchObject({
        best: { state: 'insufficient', observed: 4, required: 5 },
        toughest: { state: 'insufficient', observed: 4, required: 5 },
        closestRivalry: { state: 'insufficient', observed: 4, required: 5 }
      });
      await play([a, b], [c, d]);
      const result = await pair(a, a, b);
      expect(matchesOf(result)).toMatchObject({
        played: 6,
        wins: 3,
        losses: 1,
        draws: 1,
        incomplete: 1,
        competitive: 6,
        winRate: { state: 'ready', value: 0.6, numerator: 3, denominator: 5 }
      });
      // Sequence W L D (incomplete omitted) W W: a draw ends the loss run, an incomplete never breaks a run.
      expect(recordOf(result)['streaks']).toEqual({
        current: { kind: 'W', length: 2 },
        longestWins: 2,
        longestLosses: 1
      });
      expect(recordOf(result)['leaderEligibility']).toMatchObject({ state: 'ready', value: 5 });
      expect(recentOf(result).map((match) => match['outcome'])).toEqual([
        'W',
        'W',
        'I',
        'D',
        'L',
        'W'
      ]);
    });

    it('lists partners and opponents with all tied identities in deterministic order', async () => {
      const partners = await records('get_player_partner_records', a);
      expect(partners).toMatchObject({
        total: 1,
        items: [{ playerId: b.id, played: 6, wins: 3, losses: 1, draws: 1, incomplete: 1 }],
        best: {
          state: 'ready',
          value: { resolved: 5, winRate: 0.6, players: [{ userId: b.id }] }
        }
      });
      const opponents = await records('get_player_opponent_records', a);
      const tied = sortedIds(c, d);
      expect(opponents['total']).toBe(2);
      const items = list(opponents['items']);
      expect(items.map((item) => item['playerId'])).toEqual(tied);
      const leaderIds = (key: string) =>
        list(asRecord(asRecord(opponents[key])['value'])['players']).map(
          (player) => player['userId']
        );
      expect(leaderIds('mostFrequent')).toEqual(tied);
      expect(leaderIds('best')).toEqual(tied);
      expect(leaderIds('toughest')).toEqual(tied);
      expect(asRecord(opponents['closestRivalry'])).toMatchObject({
        state: 'ready',
        value: { resolved: 5, imbalance: 2 }
      });
      expect(leaderIds('closestRivalry')).toEqual(tied);
      const page = await records('get_player_opponent_records', a, { p_limit: 1, p_offset: 1 });
      expect(page).toMatchObject({ total: 2, limit: 1, offset: 1, items: [{ playerId: tied[1] }] });
      const cOpponents = await records('get_player_opponent_records', c);
      expect(cOpponents['items']).toMatchObject([
        { playerId: sortedIds(a, b)[0], played: 6, wins: 1, losses: 3 },
        { playerId: sortedIds(a, b)[1], played: 6, wins: 1, losses: 3 }
      ]);
    });

    it('follows the actual rotated teams, not the registered quartet', async () => {
      await play([a, c], [b, d]);
      expect(matchesOf(await pair(a, a, c))).toMatchObject({ played: 1, wins: 1 });
      expect(matchesOf(await versus(a, a, b))).toMatchObject({ played: 1, wins: 1, losses: 0 });
      expect(matchesOf(await versus(a, a, c))).toMatchObject({ played: 6 });
      expect(matchesOf(await pair(a, a, b))).toMatchObject({ played: 6 });
      const partners = await records('get_player_partner_records', a);
      expect(partners['total']).toBe(2);
      expect(list(partners['items'])[0]).toMatchObject({
        playerId: b.id,
        played: 6
      });
      expect(asRecord(partners['mostFrequent'])).toMatchObject({
        value: { groups: 6, players: [{ userId: b.id }] }
      });
    });

    it('shows missing Friendly evidence and counts only the rated sample for opponent level', async () => {
      const { group } = await play([a, b], [c, d], { type: 'friendly' });
      const result = await pair(a, a, b);
      expect(matchesOf(result)).toMatchObject({ played: 7, competitive: 6, friendly: 1 });
      const [sample] = await sqlRows(
        `select count(*)::int as n, avg(opponent_team_strength) as mean,
          count(*) filter (where opponent_team_strength is null)::int as unrated
        from public.statistics_pair_facts
        where player_low = least(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid)
          and player_high = greatest(${sqlText(a.id)}::uuid, ${sqlText(b.id)}::uuid)`
      );
      expect(Number(sample?.['unrated'])).toBeGreaterThanOrEqual(2);
      const level = asRecord(recordOf(result)['averageOpponentLevel']);
      expect(level['state']).toBe('ready');
      const rated = Number(sample?.['n']) - Number(sample?.['unrated']);
      expect(level['denominator']).toBe(rated);
      expect(rated).toBeLessThan(7);
      expect(Number(level['value'])).toBeCloseTo(Number(sample?.['mean']), 8);
      const meeting = recentOf(await versus(a, a, c)).find((match) => match['groupId'] === group);
      expect(meeting).toMatchObject({
        matchType: 'friendly',
        ratingDelta: null,
        expectedScore: null
      });
      const friendlyOnly = await pair(a, a, b, { p_type: 'friendly' });
      expect(matchesOf(friendlyOnly)).toMatchObject({ played: 1, friendly: 1, competitive: 0 });
      expect(recordOf(friendlyOnly)['averageOpponentLevel']).toMatchObject({
        state: 'insufficient',
        reason: 'missing_evidence'
      });
      expect(recordOf(friendlyOnly)['biggestUpset']).toMatchObject({
        state: 'insufficient',
        reason: 'no_applicable_result'
      });
    });

    it('exposes the biggest upset with its confirmed match for linking', async () => {
      const result = await pair(a, a, b);
      const upset = asRecord(recordOf(result)['biggestUpset']);
      expect(upset['state']).toBe('ready');
      const value = asRecord(upset['value']);
      const [group] = await sqlRows(
        `select match_event_id::text as event from public.statistics_group_facts where game_group_id = ${sqlText(String(value['g']))}`
      );
      expect(value['eventId']).toBe(group?.['event']);
      expect(recordOf(result)['upsetWins']).toBe(0);
      expect(recordOf(result)['leagues']).toEqual([]);
    });

    it('gives the same record for a lifetime read and a date window covering it', async () => {
      const lifetime = await pair(a, a, b);
      const day = playedAt(0).iso.slice(0, 10);
      const shift = (n: number) =>
        new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
      const window = await pair(a, a, b, { p_from: shift(-1), p_through: shift(1) });
      expect(window['record']).toEqual(lifetime['record']);
      const opponentLifetime = await versus(a, a, c);
      const opponentWindow = await versus(a, a, c, { p_from: shift(-1), p_through: shift(1) });
      expect(opponentWindow['record']).toEqual(opponentLifetime['record']);
      const empty = await pair(a, a, b, { p_from: '2000-01-01', p_through: '2000-01-01' });
      expect(matchesOf(empty)).toMatchObject({ played: 0 });
      expect(recentOf(empty)).toEqual([]);
      const partners = await records('get_player_partner_records', a, {
        p_from: shift(-1),
        p_through: shift(1)
      });
      expect(partners['total']).toBe(2);
      const none = await records('get_player_partner_records', a, {
        p_from: '2000-01-01',
        p_through: '2000-01-01'
      });
      expect(none).toMatchObject({ total: 0, items: [] });
      expect(asRecord(none['best'])).toMatchObject({ state: 'insufficient', observed: 0 });
    });

    it('keeps history of a player whose membership has ended', async () => {
      await setMembershipHistory(kit.communityId, d.id, [
        {
          activatedAt: new Date(Date.now() - 86_400_000).toISOString(),
          validUntil: new Date(Date.now() - 1000).toISOString()
        }
      ]);
      const result = await versus(a, a, d);
      expect(matchesOf(result).played).toBeGreaterThan(0);
      expect(matchesOf(await pair(c, c, d))).toMatchObject({ played: 7 });
      const opponents = await records('get_player_opponent_records', a);
      expect(list(opponents['items']).map((item) => item['playerId'])).toContain(d.id);
    });

    it('authorizes like player statistics: parties and shared active members only', async () => {
      const outsider = await kit.actor();
      for (const fn of ['get_pair_statistics', 'get_opponent_statistics']) {
        const args = {
          p_player_id: a.id,
          [fn === 'get_pair_statistics' ? 'p_partner_id' : 'p_opponent_id']: b.id
        };
        expect(
          (await kit.rpc(outsider, fn, { ...args, p_community_id: kit.communityId })).error?.message
        ).toContain('STATISTICS_NOT_FOUND');
        expect((await kit.rpc(outsider, fn, args)).error?.message).toContain(
          'STATISTICS_NOT_FOUND'
        );
      }
      for (const fn of ['get_player_partner_records', 'get_player_opponent_records'])
        expect(
          (await kit.rpc(outsider, fn, { p_player_id: a.id, p_community_id: kit.communityId }))
            .error?.message
        ).toContain('STATISTICS_NOT_FOUND');
      const member = kit.players[5]!;
      expect(matchesOf(await pair(member, a, b))).toMatchObject({ played: 7 });
      const noCommunity = await kit.rpc(member, 'get_pair_statistics', {
        p_player_id: a.id,
        p_partner_id: b.id
      });
      expect(noCommunity.error?.message).toContain('STATISTICS_NOT_FOUND');
      // A party may read the relationship without naming a community (own all-communities history).
      const own = await kit.rpc(a, 'get_pair_statistics', {
        p_player_id: a.id,
        p_partner_id: b.id
      });
      expect(own.error).toBeNull();
      const asPartner = await kit.rpc(b, 'get_pair_statistics', {
        p_player_id: a.id,
        p_partner_id: b.id
      });
      expect(asPartner.error).toBeNull();
    });

    it('rejects invalid input with typed errors', async () => {
      const invalid = async (fn: string, args: Record<string, unknown>) =>
        (await kit.rpc(a, fn, args)).error?.message ?? '';
      expect(
        await invalid('get_pair_statistics', { p_player_id: a.id, p_partner_id: a.id })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_opponent_statistics', { p_player_id: a.id, p_opponent_id: a.id })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_pair_statistics', {
          p_player_id: a.id,
          p_partner_id: b.id,
          p_type: 'bogus'
        })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_pair_statistics', {
          p_player_id: a.id,
          p_partner_id: b.id,
          p_from: '2030-02-02',
          p_through: '2030-02-01'
        })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_pair_statistics', {
          p_player_id: a.id,
          p_partner_id: b.id,
          p_league_id: kit.communityId
        })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_player_partner_records', { p_player_id: a.id, p_limit: 0 })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_player_opponent_records', { p_player_id: a.id, p_limit: 101 })
      ).toContain('STATISTICS_INVALID_INPUT');
      expect(
        await invalid('get_player_opponent_records', { p_player_id: a.id, p_offset: -1 })
      ).toContain('STATISTICS_INVALID_INPUT');
    });

    it('decodes every reader through the TypeScript boundary', async () => {
      const filters = validateStatisticsFilters({ communityId: kit.communityId });
      const client = a.client;
      const pairResult = await readPairStatistics(client, {
        playerId: a.id,
        otherId: b.id,
        filters
      });
      expect(pairResult).toMatchObject({
        status: 'ok',
        value: {
          focalId: a.id,
          otherId: b.id,
          record: { matches: { played: 7 }, leaderEligibility: { state: 'ready' } }
        }
      });
      const opponentResult = await readOpponentStatistics(client, {
        playerId: a.id,
        otherId: c.id,
        filters
      });
      expect(opponentResult).toMatchObject({
        status: 'ok',
        value: { focal: { userId: a.id }, other: { userId: c.id } }
      });
      const partners = await readPartnerRecords(client, {
        playerId: a.id,
        filters,
        limit: 20,
        offset: 0
      });
      expect(partners).toMatchObject({
        status: 'ok',
        value: { total: 2, best: { state: 'ready' } }
      });
      const opponents = await readOpponentRecords(client, {
        playerId: a.id,
        filters,
        limit: 20,
        offset: 0
      });
      expect(opponents).toMatchObject({
        status: 'ok',
        value: { total: 3, toughest: { state: 'ready' } }
      });
      const denied = await readPairStatistics((await kit.actor()).client, {
        playerId: a.id,
        otherId: b.id,
        filters
      });
      expect(denied).toEqual({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    });
  }
);
