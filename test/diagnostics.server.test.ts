import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  classifyCommandResult,
  currentCorrelation,
  emitDiagnostic,
  newCorrelationId,
  requestReference,
  runWithDiagnostics,
  safeErrorCode,
  traceOperation
} from '../src/lib/diagnostics.server';

function lines(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.map(([line]) => {
    const parsed: unknown = JSON.parse(String(line));
    if (!parsed || typeof parsed !== 'object') throw new Error('log line is not an object');
    return Object.fromEntries(Object.entries(parsed));
  });
}

afterEach(() => vi.restoreAllMocks());

describe('diagnostics helper', () => {
  it('rejects unsafe context IDs and snapshots caller-owned context', () => {
    expect(() =>
      runWithDiagnostics({ kind: 'request', id: 'forged\nline' }, () => undefined)
    ).toThrow('CORRELATION_ID_INVALID');
    const context = { kind: 'request' as const, id: 'original' };
    runWithDiagnostics(context, () => {
      context.id = 'changed';
      expect(requestReference()).toBe('original');
    });
  });

  it('mints a fresh UUID per call', () => {
    const [first, second] = [newCorrelationId(), newCorrelationId()];
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).not.toBe(second);
  });

  it('keeps correlation isolated across concurrent requests', async () => {
    const seen: string[] = [];
    const run = (id: string, delay: number) =>
      runWithDiagnostics({ kind: 'request', id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        seen.push(`${id}:${requestReference()}`);
      });
    await Promise.all([run('a', 20), run('b', 5), run('c', 10)]);
    expect(seen.sort()).toEqual(['a:a', 'b:b', 'c:c']);
    expect(currentCorrelation()).toBeUndefined();
  });

  it('drops anything that is not an allowlisted short token (no cookie/JWT/e-mail/endpoint/SQL/newline)', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    runWithDiagnostics({ kind: 'request', id: 'req-1' }, () =>
      emitDiagnostic('match.create', 'success', {
        code: 'MATCH_OK',
        cookie: 'sb-token=abc',
        reference: 'player@example.com',
        job: 'eyJhbGciOi.payload.sig',
        stage: 'https://fcm.googleapis.com/send/secret',
        status: "select * from users where id = '1'",
        decision: 'line one\nforged {"event":"x"}',
        attempt: 3
      })
    );
    const [line] = lines(info);
    expect(line).toMatchObject({
      event: 'match.create',
      outcome: 'success',
      requestId: 'req-1',
      code: 'MATCH_OK',
      attempt: 3
    });
    expect(Object.keys(line!).sort()).toEqual([
      'at',
      'attempt',
      'code',
      'event',
      'outcome',
      'requestId'
    ]);
    expect(info.mock.calls[0]).toHaveLength(1);
    expect(String(info.mock.calls[0]![0])).not.toContain('\n');
  });

  it('uses jobId for scheduled scope and routes non-success outcomes to console.error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    runWithDiagnostics({ kind: 'job', id: 'job-1' }, () =>
      emitDiagnostic('push.failure', 'failure', { code: 'PUSH_FAILED' })
    );
    expect(lines(error)[0]).toMatchObject({ jobId: 'job-1', event: 'push.failure' });
    expect(lines(error)[0]).not.toHaveProperty('requestId');
  });

  it('exposes only stable upper-snake codes', () => {
    expect(safeErrorCode(new Error('MATCH_CONFLICT'))).toBe('MATCH_CONFLICT');
    expect(safeErrorCode(new Error('duplicate key value violates unique constraint "x"'))).toBe(
      'INTERNAL'
    );
    expect(safeErrorCode(undefined)).toBe('INTERNAL');
  });

  it('classifies command results by actual outcome', () => {
    expect(classifyCommandResult({ status: 'ok', value: 1 })).toEqual({ outcome: 'success' });
    expect(classifyCommandResult({ status: 'error', code: 'full' })).toEqual({
      outcome: 'race',
      code: 'FULL'
    });
    expect(classifyCommandResult({ status: 'error', code: 'stale_version' })).toEqual({
      outcome: 'race',
      code: 'STALE_VERSION'
    });
    expect(classifyCommandResult({ status: 'error', code: 'forbidden' })).toEqual({
      outcome: 'rejected',
      code: 'FORBIDDEN'
    });
    expect(classifyCommandResult({ status: 'conflict', code: 'deadline_elapsed' })).toEqual({
      outcome: 'race',
      code: 'CONFLICT'
    });
    expect(classifyCommandResult(null)).toEqual({ outcome: 'failure', code: 'INTERNAL' });
  });
});

describe('PRD §59 event matrix', () => {
  it.each([
    ['match.join', { status: 'ok' }, 'success'],
    ['match.join', { status: 'error', code: 'conflict' }, 'race'],
    ['match.join', { status: 'error', code: 'unavailable' }, 'rejected'],
    ['result.submit', { status: 'error', code: 'invalid' }, 'rejected'],
    ['result.review', { status: 'ok' }, 'success']
  ] as const)('%s records %j as %s (never "attempted")', async (event, result, outcome) => {
    const sink = vi
      .spyOn(outcome === 'success' ? console : console, outcome === 'success' ? 'info' : 'error')
      .mockImplementation(() => undefined);
    await traceOperation(event, classifyCommandResult, async () => result, { decision: 'approve' });
    expect(lines(sink)[0]).toMatchObject({ event, outcome, decision: 'approve' });
    expect(lines(sink)[0]!['durationMs']).toBeTypeOf('number');
  });

  it('records a thrown failure with its safe code and rethrows', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(
      traceOperation('league.close', classifyCommandResult, async () => {
        throw new Error('LEAGUE_STALE');
      })
    ).rejects.toThrow('LEAGUE_STALE');
    expect(lines(error)[0]).toMatchObject({
      event: 'league.close',
      outcome: 'failure',
      code: 'LEAGUE_STALE'
    });
  });
});
