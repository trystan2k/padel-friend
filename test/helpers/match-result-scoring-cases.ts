import type {
  ResultClassification,
  ResultSetRow,
  ResultValidationDetail
} from '../../src/features/matches/match-result-model';

export const resultSet = (
  position: number,
  a: number,
  b: number,
  completed = true
): ResultSetRow => ({
  position,
  team_a_games: a,
  team_b_games: b,
  completed
});

type ScoringCase = {
  name: string;
  sets: unknown;
} & (
  | { classification: ResultClassification; error?: never }
  | {
      classification?: never;
      error: ResultValidationDetail;
    }
);

const invalid = (
  name: string,
  sets: unknown,
  reason_token: string,
  set_index: number | null = null,
  side: ResultValidationDetail['side'] = null
): ScoringCase => ({ name, sets, error: { set_index, side, reason_token } });

// Single decision table consumed by both engines' suites; expected values never come from either engine.
export const scoringCases: ScoringCase[] = [
  {
    name: 'normal three-set win',
    sets: [resultSet(1, 6, 4), resultSet(2, 4, 6), resultSet(3, 7, 5)],
    classification: 'team_a'
  },
  { name: 'two-set draw', sets: [resultSet(1, 6, 4), resultSet(2, 4, 6)], classification: 'draw' },
  {
    name: 'draw with unfinished third',
    sets: [resultSet(1, 6, 4), resultSet(2, 4, 6), resultSet(3, 5, 3, false)],
    classification: 'draw'
  },
  {
    name: 'one completed set is incomplete',
    sets: [resultSet(1, 6, 4)],
    classification: 'incomplete'
  },
  {
    name: 'one unfinished set is incomplete',
    sets: [resultSet(1, 0, 0, false)],
    classification: 'incomplete'
  },
  {
    name: 'one completed and one unfinished is incomplete',
    sets: [resultSet(1, 6, 4), resultSet(2, 6, 5, false)],
    classification: 'incomplete'
  },
  {
    name: 'two-zero plus unfinished third is win',
    sets: [resultSet(1, 6, 4), resultSet(2, 7, 6), resultSet(3, 1, 5, false)],
    classification: 'team_a'
  },
  {
    name: 'team B majority',
    sets: [resultSet(1, 4, 6), resultSet(2, 6, 4), resultSet(3, 6, 7)],
    classification: 'team_b'
  },
  {
    name: 'team B straight win',
    sets: [resultSet(1, 0, 6), resultSet(2, 5, 7)],
    classification: 'team_b'
  },
  invalid('null sets', null, 'INVALID_SETS'),
  invalid('object sets', {}, 'INVALID_SETS'),
  invalid('empty sets', [], 'INVALID_SETS'),
  invalid('too many sets', [1, 2, 3, 4], 'INVALID_SETS'),
  invalid('null row', [null], 'INVALID_SET', 1),
  invalid('extra row key', [{ ...resultSet(1, 6, 4), extra: true }], 'INVALID_SET', 1),
  invalid('missing row key', [{ position: 1, team_a_games: 6, team_b_games: 4 }], 'INVALID_SET', 1),
  invalid('nonboolean completed', [{ ...resultSet(1, 6, 4), completed: 'true' }], 'INVALID_SET', 1),
  invalid('out of order', [resultSet(2, 6, 4)], 'INVALID_SET_POSITION', 1),
  invalid('skipped position', [resultSet(1, 6, 4), resultSet(3, 4, 6)], 'INVALID_SET_POSITION', 2),
  invalid(
    'duplicate position',
    [resultSet(1, 6, 4), resultSet(1, 4, 6)],
    'INVALID_SET_POSITION',
    2
  ),
  invalid('string position', [{ ...resultSet(1, 6, 4), position: '1' }], 'INVALID_SET_POSITION', 1),
  invalid(
    'non-sequential completed row',
    [resultSet(1, 3, 2, false), resultSet(2, 6, 4)],
    'NON_SEQUENTIAL_SETS',
    2
  ),
  invalid(
    'non-sequential unfinished row',
    [resultSet(1, 3, 2, false), resultSet(2, 0, 0, false)],
    'NON_SEQUENTIAL_SETS',
    2
  ),
  invalid(
    'invalid third has exact index and side',
    [resultSet(1, 6, 4), resultSet(2, 4, 6), resultSet(3, 5, 6)],
    'INVALID_SET_SCORE',
    3,
    'team_b'
  ),
  ...[-1, 8, 10, 1.5, null, '6', true].flatMap((score) =>
    (['team_a', 'team_b'] as const).map((side) =>
      invalid(
        `invalid ${side} score ${JSON.stringify(score)}`,
        [{ ...resultSet(1, 6, 4), [`${side}_games`]: score }],
        'INVALID_SET_SCORE',
        1,
        side
      )
    )
  ),
  ...[true, false].flatMap((completed) => [
    invalid(
      `7-4 completed=${completed}`,
      [resultSet(1, 7, 4, completed)],
      'INVALID_SET_SCORE',
      1,
      'team_a'
    ),
    invalid(
      `7-7 completed=${completed}`,
      [resultSet(1, 7, 7, completed)],
      'INVALID_SET_SCORE',
      1,
      'team_a'
    )
  ]),
  // Exhaustive completed-set decision table covers both orientations, 6-5 and all ties.
  ...Array.from({ length: 8 }, (_, a) =>
    Array.from({ length: 8 }, (_item, b): ScoringCase => {
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      const sets = [resultSet(1, a, b)];
      return (high === 6 && low <= 4) || (high === 7 && (low === 5 || low === 6))
        ? { name: `completed ${a}-${b}`, sets, classification: 'incomplete' }
        : invalid(
            `completed ${a}-${b}`,
            sets,
            'INVALID_SET_SCORE',
            1,
            a >= b ? 'team_a' : 'team_b'
          );
    })
  ).flat()
];
