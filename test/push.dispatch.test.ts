import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminClient } from '../src/lib/supabase/admin.server';
import {
  dispatchNotificationPush,
  sweepNotificationPushOnSchedule
} from '../src/features/notifications/push-dispatch.server';

const admin = vi.hoisted(() => ({
  get: vi.fn<() => Promise<{ status: number; retryAfter: string | null }>>()
}));
vi.mock('../src/lib/supabase/admin.server', () => ({ getAdminClient: admin.get }));
const id = 'f74b5d16-a581-4b51-b006-805cddca5abe';
const key = { publicKey: 'public', privateKey: 'private', subject: 'mailto:test@example.test' };
const keyring = { keys: new Map([['key-1', key]]), revoked: [] as string[] };
function fixture() {
  const rpc = vi.fn<
    (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: null }>
  >(
    async (
      name: string,
      _args?: Record<string, unknown>
    ): Promise<{ data: unknown; error: null }> => {
      if (name === 'claim_notification_push_jobs')
        return { data: [{ notification_id: id, claim_token: 'lease' }], error: null };
      if (name === 'materialize_notification_push')
        return { data: [{ subscription_id: 'phone' }, { subscription_id: 'laptop' }], error: null };
      if (name === 'prepare_notification_push')
        return {
          data: {
            subscription: {
              id: _args!.p_subscription_id,
              endpoint: 'https://fcm.googleapis.com/send/private-endpoint',
              p256dh: 'p256dh',
              auth: 'secret',
              locale: 'es',
              vapid_key_id: 'key-1'
            },
            category: 'matches',
            attempt: 1
          },
          error: null
        };
      return { data: true, error: null };
    }
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow RPC fixture double; no real admin credential
  return { rpc, client: { rpc } as unknown as AdminClient };
}
describe('durable Push dispatcher', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    admin.get.mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  it.each([404, 410])(
    'retires only HTTP %s device while second device succeeds',
    async (status) => {
      const { rpc, client } = fixture();
      const send = vi
        .fn<() => Promise<{ status: number; retryAfter: string | null }>>()
        .mockResolvedValueOnce({ status, retryAfter: null })
        .mockResolvedValueOnce({ status: 201, retryAfter: null });
      expect(await dispatchNotificationPush(client, keyring, send)).toMatchObject({
        expired: 1,
        accepted: 1
      });
      const settlements = rpc.mock.calls
        .filter(([name]) => name === 'settle_notification_push_delivery')
        .map(([, args]) => args);
      expect(settlements).toEqual([
        expect.objectContaining({ p_subscription_id: 'phone', p_status: 'expired' }),
        expect.objectContaining({ p_subscription_id: 'laptop', p_status: 'accepted' })
      ]);
    }
  );
  it.each([429, 500, 503])('schedules durable retry for %s', async (status) => {
    const { rpc, client } = fixture();
    await dispatchNotificationPush(
      client,
      keyring,
      vi
        .fn<() => Promise<{ status: number; retryAfter: string | null }>>()
        .mockResolvedValue({ status, retryAfter: '1200' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'settle_notification_push_delivery',
      expect.objectContaining({ p_status: 'pending', p_delay_seconds: 1200 })
    );
  });
  it.each([401, 403])(
    'surfaces %s key fault, restores budget, never expires subscription',
    async (status) => {
      const { rpc, client } = fixture();
      await expect(
        dispatchNotificationPush(
          client,
          keyring,
          vi
            .fn<() => Promise<{ status: number; retryAfter: string | null }>>()
            .mockResolvedValue({ status, retryAfter: null })
        )
      ).rejects.toThrow('PUSH_CONFIG_UNAVAILABLE');
      expect(rpc).toHaveBeenCalledWith(
        'finish_notification_push',
        expect.objectContaining({ p_unavailable: true })
      );
      expect(
        rpc.mock.calls
          .filter(([name]) => name === 'settle_notification_push_delivery')
          .every(([, args]) => args!.p_status === 'unavailable')
      ).toBe(true);
    }
  );
  it('treats 400 and invalid endpoints as terminal but network/timeout as retriable; logs no secrets', async () => {
    const { rpc, client } = fixture();
    const send = vi
      .fn<() => Promise<{ status: number; retryAfter: string | null }>>()
      .mockResolvedValueOnce({ status: 400, retryAfter: null })
      .mockRejectedValueOnce(new Error('private-endpoint secret'));
    await dispatchNotificationPush(client, keyring, send);
    expect(rpc).toHaveBeenCalledWith(
      'settle_notification_push_delivery',
      expect.objectContaining({ p_status: 'failed' })
    );
    expect(rpc).toHaveBeenCalledWith(
      'settle_notification_push_delivery',
      expect.objectContaining({ p_status: 'pending' })
    );
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(
      /private-endpoint|secret/
    );
  });
  it('disabled configuration cannot claim jobs or burn attempts', async () => {
    vi.stubEnv('WEB_PUSH_ENABLED', 'false');
    await expect(sweepNotificationPushOnSchedule()).rejects.toThrow('PUSH_DISABLED');
    expect(admin.get).not.toHaveBeenCalled();
  });
  it('does not send when per-send preference check suppresses delivery', async () => {
    const { rpc, client } = fixture();
    const original = rpc.getMockImplementation()!;
    rpc.mockImplementation((name, args) =>
      name === 'prepare_notification_push'
        ? Promise.resolve({ data: null, error: null })
        : original(name, args)
    );
    const send = vi.fn<() => Promise<{ status: number; retryAfter: string | null }>>();
    expect(await dispatchNotificationPush(client, keyring, send)).toMatchObject({ skipped: 2 });
    expect(send).not.toHaveBeenCalled();
  });
  it('missing old key reports unavailable without retirement or success', async () => {
    const { rpc, client } = fixture();
    const send = vi.fn<() => Promise<{ status: number; retryAfter: string | null }>>();
    await expect(
      dispatchNotificationPush(client, { keys: new Map(), revoked: [] }, send)
    ).rejects.toThrow('PUSH_CONFIG_UNAVAILABLE');
    expect(send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith(
      'settle_notification_push_delivery',
      expect.objectContaining({ p_status: 'unavailable' })
    );
  });
});
