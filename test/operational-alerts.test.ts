import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAdminClient, type AdminClient } from '../src/lib/supabase/admin.server';
import {
  createAlertSender,
  sweepOperationalAlerts,
  sweepOperationalAlertsOnSchedule,
  type AlertMessage
} from '../src/features/notifications/operational-alerts.server';

vi.mock('../src/lib/supabase/admin.server', () => ({
  getAdminClient: vi.fn<typeof getAdminClient>()
}));

afterEach(() => vi.restoreAllMocks());

type Reply = { data: unknown; error: unknown };
function fakeAdmin(replies: { signals?: unknown; reconciled?: unknown; marked?: Reply }) {
  const rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<Reply>>(
    async (name) => {
      if (name === 'operational_failure_signals')
        return { data: replies.signals ?? [], error: null };
      if (name === 'reconcile_operational_alerts')
        return { data: replies.reconciled ?? { open: [], resolved: [] }, error: null };
      return replies.marked ?? { data: true, error: null };
    }
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow RPC double; no real credential
  return { rpc, client: { rpc } as unknown as AdminClient };
}
const item = { key: 'repair:job-1:5', source: 'repair', severity: 'critical', reference: 'job-1' };
const signal = { ...item, code: 'REPLAY_FAILED' };

describe('alert sender', () => {
  it('is disabled without a receiver and rejects insecure or invalid targets', () => {
    expect(createAlertSender({})).toBeNull();
    expect(() =>
      createAlertSender({ OPS_ALERT_WEBHOOK_URL: 'http://alerts.example.com/x' })
    ).toThrow('ALERT_RECEIVER_INVALID');
    expect(() => createAlertSender({ OPS_ALERT_WEBHOOK_URL: 'not a url' })).toThrow(
      'ALERT_RECEIVER_INVALID'
    );
    expect(createAlertSender({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' })).toBeTypeOf(
      'function'
    );
    expect(createAlertSender({ OPS_ALERT_WEBHOOK_URL: 'http://127.0.0.1:9999/x' })).toBeTypeOf(
      'function'
    );
  });

  it('posts identifiers only and treats a non-2xx reply as a failure', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const send = createAlertSender({ OPS_ALERT_WEBHOOK_URL: 'https://hooks.example.com/x' })!;
    await send({ state: 'open', ...item });
    const init = fetchMock.mock.calls[0]![1];
    const body = typeof init?.body === 'string' ? init.body : '';
    expect(JSON.parse(body)).toMatchObject({ state: 'open', key: item.key, reference: 'job-1' });
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }));
    await expect(send({ state: 'open', ...item })).rejects.toThrow('ALERT_RECEIVER_REJECTED');
    vi.unstubAllGlobals();
  });
});

describe('alert sweep', () => {
  it('creates its admin client inside the scheduled server-only entry', async () => {
    const { client, rpc } = fakeAdmin({});
    vi.mocked(getAdminClient).mockReturnValueOnce(client);
    await expect(sweepOperationalAlertsOnSchedule()).resolves.toEqual({
      sent: 0,
      failed: 0,
      pending: 0
    });
    expect(getAdminClient).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('operational_failure_signals');
  });
  it('sends each pending open alert once, stamps delivery, and emits the failure event', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { rpc, client } = fakeAdmin({
      signals: [signal],
      reconciled: { open: [item], resolved: [] }
    });
    const sent: AlertMessage[] = [];
    const counters = await sweepOperationalAlerts(
      client,
      async (message) => void sent.push(message)
    );
    expect(sent).toEqual([{ state: 'open', ...item }]);
    expect(counters).toMatchObject({ sent: 1, failed: 0 });
    expect(rpc).toHaveBeenCalledWith('mark_operational_alert_sent', {
      p_key: item.key,
      p_resolution: false,
      p_token: expect.any(String)
    });
    expect(JSON.parse(String(error.mock.calls[0]![0]))).toMatchObject({
      event: 'replay.fail',
      code: 'REPLAY_FAILED',
      reference: 'job-1'
    });
  });

  it('sends nothing when reconciliation reports no new alert (dedupe lives in the durable state)', async () => {
    const { client } = fakeAdmin({ signals: [signal] });
    const send = vi.fn<(message: AlertMessage) => Promise<void>>();
    expect(await sweepOperationalAlerts(client, send)).toMatchObject({ pending: 0, sent: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps an undelivered alert un-stamped when the receiver fails, without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rpc, client } = fakeAdmin({
      signals: [signal],
      reconciled: { open: [item], resolved: [] }
    });
    const counters = await sweepOperationalAlerts(client, async () => {
      throw new Error('ALERT_RECEIVER_REJECTED');
    });
    expect(counters).toMatchObject({ sent: 0, failed: 1 });
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('mark_operational_alert_sent');
  });

  it('reports recovery as a resolution message', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const { rpc, client } = fakeAdmin({ reconciled: { open: [], resolved: [item] } });
    const sent: AlertMessage[] = [];
    await sweepOperationalAlerts(client, async (message) => void sent.push(message));
    expect(sent).toEqual([{ state: 'resolved', ...item }]);
    expect(rpc).toHaveBeenCalledWith('mark_operational_alert_sent', {
      p_key: item.key,
      p_resolution: true,
      p_token: expect.any(String)
    });
  });

  it('keeps durable state and logs when no receiver is configured', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rpc, client } = fakeAdmin({
      signals: [signal],
      reconciled: { open: [item], resolved: [] }
    });
    expect(await sweepOperationalAlerts(client, null)).toMatchObject({ pending: 1, sent: 0 });
    expect(error.mock.calls.map(([line]) => JSON.parse(String(line)))).toContainEqual(
      expect.objectContaining({ event: 'alert.send', code: 'ALERT_RECEIVER_UNCONFIGURED' })
    );
    expect(rpc.mock.calls.map(([name]) => name)).not.toContain('mark_operational_alert_sent');
  });

  it('logs publication failure as replay, independently of a configured receiver', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { client } = fakeAdmin({
      signals: [{ ...signal, code: 'PUBLICATION_FAILED' }],
      reconciled: { open: [item], resolved: [] }
    });
    await sweepOperationalAlerts(client, null);
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({
      event: 'replay.fail',
      code: 'PUBLICATION_FAILED',
      reference: 'job-1'
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('rating.failure');
  });
  it('does not deliver when another sweep owns the lease', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { rpc, client } = fakeAdmin({
      signals: [signal],
      reconciled: { open: [item], resolved: [] }
    });
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === 'claim_operational_alert'
        ? Promise.resolve({ data: false, error: null })
        : original(name, args)
    );
    const send = vi.fn<(message: AlertMessage) => Promise<void>>();
    expect(await sweepOperationalAlerts(client, send)).toMatchObject({ sent: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });
  it('surfaces database failures so the cron run fails visibly', async () => {
    const rpc = vi.fn<() => Promise<Reply>>(async () => ({
      data: null,
      error: { message: 'down' }
    }));
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow RPC double
    await expect(sweepOperationalAlerts({ rpc } as unknown as AdminClient, null)).rejects.toThrow(
      'ALERT_SIGNALS_UNAVAILABLE'
    );
  });
});
