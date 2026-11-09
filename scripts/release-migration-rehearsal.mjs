import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  DEFAULT_CONTAINER,
  MIGRATION_PREFIX,
  assertDisposableDatabase,
  createDocker,
  diffFingerprints,
  dropDatabase,
  provisionDatabase,
  schemaFingerprint
} from './release-rehearsal-lib.mjs';

// Migration rehearsal (PRD §58) in a DISPOSABLE database: the platform base (auth/storage
// structure) is cloned from the local source, repository migrations are applied up to a populated
// predecessor, a committed fixture is seeded, the remaining migrations are applied, and the result
// is compared with the source database that was built by the normal local flow. It also rehearses
// failed-migration recovery: a failing migration rolls back whole (forward-only), then a corrected
// forward migration applies. Nothing here touches the source database except reading it.
//
//   node scripts/release-migration-rehearsal.mjs --confirm-disposable migration_rehearsal_<id>
//        [--source-db postgres] [--container supabase_db_padel-friend]

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
// Populated predecessor (PAF-12): League tables exist; the League projection and every later
// migration (statistics, reviews, repairs, Push, alerts) is applied on top of populated rows.
export const PREDECESSOR = '20261101194000';
const SEED = 'test/fixtures/league-projection-predecessor-upgrade.sql';
const ASSERTIONS = 'test/fixtures/league-projection-upgrade-assertions.sql';
const PRESERVED = {
  'auth.users': 'id',
  'public.player_profiles': 'user_id',
  'public.match_events': 'id',
  'public.match_event_audit_log': 'id',
  'public.match_event_result_proposals': 'id'
};
const FAILING_MIGRATION = `create table public.zz_rehearsal_partial (id integer primary key);
alter table public.zz_rehearsal_missing add column nope integer;`;
const FORWARD_FIX = 'create table public.zz_rehearsal_partial (id integer primary key);';

export function parseArgs(argv) {
  const options = { container: DEFAULT_CONTAINER, source: 'postgres', checkTypes: false };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--check-types') {
      options.checkTypes = true;
      continue;
    }
    if (!['--confirm-disposable', '--source-db', '--container'].includes(flag))
      throw new Error(`Unknown argument ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
    if (flag === '--confirm-disposable') options.confirm = value;
    else if (flag === '--source-db') options.source = value;
    else options.container = value;
  }
  if (!options.confirm)
    throw new Error('--confirm-disposable <migration_rehearsal_id> is required');
  return options;
}

export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort()
    .map((name) => ({ version: name.slice(0, name.indexOf('_')), file: path.join(dir, name) }));
}

function cloneBase(docker, source, destination) {
  const dump = docker.dump(source, [
    '-Fc',
    '-s',
    '--no-owner',
    '-n',
    'auth',
    '-n',
    'storage',
    '-n',
    'supabase_migrations'
  ]);
  // Objects the APPLICATION added to platform schemas are re-created by its own migrations.
  const appTriggers = docker
    .sql(
      source,
      `select t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where not t.tgisinternal and p.pronamespace = 'public'::regnamespace
          and t.tgrelid::regclass::text ~ '^(auth|storage)\\.'`
    )
    .split('\n')
    .filter(Boolean);
  const toc = String(docker.exec(['pg_restore', '-l'], { input: dump }))
    .split('\n')
    .filter(
      (line) =>
        !line.includes('DEFAULT ACL') &&
        !/ POLICY storage /.test(line) &&
        !appTriggers.some((name) => new RegExp(` TRIGGER (auth|storage) \\S+ ${name} `).test(line))
    )
    .join('\n');
  docker.exec(['sh', '-c', 'cat > /tmp/release-migration.toc'], { input: toc });
  docker.restore(destination, dump, ['--exit-on-error', '--use-list=/tmp/release-migration.toc']);
}

function apply(docker, database, { version, file }) {
  docker.sqlFile(database, readFileSync(file, 'utf8'));
  docker.sql(
    database,
    `insert into supabase_migrations.schema_migrations(version) values ('${version}');`
  );
}

function preservedColumns(docker, database) {
  return Object.fromEntries(
    Object.keys(PRESERVED).map((table) => {
      const [schema, name] = table.split('.');
      return [
        table,
        docker.sql(
          database,
          `select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
           from information_schema.columns where table_schema = '${schema}' and table_name = '${name}'`
        )
      ];
    })
  );
}

function preservedFingerprint(docker, database, columns) {
  return Object.fromEntries(
    Object.keys(PRESERVED).map((table) => [
      table,
      docker.sql(
        database,
        `select count(*)||':'||md5(coalesce(string_agg(to_jsonb(t)::text, E'\n' order by to_jsonb(t)::text), ''))
           from (select ${columns[table]} from ${table}) t`
      )
    ])
  );
}

export function runMigrationRehearsal({
  docker = createDocker(),
  source = 'postgres',
  destination,
  confirm,
  checkTypes = false,
  now = () => Date.now(),
  log = () => undefined
}) {
  if (source !== 'postgres') throw new Error('Only the local postgres source is supported');
  assertDisposableDatabase({
    name: destination,
    prefix: MIGRATION_PREFIX,
    source,
    confirmation: confirm
  });
  const files = migrationFiles();
  const split = files.findIndex((entry) => entry.version > PREDECESSOR);
  const started = now();
  const report = { destination, predecessor: PREDECESSOR, migrations: files.length, steps: [] };
  const step = (name, detail = {}) => {
    report.steps.push({ name, ...detail });
    log(`[PASS] ${name}`);
  };
  provisionDatabase(docker, destination);
  try {
    cloneBase(docker, source, destination);
    step('platform base cloned from source structure');
    files.slice(0, split).forEach((entry) => apply(docker, destination, entry));
    step('migrations applied up to populated predecessor', { applied: split });
    docker.sqlFile(destination, readFileSync(path.join(ROOT, SEED), 'utf8'));
    const columns = preservedColumns(docker, destination);
    const before = preservedFingerprint(docker, destination, columns);
    step('predecessor fixture seeded', { preserved: before });
    files.slice(split).forEach((entry) => apply(docker, destination, entry));
    step('remaining migrations applied over populated data', { applied: files.length - split });
    docker.sqlFile(destination, readFileSync(path.join(ROOT, ASSERTIONS), 'utf8'));
    step('upgrade assertions (source rows, readers, projections) passed');
    // The fixture's own before-snapshot table is test scaffolding, not part of the schema contract.
    docker.sql(destination, 'drop table if exists public.paf_league_upgrade_snapshot_before;');
    const after = preservedFingerprint(docker, destination, columns);
    const changed = Object.keys(before).filter((table) => before[table] !== after[table]);
    if (changed.length)
      throw new Error(`Preserved source/audit rows changed: ${changed.join(', ')}`);
    step('preserved source/audit rows identical after upgrade', { preserved: after });
    const diff = diffFingerprints(
      schemaFingerprint(docker, source),
      schemaFingerprint(docker, destination)
    );
    // A drifted development database is evidence, not the migration oracle. Still run the
    // failure/forward-fix drill before reporting drift as a failed rehearsal. Never change
    // the shared source to make this comparison pass.
    report.liveSchemaDrift = diff;
    if (!diff.length)
      step('RPC grants, table grants, policies and functions equal the live migrated schema');
    if (checkTypes) {
      const generate = (args) => {
        const generated = spawnSync(
          'pnpm',
          ['exec', 'supabase', 'gen', 'types', 'typescript', ...args, '--schema', 'public'],
          { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
        );
        if (generated.status !== 0 || !generated.stdout.includes('operational_job_events'))
          throw new Error(
            `Disposable schema type generation failed (exit ${generated.status}, output ${generated.stdout.slice(0, 500)}): ${generated.stderr.replace(/postgresql:\/\/\S+/g, '[local-db]').slice(0, 1200)}`
          );
        return generated.stdout;
      };
      // Repository's local port only; never assume Supabase's default (another project
      // can own it). URL accepts neither a hosted server nor an arbitrary caller target.
      const port = readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8').match(
        /\[db\][\s\S]*?^port\s*=\s*(\d+)/m
      )?.[1];
      if (!port || Number(port) < 1 || Number(port) > 65535)
        throw new Error('Local database port missing');
      const upgraded = generate([
        '--db-url',
        `postgresql://postgres:postgres@127.0.0.1:${port}/${destination}?sslmode=disable`
      ]);
      const live = generate(['--local']);
      if (upgraded !== live)
        throw new Error('Disposable public types differ from live migrated schema');
      step('live disposable public-schema generated types match live migrated source');
    }
    let failed = false;
    try {
      docker.sqlFile(destination, FAILING_MIGRATION);
    } catch {
      failed = true;
    }
    const partial = docker.sql(
      destination,
      "select to_regclass('public.zz_rehearsal_partial') is not null"
    );
    const versions = docker.sql(
      destination,
      'select count(*) from supabase_migrations.schema_migrations'
    );
    if (!failed || partial !== 'f' || Number(versions) !== files.length)
      throw new Error('Failed migration did not roll back atomically');
    step('failed migration rolled back whole (no partial objects, history unchanged)');
    docker.sqlFile(destination, FORWARD_FIX);
    if (
      docker.sql(destination, "select to_regclass('public.zz_rehearsal_partial') is not null") !==
      't'
    )
      throw new Error('Forward-fix migration did not apply');
    step('forward-fix migration applied after the failure');
    report.pass = !report.liveSchemaDrift.length;
    if (!report.pass)
      report.error = `Live source schema drift: ${report.liveSchemaDrift.join(', ')}`;
  } catch (error) {
    report.pass = false;
    report.error =
      error instanceof Error ? error.message.slice(0, 600) : 'Migration rehearsal failed';
  } finally {
    dropDatabase(docker, destination);
  }
  report.elapsedMs = now() - started;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = runMigrationRehearsal({
      docker: createDocker({ container: options.container }),
      source: options.source,
      destination: options.confirm,
      confirm: options.confirm,
      checkTypes: options.checkTypes,
      log: (line) => console.error(line)
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Migration rehearsal failed');
    process.exitCode = 1;
  }
}
