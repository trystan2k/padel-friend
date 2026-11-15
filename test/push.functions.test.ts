import { describe, expect, it, vi } from 'vitest';
import { acceptedPushEndpoints, rejectedPushEndpoints } from './helpers/push-endpoint-corpus';
import { validatePushEndpoint } from '../src/features/notifications/push-endpoint';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn<(...args: unknown[]) => Promise<{ error: null }>>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (ctx: { data: unknown }) => unknown) =>
        async (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({ client: { rpc: mocks.rpc } })
}));
vi.mock('../src/features/notifications/push-config.server', () => ({
  readPushConfig: () => ({ enabled: true, keyId: 'key-1' }),
  toPublicPushConfig: vi.fn<() => unknown>()
}));
import { registerMyPushSubscription } from '../src/features/notifications/push.functions';

const input = (endpoint: string) => ({
  subscription: {
    endpoint,
    keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
    expirationTime: null
  },
  locale: 'en' as const
});

describe('push endpoint registration boundary', () => {
  it.each(acceptedPushEndpoints)('accepts supported endpoint %s', async (endpoint) => {
    expect(() => validatePushEndpoint(endpoint)).not.toThrow();
    mocks.rpc.mockResolvedValue({ error: null });
    await expect(registerMyPushSubscription({ data: input(endpoint) })).resolves.toEqual({
      ok: true
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith(
      'register_my_push_subscription',
      expect.objectContaining({ p_endpoint: endpoint })
    );
  });

  it.each(rejectedPushEndpoints)('rejects endpoint before RPC %s', async (endpoint) => {
    expect(() => validatePushEndpoint(endpoint)).toThrow('PUSH_INVALID_ENDPOINT');
    mocks.rpc.mockClear();
    await expect(registerMyPushSubscription({ data: input(endpoint) })).rejects.toThrow(
      /PUSH_INVALID_ENDPOINT|INVALID_PUSH_INPUT/
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
