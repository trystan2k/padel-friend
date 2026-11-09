import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  sweepJobDiagnostics,
  sweepJobDiagnosticsOnSchedule
} from '../src/features/result-repairs/job-diagnostics.server';
import { getAdminClient, type AdminClient } from '../src/lib/supabase/admin.server';
import { requestReference } from '../src/lib/diagnostics.server';

vi.mock('../src/lib/supabase/admin.server', () => ({
  getAdminClient: vi.fn<typeof getAdminClient>()
}));

afterEach(() => vi.restoreAllMocks());
const reference = '00000000-0000-4000-8000-000000000001';
function clientFor(data: unknown, failMark = false) {
  const rpc = vi.fn<(name: string, args?: unknown) => Promise<{ data: unknown; error: unknown }>>(
    async (name) => ({
      data: name === 'read_operational_job_events' ? data : null,
      error: name === 'mark_operational_job_events' && failMark ? { message: 'private sql' } : null
    })
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- service RPC test double
  return { client: { rpc } as unknown as AdminClient, rpc };
}
describe('committed DB-job diagnostic sweep', () => {
  it('creates its admin client inside the scheduled server-only wrapper', async () => {
    const { client, rpc } = clientFor([]);
    vi.mocked(getAdminClient).mockReturnValueOnce(client);
    await expect(sweepJobDiagnosticsOnSchedule()).resolves.toBe(0);
    expect(getAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('read_operational_job_events');
  });
  it.each(['result.confirm', 'rating.failure', 'replay.start', 'replay.complete', 'replay.fail'])(
    'logs %s with durable job/attempt correlation and acknowledges outside transaction',
    async (event) => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const outcome = event.endsWith('failure') || event.endsWith('fail') ? 'failure' : 'success';
      const { client, rpc } = clientFor([
        {
          event_key: 'key',
          event,
          outcome,
          reference,
          attempt: 2,
          code: 'SAFE_CODE',
          stage: 'replay',
          cookie: 'secret',
          sql: 'private'
        }
      ]);
      expect(await sweepJobDiagnostics(client)).toBe(1);
      const logs = [...info.mock.calls, ...error.mock.calls];
      expect(JSON.parse(String(logs[0]?.[0]))).toMatchObject({
        event,
        outcome,
        jobId: reference + ':2',
        reference,
        attempt: 2,
        source: 'database'
      });
      expect(JSON.stringify(logs)).not.toMatch(/secret|private/);
      expect(rpc).toHaveBeenCalledWith('mark_operational_job_events', { p_keys: ['key'] });
      expect(requestReference()).toBeNull();
    }
  );
  it('does not acknowledge malformed or forged events', async () => {
    const { client, rpc } = clientFor([
      { event_key: 'x', event: 'forged', outcome: 'success', reference, attempt: 1 }
    ]);
    await expect(sweepJobDiagnostics(client)).rejects.toThrow('JOB_DIAGNOSTICS_INVALID');
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it('surfaces acknowledgement failure for retry rather than pretending delivery', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { client } = clientFor(
      [{ event_key: 'x', event: 'replay.complete', outcome: 'success', reference, attempt: 1 }],
      true
    );
    await expect(sweepJobDiagnostics(client)).rejects.toThrow('JOB_DIAGNOSTICS_UNAVAILABLE');
  });
});
