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
  const departures = env.POPULATED_UPGRADE_SCENARIO === 'departures';
  const ownership = env.POPULATED_UPGRADE_SCENARIO === 'ownership';
  const edits = env.POPULATED_UPGRADE_SCENARIO === 'edits';
  const reconfirmation = env.POPULATED_UPGRADE_SCENARIO === 'reconfirmation';
  if (env.POPULATED_UPGRADE_SCENARIO && !departures && !ownership && !edits && !reconfirmation)
    throw new Error('Unknown populated migration scenario');
  const predecessor = reconfirmation
    ? '20261021203000'
    : edits
      ? '20261021202000'
      : ownership
        ? '20261021201100'
        : departures
          ? '20261021200000'
          : PREDECESSOR;
  const seed = reconfirmation
    ? 'test/fixtures/matches-reconfirmation-predecessor.sql'
    : edits
      ? 'test/fixtures/matches-edits-predecessor.sql'
      : ownership
        ? 'test/fixtures/matches-ownership-predecessor.sql'
        : departures
          ? 'test/fixtures/matches-departures-predecessor.sql'
          : SEED;
  const assertions = reconfirmation
    ? 'test/fixtures/matches-reconfirmation-upgrade-assertions.sql'
    : edits
      ? 'test/fixtures/matches-edits-upgrade-assertions.sql'
      : ownership
        ? 'test/fixtures/matches-ownership-upgrade-assertions.sql'
        : departures
          ? 'test/fixtures/matches-departures-upgrade-assertions.sql'
          : ASSERTIONS;

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
    // CLI env output contains credentials; retain it only for loopback validation.
    if (args[0] !== 'status') log.log(result.stdout);
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
      predecessor,
      '--no-seed'
    ]);
    const preflight = must('predecessor schema/history and legacy trigger; new columns absent', [
      'db',
      'query',
      '--local',
      `do $check$ begin
      if (select version from supabase_migrations.schema_migrations order by version desc limit 1) is distinct from '${predecessor}' then raise exception 'history does not end at predecessor'; end if;
      if not exists (select 1 from pg_catalog.pg_trigger where tgname='${departures || ownership || edits || reconfirmation ? 'match_registration_identity_guard' : 'match_registration_immutable'}' and not tgisinternal) then raise exception 'legacy trigger missing'; end if;
      ${reconfirmation ? "if exists(select 1 from information_schema.columns where table_schema='public' and table_name='match_events' and column_name='reconfirmation_generation') then raise exception 'consent schema unexpectedly exists';end if;" : edits ? "if to_regprocedure('public.edit_match_event(uuid,bigint,jsonb,uuid)') is not null then raise exception 'edit RPC unexpectedly exists'; end if;" : `if exists (select 1 from information_schema.columns where table_schema='public' and table_name='match_event_registrations' and column_name in (${ownership ? "'cancelled_at'" : departures ? "'current_attempt_id','left_at','removed_by','removal_reason'" : "'accepted_order','lifecycle','participation_status','registration_source'"})) then raise exception 'new registration columns unexpectedly exist'; end if;`}
    end $check$;`
    ]);
    void preflight;
    log.log('[assert] predecessor history, legacy trigger, and absent new columns verified');
    must('apply committed predecessor fixture', [
      'db',
      'query',
      '--local',
      '--file',
      path.join(ROOT, seed)
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
      path.join(ROOT, assertions)
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
      ...(departures || ownership || edits || reconfirmation
        ? ['--file', path.join(ROOT, assertions)]
        : ['select public.paf_upgrade_assert_snapshot()'])
    ]);
  } catch (error) {
    originalError = error;
  } finally {
    if (started) {
      const restore = execute([
        'db',
        'reset',
        '--local',
        ...(departures || ownership || edits || reconfirmation ? ['--no-seed'] : [])
      ]);
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
