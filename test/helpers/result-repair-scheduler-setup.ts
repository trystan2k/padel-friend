import { Client } from 'pg';
import { discoverTestDatabaseUrl } from '../../scripts/integration-db-url.mjs';

const JOB_NAMES = [
  'padel-friend-result-repair-claim',
  'padel-friend-result-repair-run',
  'padel-friend-result-amendment-auto-accept'
];
type SchedulerJob = { jobid: number; active: boolean };

/**
 * Keep real cron from claiming test-owned repair jobs and auto-accepting test-owned amendments
 * (which rewrites rating and statistics revisions mid-test); restore exact prior settings afterward.
 */
export default async function setupResultRepairScheduler(): Promise<
  (() => Promise<void>) | undefined
> {
  // Launcher handoff or the TEST stack's status via the pinned workdir; a missing/wrong test stack throws.
  const connectionString = discoverTestDatabaseUrl();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000
  });
  try {
    await client.connect();
    const available = await client.query<{ available: boolean }>(
      "select to_regclass('cron.job') is not null as available"
    );
    if (!available.rows[0]?.available) {
      await client.end();
      return undefined;
    }
    await client.query('begin');
    const jobs = await client.query<SchedulerJob>(
      'select jobid, active from cron.job where jobname = any($1::text[])',
      [JOB_NAMES]
    );
    for (const job of jobs.rows) {
      await client.query('select cron.alter_job(job_id := $1::bigint, active := $2::boolean)', [
        job.jobid,
        false
      ]);
    }
    await client.query('commit');
    return async () => {
      try {
        for (const job of jobs.rows) {
          await client.query('select cron.alter_job(job_id := $1::bigint, active := $2::boolean)', [
            job.jobid,
            job.active
          ]);
        }
      } finally {
        await client.end();
      }
    };
  } catch (error) {
    await client.end();
    throw error;
  }
}
