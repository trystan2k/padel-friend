export const PRIVACY_CASE_STATES = [
  'received',
  'verified',
  'ready',
  'executing',
  'app_data_erased',
  'supabase_erased',
  'closed',
  'withdrawn',
  'blocked'
] as const;
export type PrivacyCaseState = (typeof PRIVACY_CASE_STATES)[number];

export const PRIVACY_PHASES = ['freeze', 'relational', 'storage', 'auth'] as const;
export type PrivacyPhase = (typeof PRIVACY_PHASES)[number];

/** Mirror of the database transition graph (privacy_internal.guard_privacy_case). */
const GRAPH: Record<PrivacyCaseState, readonly PrivacyCaseState[]> = {
  received: ['verified', 'withdrawn', 'closed'],
  verified: ['ready', 'received', 'withdrawn', 'closed'],
  ready: ['executing', 'verified', 'withdrawn', 'blocked', 'closed'],
  executing: ['app_data_erased', 'blocked'],
  app_data_erased: ['supabase_erased', 'blocked'],
  // A failing finish quarantines the case (blocked) and the operator retry resumes it.
  supabase_erased: ['closed', 'blocked'],
  blocked: [
    'executing',
    'app_data_erased',
    'supabase_erased',
    'ready',
    'received',
    'withdrawn',
    'closed'
  ],
  closed: [],
  withdrawn: []
};

export type TransitionContext = {
  lastPhase?: PrivacyPhase | null;
  armConsumed?: boolean;
  /** Monotonic marker set at the first freeze: from then on only resume paths remain. */
  destructiveStarted?: boolean;
};

export function canTransition(
  from: PrivacyCaseState,
  to: PrivacyCaseState,
  context: TransitionContext = {}
): boolean {
  if (!GRAPH[from].includes(to)) return false;
  if (from === 'executing' && to === 'app_data_erased') return context.lastPhase === 'relational';
  if (from === 'app_data_erased' && to === 'supabase_erased') return context.lastPhase === 'auth';
  // After the destructive start no case can be withdrawn, restarted, un-verified or refused.
  if (
    context.destructiveStarted &&
    (to === 'withdrawn' ||
      to === 'received' ||
      to === 'verified' ||
      (to === 'closed' && from !== 'supabase_erased'))
  )
    return false;
  // After the one-use arm is consumed the case is irreversible: no withdrawal and no refusal.
  if (from === 'blocked' && (to === 'withdrawn' || to === 'closed' || to === 'received'))
    return !context.armConsumed;
  return true;
}

/** Withdrawal is allowed until the executor claim consumes the arm or the destructive phase starts. */
export function canWithdraw(
  state: PrivacyCaseState,
  armConsumed: boolean,
  destructiveStarted = false
): boolean {
  if (destructiveStarted) return false;
  return (
    state === 'received' ||
    state === 'verified' ||
    state === 'ready' ||
    (state === 'blocked' && !armConsumed)
  );
}

/** The one phase the processor may run next after the last committed phase. */
export function nextPhase(
  state: PrivacyCaseState,
  lastPhase: PrivacyPhase | null
): PrivacyPhase | 'finish' | null {
  if (state === 'supabase_erased') return 'finish';
  if (state !== 'executing' && state !== 'app_data_erased') return null;
  if (lastPhase === null) return state === 'executing' ? 'freeze' : null;
  if (lastPhase === 'freeze') return state === 'executing' ? 'relational' : null;
  if (lastPhase === 'relational') return state === 'app_data_erased' ? 'storage' : null;
  if (lastPhase === 'storage') return state === 'app_data_erased' ? 'auth' : null;
  return null;
}

export const PRIVACY_REQUEST_ERROR_CODES = [
  'unauthenticated',
  'account_required',
  'restricted',
  'rate_limited',
  'disabled',
  'not_found',
  'not_withdrawable',
  'unavailable'
] as const;
export type PrivacyRequestErrorCode = (typeof PRIVACY_REQUEST_ERROR_CODES)[number];

export function privacyRequestError(error: { message?: string; code?: string }): {
  status: 'error';
  code: PrivacyRequestErrorCode;
} {
  const message = error.message ?? '';
  const code: PrivacyRequestErrorCode =
    error.code === '28000' || message === 'Authentication required'
      ? 'unauthenticated'
      : message === 'PRIVACY_REQUEST_ACCOUNT_REQUIRED'
        ? 'account_required'
        : message === 'PROVISIONAL_PLAYER_RESTRICTED'
          ? 'restricted'
          : message === 'PRIVACY_REQUEST_RATE_LIMITED'
            ? 'rate_limited'
            : message === 'PRIVACY_REQUESTS_DISABLED'
              ? 'disabled'
              : message === 'PRIVACY_REQUEST_NOT_FOUND'
                ? 'not_found'
                : message === 'PRIVACY_REQUEST_NOT_WITHDRAWABLE'
                  ? 'not_withdrawable'
                  : 'unavailable';
  return { status: 'error', code };
}

export type PrivacyReceipt = {
  command_id: string;
  reference: string;
  state: PrivacyCaseState;
  received_at: string;
  replayed: boolean;
  can_withdraw: boolean;
};
export type MyDeletionRequest = {
  reference: string;
  state: PrivacyCaseState;
  received_at: string;
  blocked: boolean;
  can_withdraw: boolean;
};
export type PrivacyRequestResponse<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: PrivacyRequestErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^PR-[0-9A-F]{12}$/;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}
function stateOf(value: unknown): PrivacyCaseState | null {
  return PRIVACY_CASE_STATES.find((state) => state === value) ?? null;
}
function instant(value: unknown): string | null {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Typed allowlist: an unknown key or a malformed field makes the whole receipt untrusted. */
export function parsePrivacyReceipt(value: unknown): PrivacyReceipt | null {
  const row = record(value);
  if (!row) return null;
  const keys = ['command_id', 'reference', 'state', 'received_at', 'replayed', 'can_withdraw'];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return null;
  const state = stateOf(row.state);
  const receivedAt = instant(row.received_at);
  if (
    typeof row.command_id !== 'string' ||
    !UUID.test(row.command_id) ||
    typeof row.reference !== 'string' ||
    !REFERENCE.test(row.reference) ||
    !state ||
    !receivedAt ||
    typeof row.replayed !== 'boolean' ||
    typeof row.can_withdraw !== 'boolean'
  )
    return null;
  return {
    command_id: row.command_id,
    reference: row.reference,
    state,
    received_at: receivedAt,
    replayed: row.replayed,
    can_withdraw: row.can_withdraw
  };
}

export function parseMyDeletionRequest(value: unknown): MyDeletionRequest | null | undefined {
  if (value === null) return null;
  const row = record(value);
  if (!row) return undefined;
  const keys = ['reference', 'state', 'received_at', 'blocked', 'can_withdraw'];
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return undefined;
  const state = stateOf(row.state);
  const receivedAt = instant(row.received_at);
  if (
    typeof row.reference !== 'string' ||
    !REFERENCE.test(row.reference) ||
    !state ||
    !receivedAt ||
    typeof row.blocked !== 'boolean' ||
    typeof row.can_withdraw !== 'boolean'
  )
    return undefined;
  return {
    reference: row.reference,
    state,
    received_at: receivedAt,
    blocked: row.blocked,
    can_withdraw: row.can_withdraw
  };
}

export function validatePrivacyCommand(value: unknown): { command_id: string } {
  const row = record(value);
  if (
    !row ||
    Object.keys(row).length !== 1 ||
    typeof row.command_id !== 'string' ||
    !UUID.test(row.command_id)
  )
    throw new Error('INVALID_PRIVACY_REQUEST');
  return { command_id: row.command_id };
}

export const PRIVACY_PURGE_DAYS = 90;

/** Case records purge to outcome counts this many days after the final response (owner decision). */
export function purgeAfter(finalResponseAt: Date): Date {
  return new Date(finalResponseAt.getTime() + PRIVACY_PURGE_DAYS * 86_400_000);
}
