import { readFileSync } from 'node:fs';

// Pure release-loop oracle (no Playwright import, so Vitest can contract-test it). Every expected
// value comes from the approved golden document docs/rating/golden-fixtures.json (GF-06: equal team
// strengths, Team A wins, first rated group) plus fixed score lines; nothing is read back from the
// system under test.

/** Every fixture player is onboarded at this self-declared level. */
export const START_LEVEL = 3.2;
export type SetScore = readonly [number, number];
/** Team A wins both sets; the same lines are submitted for each quartet. */
export const WINNING_SETS: readonly SetScore[] = [
  [6, 4],
  [6, 3]
];
export const GOLDEN_CASE = 'GF-06';

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`Golden fixture: expected an object at ${where}`);
  return Object.fromEntries(Object.entries(value));
}

function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Golden fixture: expected a list at ${where}`);
  return value;
}

export type GoldenSide = {
  appliedDelta: number;
  reliabilityBefore: number;
  reliabilityAfter: number;
  groupsAfter: number;
};

/** Winner (Team A) and loser (Team B) outcome of the approved first-group golden case. */
export function firstGroupGolden(): { winner: GoldenSide; loser: GoldenSide } {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('../docs/rating/golden-fixtures.json', import.meta.url), 'utf8')
  );
  const goldenCase = list(record(raw, 'root').cases, 'cases')
    .map((item) => record(item, 'case'))
    .find((item) => String(item.id).startsWith(GOLDEN_CASE));
  if (!goldenCase) throw new Error(`Golden fixture ${GOLDEN_CASE} is missing`);
  const step = record(list(goldenCase.steps, 'steps')[0], 'step');
  const results = list(record(step.expected, 'expected').player_results, 'player_results').map(
    (item) => record(item, 'player result')
  );
  const side = (team: 'team_a' | 'team_b'): GoldenSide => {
    const row = results.find((item) => item.team === team);
    if (!row) throw new Error(`Golden fixture has no ${team} result`);
    return {
      appliedDelta: Number(row.applied_delta),
      reliabilityBefore: Number(row.reliability_before),
      reliabilityAfter: Number(row.reliability_after),
      groupsAfter: Number(row.confirmed_competitive_game_groups_after)
    };
  };
  return { winner: side('team_a'), loser: side('team_b') };
}

const cents = (value: number) => Math.round(value * 100) / 100;

export type ExpectedRating = { level: number; reliability: number; groups: number };

/** Fresh equal-strength players after their first Team A win. */
export function expectedFirstGroupRatings(startLevel = START_LEVEL): {
  winner: ExpectedRating;
  loser: ExpectedRating;
} {
  const { winner, loser } = firstGroupGolden();
  const build = (side: GoldenSide): ExpectedRating => ({
    level: cents(startLevel + side.appliedDelta),
    reliability: side.reliabilityAfter,
    groups: side.groupsAfter
  });
  return { winner: build(winner), loser: build(loser) };
}

export type ExpectedCounters = {
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  setsWon: number;
  setsLost: number;
};

/** League counters of one Team A (winner) or Team B (loser) player for the winning score lines. */
export function expectedLeagueCounters(
  side: 'winner' | 'loser',
  sets: readonly SetScore[] = WINNING_SETS
): ExpectedCounters {
  const teamAWon = sets.filter(([a, b]) => a > b).length;
  const teamBWon = sets.filter(([a, b]) => b > a).length;
  const won = side === 'winner' ? teamAWon : teamBWon;
  const lost = side === 'winner' ? teamBWon : teamAWon;
  return {
    matches: 1,
    wins: won > lost ? 1 : 0,
    draws: won === lost ? 1 : 0,
    losses: won < lost ? 1 : 0,
    setsWon: won,
    setsLost: lost
  };
}

/** Table cells after the place column: matches, wins, draws, losses, sets won, sets lost, difference. */
export function standingsCells(counters: ExpectedCounters): string[] {
  const difference = counters.setsWon - counters.setsLost;
  return [
    counters.matches,
    counters.wins,
    counters.draws,
    counters.losses,
    counters.setsWon,
    counters.setsLost
  ]
    .map(String)
    .concat(difference > 0 ? `+${difference}` : String(difference));
}

export type ReleaseLayout<T> = {
  groups: [T[], T[]];
  reserve: T;
};

/** FIFO acceptance order -> two complete quartets plus the ninth as Reserve (group = (position-1)/4). */
export function releaseLayout<T>(acceptedInOrder: readonly T[]): ReleaseLayout<T> {
  if (acceptedInOrder.length !== 9) throw new Error('Release loop needs exactly nine registrants');
  return {
    groups: [acceptedInOrder.slice(0, 4), acceptedInOrder.slice(4, 8)],
    reserve: acceptedInOrder[8]!
  };
}
