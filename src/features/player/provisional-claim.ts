export type ProvisionalClaim =
  | { state: 'unverified' }
  | {
      state: 'ready';
      displayName: string;
      initialLevel: number;
      canEditLevel: boolean;
      matchCount: number;
    };

/**
 * Parses get_provisional_claim_context. 'none' (not a provisional player) maps to
 * null; anything unexpected also maps to null so a malformed payload can never
 * open the claim form.
 */
export function parseProvisionalClaim(value: unknown): ProvisionalClaim | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = Object.fromEntries(Object.entries(value));
  if (row.state === 'unverified') return { state: 'unverified' };
  if (
    row.state === 'ready' &&
    typeof row.display_name === 'string' &&
    typeof row.initial_level === 'number' &&
    typeof row.can_edit_level === 'boolean' &&
    typeof row.match_count === 'number'
  )
    return {
      state: 'ready',
      displayName: row.display_name,
      initialLevel: row.initial_level,
      canEditLevel: row.can_edit_level,
      matchCount: row.match_count
    };
  return null;
}

export type PasswordSetupState = { pending: boolean; canSkip: boolean };

/**
 * Parses get_password_setup_state. Null (malformed) is never read as "nothing owed":
 * callers fail closed and surface the error instead.
 */
export function parsePasswordSetupState(value: unknown): PasswordSetupState | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = Object.fromEntries(Object.entries(value));
  return typeof row.pending === 'boolean' && typeof row.can_skip === 'boolean'
    ? { pending: row.pending, canSkip: row.can_skip }
    : null;
}

const CLAIM_ERRORS: Record<string, string> = {
  PROVISIONAL_CLAIM_NOT_PENDING: 'PLAYER_CLAIM_NOT_PENDING',
  PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED: 'PLAYER_CLAIM_NOT_VERIFIED',
  PROVISIONAL_CLAIM_LEVEL_LOCKED: 'PLAYER_CLAIM_LEVEL_LOCKED'
};

/** Stable application error code for a claim RPC failure, or null when unrecognized. */
export function claimErrorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const message: unknown = Reflect.get(error, 'message');
  return typeof message === 'string' ? (CLAIM_ERRORS[message] ?? null) : null;
}
