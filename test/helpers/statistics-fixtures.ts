import { emptyAggregate, sequenceFrom } from '../../src/features/statistics/statistics-model';
import type {
  StatisticsAggregate,
  StatisticsOutcome
} from '../../src/features/statistics/statistics-contracts';

/** One resolved or incomplete group seen from a single subject, enough to fold an aggregate. */
export type StatsGroupLine = {
  group: string;
  at: string;
  outcome: StatisticsOutcome | 'I';
  setsWon?: number;
  setsLost?: number;
  gamesWon?: number;
  gamesLost?: number;
  type?: 'competitive' | 'friendly';
};

const compareLines = (a: StatsGroupLine, b: StatsGroupLine) =>
  a.at.localeCompare(b.at) || a.group.localeCompare(b.group);

/**
 * Independent oracle used by the unit tests: folds ordered lines straight into an aggregate. It
 * deliberately shares no code with mergeAggregates, so the merge proofs compare two derivations.
 */
export function aggregateOfLines(lines: readonly StatsGroupLine[]): StatisticsAggregate {
  const ordered = [...lines].sort(compareLines);
  const aggregate = emptyAggregate();
  for (const line of ordered) {
    aggregate.confirmed_groups += 1;
    if (line.outcome === 'W') aggregate.wins += 1;
    if (line.outcome === 'L') aggregate.losses += 1;
    if (line.outcome === 'D') aggregate.draws += 1;
    if (line.outcome === 'I') aggregate.incomplete_groups += 1;
    if ((line.type ?? 'competitive') === 'competitive') aggregate.competitive_groups += 1;
    else aggregate.friendly_groups += 1;
    aggregate.sets_won += line.setsWon ?? 0;
    aggregate.sets_lost += line.setsLost ?? 0;
    aggregate.games_won += line.gamesWon ?? 0;
    aggregate.games_lost += line.gamesLost ?? 0;
  }
  const first = ordered[0];
  const last = ordered.at(-1);
  aggregate.first_played_at = first?.at ?? null;
  aggregate.first_game_group_id = first?.group ?? null;
  aggregate.last_played_at = last?.at ?? null;
  aggregate.last_game_group_id = last?.group ?? null;
  const resolved = ordered.filter((line) => line.outcome !== 'I');
  const keyed = resolved.flatMap((line) =>
    line.outcome === 'I' ? [] : [{ g: line.group, o: line.outcome, at: line.at }]
  );
  aggregate.sequence = sequenceFrom(keyed.map((item) => item.o));
  aggregate.recent = keyed.slice(-10);
  aggregate.relations = { partners: { x: { g: ordered.length } } };
  return aggregate;
}

/** Deterministic group ids/instants for ordering fixtures: index → increasing instant, stable id. */
export const statsGroupId = (index: number) =>
  `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
export const statsInstant = (index: number, day = 1) =>
  `2030-01-${String(day).padStart(2, '0')}T${String(10 + index).padStart(2, '0')}:00:00.000000Z`;
