import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GENERIC_CLIENT_ERROR_CODES,
  COMMUNITY_RPC_ERROR_CODES
} from '../src/lib/client-error-codes';
import { toClientError } from '../src/lib/client-error.server';

const pgError = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "community_members_open_idx"',
  details: 'Key (email)=(ana@example.test) already exists.',
  hint: 'rename it',
  constraint: 'community_members_open_idx',
  cause: new Error('nested')
};

afterEach(() => vi.restoreAllMocks());

describe('toClientError', () => {
  it.each([...COMMUNITY_RPC_ERROR_CODES, ...GENERIC_CLIENT_ERROR_CODES])(
    'passes registry code %s through as a plain error',
    (code) => {
      const error = toClientError({ code: 'P0001', message: code, details: 'secret', hint: 'h' });
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(code);
      expect(error.cause).toBeUndefined();
      expect(Object.keys(error)).toEqual([]);
    }
  );

  it.each([
    ['28000', 'UNAUTHENTICATED'],
    ['PGRST301', 'UNAUTHENTICATED'],
    ['42501', 'FORBIDDEN'],
    ['P0002', 'RESOURCE_NOT_FOUND'],
    ['PGRST116', 'RESOURCE_NOT_FOUND'],
    ['23503', 'REQUEST_CONFLICT'],
    ['23505', 'REQUEST_CONFLICT'],
    ['40001', 'REQUEST_CONFLICT'],
    ['40P01', 'REQUEST_CONFLICT'],
    ['23514', 'REQUEST_INVALID'],
    ['23502', 'REQUEST_INVALID'],
    ['22023', 'REQUEST_INVALID'],
    ['22P02', 'REQUEST_INVALID'],
    ['XX000', 'OPERATION_FAILED']
  ])('maps SQLSTATE %s to %s', (code, expected) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(toClientError({ code, message: 'raw database text' }).message).toBe(expected);
  });

  it('collapses unknown and lookalike failures to the generic code', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const value of [
      new Error('connection refused to 10.0.0.1'),
      { code: 'P0001', message: 'NOT_COMMUNITY_ADMIN: details' },
      { code: 'P0001', message: 'SOME_UNREGISTERED_CODE' },
      'plain string',
      null,
      undefined
    ])
      expect(toClientError(value).message).toBe('OPERATION_FAILED');
  });

  it('serializes no details, hint, SQLSTATE, constraint, cause or PII', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = toClientError(pgError);
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    expect(error.message).toBe('REQUEST_CONFLICT');
    expect(error.cause).toBeUndefined();
    expect(serialized).not.toMatch(/23505|details|hint|constraint|ana@example|nested|cause/);
  });

  it('logs a safe diagnostic without raw database text', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    toClientError(pgError);
    const line = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(line)).toMatchObject({
      event: 'request.failure',
      code: 'REQUEST_CONFLICT',
      status: '23505'
    });
    expect(line).not.toMatch(/ana@example|duplicate key|rename it/);
  });

  it('stays silent for registry codes', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    toClientError({ code: 'P0001', message: 'NOT_COMMUNITY_ADMIN' });
    expect(log).not.toHaveBeenCalled();
  });
});
