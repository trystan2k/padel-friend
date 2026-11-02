import { LEAGUE_STATUSES } from './league-contracts';
import {
  LEAGUE_STANDINGS_CAUSES,
  type LeagueStandingEntry,
  type LeagueStandingsAuditEvent,
  type LeagueStandingsAuditResult,
  type LeagueStandingsResult,
  type LeagueStandingsVersionSummary,
  type LeagueStandingsVersionsResult
} from './league-standings-contracts';

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
function text(value: unknown): string {
  return typeof value === 'string' && value ? value : fail();
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
    'source',
    'standings_version',
    'latest_standings_version',
    'generated_at',
    'cause',
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

  const base = {
    league_id: uuid(row.league_id),
    status,
    minimum_matches_for_final_award: threshold,
    entries
  };
  if (row.source === 'live') {
    // An open League is never addressed by version and carries no publication facts.
    if (
      status === 'closed' ||
      row.standings_version !== null ||
      row.latest_standings_version !== null ||
      row.generated_at !== null ||
      row.cause !== null
    )
      return fail();
    return {
      ...base,
      source: 'live',
      standings_version: null,
      latest_standings_version: null,
      generated_at: null,
      cause: null
    };
  }
  if (row.source !== 'final' || status !== 'closed') return fail();
  const standingsVersion = positive(row.standings_version);
  const latestVersion = positive(row.latest_standings_version);
  if (latestVersion < standingsVersion) return fail();
  return {
    ...base,
    source: 'final',
    standings_version: standingsVersion,
    latest_standings_version: latestVersion,
    generated_at: text(row.generated_at),
    cause: LEAGUE_STANDINGS_CAUSES.find((item) => item === row.cause) ?? fail()
  };
}

const VERSION_CONFIRMATION_KEYS = ['source', 'confirmed_at', 'played_at'] as const;
const VERSION_KEYS = [
  'standings_version',
  'cause',
  'basis',
  'generated_at',
  'effective_end_at',
  'minimum_matches_for_final_award',
  'entry_count',
  'confirmation'
] as const;

function decodeVersionSummary(value: unknown): LeagueStandingsVersionSummary {
  const row = exactObject(value, VERSION_KEYS);
  const cause = LEAGUE_STANDINGS_CAUSES.find((item) => item === row.cause) ?? fail();
  const basis = row.basis === 'published' || row.basis === 'reconstructed' ? row.basis : fail();
  let confirmation: LeagueStandingsVersionSummary['confirmation'] = null;
  if (row.confirmation !== null) {
    const raw = exactObject(row.confirmation, VERSION_CONFIRMATION_KEYS);
    const source = raw.source === 'MANUAL' || raw.source === 'AUTO_48H' ? raw.source : fail();
    confirmation = { source, confirmed_at: text(raw.confirmed_at), played_at: text(raw.played_at) };
  }
  // A late revision always names its confirmation; every other cause never does.
  if ((cause === 'late_first_confirmation') !== (confirmation !== null)) return fail();
  return {
    standings_version: positive(row.standings_version),
    cause,
    basis,
    generated_at: text(row.generated_at),
    effective_end_at: text(row.effective_end_at),
    minimum_matches_for_final_award: positive(row.minimum_matches_for_final_award),
    entry_count: count(row.entry_count),
    confirmation
  };
}

export function decodeLeagueStandingsVersions(value: unknown): LeagueStandingsVersionsResult {
  const row = exactObject(value, ['league_id', 'status', 'versions', 'next_before_version']);
  if (!Array.isArray(row.versions)) return fail();
  const versions = row.versions.map(decodeVersionSummary);
  // Strictly newest first: a repeated or out-of-order version is a corrupted page.
  versions.forEach((version, index) => {
    const previous = versions[index - 1];
    if (previous && previous.standings_version <= version.standings_version) fail();
  });
  return {
    league_id: uuid(row.league_id),
    status: LEAGUE_STATUSES.find((item) => item === row.status) ?? fail(),
    versions,
    next_before_version: row.next_before_version === null ? null : positive(row.next_before_version)
  };
}

/** The only detail keys the audit reader publishes: versions, instants, provenance and counts. */
const AUDIT_DETAIL_KEYS = new Set([
  'standings_version',
  'old_standings_version',
  'closed_at',
  'source',
  'played_at',
  'confirmed_at',
  'effective_cutoff',
  'publication_cutoff',
  'provenance',
  'added_count',
  'removed_count'
]);

function decodeAuditEvent(value: unknown): LeagueStandingsAuditEvent {
  const row = exactObject(value, ['action', 'actor_id', 'system_reason', 'occurred_at', 'details']);
  const action =
    row.action === 'closed' || row.action === 'standings_revised' ? row.action : fail();
  const actorId = row.actor_id === null ? null : uuid(row.actor_id);
  const systemReason = row.system_reason === null ? null : text(row.system_reason);
  // Exactly one of a human actor or a system reason, mirroring the database invariant.
  if ((actorId === null) === (systemReason === null)) return fail();
  if (typeof row.details !== 'object' || row.details === null || Array.isArray(row.details))
    return fail();
  const details: LeagueStandingsAuditEvent['details'] = {};
  for (const [key, detail] of Object.entries(row.details)) {
    if (!AUDIT_DETAIL_KEYS.has(key)) return fail();
    if (detail !== null && typeof detail !== 'string' && typeof detail !== 'number') return fail();
    details[key] = detail;
  }
  return {
    action,
    actor_id: actorId,
    system_reason: systemReason,
    occurred_at: text(row.occurred_at),
    details
  };
}

export function decodeLeagueStandingsAudit(value: unknown): LeagueStandingsAuditResult {
  const row = exactObject(value, ['league_id', 'events']);
  if (!Array.isArray(row.events)) return fail();
  return { league_id: uuid(row.league_id), events: row.events.map(decodeAuditEvent) };
}
