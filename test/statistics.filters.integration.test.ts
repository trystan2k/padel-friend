import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import type { ManagementActor } from './helpers/match-management-fixtures';
import {
  SCORES,
  buildCommunityWorld,
  type CommunityWorld,
  type WorldGroup
} from './helpers/community-statistics-world';
import { sqlText } from './helpers/provisional-player-fixtures';
import { decodeCommunityStatistics } from '../src/features/statistics/statistics-community.server';

const environment = localSupabaseEnv();
const TYPES = ['all', 'competitive', 'friendly'] as const;

type Scope = 'all' | 'main' | 'active' | 'closed';
type Window = { from?: string; through?: string };

describe.skipIf(!environment.env)(
  'community statistics filter matrix',
  { timeout: 900_000 },
  () => {
    let world: CommunityWorld;
    let a: ManagementActor;
    beforeAll(async () => {
      world = await buildCommunityWorld(environment.env!);
      a = world.players[0]!;
    });
    afterAll(async () => {
      await world?.cleanup();
    });

    const idOf = (index: number) => world.players[index]!.id;
    const read = async (
      actor: ManagementActor,
      scope: Scope,
      type: string,
      window: Window = {}
    ) => {
      const args: Record<string, unknown> = { p_type: type };
      if (scope !== 'all') args['p_community_id'] = world.main.communityId;
      if (scope === 'active') args['p_league_id'] = world.leagues.active;
      if (scope === 'closed') args['p_league_id'] = world.leagues.closed;
      if (window.from) args['p_from'] = window.from;
      if (window.through) args['p_through'] = window.through;
      const result = await world.main.rpc(actor, 'get_community_statistics', args);
      if (result.error) throw result.error;
      return asRecord(result.data);
    };

    /** Independent oracle: explicit group list, plain counting, no projection code. */
    const inScope = (group: WorldGroup, scope: Scope, type: string, window: Window) => {
      if (scope !== 'all' && group.community !== 'main') return false;
      if (scope === 'active' && group.league !== 'active') return false;
      if (scope === 'closed' && group.league !== 'closed') return false;
      if (type !== 'all' && group.type !== type) return false;
      if (window.from && group.day < window.from) return false;
      if (window.through && group.day > window.through) return false;
      return true;
    };
    const expected = (scope: Scope, type: string, window: Window = {}) => {
      const groups = world.groups.filter((group) => inScope(group, scope, type, window));
      const count = (test: (group: WorldGroup) => boolean) => groups.filter(test).length;
      const players = new Set(
        groups.flatMap((group) =>
          [...group.teamA, ...group.teamB].map((index) => `${group.community}:${index}`)
        )
      );
      return {
        groups,
        played: groups.length,
        competitive: count((group) => group.type === 'competitive'),
        friendly: count((group) => group.type === 'friendly'),
        decided: count((group) => group.result === 'win'),
        draws: count((group) => group.result === 'draw'),
        incomplete: count((group) => group.result === 'incomplete'),
        sets: groups.reduce(
          (sum, group) => sum + SCORES[group.result].setsA + SCORES[group.result].setsB,
          0
        ),
        games: groups.reduce(
          (sum, group) => sum + SCORES[group.result].gamesA + SCORES[group.result].gamesB,
          0
        ),
        activePlayers: players.size
      };
    };
    const matchesOf = (stats: Record<string, unknown>) => asRecord(stats['matches']);
    const day = (offset: number) => {
      const base = new Date(`${world.groups.find((g) => g.key === 'g6')!.day}T00:00:00Z`);
      base.setUTCDate(base.getUTCDate() + offset);
      return base.toISOString().slice(0, 10);
    };

    it('matches the oracle for every scope × type × date-window row', async () => {
      const scopes: Scope[] = ['main', 'active', 'closed'];
      const windows: Window[] = [
        {},
        { from: day(-1), through: day(0) },
        { from: day(0) },
        { through: day(-2) },
        { from: day(-3), through: day(-3) }
      ];
      for (const scope of scopes) {
        for (const type of TYPES) {
          for (const window of windows) {
            const want = expected(scope, type, window);
            const got = await read(a, scope, type, window);
            expect(matchesOf(got)).toEqual({
              played: want.played,
              competitive: want.competitive,
              friendly: want.friendly,
              decided: want.decided,
              draws: want.draws,
              incomplete: want.incomplete
            });
            expect(got['totals']).toEqual({ sets: want.sets, games: want.games });
            expect(got['activePlayers']).toBe(want.activePlayers);
            expect(got['filters']).toEqual({
              communityId: scope === 'all' ? null : world.main.communityId,
              leagueId:
                scope === 'active'
                  ? world.leagues.active
                  : scope === 'closed'
                    ? world.leagues.closed
                    : null,
              type,
              from: window.from ?? null,
              through: window.through ?? null
            });
          }
        }
      }
    });

    it('keeps the League rule: eligible competitive groups only, Friendly + League empty and explained', async () => {
      const active = await read(a, 'active', 'all');
      expect(matchesOf(active)).toMatchObject({ played: 2, competitive: 2, friendly: 0 });
      expect(active['notice']).toBeNull();
      expect(active['league']).toMatchObject({ id: world.leagues.active, status: 'active' });
      const friendly = await read(a, 'active', 'friendly');
      expect(matchesOf(friendly)).toMatchObject({ played: 0 });
      expect(friendly['notice']).toBe('friendly_league');
      const closedFriendly = await read(a, 'closed', 'friendly');
      expect(closedFriendly['notice']).toBe('friendly_league');
      // A Friendly group bound to nothing never leaks into a League, and no type coercion happened.
      expect((await read(a, 'closed', 'all'))['league']).toMatchObject({ status: 'closed' });
      expect(matchesOf(await read(a, 'closed', 'competitive'))).toMatchObject({ played: 1 });
    });

    it('never silently switches a historical League to the active one', async () => {
      const closed = await read(a, 'closed', 'all');
      expect(asRecord(closed['filters'])['leagueId']).toBe(world.leagues.closed);
      expect(closed['activeLeagueId']).toBe(world.leagues.active);
      expect(matchesOf(closed)).toMatchObject({ played: 1 });
      expect(asRecord(closed['rankingMatches'])).toMatchObject({
        state: 'ready',
        value: { groups: 0 }
      });
      const lifetime = await read(a, 'main', 'all');
      // "Matches in the active ranking" counts only the active League's eligible groups.
      expect(asRecord(lifetime['rankingMatches'])).toMatchObject({
        state: 'ready',
        value: { groups: 2, leagues: 1 }
      });
    });

    it('answers PRD 38 from independently counted groups', async () => {
      const stats = await read(a, 'main', 'all');
      const decoded = decodeCommunityStatistics(stats);
      const leader = (key: string) => asRecord(stats[key]);
      const ids = (key: string) => {
        const players = asRecord(leader(key)['value'])['players'];
        if (!Array.isArray(players)) throw new Error('Expected players');
        return players.map((player: unknown) => String(asRecord(player)['userId']));
      };
      const sortedIds = (...indexes: number[]) => indexes.map(idOf).sort();
      expect(stats['activePlayers']).toBe(8);
      expect(leader('mostActivePlayer')).toMatchObject({
        state: 'ready',
        value: { value: 7, total: 4 }
      });
      expect(ids('mostActivePlayer')).toEqual(sortedIds(0, 1, 2, 3));
      expect(leader('mostWins')).toMatchObject({ state: 'ready', value: { value: 4, total: 1 } });
      expect(ids('mostWins')).toEqual([idOf(0)]);
      expect(leader('bestSetDifferential')).toMatchObject({ state: 'ready', value: { value: 7 } });
      expect(ids('bestSetDifferential')).toEqual([idOf(0)]);
      expect(leader('bestGameDifferential')).toMatchObject({
        state: 'ready',
        value: { value: 17 }
      });
      expect(ids('bestGameDifferential')).toEqual([idOf(0)]);
      // Highest win rate: threshold 5 decided matches; player 0 is 4W-1L-1D (4/6).
      expect(leader('highestWinRate')).toMatchObject({ state: 'ready' });
      expect(ids('highestWinRate')).toEqual([idOf(0)]);
      expect(Number(asRecord(leader('highestWinRate')['value'])['value'])).toBeCloseTo(4 / 6, 6);
      // Most improved is the largest scoped ledger movement over the participant facts.
      const [best] = await sqlRows(
        `select pf.user_id::text as user_id, sum(pf.rating_delta) as delta
         from public.statistics_participant_facts pf
        where pf.community_id = ${sqlText(world.main.communityId)} and pf.rating_delta is not null
        group by pf.user_id order by delta desc, pf.user_id limit 1`
      );
      expect(ids('mostImproved')).toEqual([String(best?.['user_id'])]);
      expect(Number(asRecord(leader('mostImproved')['value'])['value'])).toBeCloseTo(
        Number(best?.['delta']),
        6
      );
      // Most frequent pair: 0+1 and 2+3 tie at 6 groups, both kept; common matchup 0+1 vs 2+3 (6).
      const pair = asRecord(asRecord(stats['mostFrequentPair'])['value']);
      expect(pair).toMatchObject({ groups: 6, total: 2 });
      if (decoded.mostFrequentPair.state !== 'ready') throw new Error('Expected pair');
      const pairTeams = decoded.mostFrequentPair.value.items.map((item) =>
        item.teams[0]!.map((p) => p.userId).sort((left, right) => left.localeCompare(right))
      );
      expect(pairTeams.sort((left, right) => left.join().localeCompare(right.join()))).toEqual(
        [sortedIds(0, 1), sortedIds(2, 3)].sort((left, right) =>
          left.join().localeCompare(right.join())
        )
      );
      const matchup = asRecord(asRecord(stats['mostCommonMatchup'])['value']);
      expect(matchup).toMatchObject({ groups: 6, total: 1 });
      if (decoded.mostCommonMatchup.state !== 'ready') throw new Error('Expected matchup');
      const teams = decoded.mostCommonMatchup.value.items[0]!.teams;
      expect(
        teams
          .map((team) => team.map((p) => p.userId).sort((left, right) => left.localeCompare(right)))
          .sort((left, right) => left.join().localeCompare(right.join()))
      ).toEqual(
        [sortedIds(0, 1), sortedIds(2, 3)].sort((left, right) =>
          left.join().localeCompare(right.join())
        )
      );
      // Closest rivalry: players 1 and 2 meet 6 times decided (3W-2L-1D, gap 1).
      expect(asRecord(stats['closestRivalry'])).toMatchObject({
        state: 'ready',
        value: { imbalance: 1, resolved: 6, total: 1 }
      });
      if (decoded.closestRivalry.state !== 'ready') throw new Error('Expected rivalry');
      const pairing = decoded.closestRivalry.value.relationships[0]!;
      expect(
        [pairing.first.userId, pairing.second.userId].sort((left, right) =>
          left.localeCompare(right)
        )
      ).toEqual(sortedIds(1, 2));
    });

    it('counts a group once at community level and reconciles with player, pair and head-to-head totals', async () => {
      const stats = await read(a, 'main', 'all');
      const played = Number(matchesOf(stats)['played']);
      expect(played).toBe(9);
      let participants = 0;
      for (let index = 0; index < 8; index += 1) {
        const result = await world.main.rpc(world.players[index]!, 'get_player_statistics', {
          p_player_id: idOf(index),
          p_community_id: world.main.communityId
        });
        if (result.error) throw result.error;
        participants += Number(asRecord(asRecord(result.data)['matches'])['played']);
      }
      // Four participants per group: the deliberate multiplier between player and community totals.
      expect(participants).toBe(4 * played);
      const pair = await world.main.rpc(a, 'get_pair_statistics', {
        p_player_id: idOf(0),
        p_partner_id: idOf(1),
        p_community_id: world.main.communityId
      });
      expect(asRecord(asRecord(asRecord(pair.data)['record'])['matches'])['played']).toBe(
        asRecord(asRecord(stats['mostFrequentPair'])['value'])['groups']
      );
      const versus = await world.main.rpc(a, 'get_opponent_statistics', {
        p_player_id: idOf(1),
        p_opponent_id: idOf(2),
        p_community_id: world.main.communityId
      });
      const record = asRecord(asRecord(asRecord(versus.data)['record'])['matches']);
      const rivalry = asRecord(asRecord(stats['closestRivalry'])['value']);
      expect(Number(record['wins']) + Number(record['losses']) + Number(record['draws'])).toBe(
        rivalry['resolved']
      );
      expect(Math.abs(Number(record['wins']) - Number(record['losses']))).toBe(
        rivalry['imbalance']
      );
    });

    it('insufficient evidence stays typed: no leader claim below the configured threshold', async () => {
      const closed = await read(a, 'closed', 'all');
      expect(closed['highestWinRate']).toMatchObject({
        state: 'insufficient',
        reason: 'minimum_matches',
        observed: 1,
        required: 5
      });
      expect(closed['closestRivalry']).toMatchObject({ state: 'insufficient', required: 5 });
      const empty = await read(a, 'main', 'all', { from: '2000-01-01', through: '2000-01-01' });
      expect(matchesOf(empty)).toMatchObject({ played: 0 });
      expect(empty['mostWins']).toMatchObject({
        state: 'insufficient',
        reason: 'no_applicable_result'
      });
      expect(empty['averageMatchesPerWeek']).toMatchObject({
        state: 'insufficient',
        reason: 'no_denominator'
      });
      expect(empty['weeks']).toEqual([]);
      expect(empty['activePlayers']).toBe(0);
    });

    it('reports UTC ISO-week and month frequency with zero buckets and a declared window', async () => {
      const stats = await read(a, 'main', 'all');
      const decoded = decodeCommunityStatistics(stats);
      const weeks = decoded.weeks;
      expect(weeks.reduce((sum, week) => sum + week.groups, 0)).toBe(9);
      for (const week of weeks) expect(new Date(`${week.start}T00:00:00Z`).getUTCDay()).toBe(1);
      for (let i = 1; i < weeks.length; i += 1) {
        const gap =
          Date.parse(`${weeks[i]!.start}T00:00:00Z`) -
          Date.parse(`${weeks[i - 1]!.start}T00:00:00Z`);
        expect(gap).toBe(7 * 86_400_000);
      }
      const months = decoded.months;
      expect(months.reduce((sum, month) => sum + month.groups, 0)).toBe(9);
      const days = world.groups
        .filter((group) => group.community === 'main')
        .map((group) => group.day)
        .sort((left, right) => left.localeCompare(right));
      const first = days[0]!;
      const last = days.at(-1)!;
      const elapsed =
        (Date.parse(last + 'T00:00:00Z') - Date.parse(first + 'T00:00:00Z')) / 86_400_000 + 1;
      const window = asRecord(stats['window']);
      expect(window['from']).toBe(first);
      expect(window['through']).toBe(last);
      expect(window['elapsedDays']).toBe(elapsed);
      const average = asRecord(stats['averageMatchesPerWeek']);
      expect(average).toMatchObject({ state: 'ready', numerator: 9, denominator: elapsed });
      expect(Number(average['value'])).toBeCloseTo(9 / Math.max(1, elapsed / 7), 6);
    });

    it('applies the date range to played day bounds, including start and end midnight', async () => {
      const g6 = world.groups.find((g) => g.key === 'g6')!;
      const exactDay = await read(a, 'main', 'all', { from: g6.day, through: g6.day });
      expect(matchesOf(exactDay)).toMatchObject({
        played: expected('main', 'all', { from: g6.day, through: g6.day }).played
      });
      // Day before and after exclude it, from/through are both inclusive.
      const before = await read(a, 'main', 'all', { through: day(-1) });
      const after = await read(a, 'main', 'all', { from: day(0) });
      expect(Number(matchesOf(before)['played']) + Number(matchesOf(after)['played'])).toBe(9);
    });

    it('rejects invalid input with a typed error', async () => {
      const rpc = (args: Record<string, unknown>) =>
        world.main.rpc(a, 'get_community_statistics', args);
      const failing = [
        { p_type: 'ranked' },
        { p_league_id: world.leagues.active },
        { p_community_id: world.main.communityId, p_league_id: world.other.communityId },
        { p_community_id: world.main.communityId, p_from: '2030-02-02', p_through: '2030-02-01' }
      ];
      for (const args of failing) {
        const result = await rpc(args);
        expect(result.error?.message ?? '').toContain('STATISTICS_INVALID_INPUT');
      }
    });
  }
);
