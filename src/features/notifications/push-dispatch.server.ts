import { emitDiagnostic } from '../../lib/diagnostics.server';
import { getAdminClient, type AdminClient } from '../../lib/supabase/admin.server';
import type { Json } from '../../lib/supabase/database.types';
import {
  classifyPushResponse,
  pushPayload,
  pushRetrySeconds,
  type PushCategory
} from './push-delivery';
import { readPushKeyring } from './push-keyring.server';
import { createPushTransport, type PushTransport, type PushDevice } from './push-transport.server';

type Prepared = {
  subscription: PushDevice & { locale: string; vapid_key_id: string };
  category: PushCategory;
  attempt: number;
};
function decodePrepared(value: Json): Prepared {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('PUSH_INVALID_JOB');
  const s = value.subscription;
  const category = value.category;
  if (
    !s ||
    typeof s !== 'object' ||
    Array.isArray(s) ||
    typeof s.endpoint !== 'string' ||
    typeof s.p256dh !== 'string' ||
    typeof s.auth !== 'string' ||
    typeof s.locale !== 'string' ||
    typeof s.vapid_key_id !== 'string' ||
    typeof value.attempt !== 'number' ||
    (category !== 'community' &&
      category !== 'matches' &&
      category !== 'results' &&
      category !== 'rankings' &&
      category !== 'leagues')
  )
    throw new Error('PUSH_INVALID_JOB');
  return {
    subscription: {
      endpoint: s.endpoint,
      p256dh: s.p256dh,
      auth: s.auth,
      locale: s.locale,
      vapid_key_id: s.vapid_key_id
    },
    category,
    attempt: value.attempt
  };
}

type Counters = {
  pending: number;
  accepted: number;
  retried: number;
  expired: number;
  failed: number;
  skipped: number;
  unavailable: number;
};

async function recordPushHealth(client: AdminClient, code: 'PUSH_CONFIG_UNAVAILABLE' | null) {
  try {
    const result = await client.rpc('record_operational_push_health', {
      p_code: code ?? undefined
    });
    if (result.error) throw new Error('PUSH_HEALTH_UNAVAILABLE');
  } catch {
    emitDiagnostic('push.failure', 'failure', { code: 'PUSH_HEALTH_UNAVAILABLE' });
  }
}

// One bounded sweep. Never expose provider errors (they frequently contain endpoint/key material).
export async function dispatchNotificationPush(
  client: AdminClient,
  keyring: NonNullable<ReturnType<typeof readPushKeyring>>,
  transport: PushTransport = createPushTransport()
) {
  const counters: Counters = {
    pending: 0,
    accepted: 0,
    retried: 0,
    expired: 0,
    failed: 0,
    skipped: 0,
    unavailable: 0
  };
  const revoked = await client.rpc('revoke_notification_push_keys', { p_key_ids: keyring.revoked });
  if (revoked.error) throw new Error('PUSH_DATABASE_UNAVAILABLE');
  const claimed = await client.rpc('claim_notification_push_jobs', { p_limit: 10 });
  if (claimed.error) throw new Error('PUSH_DATABASE_UNAVAILABLE');
  counters.pending = claimed.data.length;
  const outcomes = await Promise.allSettled(
    claimed.data.map(async (job) => {
      const token = job.claim_token!;
      const materialized = await client.rpc('materialize_notification_push', {
        p_notification_id: job.notification_id,
        p_claim_token: token
      });
      if (materialized.error) throw new Error('PUSH_DATABASE_UNAVAILABLE');
      let unavailable = false;
      for (const delivery of materialized.data) {
        const prepared = await client.rpc('prepare_notification_push', {
          p_notification_id: job.notification_id,
          p_subscription_id: delivery.subscription_id,
          p_claim_token: token
        });
        if (prepared.error) throw new Error('PUSH_DATABASE_UNAVAILABLE');
        if (!prepared.data) {
          counters.skipped++;
          continue;
        }
        // Internal service RPC returns this shape, never untrusted browser input.
        const { subscription, category, attempt } = decodePrepared(prepared.data);
        const key = keyring.keys.get(subscription.vapid_key_id);
        let status: ReturnType<typeof classifyPushResponse> = 'unavailable';
        let httpStatus: number | undefined;
        let retryAfter: string | null = null;
        if (key) {
          try {
            const result = await transport(
              subscription,
              pushPayload(job.notification_id, category, subscription.locale),
              key
            );
            httpStatus = result.status;
            retryAfter = result.retryAfter;
            status = classifyPushResponse(result.status);
          } catch (error) {
            status =
              error instanceof Error && /^PUSH_(INVALID_|PAYLOAD_)/.test(error.message)
                ? 'failed'
                : 'pending';
          }
        }
        const settled = await client.rpc('settle_notification_push_delivery', {
          p_notification_id: job.notification_id,
          p_subscription_id: delivery.subscription_id,
          p_claim_token: token,
          p_status: status,
          p_http_status: httpStatus,
          p_delay_seconds: pushRetrySeconds(attempt, retryAfter)
        });
        if (settled.error || !settled.data) throw new Error('PUSH_SETTLEMENT_LOST');
        if (status === 'failed' || status === 'unavailable')
          emitDiagnostic('push.failure', 'failure', {
            code: status === 'failed' ? 'PUSH_FAILED' : 'PUSH_CONFIG_UNAVAILABLE',
            status: httpStatus,
            attempt
          });
        if (status === 'unavailable') {
          unavailable = true;
          counters.unavailable++;
        } else if (status === 'pending') counters.retried++;
        else counters[status]++;
      }
      const finished = await client.rpc('finish_notification_push', {
        p_notification_id: job.notification_id,
        p_claim_token: token,
        p_unavailable: unavailable
      });
      if (finished.error || !finished.data) throw new Error('PUSH_SETTLEMENT_LOST');
    })
  );
  const health = await client.rpc('notification_push_health');
  console.info('notification_push_sweep', {
    ...counters,
    health: health.error ? null : health.data
  });
  if (outcomes.some((result) => result.status === 'rejected') || health.error)
    throw new Error('PUSH_SWEEP_FAILED');
  await recordPushHealth(client, counters.unavailable ? 'PUSH_CONFIG_UNAVAILABLE' : null);
  if (counters.unavailable) throw new Error('PUSH_CONFIG_UNAVAILABLE');
  return counters;
}

export async function sweepNotificationPushOnSchedule(options?: {
  client?: AdminClient;
  env?: Record<string, string | undefined>;
}) {
  let keyring: ReturnType<typeof readPushKeyring>;
  try {
    keyring = readPushKeyring(options?.env);
  } catch {
    console.error('notification_push_unavailable', { reason: 'configuration' });
    emitDiagnostic('push.failure', 'failure', { code: 'PUSH_CONFIG_UNAVAILABLE' });
    try {
      await recordPushHealth(options?.client ?? getAdminClient(), 'PUSH_CONFIG_UNAVAILABLE');
    } catch {
      /* Missing admin configuration is already diagnosed by the scheduled sweep. */
    }
    throw new Error('PUSH_CONFIG_UNAVAILABLE');
  }
  if (!keyring) {
    console.warn('notification_push_unavailable', { reason: 'disabled' });
    throw new Error('PUSH_DISABLED');
  }
  return dispatchNotificationPush(options?.client ?? getAdminClient(), keyring);
}
