import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PREDECESSOR = '20261016120300';
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SEED = 'test/fixtures/matches-predecessor-upgrade.sql';
const ASSERTIONS = 'test/fixtures/matches-upgrade-assertions.sql';
const MIGRATIONS = readdirSync(path.join(ROOT, 'supabase/migrations'))
  .filter((name) => /^\d+_.*\.sql$/.test(name))
  .sort()
  .map((name) => name.slice(0, name.indexOf('_')));

function fullHistorySql() {
  const expected = MIGRATIONS.map((version) => `'${version}'`).join(',');
  return `do $history$ begin
    if (select count(distinct version) from supabase_migrations.schema_migrations where version::text in (${expected})) <> ${MIGRATIONS.length} then
      raise exception 'migration history is missing a repository migration';
    end if;
    if (select max(version)::text from supabase_migrations.schema_migrations) <> '${MIGRATIONS.at(-1)}' then
      raise exception 'migration history does not end at final repository migration';
    end if;
  end $history$;`;
}

export function databaseHost(status) {
  const value = status.match(/^DB_URL=(.*)$/m)?.[1]?.replace(/^"|"$/g, '');
  if (!value) throw new Error('Supabase status did not report DB_URL');
  let host;
  try {
    host = new URL(value).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    throw new Error('Supabase DB_URL is invalid');
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new Error(`Refusing non-loopback Supabase database host: ${host}`);
  }
  return host;
}

export function runHarness({ env = process.env, run = spawnSync, log = console } = {}) {
  if (env.POPULATED_UPGRADE_OPT_IN !== '1')
    throw new Error('Set POPULATED_UPGRADE_OPT_IN=1 to opt into disposable local backend test');
  if (!env.CI) throw new Error('Refusing populated migration test outside CI');

  const execute = (args, options = {}) => {
    const result = run('pnpm', ['exec', 'supabase', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      ...options
    });
    if (result.error) throw result.error;
    return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  const must = (label, args) => {
    log.log(`[assert] ${label}`);
    const result = execute(args);
    log.log(result.stdout);
    if (result.stderr) log.log(result.stderr);
    if (result.status !== 0) throw new Error(`${args.join(' ')} failed (${result.status})`);
    log.log(`[PASS] ${label}`);
    return result.stdout;
  };
  let originalError;
  let restorationError;
  let started = false;
  try {
    const status = must('Supabase CLI status resolves local DB', ['status', '-o', 'env']);
    databaseHost(status);
    log.log('[assert] database host is loopback');
    // GitHub supplies a per-job local Supabase service. Schema-level data checks
    // cannot run before the predecessor reset because a fresh DB may have no app tables yet.
    started = true;

    must('reset to predecessor without seed', [
      'db',
      'reset',
      '--local',
      '--version',
      PREDECESSOR,
      '--no-seed'
    ]);
    const preflight = must('predecessor schema/history and legacy trigger; new columns absent', [
      'db',
      'query',
      '--local',
      `do $check$ begin
      if (select version from supabase_migrations.schema_migrations order by version desc limit 1) is distinct from '${PREDECESSOR}' then raise exception 'history does not end at predecessor'; end if;
      if not exists (select 1 from pg_catalog.pg_trigger where tgname='match_registration_immutable' and not tgisinternal) then raise exception 'legacy trigger missing'; end if;
      if exists (select 1 from information_schema.columns where table_schema='public' and table_name='match_event_registrations' and column_name in ('accepted_order','lifecycle','participation_status','registration_source')) then raise exception 'new registration columns unexpectedly exist'; end if;
    end $check$;`
    ]);
    void preflight;
    log.log('[assert] predecessor history, legacy trigger, and absent new columns verified');
    must('apply committed predecessor fixture', [
      'db',
      'query',
      '--local',
      '--file',
      path.join(ROOT, SEED)
    ]);
    must('apply repository migrations using migration up', ['migration', 'up', '--local']);
    must('all repository migrations including final roster migration are recorded', [
      'db',
      'query',
      '--local',
      fullHistorySql()
    ]);
    must('assert upgraded fixture', [
      'db',
      'query',
      '--local',
      '--file',
      path.join(ROOT, ASSERTIONS)
    ]);
    must('second migration up is a no-op', ['migration', 'up', '--local']);
    must('second run leaves complete history with no pending repository migrations', [
      'db',
      'query',
      '--local',
      fullHistorySql()
    ]);
    must('repeated migration up preserves fixture snapshot', [
      'db',
      'query',
      '--local',
      'select public.paf_upgrade_assert_snapshot()'
    ]);
  } catch (error) {
    originalError = error;
  } finally {
    if (started) {
      const restore = execute(['db', 'reset', '--local']);
      log.log('[restore] pnpm exec supabase db reset --local');
      log.log(restore.stdout);
      if (restore.stderr) log.log(restore.stderr);
      if (restore.status !== 0) {
        restorationError = new Error(`Latest-schema restore failed (${restore.status})`);
      }
      if (!restorationError) log.log('[assert] backend restored to latest migration');
    }
  }
  if (restorationError) {
    if (originalError) restorationError.cause = originalError;
    throw restorationError;
  }
  if (originalError) throw originalError;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runHarness();
  } catch (error) {
    console.error(`[populated-migration-up] ${error.message}`);
    process.exitCode = 1;
  }
}
