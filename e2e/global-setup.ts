import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The match-event suites share one local database with every integration fixture run, and
// Available is a global limit-20 listing ordered by start time. Integration suites run before
// E2E in the same quality gate and leave dozens of future-dated fixture events behind, which
// would push freshly published events past the first page. This setup runs ONCE before any
// worker starts (no test has published anything yet, so the prune is race-free) and only ever
// runs against the loopback local stack.
//
// The prune is scoped to rows the suites own: every integration and E2E suite signs its
// synthetic actors up through the dedicated `@test.local` email domain, so only match rows
// created by those accounts — or pointing at those accounts or their events — are removed.
// A developer's own local data (any other email address) never matches and always survives.

/** The dedicated email domain every test suite uses for its synthetic actors. */
export const FIXTURE_EMAIL_LIKE = '%@test.local';

const fixtureUserIds = `(select u.id from auth.users u where u.email ilike '${FIXTURE_EMAIL_LIKE}')`;
const fixtureEventIds = `(select e.id from public.match_events e where e.created_by in ${fixtureUserIds})`;

/**
 * Trusted-SQL statements that delete exactly the match rows the suites own: events created
 * by a fixture account, plus registrations and invites that belong to those events or point
 * at a fixture account in either direction. The immutable triggers are bypassed only around
 * the deletes. Exported so the prune-scoping guard test can replay these exact statements
 * inside a rolled-back transaction and prove non-fixture rows survive.
 */
export const MATCH_FIXTURE_PRUNE_STATEMENTS = [
  'alter table public.match_event_invites disable trigger match_invite_immutable',
  'alter table public.match_event_registrations disable trigger match_registration_immutable',
  'alter table public.match_events disable trigger match_event_immutable',
  `delete from public.match_event_invites i where i.match_event_id in ${fixtureEventIds} or i.invitee_user_id in ${fixtureUserIds} or i.invited_by in ${fixtureUserIds}`,
  `delete from public.match_event_registrations r where r.match_event_id in ${fixtureEventIds} or r.user_id in ${fixtureUserIds}`,
  `delete from public.match_events e where e.created_by in ${fixtureUserIds}`,
  'alter table public.match_event_invites enable trigger match_invite_immutable',
  'alter table public.match_event_registrations enable trigger match_registration_immutable',
  'alter table public.match_events enable trigger match_event_immutable'
].join('; ');

function assertLocalSupabase(): void {
  const variables = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
      })
  );
  const url =
    process.env.VITE_SUPABASE_URL ??
    (variables.get('VITE_SUPABASE_URL') ?? '').replace(/^['"]|['"]$/g, '');
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Match event cleanup requires loopback Supabase; refusing to prune');
}

/** Runs the fixture-scoped prune through the trusted local SQL harness. */
export function runMatchFixturePrune(): Promise<void> {
  const sql = `do $$ begin ${MATCH_FIXTURE_PRUNE_STATEMENTS}; end $$;`;
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Match event cleanup failed (${code}): ${stderr}`));
    });
  });
}

export default function globalSetup(): Promise<void> {
  assertLocalSupabase();
  return runMatchFixturePrune();
}
