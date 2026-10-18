import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

export const FIXTURE_EMAIL_LIKE = '%@test.local';
const FIXTURE_USERS = `(select u.id from auth.users u where u.email ilike '${FIXTURE_EMAIL_LIKE}')`;

function uuidList(values: readonly string[]): string {
  for (const value of values) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`Refusing non-UUID fixture identity: ${value}`);
    }
  }
  return values.length === 0
    ? 'array[]::uuid[]'
    : `array[${values.map((value) => `'${value}'::uuid`).join(', ')}]`;
}

export type MatchFixtureOwner = { eventIds?: readonly string[]; actorIds?: readonly string[] };

export async function runCleanupTasks(tasks: readonly (() => Promise<unknown>)[]): Promise<void> {
  const outcomes = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)));
  const errors = outcomes.flatMap((outcome) =>
    outcome.status === 'rejected' ? [outcome.reason] : []
  );
  if (errors.length) throw new AggregateError(errors, 'One or more fixture cleanup tasks failed');
}

/** Trusted ownership-only SQL; materializes event IDs before notifications or events are deleted. */
export function buildMatchFixtureCleanupSql(owner: MatchFixtureOwner = {}): string {
  const actorPredicate = (column: string): string =>
    owner.actorIds === undefined
      ? `${column} in ${FIXTURE_USERS}`
      : `${column} = any(${uuidList(owner.actorIds)})`;
  const ids = owner.eventIds === undefined ? null : uuidList(owner.eventIds);
  const eventPredicate =
    ids === null
      ? actorPredicate('e.created_by')
      : `e.id = any(${ids}) and ${actorPredicate('e.created_by')}`;
  const events = `create temporary table if not exists owned_match_fixture_events (id uuid primary key) on commit drop; truncate table owned_match_fixture_events; insert into owned_match_fixture_events select e.id from public.match_events e where ${eventPredicate}`;
  return [
    events,
    'alter table public.match_event_invites disable trigger match_invite_immutable',
    'alter table public.match_event_registrations disable trigger match_registration_identity_guard',
    'alter table public.match_events disable trigger match_event_immutable',
    `delete from public.notifications n where (n.target_type = 'match_event' and n.target_id in (select id from owned_match_fixture_events)) or (n.category = 'matches' and ${actorPredicate('n.recipient_user_id')})`,
    `delete from public.match_event_registration_attempts a where a.match_event_id in (select id from owned_match_fixture_events) or ${actorPredicate('a.user_id')}`,
    'delete from public.match_event_registration_state s where s.match_event_id in (select id from owned_match_fixture_events)',
    `delete from public.match_event_invites i where i.match_event_id in (select id from owned_match_fixture_events) or ${actorPredicate('i.invitee_user_id')} or ${actorPredicate('i.invited_by')}`,
    `delete from public.match_event_registrations r where r.match_event_id in (select id from owned_match_fixture_events) or ${actorPredicate('r.user_id')}`,
    'delete from public.match_events e where e.id in (select id from owned_match_fixture_events)',
    'alter table public.match_event_invites enable trigger match_invite_immutable',
    'alter table public.match_event_registrations enable trigger match_registration_identity_guard',
    'alter table public.match_events enable trigger match_event_immutable'
  ].join('; ');
}

export const MATCH_FIXTURE_PRUNE_STATEMENTS = buildMatchFixtureCleanupSql();

export function assertLoopbackUrl(url: string | undefined): void {
  if (!url || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
    throw new Error('Match event cleanup requires loopback Supabase; refusing to prune');
  }
}

export function assertLocalSupabase(): void {
  const variables = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
      })
  );
  assertLoopbackUrl(
    process.env.VITE_SUPABASE_URL ??
      (variables.get('VITE_SUPABASE_URL') ?? '').replace(/^['"]|['"]$/g, '')
  );
}

export function runMatchFixtureCleanup(owner: MatchFixtureOwner = {}): Promise<void> {
  assertLocalSupabase();
  const sql = `do $$ begin ${buildMatchFixtureCleanupSql(owner)}; end $$;`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
      { cwd: process.cwd(), stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`Match event cleanup failed (${code}): ${stderr}`))
    );
  });
}

export function runMatchFixturePrune(): Promise<void> {
  return runMatchFixtureCleanup();
}
