import { type ClientErrorCode, isClientErrorCode } from './client-error-codes';
import { emitDiagnostic } from './diagnostics.server';

// Single boundary between database/provider errors and the browser. A PostgREST error carries
// SQLSTATE, details, hint and constraint names; none of that may serialize into a server-function
// response. The caller receives a fresh plain Error whose message is one allowlisted code: no cause,
// no stack-bearing wrapper of the original, no extra fields. The raw error stays server-side.

const SQLSTATE = /^[A-Z0-9]{5}$/;

function readField(error: unknown, key: 'code' | 'message'): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const value: unknown = Reflect.get(error, key);
  return typeof value === 'string' ? value : undefined;
}

function codeForSqlState(state: string | undefined): ClientErrorCode {
  if (state === undefined) return 'OPERATION_FAILED';
  if (state === '28000' || state === 'PGRST301') return 'UNAUTHENTICATED';
  if (state === '42501') return 'FORBIDDEN';
  if (state === 'P0002' || state === 'PGRST116') return 'RESOURCE_NOT_FOUND';
  if (state === '23503' || state === '23505' || state === '40001' || state === '40P01')
    return 'REQUEST_CONFLICT';
  // Class 22 (data exception) and 23514/23502/23000 integrity checks are caller-input problems.
  if (state.startsWith('22') || state === '23514' || state === '23502' || state === '23000')
    return 'REQUEST_INVALID';
  return 'OPERATION_FAILED';
}

/**
 * Maps anything caught around a database call to a client-safe error. Registry codes (exact match
 * on the message) survive; known SQLSTATEs collapse to a generic registry code; everything else
 * becomes OPERATION_FAILED. Unexpected failures are recorded as a safe server diagnostic.
 */
export function toClientError(error: unknown): Error {
  const message = readField(error, 'message');
  if (isClientErrorCode(message)) return new Error(message);
  const state = readField(error, 'code');
  const code = codeForSqlState(state);
  emitDiagnostic('request.failure', 'failure', {
    code,
    source: 'server-function',
    status: state !== undefined && SQLSTATE.test(state) ? state : undefined
  });
  return new Error(code);
}
