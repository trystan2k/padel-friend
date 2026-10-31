export const ADD_MATCH_PLAYER_ERROR_CODES = [
  'closed',
  'started',
  'cancelled',
  'result_protected',
  'full',
  'rate_limited',
  'idempotency_conflict',
  'not_found',
  'unauthenticated',
  'forbidden',
  'invalid',
  'unavailable'
] as const;
export type AddMatchPlayerErrorCode = (typeof ADD_MATCH_PLAYER_ERROR_CODES)[number];

// One success shape for registered, provisional and unknown emails alike, so
// the caller can never infer which branch ran or whether an email was sent.
export type AddMatchPlayerResult =
  | { status: 'ok' }
  | { status: 'error'; code: AddMatchPlayerErrorCode };

export const ADD_MATCH_PLAYER_OK: AddMatchPlayerResult = Object.freeze({ status: 'ok' });

const SQL_MESSAGE_CODES: Readonly<Record<string, AddMatchPlayerErrorCode>> = {
  MATCH_MANAGEMENT_CLOSED: 'closed',
  MATCH_MANAGEMENT_STARTED: 'started',
  MATCH_MANAGEMENT_CANCELLED: 'cancelled',
  MATCH_MANAGEMENT_RESULT_PROTECTED: 'result_protected',
  MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  MATCH_MANAGEMENT_NOT_FOUND: 'not_found',
  MATCH_REGISTRATION_FULL: 'full'
};

export function addMatchPlayerError(error: {
  code?: string | null;
  message?: string | null;
}): AddMatchPlayerResult {
  const known = error.code === 'P0001' ? SQL_MESSAGE_CODES[error.message ?? ''] : undefined;
  if (known) return { status: 'error', code: known };
  const code =
    error.code === '28000'
      ? 'unauthenticated'
      : error.code === '42501'
        ? 'forbidden'
        : error.code === '22023'
          ? 'invalid'
          : 'unavailable';
  return { status: 'error', code };
}

/** add_match_player accepted the command ('ok') or the actor throttle answered. */
export function parseAddMatchPlayerStatus(value: unknown): 'ok' | 'rate_limited' | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const status: unknown = Reflect.get(value, 'status');
  return status === 'ok' || status === 'rate_limited' ? status : null;
}
