import type { LeagueErrorCode } from './league-contracts';

const DATABASE_ERRORS: readonly LeagueErrorCode[] = [
  'UNAUTHENTICATED',
  'LEAGUE_FORBIDDEN',
  'LEAGUE_CREATION_DISABLED',
  'PROVISIONAL_PLAYER_RESTRICTED',
  'LEAGUE_NOT_FOUND',
  'LEAGUE_NAME_INVALID',
  'LEAGUE_DESCRIPTION_INVALID',
  'LEAGUE_MINIMUM_INVALID',
  'LEAGUE_END_MODE_INVALID',
  'LEAGUE_START_DATE_INVALID',
  'LEAGUE_START_IN_PAST',
  'LEAGUE_END_DATE_REQUIRED',
  'LEAGUE_END_DATE_NOT_ALLOWED',
  'LEAGUE_END_NOT_AFTER_START',
  'LEAGUE_END_IN_PAST',
  'LEAGUE_CHANGES_INVALID',
  'LEAGUE_INVALID_INPUT',
  'LEAGUE_INVALID_STATE',
  'LEAGUE_NOT_DUE',
  'LEAGUE_ACTIVE_EXISTS',
  'LEAGUE_CLOSE_NOT_MANUAL',
  'LEAGUE_PERIOD_LOCKED',
  'LEAGUE_START_LOCKED',
  'LEAGUE_VERSION_CONFLICT',
  'LEAGUE_REQUEST_CONFLICT',
  'LEAGUE_STANDINGS_VERSION_INVALID',
  'LEAGUE_STANDINGS_VERSION_NOT_FOUND'
];

/** Server-side: maps a PostgREST error to a stable League error code (never raw database text). */
export function leagueErrorFromDatabase(error: { message?: string }): LeagueErrorCode {
  const matched = DATABASE_ERRORS.find((code) => code === error.message);
  return matched ?? 'LEAGUE_UNAVAILABLE';
}

/** Client-side: server function failures arrive as Error(message=code). */
export function leagueErrorCode(error: unknown): LeagueErrorCode {
  if (!(error instanceof Error)) return 'LEAGUE_UNAVAILABLE';
  const matched = [...DATABASE_ERRORS, 'INVALID_LEAGUE_INPUT' as const].find(
    (code) => code === error.message
  );
  return matched ?? 'LEAGUE_UNAVAILABLE';
}
