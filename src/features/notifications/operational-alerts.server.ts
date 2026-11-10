import { getAdminClient, type AdminClient } from '../../lib/supabase/admin.server';
import { emitDiagnostic, safeErrorCode, type DiagnosticEvent } from '../../lib/diagnostics.server';

// Operational alerts for failed rating/replay/Push work. The durable failure records are the
// source of truth; this module only reconciles them into deduplicated alert state and sends
// best-effort OUTSIDE every critical transaction. A dead receiver never rolls back, blocks or
// starves a result, rating, notification or any other sweep.

export type AlertMessage = {
  state: 'open' | 'resolved';
  key: string;
  source: string;
  severity: string;
  reference: string;
  deliveryId?: string;
};
export type AlertSend = (message: AlertMessage) => Promise<void>;

type Signal = { key: string; source: string; severity: string; reference: string; code: string };

const SEND_TIMEOUT_MS = 5000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decodeSignals(value: unknown): Signal[] {
  if (!Array.isArray(value)) throw new Error('ALERT_SIGNALS_INVALID');
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.key !== 'string' ||
      typeof item.source !== 'string' ||
      typeof item.severity !== 'string' ||
      typeof item.reference !== 'string'
    )
      throw new Error('ALERT_SIGNALS_INVALID');
    return {
      key: item.key,
      source: item.source,
      severity: item.severity,
      reference: item.reference,
      code: typeof item.code === 'string' ? item.code : 'INTERNAL'
    };
  });
}

function decodePending(value: unknown): Omit<AlertMessage, 'state'>[] {
  if (!Array.isArray(value)) throw new Error('ALERT_SIGNALS_INVALID');
  return value.map((item) => {
    if (
      !isRecord(item) ||
      typeof item.key !== 'string' ||
      typeof item.source !== 'string' ||
      typeof item.severity !== 'string' ||
      typeof item.reference !== 'string'
    )
      throw new Error('ALERT_SIGNALS_INVALID');
    return {
      key: item.key,
      source: item.source,
      severity: item.severity,
      reference: item.reference,
      ...(typeof item.deliveryId === 'string' ? { deliveryId: item.deliveryId } : {})
    };
  });
}

/**
 * Webhook transport to an OPERATOR-APPROVED receiver (OPS_ALERT_WEBHOOK_URL, a Workers secret).
 * HTTPS only; plain HTTP is accepted solely for loopback so local fault drills can use a sink.
 * Payload carries identifiers and codes only: no user data, e-mail, Push endpoint or SQL text.
 */
export function createAlertSender(
  env: Record<string, string | undefined> = process.env
): AlertSend | null {
  const raw = env.OPS_ALERT_WEBHOOK_URL;
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('ALERT_RECEIVER_INVALID');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
    throw new Error('ALERT_RECEIVER_INVALID');
  return async (message) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': message.deliveryId ?? `${message.key}:${message.state}`
      },
      redirect: 'error',
      body: JSON.stringify({
        text: `[padel-friend] ${message.state === 'open' ? 'ALERT' : 'RESOLVED'} ${message.severity} ${message.source} ${message.reference}`,
        ...message
      }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (!response.ok) throw new Error('ALERT_RECEIVER_REJECTED');
  };
}

function failureEvent(signal: Signal | undefined): DiagnosticEvent {
  if (signal?.source === 'push') return 'push.failure';
  if (signal?.source === 'repair') return 'replay.fail';
  if (signal?.source === 'processing') return 'result.confirm';
  return 'scheduled.sweep';
}

// Reconciliation applies a signal snapshot to durable alert state, so a snapshot read earlier must
// never land after a newer one (it could resolve or reopen a failure the newer read already settled).
// Workers isolates cannot coordinate in memory: the database reads the signals and reconciles them
// in one transaction behind an advisory lock. Delivery stays outside it, fenced by its own leases.
async function readAndReconcile(client: AdminClient) {
  const result = await client.rpc('reconcile_current_operational_alerts');
  if (result.error || !isRecord(result.data)) throw new Error('ALERT_SIGNALS_UNAVAILABLE');
  return { signals: decodeSignals(result.data.signals), reconciled: result.data };
}

export async function sweepOperationalAlerts(client: AdminClient, send: AlertSend | null) {
  const { signals, reconciled } = await readAndReconcile(client);
  const byKey = new Map(signals.map((signal) => [signal.key, signal]));
  const open = decodePending(reconciled.open);
  const resolved = decodePending(reconciled.resolved);
  const counters = { sent: 0, failed: 0, pending: open.length + resolved.length };
  // Durable failure diagnostics must not depend on transport configuration or receipt.
  for (const message of open) {
    const signal = byKey.get(message.key);
    if (signal)
      emitDiagnostic(failureEvent(signal), 'failure', {
        code: signal.code,
        reference: message.reference,
        source: message.source
      });
  }
  if (counters.pending > 0 && !send) {
    emitDiagnostic('alert.send', 'failure', {
      code: 'ALERT_RECEIVER_UNCONFIGURED',
      count: counters.pending
    });
    return counters;
  }
  const deliveries = [
    ...open.map((item) => ({ ...item, state: 'open' as const })),
    ...resolved.map((item) => ({ ...item, state: 'resolved' as const }))
  ];
  await Promise.allSettled(
    deliveries.map(async (message) => {
      const token = crypto.randomUUID();
      try {
        const claim = await client.rpc('claim_operational_alert', {
          p_key: message.key,
          p_resolution: message.state === 'resolved',
          p_token: token
        });
        if (claim.error) throw new Error('ALERT_SIGNALS_UNAVAILABLE');
        if (!claim.data) return;
        await send!(message);
        const marked = await client.rpc('mark_operational_alert_sent', {
          p_key: message.key,
          p_resolution: message.state === 'resolved',
          p_token: token
        });
        if (marked.error || !marked.data) throw new Error('ALERT_DELIVERY_FENCE_LOST');
        counters.sent++;
        emitDiagnostic('alert.send', 'success', { source: message.source, status: message.state });
      } catch (error) {
        await client.rpc('release_operational_alert', { p_key: message.key, p_token: token }).then(
          () => undefined,
          () => undefined
        );
        counters.failed++;
        emitDiagnostic('alert.send', 'failure', {
          code: safeErrorCode(error),
          source: message.source,
          status: message.state
        });
      }
    })
  );
  return counters;
}

export async function sweepOperationalAlertsOnSchedule(
  client: AdminClient = getAdminClient(),
  env: Record<string, string | undefined> = process.env
) {
  let send: AlertSend | null = null;
  try {
    send = createAlertSender(env);
  } catch (error) {
    emitDiagnostic('alert.send', 'failure', { code: safeErrorCode(error) });
  }
  return sweepOperationalAlerts(client, send);
}
