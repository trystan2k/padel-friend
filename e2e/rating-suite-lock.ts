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

/** Blocks until no other rating-sensitive spec file is running. Pair with releaseRatingSuite. */
export async function acquireRatingSuite(): Promise<void> {
  holder = new Client({
    connectionString: localConnectionString(),
    connectionTimeoutMillis: 5_000
  });
  await holder.connect();
  await holder.query(
    "select pg_advisory_lock(hashtextextended('padel-friend:e2e-rating-suite',0))"
  );
}

export async function releaseRatingSuite(): Promise<void> {
  const client = holder;
  holder = undefined;
  await client?.end();
}
