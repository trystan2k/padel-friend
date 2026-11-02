import { LEAGUE_STATUSES } from './league-contracts';
import type { LeagueStandingEntry, LeagueStandingsResult } from './league-standings-contracts';

type ObjectValue = Record<string, unknown>;

const fail = (): never => {
  throw new Error('INVALID_LEAGUE_RESPONSE');
};
function exactObject(value: unknown, keys: readonly string[]): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const row: ObjectValue = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail();
  return row;
}
function uuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : fail();
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function positive(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fail();
}
function signedCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fail();
}
function displayName(value: unknown): string | null {
  if (value === null) return null;
  return typeof value === 'string' && value ? value : fail();
}

const ENTRY_KEYS = [
  'user_id',
  'display_name',
  'is_provisional',
  'position',
  'matches',
  'wins',
  'losses',
  'draws',
  'sets_won',
  'sets_lost',
  'set_differential',
  'award_eligible',
  'matches_remaining'
] as const;

function decodeEntry(value: unknown, threshold: number): LeagueStandingEntry {
  const row = exactObject(value, ENTRY_KEYS);
  const entry: LeagueStandingEntry = {
    user_id: uuid(row.user_id),
    display_name: displayName(row.display_name),
    is_provisional: boolean(row.is_provisional),
    position: positive(row.position),
    matches: count(row.matches),
    wins: count(row.wins),
    losses: count(row.losses),
    draws: count(row.draws),
    sets_won: count(row.sets_won),
    sets_lost: count(row.sets_lost),
    set_differential: signedCount(row.set_differential),
    award_eligible: boolean(row.award_eligible),
    matches_remaining: count(row.matches_remaining)
  };
  // Closed arithmetic: any drift means a corrupted or foreign payload.
  if (
    entry.wins + entry.losses + entry.draws !== entry.matches ||
    entry.sets_won - entry.sets_lost !== entry.set_differential ||
    entry.award_eligible !== entry.matches >= threshold ||
    entry.matches_remaining !== Math.max(threshold - entry.matches, 0)
  )
    return fail();
  return entry;
}

/** The sporting order the database promises: Wins desc, Losses asc, Set Diff desc, Sets Won desc. */
function sameSportingKey(a: LeagueStandingEntry, b: LeagueStandingEntry): boolean {
  return (
    a.wins === b.wins &&
    a.losses === b.losses &&
    a.set_differential === b.set_differential &&
    a.sets_won === b.sets_won
  );
}
function sortsBefore(a: LeagueStandingEntry, b: LeagueStandingEntry): boolean {
  if (a.wins !== b.wins) return a.wins > b.wins;
  if (a.losses !== b.losses) return a.losses < b.losses;
  if (a.set_differential !== b.set_differential) return a.set_differential > b.set_differential;
  return a.sets_won > b.sets_won;
}

export function decodeLeagueStandings(value: unknown): LeagueStandingsResult {
  const row = exactObject(value, [
    'league_id',
    'status',
    'minimum_matches_for_final_award',
    'entries'
  ]);
  const status = LEAGUE_STATUSES.find((item) => item === row.status) ?? fail();
  const threshold = positive(row.minimum_matches_for_final_award);
  if (!Array.isArray(row.entries)) return fail();
  const entries = row.entries.map((entry) => decodeEntry(entry, threshold));
  if (new Set(entries.map((entry) => entry.user_id)).size !== entries.length) return fail();

  // Positions must be the competition ranking of that exact order: shared on a full tie, otherwise
  // one plus the number of rows strictly ahead.
  entries.forEach((entry, index) => {
    const previous = entries[index - 1];
    if (!previous) {
      if (entry.position !== 1) fail();
      return;
    }
    if (sameSportingKey(previous, entry)) {
      if (
        entry.position !== previous.position ||
        previous.user_id.toLowerCase() >= entry.user_id.toLowerCase()
      )
        fail();
    } else if (!sortsBefore(previous, entry) || entry.position !== index + 1) fail();
  });

  return {
    league_id: uuid(row.league_id),
    status,
    minimum_matches_for_final_award: threshold,
    entries
  };
}
