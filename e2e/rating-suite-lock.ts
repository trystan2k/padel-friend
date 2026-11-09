import { execFileSync } from 'node:child_process';
import { Client } from 'pg';

// The rating projection is one global stream: its consistency gate counts every game group in the
// database and level approvals compare a global revision. Specs that confirm results, replay
// projections or approve reviews therefore cannot interleave with each other. A session-level
// advisory lock held from beforeAll to afterAll makes those files take turns across workers.
let holder: Client | undefined;

function localConnectionString(): string {
  const status = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const connectionString = status.match(/^DB_URL="?([^"\n]+)"?$/m)?.[1];
  if (
    !connectionString ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(connectionString).hostname)
  )
    throw new Error('Local database required');
  return connectionString;
}

const LOCK_WAIT_SECONDS = 120;
const LOCK_NOT_AVAILABLE = '55P03';

/**
 * Waits at most LOCK_WAIT_SECONDS for the other rating-sensitive spec files to finish, then fails fast
 * instead of stalling the worker for the whole beforeAll budget. Pair with releaseRatingSuite.
 */
export async function acquireRatingSuite(): Promise<void> {
  const client = new Client({
    connectionString: localConnectionString(),
    connectionTimeoutMillis: 5_000
  });
  await client.connect();
  try {
    await client.query(`set lock_timeout = '${LOCK_WAIT_SECONDS}s'`);
    await client.query(
      "select pg_advisory_lock(hashtextextended('padel-friend:e2e-rating-suite',0))"
    );
    holder = client;
  } catch (error) {
    await client.end().catch(() => undefined);
    if (error instanceof Error && 'code' in error && error.code === LOCK_NOT_AVAILABLE)
      throw new Error(
        `rating suite lock not acquired within ${LOCK_WAIT_SECONDS}s — another suite holds it`,
        { cause: error }
      );
    throw error;
  }
}

export async function releaseRatingSuite(): Promise<void> {
  const client = holder;
  holder = undefined;
  await client?.end();
}
