import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { readPushConfig, toPublicPushConfig } from './push-config.server';
import {
  validateReconcilePushDevices,
  validateRegisterPushSubscription,
  validateRetirePushSubscription
} from './push.validators';

export type PushFailureCode = 'unavailable' | 'endpointConflict' | 'deviceLimit' | 'failed';
export type PushCurrentDevice = 'active' | 'retired' | 'none';

// Database errors are mapped to generic codes; endpoints, keys and raw messages never reach the client.
function failureCode(error: { message?: string } | null): PushFailureCode {
  if (error?.message === 'PUSH_ENDPOINT_CONFLICT') return 'endpointConflict';
  if (error?.message === 'PUSH_DEVICE_LIMIT') return 'deviceLimit';
  return 'failed';
}

export const getPushConfig = createServerFn({ method: 'GET' }).handler(async () => {
  await requireAuthenticatedClient();
  return toPublicPushConfig(readPushConfig());
});

export const registerMyPushSubscription = createServerFn({ method: 'POST' })
  .validator(validateRegisterPushSubscription)
  .handler(async ({ data }): Promise<{ ok: true } | { ok: false; code: PushFailureCode }> => {
    const { client } = await requireAuthenticatedClient();
    const config = readPushConfig();
    if (!config.enabled || !config.keyId) return { ok: false, code: 'unavailable' };
    const { error } = await client.rpc('register_my_push_subscription', {
      p_endpoint: data.subscription.endpoint,
      p_p256dh: data.subscription.keys.p256dh,
      p_auth: data.subscription.keys.auth,
      p_vapid_key_id: config.keyId,
      p_locale: data.locale,
      p_expires_at:
        data.subscription.expirationTime === null
          ? undefined
          : new Date(data.subscription.expirationTime).toISOString()
    });
    return error ? { ok: false, code: failureCode(error) } : { ok: true };
  });

export const retireMyPushSubscription = createServerFn({ method: 'POST' })
  .validator(validateRetirePushSubscription)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { client } = await requireAuthenticatedClient();
    const { error } = await client.rpc('retire_my_push_subscription', {
      p_endpoint: data.endpoint,
      p_reason: data.reason
    });
    return { ok: !error };
  });

export const reconcileMyPushDevices = createServerFn({ method: 'POST' })
  .validator(validateReconcilePushDevices)
  .handler(
    async ({
      data
    }): Promise<
      | {
          ok: true;
          current: PushCurrentDevice;
          retiredReason: string | null;
          otherDevices: number;
        }
      | { ok: false }
    > => {
      const { client } = await requireAuthenticatedClient();
      const { data: rows, error } = await client.rpc('reconcile_my_push_devices', {
        p_current_endpoint: data.endpoint ?? undefined,
        p_locale: data.locale
      });
      if (error || !rows) return { ok: false };
      const current = rows.find((row) => row.is_current);
      return {
        ok: true,
        current: !current ? 'none' : current.device_retired_at ? 'retired' : 'active',
        retiredReason: current?.device_retired_reason ?? null,
        otherDevices: rows.filter((row) => !row.is_current && !row.device_retired_at).length
      };
    }
  );
