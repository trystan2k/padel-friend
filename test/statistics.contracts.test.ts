import { describe, expect, it } from 'vitest';
import { DEFAULT_STATISTICS_THRESHOLDS } from '../src/features/statistics/statistics-config';
import {
  decodeDailyBucket,
  decodeSequence,
  decodeStatisticsConfig,
  decodeSummaryRow
} from '../src/features/statistics/statistics-decoders';
import { emptyAggregate } from '../src/features/statistics/statistics-model';
import { statsGroupId, statsInstant } from './helpers/statistics-fixtures';

const NIL = '00000000-0000-0000-0000-000000000000';
const baseRow = () => ({
  subject_kind: 'player',
  subject_a: statsGroupId(1),
  subject_b: NIL,
  scope_kind: 'all',
  scope_id: NIL,
  match_type: 'all',
  subject_players: [statsGroupId(1)],
  ...emptyAggregate(),
  confirmed_groups: 2,
  wins: 1,
  incomplete_groups: 1,
  competitive_groups: 1,
  friendly_groups: 1,
  rating_delta_sum: '0.30',
  opponent_strength_sum: '8.1',
  first_played_at: statsInstant(0),
  first_game_group_id: statsGroupId(2),
  last_played_at: statsInstant(1),
  last_game_group_id: statsGroupId(3),
  sequence: {
    n: 1,
    prefix: { k: 'W', len: 1 },
    suffix: { k: 'W', len: 1 },
    best_win: 1,
    best_loss: 0
  },
  recent: [{ g: statsGroupId(2), o: 'W', at: statsInstant(0) }],
  extrema: { cleanest_win: { k: -5, v: 5, at: statsInstant(0), g: statsGroupId(2) } },
  relations: { partners: { [statsGroupId(4)]: { g: 1 } } },
  activity: { weeks: { '2029-12-31': 1 }, months: { '2030-01': 1 } }
});

describe('statistics config contract', () => {
  const payload = {
    config_version: 1,
    thresholds: DEFAULT_STATISTICS_THRESHOLDS,
    statistics_revision: 4,
    rating_revision: 9,
    rating_aligned: true
  };

  it('decodes the applied thresholds and revisions exactly', () => {
    expect(decodeStatisticsConfig(payload)).toEqual(payload);
  });

  it.each([
    ['an extra key', { ...payload, extra: 1 }],
    ['a missing key', { ...payload, rating_aligned: undefined }],
    [
      'a missing threshold',
      { ...payload, thresholds: { ...payload.thresholds, form_min_resolved: undefined } }
    ],
    [
      'a zero threshold',
      { ...payload, thresholds: { ...payload.thresholds, rate_min_opportunities: 0 } }
    ],
    [
      'an upset ratio outside (0,1)',
      { ...payload, thresholds: { ...payload.thresholds, upset_expected_score_max: 1 } }
    ],
    ['a negative revision', { ...payload, statistics_revision: -1 }],
    ['a non-object', null]
  ])('rejects %s', (_label, value) => {
    expect(() => decodeStatisticsConfig(value)).toThrow('INVALID_STATISTICS_RESPONSE');
  });
});

describe('statistics row decoders', () => {
  it('decodes a stored summary row including numeric strings', () => {
    const row = decodeSummaryRow(baseRow());
    expect(row.rating_delta_sum).toBeCloseTo(0.3);
    expect(row.opponent_strength_sum).toBeCloseTo(8.1);
    expect(row.extrema.cleanest_win).toMatchObject({ k: -5, v: 5 });
    expect(row.sequence.best_win).toBe(1);
    expect(row.relations).toEqual({ partners: { [statsGroupId(4)]: { g: 1 } } });
  });

  it('decodes a daily bucket and keeps only the calendar day', () => {
    const bucket = decodeDailyBucket({ ...baseRow(), played_day: '2030-01-01' });
    expect(bucket.played_day).toBe('2030-01-01');
    expect(() => decodeDailyBucket({ ...baseRow(), played_day: 'soon' })).toThrow(
      'INVALID_STATISTICS_RESPONSE'
    );
  });

  it.each([
    ['an unknown subject kind', { subject_kind: 'team' }],
    ['an unknown scope', { scope_kind: 'region' }],
    ['a partition that does not add up', { wins: 2 }],
    [
      'an unknown extremum',
      { extrema: { best_ever: { k: 1, v: 1, at: statsInstant(0), g: statsGroupId(1) } } }
    ],
    [
      'more than ten recent outcomes',
      {
        recent: Array.from({ length: 11 }, () => ({
          g: statsGroupId(1),
          o: 'W',
          at: statsInstant(0)
        }))
      }
    ],
    ['a malformed identity', { subject_a: 'not-a-uuid' }],
    ['a non-finite delta', { rating_delta_sum: 'NaN' }]
  ])('rejects %s', (_label, patch) => {
    expect(() => decodeSummaryRow({ ...baseRow(), ...patch })).toThrow(
      'INVALID_STATISTICS_RESPONSE'
    );
  });

  it('requires an empty sequence to have no runs and a populated one to have both', () => {
    expect(decodeSequence({ n: 0, prefix: null, suffix: null, best_win: 0, best_loss: 0 }).n).toBe(
      0
    );
    expect(() =>
      decodeSequence({ n: 1, prefix: null, suffix: null, best_win: 0, best_loss: 0 })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
    expect(() =>
      decodeSequence({ n: 0, prefix: { k: 'W', len: 1 }, suffix: null, best_win: 0, best_loss: 0 })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });
});
