import handler from '@tanstack/react-start/server-entry';
import { sweepJobDiagnosticsOnSchedule } from './features/result-repairs/job-diagnostics.server';
import { sweepOperationalAlertsOnSchedule } from './features/notifications/operational-alerts.server';
import { sweepMatchPlayerAddsOnSchedule } from './features/matches/match-add-player.server';
import { sweepNotificationPushOnSchedule } from './features/notifications/push-dispatch.server';
import {
  emitDiagnostic,
  newCorrelationId,
  runWithDiagnostics,
  safeErrorCode
} from './lib/diagnostics.server';
import { applyPrivateResponsePolicy } from './lib/private-response';
import { newCspNonce, runWithNonce, securityHeaders } from './lib/security-headers.server';

type WorkerContext = { waitUntil: (promise: Promise<unknown>) => void };

const REQUEST_ID_HEADER = 'X-Request-Id';

// Headers of a handler-built Response may be immutable (redirects, fetched assets): mutate in
// place when allowed, otherwise copy. The copy keeps the body stream and every Set-Cookie.
function withHeaders(response: Response, headers: Record<string, string>) {
  try {
    for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    for (const [name, value] of Object.entries(headers)) copy.headers.set(name, value);
    return copy;
  }
}

async function runSweep(name: string, sweep: () => Promise<unknown>) {
  const started = Date.now();
  try {
    await sweep();
    emitDiagnostic('scheduled.sweep', 'success', { job: name, durationMs: Date.now() - started });
  } catch (error) {
    emitDiagnostic('scheduled.sweep', 'failure', {
      job: name,
      code: safeErrorCode(error),
      durationMs: Date.now() - started
    });
    throw error;
  }
}

export default {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    // Ingress mints the correlation ID; a client-supplied one is never trusted or echoed.
    const requestId = newCorrelationId();
    // One unpredictable nonce per request, minted here and never taken from the client. It reaches
    // SSR through request-scoped storage (router.tsx) and the Start request context.
    const nonce = newCspNonce();
    const finalize = (response: Response) =>
      withHeaders(response, {
        [REQUEST_ID_HEADER]: requestId,
        ...securityHeaders(args[0].url, nonce)
      });
    return runWithDiagnostics({ kind: 'request', id: requestId }, () =>
      runWithNonce(nonce, async () => {
        try {
          const response = await handler.fetch(args[0], { context: { nonce } });
          return finalize(applyPrivateResponsePolicy(args[0], response));
        } catch (error) {
          emitDiagnostic('request.failure', 'failure', { code: safeErrorCode(error) });
          return finalize(
            new Response(null, { status: 500, headers: { 'Cache-Control': 'private, no-store' } })
          );
        }
      })
    );
  },
  scheduled(_controller: unknown, _env: unknown, ctx: WorkerContext) {
    // Start independently. A disabled/misconfigured Push channel must never starve player-add
    // recovery, and a dead alert receiver must never starve either. No HTTP request exists
    // here, so each cron run is its own correlation scope.
    ctx.waitUntil(
      runWithDiagnostics({ kind: 'job', id: newCorrelationId() }, () =>
        Promise.allSettled([
          runSweep('player-adds', () =>
            Promise.resolve().then(() => sweepMatchPlayerAddsOnSchedule())
          ),
          runSweep('push', () => Promise.resolve().then(() => sweepNotificationPushOnSchedule())),
          runSweep('diagnostics', () =>
            Promise.resolve().then(() => sweepJobDiagnosticsOnSchedule())
          ),
          runSweep('alerts', () => Promise.resolve().then(() => sweepOperationalAlertsOnSchedule()))
        ]).then((results) => {
          const failures = results.filter((result) => result.status === 'rejected');
          if (failures.length) throw new Error('SCHEDULED_SWEEP_FAILED');
        })
      )
    );
  }
};
