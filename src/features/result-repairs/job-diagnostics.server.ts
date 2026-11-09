import { getAdminClient, type AdminClient } from '../../lib/supabase/admin.server';
import {
  emitDiagnostic,
  runWithDiagnostics,
  type DiagnosticEvent
} from '../../lib/diagnostics.server';

export async function sweepJobDiagnosticsOnSchedule() {
  return sweepJobDiagnostics(getAdminClient());
}

const EVENTS: readonly DiagnosticEvent[] = [
  'result.confirm',
  'rating.failure',
  'replay.start',
  'replay.complete',
  'replay.fail'
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bounded committed evidence outbox. Original repair/processing ledgers remain authority.
 * Logging/acknowledgement happens outside sporting transactions; a failed sweep leaves backlog.
 * A crash after logging but before acknowledgement can repeat a job/attempt, never invent success.
 */
export async function sweepJobDiagnostics(client: AdminClient) {
  const result = await client.rpc('read_operational_job_events');
  if (result.error || !Array.isArray(result.data)) throw new Error('JOB_DIAGNOSTICS_UNAVAILABLE');
  const keys: string[] = [];
  for (const row of result.data) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      typeof row.event_key !== 'string' ||
      typeof row.event !== 'string' ||
      typeof row.reference !== 'string' ||
      !UUID.test(row.reference) ||
      typeof row.attempt !== 'number' ||
      !Number.isSafeInteger(row.attempt) ||
      row.attempt < 0 ||
      (row.outcome !== 'success' && row.outcome !== 'failure')
    )
      throw new Error('JOB_DIAGNOSTICS_INVALID');
    const event = EVENTS.find((candidate) => candidate === row.event);
    if (!event) throw new Error('JOB_DIAGNOSTICS_INVALID');
    const outcome = row.outcome;
    runWithDiagnostics({ kind: 'job', id: `${row.reference}:${row.attempt}` }, () =>
      emitDiagnostic(event, outcome, {
        reference: row.reference,
        attempt: row.attempt,
        code: row.code,
        stage: row.stage,
        source: 'database'
      })
    );
    keys.push(row.event_key);
  }
  if (keys.length) {
    const marked = await client.rpc('mark_operational_job_events', { p_keys: keys });
    if (marked.error) throw new Error('JOB_DIAGNOSTICS_UNAVAILABLE');
  }
  return keys.length;
}
