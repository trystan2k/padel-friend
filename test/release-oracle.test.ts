import { describe, expect, it } from 'vitest';
import {
  expectedFirstGroupRatings,
  expectedLeagueCounters,
  firstGroupGolden,
  releaseLayout,
  standingsCells,
  START_LEVEL,
  WINNING_SETS
} from '../e2e/release-oracle';

describe('release oracle', () => {
  it('reads the approved first-group golden case for both sides', () => {
    const golden = firstGroupGolden();
    expect(golden.winner).toEqual({
      appliedDelta: 0.14,
      reliabilityBefore: 10,
      reliabilityAfter: 16,
      groupsAfter: 1
    });
    expect(golden.loser).toMatchObject({
      appliedDelta: -0.14,
      reliabilityAfter: 16,
      groupsAfter: 1
    });
  });

  it('derives equal-strength first-group levels from the fixture start level', () => {
    expect(START_LEVEL).toBe(3.2);
    expect(expectedFirstGroupRatings()).toEqual({
      winner: { level: 3.34, reliability: 16, groups: 1 },
      loser: { level: 3.06, reliability: 16, groups: 1 }
    });
    expect(expectedFirstGroupRatings(4).winner.level).toBe(4.14);
  });

  it('computes League counters and table cells from the score lines', () => {
    expect(expectedLeagueCounters('winner')).toEqual({
      matches: 1,
      wins: 1,
      draws: 0,
      losses: 0,
      setsWon: 2,
      setsLost: 0
    });
    expect(standingsCells(expectedLeagueCounters('winner'))).toEqual([
      '1',
      '1',
      '0',
      '0',
      '2',
      '0',
      '+2'
    ]);
    expect(standingsCells(expectedLeagueCounters('loser'))).toEqual([
      '1',
      '0',
      '0',
      '1',
      '0',
      '2',
      '-2'
    ]);
    const split = [
      [6, 4],
      [4, 6]
    ] as const;
    expect(expectedLeagueCounters('winner', split)).toMatchObject({ draws: 1, wins: 0, losses: 0 });
    expect(WINNING_SETS).toHaveLength(2);
  });

  it('splits nine FIFO registrants into two quartets and a Reserve', () => {
    const layout = releaseLayout(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    expect(layout.groups).toEqual([
      ['a', 'b', 'c', 'd'],
      ['e', 'f', 'g', 'h']
    ]);
    expect(layout.reserve).toBe('i');
    expect(() => releaseLayout(['a', 'b'])).toThrow('exactly nine');
  });
});
