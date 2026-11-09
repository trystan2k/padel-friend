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

type WorkerContext = { waitUntil: (promise: Promise<unknown>) => void };

const REQUEST_ID_HEADER = 'X-Request-Id';

// Headers of a handler-built Response may be immutable (redirects, fetched assets): mutate in
// place when allowed, otherwise copy. The copy keeps the body stream and every Set-Cookie.
function withRequestId(response: Response, requestId: string) {
  try {
    response.headers.set(REQUEST_ID_HEADER, requestId);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    copy.headers.set(REQUEST_ID_HEADER, requestId);
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
    return runWithDiagnostics({ kind: 'request', id: requestId }, async () => {
      try {
        const response = await handler.fetch(...args);
        return withRequestId(applyPrivateResponsePolicy(args[0], response), requestId);
      } catch (error) {
        emitDiagnostic('request.failure', 'failure', { code: safeErrorCode(error) });
        return withRequestId(
          new Response(null, { status: 500, headers: { 'Cache-Control': 'private, no-store' } }),
          requestId
        );
      }
    });
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
