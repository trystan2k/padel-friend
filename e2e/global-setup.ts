import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

// The match-event suites share one local database with every integration fixture run, and
// Available is a global limit-20 listing ordered by start time. Integration suites run before
// E2E in the same quality gate and leave dozens of future-dated fixture events behind, which
// would push freshly published events past the first page. This setup runs ONCE before any
// worker starts (no test has published anything yet, so a full prune is race-free) and only
// ever runs against the loopback local stack.

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

export default function globalSetup(): Promise<void> {
  assertLocalSupabase();
  const sql =
    `do $$ begin ` +
    `alter table public.match_event_invites disable trigger match_invite_immutable; ` +
    `alter table public.match_event_registrations disable trigger match_registration_immutable; ` +
    `alter table public.match_events disable trigger match_event_immutable; ` +
    `delete from public.match_event_invites; ` +
    `delete from public.match_event_registrations; ` +
    `delete from public.match_events; ` +
    `alter table public.match_event_invites enable trigger match_invite_immutable; ` +
    `alter table public.match_event_registrations enable trigger match_registration_immutable; ` +
    `alter table public.match_events enable trigger match_event_immutable; ` +
    `end $$;`;
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
