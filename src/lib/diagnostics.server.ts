import { AsyncLocalStorage } from 'node:async_hooks';

// Server-only structured diagnostics (PRD §59). Correlation context is request-scoped through
// AsyncLocalStorage (available under nodejs_compat): concurrent requests on one isolate never see
// each other's ID, and nothing here is module-global per-request state.

export type DiagnosticEvent =
  | 'auth.failure'
  | 'match.create'
  | 'match.join'
  | 'result.submit'
  | 'result.review'
  | 'result.reject'
  | 'result.confirm'
  | 'request.failure'
  | 'rating.failure'
  | 'replay.start'
  | 'replay.complete'
  | 'replay.fail'
  | 'league.close'
  | 'push.failure'
  | 'scheduled.sweep'
  | 'alert.send';

export type DiagnosticOutcome = 'success' | 'failure' | 'rejected' | 'race';

type DiagnosticContext = { kind: 'request' | 'job'; id: string };
type FieldValue = string | number | boolean | null;

const storage = new AsyncLocalStorage<DiagnosticContext>();
const SAFE_FIELD_KEYS = new Set([
  'code',
  'stage',
  'count',
  'status',
  'source',
  'attempt',
  'durationMs',
  'reference',
  'job',
  'decision',
  'retryable'
]);
const SAFE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]{1,80}$/;

/** Ingress always mints its own ID: a client-supplied value is never trusted or echoed. */
export function newCorrelationId(): string {
  return crypto.randomUUID();
}

export function runWithDiagnostics<T>(context: DiagnosticContext, task: () => T): T {
  if (!/^[A-Za-z0-9_:-]{1,64}$/.test(context.id)) throw new Error('CORRELATION_ID_INVALID');
  return storage.run(Object.freeze({ ...context }), task);
}

export function currentCorrelation(): DiagnosticContext | undefined {
  return storage.getStore();
}

/** Opaque reference an operator can match against logs; safe to show a user. */
export function requestReference(): string | null {
  return storage.getStore()?.id ?? null;
}

/** Only stable upper-snake error codes survive; provider/SQL text becomes INTERNAL. */
export function safeErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return SAFE_CODE.test(message) ? message : 'INTERNAL';
}

function safeValue(value: unknown): FieldValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string')
    return SAFE_TOKEN.test(value) && !value.includes('.') && value.length <= 64 ? value : undefined;
  return undefined;
}

/**
 * Emits one JSON line. Fields are allowlisted by key AND value shape, so cookies, JWTs, e-mail
 * addresses, Push endpoints/keys, SQL payloads and newline injection cannot be logged even by
 * mistake: anything not a short token is dropped, never truncated into the log.
 */
export function emitDiagnostic(
  event: DiagnosticEvent,
  outcome: DiagnosticOutcome,
  fields: Record<string, unknown> = {}
) {
  const context = storage.getStore();
  const safe: Record<string, FieldValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_FIELD_KEYS.has(key)) continue;
    const accepted = safeValue(value);
    if (accepted !== undefined) safe[key] = accepted;
  }
  const line = {
    event,
    outcome,
    at: new Date().toISOString(),
    ...(context ? { [context.kind === 'request' ? 'requestId' : 'jobId']: context.id } : {}),
    ...safe
  };
  (outcome === 'success' ? console.info : console.error)(JSON.stringify(line));
}

/** Records the ACTUAL outcome of an operation (never "attempted") and its duration. */
export async function traceOperation<T>(
  event: DiagnosticEvent,
  classify: (result: T) => { outcome: DiagnosticOutcome; code?: string },
  task: () => Promise<T>,
  fields: Record<string, unknown> = {}
): Promise<T> {
  const started = Date.now();
  try {
    const result = await task();
    const { outcome, code } = classify(result);
    emitDiagnostic(event, outcome, { ...fields, code, durationMs: Date.now() - started });
    return result;
  } catch (error) {
    emitDiagnostic(event, 'failure', {
      ...fields,
      code: safeErrorCode(error),
      durationMs: Date.now() - started
    });
    throw error;
  }
}

/** Classifier for the common { status: 'ok' | 'error', code } command result shape. */
export function classifyCommandResult(result: unknown): {
  outcome: DiagnosticOutcome;
  code?: string;
} {
  if (!result || typeof result !== 'object') return { outcome: 'failure', code: 'INTERNAL' };
  const status: unknown = Reflect.get(result, 'status');
  if (status === 'ok') return { outcome: 'success' };
  if (status === 'conflict') return { outcome: 'race', code: 'CONFLICT' };
  const raw: unknown = Reflect.get(result, 'code');
  const code = typeof raw === 'string' ? raw.toUpperCase().replace(/[^A-Z0-9]+/g, '_') : 'INTERNAL';
  const race = /^(CONFLICT|STALE|FULL|VERSION|SUPERSEDED|ALREADY)/.test(code);
  return { outcome: race ? 'race' : 'rejected', code: SAFE_CODE.test(code) ? code : 'INTERNAL' };
}
