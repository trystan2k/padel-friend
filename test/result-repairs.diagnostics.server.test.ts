import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>() }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({
    client: {
      rpc: mocks.rpc,
      auth: {
        getClaims: async () => ({ data: { claims: { sub: 'operator' } }, error: null })
      }
    }
  })
}));
import { retryResultRepair } from '../src/features/result-repairs/repair.functions';

const id = '00000000-0000-4000-8000-000000000001';
const job = {
  job_id: id,
  amendment_id: id,
  resolution_id: null,
  proposal_id: id,
  group_number: 1,
  kind: 'replace',
  status: 'running',
  publication: 'pending',
  projections_complete: false,
  attempt_count: 1,
  failure_code: null,
  next_attempt_at: null,
  requested_at: '2026-11-09T10:00:00Z',
  started_at: '2026-11-09T10:00:00Z',
  finished_at: null,
  committed_revision: null
};

afterEach(() => vi.restoreAllMocks());
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValueOnce({
    data: { claim: { claimed: true, attempt_number: 1 }, job },
    error: null
  });
});

describe('repair server diagnostic outcomes', () => {
  it.each([
    [{ data: null, error: { message: 'private SQL and token' } }, 'INTERNAL'],
    [{ data: { malformed: true }, error: null }, 'REPLAY_RECEIPT_INVALID']
  ])('records failed execution without leaking provider details', async (reply, code) => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValueOnce(reply);
    expect(await retryResultRepair({ data: { job_id: id } })).toMatchObject({ status: 'error' });
    expect(error.mock.calls).toHaveLength(1);
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      event: 'replay.fail',
      outcome: 'failure',
      reference: id,
      attempt: 1,
      code
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private SQL');
  });

  it('does not call a stale execution a failure or completion', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.rpc.mockResolvedValueOnce({ data: { outcome: 'stale', job }, error: null });
    expect(await retryResultRepair({ data: { job_id: id } })).toMatchObject({ status: 'ok' });
    expect(error).not.toHaveBeenCalled();
    expect(info.mock.calls).toHaveLength(1);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ event: 'replay.start' });
  });
});
