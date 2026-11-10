import { describe, expect, it } from 'vitest';
import {
  deriveActions,
  mergeActivity,
  pickNearestUpcoming,
  rankMovement,
  resolveSelection,
  skillRankOf,
  sortCommunities
} from '../src/features/home/home-model';
import type { RatingHistoryItem } from '../src/features/player/rating-contracts';
import type { PlayerRankTransition } from '../src/features/statistics/statistics-player-contracts';
import { makeMatchRpcListRow } from './helpers/match-fixtures';

const AS_OF = '2030-06-01T12:00:00.000Z';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

describe('community selection', () => {
  const communities = [
    { id: B, name: 'beta' },
    { id: A, name: 'Alpha' },
    { id: C, name: 'Alpha' }
  ];

  it('orders by name then id so the default is deterministic', () => {
    expect(sortCommunities(communities).map(({ id }) => id)).toEqual([A, C, B]);
    expect(sortCommunities([...communities].reverse()).map(({ id }) => id)).toEqual([A, C, B]);
  });

  it('uses the requested membership, else the first, else nothing', () => {
    expect(resolveSelection(communities, B)).toEqual({
      selectedId: B,
      requestedUnavailable: false
    });
    expect(resolveSelection(communities, null)).toEqual({
      selectedId: A,
      requestedUnavailable: false
    });
    expect(resolveSelection([], null)).toEqual({ selectedId: null, requestedUnavailable: false });
  });

  it('falls back without echoing a revoked or foreign selection', () => {
    const selection = resolveSelection(communities, '00000000-0000-4000-8000-0000000000ff');
    expect(selection).toEqual({ selectedId: A, requestedUnavailable: true });
    expect(resolveSelection([], B)).toEqual({ selectedId: null, requestedUnavailable: true });
  });
});

describe('nearest upcoming match', () => {
  const row = (overrides: Parameters<typeof makeMatchRpcListRow>[0]) =>
    makeMatchRpcListRow(overrides);

  it('orders by instant, never by localized date or text', () => {
    // 23:30 in Sao Paulo (UTC-3) is 02:30Z the next day; both rows are described by local clocks.
    const later = row({
      event_id: A,
      starts_at: '2030-06-01T14:00:00.000Z',
      timezone: 'Pacific/Kiritimati'
    });
    const sooner = row({
      event_id: B,
      starts_at: '2030-06-01T13:00:00.000Z',
      timezone: 'America/Sao_Paulo'
    });
    expect(pickNearestUpcoming([later, sooner], AS_OF)?.event_id).toBe(B);
  });

  it('breaks an exact instant tie by event id, whatever the input order', () => {
    const first = row({ event_id: A, starts_at: '2030-06-01T14:00:00.000Z' });
    const second = row({ event_id: B, starts_at: '2030-06-01T14:00:00.000Z' });
    expect(pickNearestUpcoming([second, first], AS_OF)?.event_id).toBe(A);
    expect(pickNearestUpcoming([first, second], AS_OF)?.event_id).toBe(A);
  });

  it('excludes past, cancelled, started and unreadable events', () => {
    const rows = [
      row({ event_id: A, starts_at: '2030-06-01T11:00:00.000Z' }),
      row({ event_id: B, starts_at: '2030-06-01T13:00:00.000Z', status: 'cancelled' }),
      row({ event_id: C, starts_at: '2030-06-01T13:30:00.000Z', is_past: true }),
      row({ event_id: '00000000-0000-4000-8000-0000000000d0', starts_at: 'not-a-date' })
    ];
    expect(pickNearestUpcoming(rows, AS_OF)).toBeNull();
    expect(pickNearestUpcoming([], AS_OF)).toBeNull();
  });

  it('treats the exact as-of instant as already started', () => {
    expect(pickNearestUpcoming([row({ event_id: A, starts_at: AS_OF })], AS_OF)).toBeNull();
  });
});

describe('rank movement', () => {
  it('reports direction and size, with position 1 as best', () => {
    expect(rankMovement(2, 5)).toEqual({ state: 'up', places: 3 });
    expect(rankMovement(6, 4)).toEqual({ state: 'down', places: 2 });
    expect(rankMovement(3, 3)).toEqual({ state: 'same' });
  });

  it('never manufactures a delta without a prior point', () => {
    expect(rankMovement(3, null)).toEqual({ state: 'new' });
    expect(rankMovement(3, undefined)).toEqual({ state: 'new' });
    expect(rankMovement(null, 3)).toBeNull();
  });
});

function transition(overrides: Partial<PlayerRankTransition>): PlayerRankTransition {
  return {
    communityId: A,
    effectiveFrom: '2030-05-01T00:00:00.000Z',
    status: 'ranked',
    position: 3,
    level: 3.1,
    reliability: 40,
    established: true,
    rankedMembers: 10,
    complete: true,
    ratingRevision: 1,
    source: 'ledger',
    ...overrides
  };
}

describe('skill rank from committed history', () => {
  it('has no rank without history', () => {
    expect(skillRankOf([])).toBeNull();
  });

  it('derives position and movement from the previous proven ranked point', () => {
    expect(
      skillRankOf([
        transition({ position: 2, effectiveFrom: '2030-05-03T00:00:00.000Z' }),
        transition({
          status: 'unrated',
          position: null,
          effectiveFrom: '2030-05-02T00:00:00.000Z'
        }),
        transition({ position: 4 })
      ])
    ).toEqual({
      status: 'ranked',
      position: 2,
      rankedMembers: 10,
      movement: { state: 'up', places: 2 }
    });
  });

  it('marks a first ranked point as a new entry', () => {
    expect(skillRankOf([transition({ position: 4 })])?.movement).toEqual({ state: 'new' });
  });

  it('does not present an unproven or unrated latest point as a position', () => {
    expect(skillRankOf([transition({ complete: false })])).toEqual({
      status: 'ranked',
      position: null,
      rankedMembers: null,
      movement: null
    });
    expect(skillRankOf([transition({ status: 'not_member', position: null })])?.status).toBe(
      'not_member'
    );
  });
});

describe('actionable items', () => {
  const upcoming = (event_id: string, overrides: Parameters<typeof makeMatchRpcListRow>[0] = {}) =>
    makeMatchRpcListRow({ event_id, ...overrides });

  it('derives every kind from authoritative status and orders them by urgency', () => {
    const past = makeMatchRpcListRow({
      event_id: C,
      caller_badge: 'playing',
      is_past: true,
      result_summary: {
        ...makeMatchRpcListRow().result_summary,
        pending_group_count: 2
      }
    });
    const items = deriveActions(
      [
        upcoming(A, { caller_badge: 'reserve', starts_at: '2030-06-02T10:00:00.000Z' }),
        upcoming(B, { caller_badge: 'reconfirmation_required' }),
        upcoming('00000000-0000-4000-8000-0000000000e1', { caller_badge: 'creator' })
      ],
      [past],
      new Map([['00000000-0000-4000-8000-0000000000e1', 3]]),
      new Map([[C, 2]])
    );
    expect(items.map(({ kind, count }) => [kind, count])).toEqual([
      ['result_review', 2],
      ['reconfirmation', null],
      ['organizer_requests', 3],
      ['reserve_standby', null]
    ]);
  });

  it('ignores cancelled events, zero requests and non-participant past events', () => {
    const past = makeMatchRpcListRow({
      event_id: C,
      caller_badge: 'invited',
      result_summary: { ...makeMatchRpcListRow().result_summary, pending_group_count: 1 }
    });
    expect(
      deriveActions(
        [
          upcoming(A, { caller_badge: 'reconfirmation_required', status: 'cancelled' }),
          upcoming(B, { caller_badge: 'creator' })
        ],
        [past],
        new Map([[B, 0]]),
        new Map([[C, 1]])
      )
    ).toEqual([]);
  });

  it('omits result review when the caller is not an eligible reviewer', () => {
    const past = makeMatchRpcListRow({
      event_id: C,
      caller_badge: 'playing',
      is_past: true,
      result_summary: { ...makeMatchRpcListRow().result_summary, pending_group_count: 2 }
    });
    expect(deriveActions([], [past], new Map(), new Map())).toEqual([]);
    expect(deriveActions([], [past], new Map(), new Map([[C, 0]]))).toEqual([]);
    expect(deriveActions([], [past], new Map(), new Map([[C, 1]]))).toMatchObject([
      { kind: 'result_review', count: 1 }
    ]);
  });
});

describe('recent activity', () => {
  const match: RatingHistoryItem = {
    kind: 'match',
    game_group_id: A,
    match_event_id: B,
    game_group_number: 1,
    played_at: '2030-05-10T00:00:00.000Z',
    classification: 'team_a',
    team: 'team_a',
    outcome_value: 1,
    expected_score: 0.5,
    before_display_level: 3,
    after_display_level: 3.2,
    applied_delta: 0.2,
    clamped: false,
    before_reliability_percent: 30,
    after_reliability_percent: 35,
    after_confirmed_groups: 1,
    calculation_revision: 1,
    recalculated: false
  };
  const adjustment: RatingHistoryItem = {
    kind: 'adjustment',
    adjustment_id: A,
    level_review_request_id: B,
    event_type: 'ADMIN_REVIEW_ADJUSTMENT',
    effective_at: '2030-05-12T00:00:00.000Z',
    reason: 'x',
    outcome: 'approved',
    before_display_level: 3.2,
    after_display_level: 3.6,
    before_reliability_percent: 35,
    after_reliability_percent: 35,
    reliability_changed: false,
    after_confirmed_groups: 1,
    calculation_revision: 2
  };

  it('merges committed ledger and rank changes newest first, bounded', () => {
    const items = mergeActivity(
      [match, adjustment],
      [
        transition({ position: 2, effectiveFrom: '2030-05-11T00:00:00.000Z' }),
        transition({ position: 5, effectiveFrom: '2030-05-01T00:00:00.000Z' })
      ]
    );
    expect(items.map(({ kind, at }) => [kind, at])).toEqual([
      ['adjustment', '2030-05-12T00:00:00.000Z'],
      ['rank', '2030-05-11T00:00:00.000Z'],
      ['rating', '2030-05-10T00:00:00.000Z'],
      ['rank', '2030-05-01T00:00:00.000Z']
    ]);
    expect(items[1]).toMatchObject({ position: 2, previous: 5 });
    expect(items[3]).toMatchObject({ position: 5, previous: null });
  });

  it('skips unchanged, unrated and unproven rank points', () => {
    expect(
      mergeActivity(
        [],
        [
          transition({ position: 3, effectiveFrom: '2030-05-03T00:00:00.000Z' }),
          transition({ complete: false, effectiveFrom: '2030-05-02T00:00:00.000Z' }),
          transition({
            status: 'unrated',
            position: null,
            effectiveFrom: '2030-05-02T00:00:00.000Z'
          }),
          transition({ position: 3 })
        ]
      ).map(({ kind, at }) => [kind, at])
    ).toEqual([['rank', '2030-05-01T00:00:00.000Z']]);
  });

  it('drops the oldest ranked point of a truncated page instead of calling it a new entry', () => {
    const page = [
      transition({ position: 2, effectiveFrom: '2030-05-11T00:00:00.000Z' }),
      transition({ position: 5, effectiveFrom: '2030-05-01T00:00:00.000Z' })
    ];
    expect(mergeActivity([], page, true).map(({ at }) => at)).toEqual(['2030-05-11T00:00:00.000Z']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 9 }, (_, index) => ({
      ...match,
      played_at: `2030-05-${String(10 + index).padStart(2, '0')}T00:00:00.000Z`
    }));
    expect(mergeActivity(many, [])).toHaveLength(5);
  });
});
