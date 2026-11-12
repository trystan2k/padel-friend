import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_CONTAINER,
  RESTORE_PREFIX,
  assertDisposableDatabase,
  createDocker,
  diffFingerprints,
  dropDatabase,
  listDumpToc,
  provisionDatabase,
  schemaFingerprint,
  sha256
} from './release-rehearsal-lib.mjs';

// Scripted backup/restore rehearsal (PRD §58). Dumps the source database from the LOCAL Supabase
// container, restores it into a disposable database, and compares row counts and content
// checksums of every application table plus the auth identity rows, the RPC/table grants and
// policies, and representative authorized reads. The source is only ever read. Runs at least
// twice into separate destinations. The dump lives in memory only: nothing is written to disk,
// so no production data, secret or dump can reach git.
//
//   node scripts/release-backup-restore.mjs --confirm-disposable restore_rehearsal_<id>
//        [--source-db postgres] [--runs 2] [--container supabase_db_padel-friend-test] [--require-representative]

const AUTH_TABLES = ['auth.users', 'auth.identities', 'supabase_migrations.schema_migrations'];
const REPRESENTATIVE_MINIMUMS = {
  'public.statistics_group_facts': 2,
  'public.player_rating_events': 1,
  'public.notifications': 1,
  'public.notification_push_jobs': 1,
  'public.league_standings_snapshots': 1,
  'public.result_repair_jobs': 1
};

export function parseArgs(argv) {
  const options = {
    runs: 2,
    requireRepresentative: false,
    container: DEFAULT_CONTAINER,
    source: 'postgres'
  };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--require-representative') options.requireRepresentative = true;
    else if (['--confirm-disposable', '--source-db', '--runs', '--container'].includes(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
      if (flag === '--confirm-disposable') options.confirm = value;
      else if (flag === '--source-db') options.source = value;
      else if (flag === '--container') options.container = value;
      else options.runs = Number(value);
    } else throw new Error(`Unknown argument ${flag}`);
  }
  if (!Number.isInteger(options.runs) || options.runs < 2)
    throw new Error('--runs must be an integer >= 2 (restore is exercised at least twice)');
  if (!options.confirm) throw new Error('--confirm-disposable <restore_rehearsal_id> is required');
  return options;
}

function dataFingerprint(docker, database) {
  const tables = docker
    .sql(
      database,
      "select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' order by 1"
    )
    .split('\n')
    .filter(Boolean)
    .concat(AUTH_TABLES);
  const entries = tables.map(
    (table) =>
      `select '${table}' as k, (select jsonb_build_object('rows', count(*), 'md5', md5(coalesce(string_agg(t::text, E'\\n' order by t::text), ''))) from ${table} t) as v`
  );
  return JSON.parse(
    docker.sql(
      database,
      `select jsonb_object_agg(k, v)::text from (${entries.join('\nunion all\n')}) s;`
    )
  );
}

function authorizedReads(docker, database, userIds) {
  return Object.fromEntries(
    userIds.map((id) => [
      sha256(id).slice(0, 12),
      docker
        .sql(
          database,
          `set local role authenticated;
           select set_config('request.jwt.claims', '{"sub":"${id}","role":"authenticated"}', true) is not null;
           select jsonb_build_object(
             'notifications', (select count(*) from public.notifications),
             'unread', (select count(*) from public.notifications where read_at is null),
             'matches', (select count(*) from public.match_events),
             'ratings', (select count(*) from public.global_player_ratings))::text;`
        )
        .split('\n')
        .at(-1)
    ])
  );
}

function disableDispatch(docker, database) {
  const retired = Number(
    docker.sql(
      database,
      `with moved as (update public.notification_push_jobs set status = 'exhausted', claim_token = null, lease_expires_at = null
          where status in ('pending', 'leased') returning 1) select count(*) from moved;`
    )
  );
  const cronAbsent = docker.sql(database, "select to_regclass('cron.job') is null") === 't';
  return { pushJobsRetired: retired, cronAbsent };
}

export function runRestoreRehearsal({
  docker = createDocker(),
  source = 'postgres',
  base,
  confirm,
  runs = 2,
  requireRepresentative = false,
  now = () => Date.now(),
  log = (line) => console.error(`[release-rehearsal] ${line}`)
}) {
  if (source !== 'postgres') throw new Error('Only the local postgres source is supported');
  if (runs < 2) throw new Error('Restore must be exercised at least twice');
  const destinations = Array.from({ length: runs }, (_, index) =>
    assertDisposableDatabase({
      name: `${base}_${index + 1}`,
      prefix: RESTORE_PREFIX,
      source,
      confirmation: confirm === base ? `${base}_${index + 1}` : undefined
    })
  );
  const startedAt = new Date(now()).toISOString();
  const before = dataFingerprint(docker, source);
  const sourceSchema = schemaFingerprint(docker, source);
  const users = docker
    .sql(
      source,
      'select recipient_user_id from public.notifications group by 1 order by count(*) desc, 1 limit 3'
    )
    .split('\n')
    .filter(Boolean);
  const sourceReads = authorizedReads(docker, source, users);
  const representative = Object.fromEntries(
    Object.keys(REPRESENTATIVE_MINIMUMS).map((table) => [table, before[table].rows])
  );
  const sparse = Object.entries(REPRESENTATIVE_MINIMUMS)
    .filter(([table, min]) => before[table].rows < min)
    .map(([table]) => table);
  if (requireRepresentative && sparse.length)
    throw new Error(`Source is not representative; too few rows in ${sparse.join(', ')}`);
  // One dump and one filtered TOC are shared by every restore, so all runs restore identical
  // input. A failure here throws before any destination is provisioned.
  const dumpStarted = now();
  // Invocation-owned container paths: concurrent rehearsals must not overwrite each other, and the
  // staged files are removed on every exit path.
  const artifactId = randomUUID();
  const dumpPath = `/tmp/release-rehearsal-${artifactId}.dump`;
  const tocPath = `/tmp/release-rehearsal-${artifactId}.toc`;
  const results = [];
  let dumpMs = 0;
  try {
    const dump = docker.dump(source, [
      '-Fc',
      '--no-owner',
      '-n',
      'public',
      '-n',
      'auth',
      '-n',
      'supabase_migrations'
    ]);
    // Platform-owned default privileges (other roles' ALTER DEFAULT PRIVILEGES) belong to the
    // platform image, not the application backup, so they are left out of the restore list.
    const toc = listDumpToc(docker, dump, dumpPath)
      .split('\n')
      .filter((line) => !line.includes('DEFAULT ACL'))
      .join('\n');
    docker.exec(['sh', '-c', 'cat > "$1"', 'sh', tocPath], { input: toc });
    // dumpMs: one-time cost of the shared dump plus its staged, filtered TOC. Not part of restoreMs.
    dumpMs = now() - dumpStarted;
    const dumpSha256 = sha256(dump);
    for (const destination of destinations) {
      const started = now();
      provisionDatabase(docker, destination);
      try {
        docker.sql(destination, 'drop schema public cascade;');
        docker.restore(destination, dump, ['--exit-on-error', `--use-list=${tocPath}`]);
        const restoreMs = now() - started;
        const restored = dataFingerprint(docker, destination);
        const mismatched = Object.keys(before).filter(
          (table) => JSON.stringify(before[table]) !== JSON.stringify(restored[table])
        );
        const schemaDiff = diffFingerprints(sourceSchema, schemaFingerprint(docker, destination));
        const restoredReads = authorizedReads(docker, destination, users);
        const readsMatch = JSON.stringify(sourceReads) === JSON.stringify(restoredReads);
        const dispatch = disableDispatch(docker, destination);
        const pass = !mismatched.length && !schemaDiff.length && readsMatch && dispatch.cronAbsent;
        log(`[${pass ? 'PASS' : 'FAIL'}] ${destination}`);
        results.push({
          destination,
          // Same value in every run: all runs restore the one shared dump.
          dumpSha256,
          dumpBytes: dump.length,
          // Per-run provision + restore only; the shared dump time is reported once as dumpMs.
          restoreMs,
          tablesCompared: Object.keys(before).length,
          mismatchedTables: mismatched,
          schemaDiff,
          authorizedReads: { users: users.length, match: readsMatch },
          dispatchDisabled: dispatch,
          pass
        });
      } finally {
        dropDatabase(docker, destination);
      }
    }
  } finally {
    // Cleanup must never mask the primary outcome: report its failure and keep the original.
    try {
      docker.exec(['rm', '-f', dumpPath, tocPath]);
    } catch (cleanupError) {
      log(
        `[WARN] failed to remove staged artifacts ${dumpPath} ${tocPath}: ${
          cleanupError instanceof Error ? cleanupError.message : 'unknown error'
        }`
      );
    }
  }
  const sourceStable = JSON.stringify(dataFingerprint(docker, source)) === JSON.stringify(before);
  return {
    startedAt,
    source,
    dumpMs,
    runs: results,
    representative,
    sparseTables: sparse,
    sourceStable,
    pass: results.every((run) => run.pass) && sourceStable
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = runRestoreRehearsal({
      docker: createDocker({ container: options.container }),
      source: options.source,
      base: options.confirm,
      confirm: options.confirm,
      runs: options.runs,
      requireRepresentative: options.requireRepresentative,
      log: (line) => console.error(line)
    });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.pass ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Restore rehearsal failed');
    process.exitCode = 1;
  }
}
