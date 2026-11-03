import { describe, expect, it } from 'vitest';
import {
  decodeOpponentRecords,
  decodeOpponentStatistics,
  decodePartnerRecords,
  readOpponentRecords,
  readOpponentStatistics,
  readPairStatistics,
  readPartnerRecords
} from '../src/features/statistics/statistics-relationships.server';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { insufficient } from './helpers/player-statistics-fixtures';
import {
  FOCAL,
  OTHER,
  THIRD,
  makeOpponent,
  makeOpponentRecords,
  makePair,
  makePartnerRecords
} from './helpers/relationship-statistics-fixtures';

type Call = { fn: string; args: Record<string, unknown> };
/** A real client over a stubbed transport: records each RPC and answers with the given payload. */
function fakeClient(response: { body: unknown; status?: number }) {
  const calls: Call[] = [];
  const client = createClient<Database>('http://localhost:54321', 'public-key', {
    global: {
      fetch: async (input, init) => {
        const request = new Request(input, init);
        calls.push({
          fn: new URL(request.url).pathname.split('/rpc/')[1] ?? '',
          args: await request.json()
        });
        return new Response(JSON.stringify(response.body), {
          status: response.status ?? 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    },
    auth: { persistSession: false }
  });
  return { calls, client };
}
const filters = {
  communityId: null,
  leagueId: null,
  type: 'all' as const,
  from: null,
  through: null
};

describe('head-to-head decoding', () => {
  it('round-trips both orientations with focal rating effects', () => {
    const opponent = makeOpponent();
    expect(decodeOpponentStatistics(opponent)).toEqual(opponent);
    const reversed = makeOpponent({
      focalId: OTHER,
      otherId: FOCAL,
      focal: opponent.other,
      other: opponent.focal,
      recent: opponent.recent.map((match) => ({
        ...match,
        outcome: match.outcome === 'W' ? 'L' : match.outcome === 'L' ? 'W' : match.outcome,
        setsFor: match.setsAgainst,
        setsAgainst: match.setsFor,
        ratingDelta: match.ratingDelta === null ? null : -match.ratingDelta
      }))
    });
    const decoded = decodeOpponentStatistics(reversed);
    expect(decoded.recent.map((match) => match.outcome)).toEqual(['W', 'L', 'L']);
    expect(decoded.recent[0]).toMatchObject({ setsFor: 1, setsAgainst: 2, ratingDelta: 0.2 });
  });
  it('keeps a missing Friendly rating effect null rather than zero', () => {
    const decoded = decodeOpponentStatistics(makeOpponent());
    expect(decoded.recent[2]?.ratingDelta).toBeNull();
  });
  it('shows no meetings for teammates as a true empty record', () => {
    const record = makeOpponent().record;
    const empty = {
      ...record,
      matches: {
        played: 0,
        competitive: 0,
        friendly: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        incomplete: 0,
        winRate: insufficient('no_denominator')
      },
      sets: { won: 0, lost: 0, differential: 0, winRate: insufficient('no_denominator') },
      games: { won: 0, lost: 0, differential: 0, winRate: insufficient('no_denominator') },
      streaks: { current: { kind: null, length: 0 }, longestWins: 0, longestLosses: 0 },
      leaderEligibility: insufficient('minimum_matches', 0, 5)
    };
    const decoded = decodeOpponentStatistics(makeOpponent({ record: empty, recent: [] }));
    expect(decoded.record.matches.played).toBe(0);
    expect(decoded.record.matches.winRate).toMatchObject({ state: 'insufficient' });
  });
  it('rejects a streak with a kind but no length', () => {
    const opponent = makeOpponent();
    expect(() =>
      decodeOpponentStatistics({
        ...opponent,
        record: {
          ...opponent.record,
          streaks: { ...opponent.record.streaks, current: { kind: 'W', length: 0 } }
        }
      })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });
});

describe('partner and opponent record decoding', () => {
  it('keeps tied leaders and a below-threshold claim as typed states', () => {
    const tied = makePartnerRecords({
      best: {
        state: 'ready',
        value: {
          players: [
            { userId: OTHER, displayName: 'Bea' },
            { userId: THIRD, displayName: null }
          ],
          resolved: 5,
          winRate: 0.8,
          imbalance: 3
        },
        numerator: null,
        denominator: null
      }
    });
    expect(decodePartnerRecords(tied).best).toMatchObject({
      state: 'ready',
      value: { players: [{ userId: OTHER }, { userId: THIRD, displayName: null }] }
    });
    const below = makePartnerRecords({ best: insufficient('minimum_matches', 4, 5) });
    expect(decodePartnerRecords(below).best).toMatchObject({
      state: 'insufficient',
      observed: 4,
      required: 5
    });
  });
  it('decodes opponent leaders including toughest and closest rivalry', () => {
    const records = makeOpponentRecords();
    expect(decodeOpponentRecords(records)).toEqual(records);
  });
  it('rejects a page larger than its limit and unaligned ratings', () => {
    const records = makePartnerRecords({ limit: 1 });
    expect(() => decodePartnerRecords(records)).toThrow('INVALID_STATISTICS_RESPONSE');
    const lagging = makePartnerRecords();
    expect(() =>
      decodePartnerRecords({ ...lagging, config: { ...lagging.config, rating_aligned: false } })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });
});

describe('relationship readers', () => {
  it('call the whitelisted RPCs with only the selected filters', async () => {
    const pair = fakeClient({ body: makePair() });
    const response = await readPairStatistics(pair.client, {
      playerId: FOCAL,
      otherId: OTHER,
      filters: { ...filters, communityId: THIRD, type: 'competitive', from: '2030-01-01' }
    });
    expect(response).toMatchObject({ status: 'ok' });
    expect(pair.calls).toEqual([
      {
        fn: 'get_pair_statistics',
        args: {
          p_player_id: FOCAL,
          p_partner_id: OTHER,
          p_recent_offset: 0,
          p_type: 'competitive',
          p_community_id: THIRD,
          p_from: '2030-01-01'
        }
      }
    ]);
    const opponent = fakeClient({ body: makeOpponent() });
    await readOpponentStatistics(opponent.client, {
      playerId: FOCAL,
      otherId: OTHER,
      filters,
      recentOffset: 10
    });
    expect(opponent.calls[0]).toMatchObject({
      fn: 'get_opponent_statistics',
      args: { p_player_id: FOCAL, p_opponent_id: OTHER, p_type: 'all', p_recent_offset: 10 }
    });
    const partners = fakeClient({ body: makePartnerRecords() });
    await readPartnerRecords(partners.client, { playerId: FOCAL, filters, limit: 20, offset: 0 });
    expect(partners.calls[0]).toMatchObject({
      fn: 'get_player_partner_records',
      args: { p_player_id: FOCAL, p_limit: 20, p_offset: 0 }
    });
    const opponents = fakeClient({ body: makeOpponentRecords() });
    await readOpponentRecords(opponents.client, { playerId: FOCAL, filters, limit: 5, offset: 10 });
    expect(opponents.calls[0]).toMatchObject({
      fn: 'get_player_opponent_records',
      args: { p_limit: 5, p_offset: 10 }
    });
  });
  it('maps database failures to typed errors, never an empty result', async () => {
    const denied = fakeClient({
      status: 404,
      body: { message: 'STATISTICS_NOT_FOUND', code: 'P0002' }
    });
    await expect(
      readPairStatistics(denied.client, { playerId: FOCAL, otherId: OTHER, filters })
    ).resolves.toEqual({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    const stale = fakeClient({
      status: 400,
      body: { message: 'STATISTICS_STALE_REVISION', code: 'P0001' }
    });
    await expect(
      readOpponentStatistics(stale.client, { playerId: FOCAL, otherId: OTHER, filters })
    ).resolves.toEqual({ status: 'error', code: 'STATISTICS_STALE_REVISION' });
  });
  it('reports malformed payloads as an invalid response', async () => {
    const bad = fakeClient({ body: { focalId: FOCAL } });
    await expect(
      readPartnerRecords(bad.client, { playerId: FOCAL, filters, limit: 20, offset: 0 })
    ).resolves.toEqual({ status: 'error', code: 'INVALID_STATISTICS_RESPONSE' });
  });
});
