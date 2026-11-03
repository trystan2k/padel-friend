import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { DEFAULT_STATISTICS_THRESHOLDS } from '../src/features/statistics/statistics-config';
import { validateStatisticsPlayerInput } from '../src/features/statistics/statistics.validators';
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  read: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  readRanks: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (validate: (value: unknown) => unknown) => ({
      handler:
        (handle: (input: { data: unknown }) => Promise<unknown>) => (input: { data: unknown }) =>
          handle({ data: validate(input.data) })
    })
  })
}));
vi.mock('../src/features/auth/auth.server', () => ({ requireAuthenticatedClient: mocks.auth }));
vi.mock('../src/features/statistics/statistics-player.server', () => ({
  readPlayerStatistics: mocks.read,
  readPlayerRankHistory: mocks.readRanks
}));
import {
  getPlayerRankHistory,
  getPlayerStatistics
} from '../src/features/statistics/statistics-player.functions';
const id = '11111111-1111-4111-8111-111111111111';
beforeEach(() => {
  mocks.auth.mockReset();
  mocks.read.mockReset();
  mocks.readRanks.mockReset();
});
describe('player rank history server boundary', () => {
  it('rejects unauthenticated requests', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(getPlayerRankHistory({ data: { playerId: id } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(mocks.readRanks).not.toHaveBeenCalled();
  });
  it('returns typed invalid input without reading data', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    await expect(getPlayerRankHistory({ data: { playerId: id, leagueId: id } })).resolves.toEqual({
      status: 'error',
      code: 'INVALID_STATISTICS_INPUT'
    });
    expect(mocks.readRanks).not.toHaveBeenCalled();
  });
  it('passes the validated scope and a clamped page size to the reader', async () => {
    const client = {};
    mocks.auth.mockResolvedValueOnce({ client });
    mocks.readRanks.mockResolvedValueOnce({ status: 'ok', value: { playerId: id } });
    await expect(
      getPlayerRankHistory({ data: { playerId: id, communityId: id, limit: 9999 } })
    ).resolves.toMatchObject({ status: 'ok' });
    expect(mocks.readRanks).toHaveBeenCalledWith(client, {
      playerId: id,
      communityId: id,
      limit: 100
    });
  });
});
describe('player statistics server boundary', () => {
  it('rejects unauthenticated requests', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(getPlayerStatistics({ data: { playerId: id } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns typed invalid input without reading data', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    await expect(getPlayerStatistics({ data: { playerId: id, leagueId: id } })).resolves.toEqual({
      status: 'error',
      code: 'INVALID_STATISTICS_INPUT'
    });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('returns outsider denial and never substitutes an empty response', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    mocks.read.mockResolvedValueOnce({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(getPlayerStatistics({ data: { playerId: id, communityId: id } })).resolves.toEqual(
      { status: 'error', code: 'STATISTICS_NOT_FOUND' }
    );
  });
  it('passes validated scope and request-local client to the reader', async () => {
    const client = {};
    mocks.auth.mockResolvedValueOnce({ client });
    mocks.read.mockResolvedValueOnce({ status: 'ok', value: { playerId: id } });
    await expect(
      getPlayerStatistics({ data: { playerId: id, communityId: id } })
    ).resolves.toMatchObject({ status: 'ok' });
    expect(mocks.read).toHaveBeenCalledWith(client, {
      playerId: id,
      filters: { communityId: id, leagueId: null, type: 'all', from: null, through: null }
    });
  });
  describe('full response decoding', () => {
    const ready = (
      value: unknown,
      numerator: number | null = null,
      denominator: number | null = null
    ) => ({
      state: 'ready',
      value,
      numerator,
      denominator
    });
    const insufficient = (reason: string, observed: number, required: number) => ({
      state: 'insufficient',
      value: null,
      numerator: null,
      denominator: null,
      observed,
      required,
      reason
    });
    const rank = {
      position: 2,
      provenance: 'reconstructed',
      at: '2026-10-01T10:00:00.000000Z',
      communityId: id,
      leagueId: null,
      standingsVersion: null,
      ratingRevision: 3
    };
    const unpublished = { state: 'unavailable', value: null, reason: 'rank_coverage_boundary' };
    const bestSkill = {
      best: ready(rank, 2, 8),
      coverageFrom: '2026-10-01T10:00:00.000000Z',
      coverageUntil: null,
      coverageComplete: true,
      coverageReason: null
    };
    const bestLeague = {
      best: unpublished,
      coverageFrom: null,
      coverageUntil: null,
      coverageComplete: false,
      coverageReason: 'unpublished_league'
    };
    const candidate = { k: 1, v: 12, at: '2026-10-01T10:00:00Z', g: id };
    const bucket = { period: '2026-10-01', groups: 3 };
    const outcome = { g: id, o: 'W', at: '2026-10-01T10:00:00Z' };
    const payload = () => ({
      player_id: id,
      config: {
        config_version: 1,
        thresholds: DEFAULT_STATISTICS_THRESHOLDS,
        statistics_revision: 7,
        rating_revision: 3,
        rating_aligned: true
      },
      filters: { communityId: id, leagueId: null, type: 'all', from: null, through: null },
      matches: {
        played: 5,
        competitive: 3,
        friendly: 2,
        wins: 3,
        losses: 1,
        draws: 0,
        incomplete: 1,
        winRate: ready(0.75, 3, 4),
        competitiveWinRate: ready(0.5, 1, 2),
        friendlyWinRate: insufficient('minimum_opportunities', 2, 5)
      },
      typeRates: {
        competitive: {
          winRate: ready(0.5, 1, 2),
          setRate: ready(0.6, 3, 5),
          gameRate: ready(0.55, 22, 40)
        },
        friendly: {
          winRate: insufficient('minimum_opportunities', 2, 5),
          setRate: insufficient('minimum_opportunities', 2, 5),
          gameRate: ready(0.5, 18, 36)
        }
      },
      sets: { won: 6, lost: 3, differential: 3, winRate: ready(2 / 3, 6, 9) },
      games: {
        won: 40,
        lost: 30,
        differential: 10,
        winRate: ready(40 / 70, 40, 70),
        averageWonPerGroup: ready(8, 40, 5),
        averageConcededPerGroup: ready(6, 30, 5)
      },
      rating: {
        currentLevel: ready(4.2),
        reliability: ready(60),
        startingLevel: ready(4),
        highestLevel: insufficient('not_established', 0, 1),
        lowestEstablishedLevel: insufficient('not_established', 0, 1),
        filteredDelta: ready(0.2, null, 4),
        communitySkillRank: ready(rank, 2, 8),
        activeLeaguePosition: insufficient('not_in_league', 0, 1),
        bestCommunitySkillRank: bestSkill,
        bestLeaguePosition: bestLeague
      },
      form: {
        last5: ready(
          { outcomes: [outcome], wins: 1, losses: 0, draws: 0, sampleSize: 1, capacity: 5 },
          null,
          1
        ),
        last10: insufficient('no_resolved_matches', 0, 3),
        current: { kind: 'W', length: 2 },
        longestWins: 3,
        longestLosses: 1
      },
      advanced: {
        straightSetWins: 2,
        straightSetLosses: 0,
        threeSetGroups: 2,
        incompleteDeciders: 1,
        decidingSetWins: 1,
        decidingSetLosses: 1,
        decidingSetWinRate: insufficient('minimum_opportunities', 2, 5),
        firstSetConversionRate: ready(1, 3, 3),
        comebackWinRate: insufficient('minimum_opportunities', 1, 5),
        cleanestWin: ready(candidate),
        closestWin: ready(candidate),
        biggestGain: insufficient('no_applicable_result', 0, 1),
        biggestLoss: insufficient('no_applicable_result', 0, 1),
        strongestUpset: ready(candidate),
        toughestLoss: insufficient('no_applicable_result', 0, 1)
      },
      activity: {
        fromDay: '2026-10-01',
        throughDay: '2026-10-07',
        weeklyAverage: ready(5, 5, 1),
        mostActiveWeek: ready(bucket),
        mostActiveMonth: ready({ period: '2026-10', groups: 5 }),
        days: [bucket],
        weeks: [bucket],
        months: [{ period: '2026-10', groups: 5 }]
      },
      relationships: {
        uniquePartners: 2,
        uniqueOpponents: 3,
        uniqueQuartets: 4,
        mostFrequentPartners: [{ playerId: id, groups: 3 }],
        mostFrequentOpponents: [{ playerId: id, groups: 2 }],
        mostFrequentPartnerShare: ready(0.6, 3, 5)
      }
    });
    const read = async (body: unknown) => {
      const actual = await vi.importActual<
        typeof import('../src/features/statistics/statistics-player.server')
      >('../src/features/statistics/statistics-player.server');
      const client = createClient<Database>('http://localhost:54321', 'public-key', {
        global: {
          fetch: async () =>
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
        },
        auth: { persistSession: false }
      });
      return actual.readPlayerStatistics(client, validateStatisticsPlayerInput({ playerId: id }));
    };
    it('decodes every section into one coherent response', async () => {
      const result = await read(payload());
      expect(result).toMatchObject({
        status: 'ok',
        value: {
          playerId: id,
          filters: { communityId: id, type: 'all' },
          config: { statistics_revision: 7, rating_revision: 3, rating_aligned: true },
          matches: { played: 5, wins: 3, incomplete: 1, winRate: { state: 'ready', value: 0.75 } },
          typeRates: { competitive: { gameRate: { value: 0.55 } } },
          sets: { won: 6, lost: 3, differential: 3 },
          games: { differential: 10, averageWonPerGroup: { value: 8 } },
          rating: {
            currentLevel: { value: 4.2 },
            communitySkillRank: {
              state: 'ready',
              value: { position: 2, provenance: 'reconstructed' }
            },
            activeLeaguePosition: { state: 'insufficient', reason: 'not_in_league' },
            bestCommunitySkillRank: {
              best: { value: { ratingRevision: 3 } },
              coverageComplete: true
            },
            bestLeaguePosition: {
              best: { state: 'unavailable', reason: 'rank_coverage_boundary' },
              coverageReason: 'unpublished_league'
            }
          },
          form: {
            last5: { state: 'ready', value: { sampleSize: 1, capacity: 5 } },
            current: { kind: 'W', length: 2 },
            longestWins: 3
          },
          advanced: {
            straightSetWins: 2,
            cleanestWin: { state: 'ready', value: candidate },
            firstSetConversionRate: { value: 1 }
          },
          activity: {
            fromDay: '2026-10-01',
            weeklyAverage: { value: 5 },
            mostActiveMonth: { value: { period: '2026-10', groups: 5 } },
            days: [bucket]
          },
          relationships: {
            uniquePartners: 2,
            uniqueQuartets: 4,
            mostFrequentPartners: [{ playerId: id, groups: 3 }],
            mostFrequentPartnerShare: { value: 0.6 }
          }
        }
      });
    });
    it('surfaces insufficient states verbatim without fabricating values', async () => {
      const result = await read(payload());
      expect(result).toMatchObject({
        status: 'ok',
        value: {
          matches: {
            friendlyWinRate: {
              state: 'insufficient',
              value: null,
              observed: 2,
              required: 5,
              reason: 'minimum_opportunities'
            }
          },
          form: { last10: { state: 'insufficient', value: null, reason: 'no_resolved_matches' } },
          advanced: {
            comebackWinRate: { state: 'insufficient', value: null, observed: 1, required: 5 },
            biggestGain: { state: 'insufficient', value: null, reason: 'no_applicable_result' }
          },
          rating: { highestLevel: { state: 'insufficient', reason: 'not_established' } }
        }
      });
    });
    it('rejects partial or inconsistent payloads', async () => {
      const missing = payload() as Record<string, unknown>;
      delete missing.relationships;
      const mismatched = payload();
      mismatched.matches.wins = 4;
      const fabricated = payload();
      Object.assign(fabricated.advanced.biggestGain, { value: 3 });
      const unaligned = payload();
      unaligned.config.rating_aligned = false;
      const invented = payload();
      Object.assign(invented.rating.communitySkillRank, {
        value: { ...rank, provenance: 'guess' }
      });
      const reasonless = payload();
      Object.assign(reasonless.rating.bestLeaguePosition, { coverageReason: 'whatever' });
      for (const body of [missing, mismatched, fabricated, unaligned, invented, reasonless])
        await expect(read(body)).resolves.toEqual({
          status: 'error',
          code: 'INVALID_STATISTICS_RESPONSE'
        });
    });
  });
  describe('rank history decoding', () => {
    const page = () => ({
      player_id: id,
      communityId: id,
      transitions: [
        {
          communityId: id,
          effectiveFrom: '2026-10-01T10:00:00.000000Z',
          status: 'ranked',
          position: 1,
          level: 4.2,
          reliability: 16,
          established: false,
          rankedMembers: 8,
          complete: true,
          ratingRevision: 2,
          source: 'ledger'
        },
        {
          communityId: id,
          effectiveFrom: '2026-10-02T10:00:00.000000Z',
          status: 'not_member',
          position: null,
          level: null,
          reliability: null,
          established: null,
          rankedMembers: null,
          complete: true,
          ratingRevision: null,
          source: null
        }
      ],
      truncated: false,
      leaguePositions: [
        {
          communityId: id,
          leagueId: id,
          standingsVersion: 2,
          position: 3,
          provenance: 'published',
          publishedAt: '2026-10-03T10:00:00.000000Z'
        }
      ]
    });
    const read = async (body: unknown) => {
      const actual = await vi.importActual<
        typeof import('../src/features/statistics/statistics-player.server')
      >('../src/features/statistics/statistics-player.server');
      const client = createClient<Database>('http://localhost:54321', 'public-key', {
        global: {
          fetch: async () =>
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'Content-Type': 'application/json' }
            })
        },
        auth: { persistSession: false }
      });
      return actual.readPlayerRankHistory(client, { playerId: id, communityId: id, limit: 50 });
    };
    it('decodes transitions and League positions with their evidence', async () => {
      await expect(read(page())).resolves.toMatchObject({
        status: 'ok',
        value: {
          playerId: id,
          transitions: [
            { status: 'ranked', position: 1, complete: true, source: 'ledger', ratingRevision: 2 },
            { status: 'not_member', position: null, source: null }
          ],
          leaguePositions: [{ standingsVersion: 2, position: 3, provenance: 'published' }]
        }
      });
    });
    it('rejects an unknown status, source or provenance', async () => {
      const status = page();
      Object.assign(status.transitions[0]!, { status: 'champion' });
      const source = page();
      Object.assign(source.transitions[0]!, { source: 'guess' });
      const provenance = page();
      Object.assign(provenance.leaguePositions[0]!, { provenance: 'invented' });
      for (const body of [status, source, provenance])
        await expect(read(body)).resolves.toEqual({
          status: 'error',
          code: 'INVALID_STATISTICS_RESPONSE'
        });
    });
  });
  it('rejects malformed payloads rather than returning a sporting result', async () => {
    const actual = await vi.importActual<
      typeof import('../src/features/statistics/statistics-player.server')
    >('../src/features/statistics/statistics-player.server');
    const client = createClient<Database>('http://localhost:54321', 'public-key', {
      global: {
        fetch: async () =>
          new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })
      },
      auth: { persistSession: false }
    });
    await expect(
      actual.readPlayerStatistics(client, validateStatisticsPlayerInput({ playerId: id }))
    ).resolves.toEqual({ status: 'error', code: 'INVALID_STATISTICS_RESPONSE' });
  });
});
