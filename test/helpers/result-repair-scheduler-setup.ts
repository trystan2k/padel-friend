import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

const JOB_NAMES = ['padel-friend-result-repair-claim', 'padel-friend-result-repair-run'];
type SchedulerJob = { jobid: number; active: boolean };

/** Keep real cron from claiming test-owned repair jobs; restore exact prior settings afterward. */
export default async function setupResultRepairScheduler(): Promise<
  (() => Promise<void>) | undefined
> {
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const connectionString = status
    .match(/^DB_URL=(.*)$/m)?.[1]
    ?.trim()
    .replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
  if (!connectionString) throw new Error('Supabase status did not report DB_URL');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(connectionString).hostname)) {
    throw new Error('Integration scheduler isolation requires a local database');
  }
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
