import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Shared guards and transport for the release-integrity rehearsals (backup/restore and
// migration). Every operation runs inside the LOCAL Supabase Postgres container through
// `docker exec`, so there is no code path that can address a hosted database: the only
// reachable server is the container's own loopback Postgres.

export const DEFAULT_CONTAINER = 'supabase_db_padel-friend';
export const RESTORE_PREFIX = 'restore_rehearsal_';
export const MIGRATION_PREFIX = 'migration_rehearsal_';
const CONTAINER_PATTERN = /^supabase_db_[a-z0-9_-]+$/;
const DISPOSABLE_SUFFIX = /^[a-z0-9_]{4,40}$/;
const PROTECTED_NAMES = /^(postgres|template0|template1|supabase|_supabase)$|prod|live|main/i;

export function assertLocalContainer(container) {
  if (container !== DEFAULT_CONTAINER || !CONTAINER_PATTERN.test(container))
    throw new Error(
      `Refusing database container "${container}": only a local supabase_db_* container is allowed`
    );
  return container;
}

/** A destination must carry the rehearsal prefix, never equal the source and be confirmed by name. */
export function assertDisposableDatabase({ name, prefix, source, confirmation }) {
  if (
    typeof name !== 'string' ||
    !name.startsWith(prefix) ||
    !DISPOSABLE_SUFFIX.test(name.slice(prefix.length))
  )
    throw new Error(
      `Refusing destination "${name}": it must be named ${prefix}<id> (lowercase letters, digits, _)`
    );
  if (name === source || PROTECTED_NAMES.test(name.slice(prefix.length)))
    throw new Error(
      `Refusing destination "${name}": it names a protected or production-like database`
    );
  if (confirmation !== name)
    throw new Error(`Destination not confirmed: pass --confirm-disposable ${name}`);
  return name;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function createDocker({ container = DEFAULT_CONTAINER, run = spawnSync } = {}) {
  assertLocalContainer(container);
  // Container names alone do not establish locality: Docker contexts can target remote hosts.
  // Resolve once and pin every operation to the verified local Unix socket.
  const context = run(
    'docker',
    ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
    { encoding: 'utf8' }
  );
  if (context.error || context.status !== 0) throw new Error('Local Docker context unavailable');
  const endpoint = JSON.parse(context.stdout.trim());
  if (typeof endpoint !== 'string' || !endpoint.startsWith('unix:///'))
    throw new Error('Refusing nonlocal Docker endpoint');
  const exec = (args, { input, encoding = 'utf8' } = {}) => {
    const result = run('docker', ['--host', endpoint, 'exec', '-i', container, ...args], {
      env: { ...process.env, DOCKER_CONTEXT: '', DOCKER_HOST: endpoint },
      input,
      encoding,
      maxBuffer: 1024 * 1024 * 512
    });
    if (result.error) throw result.error;
    if ((result.status ?? 1) !== 0) {
      const stderr = Buffer.isBuffer(result.stderr)
        ? result.stderr.toString('utf8')
        : (result.stderr ?? '');
      throw new Error(`docker exec ${args[0]} failed (${result.status}): ${stderr.slice(0, 500)}`);
    }
    return result.stdout;
  };
  /** Runs SQL (stdin) against one database; returns trimmed unaligned tuples. */
  const sql = (database, statement) =>
    String(
      exec(['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-q', '-1'], {
        input: statement
      })
    ).trim();
  const sqlFile = (database, content) =>
    exec(['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-1'], {
      input: content
    });
  const admin = (statement) =>
    exec(['psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', '-q'], {
      input: statement
    });
  const dump = (database, args) =>
    exec(['pg_dump', '-U', 'postgres', '-d', database, ...args], { encoding: 'buffer' });
  const restore = (database, data, args = []) =>
    exec(['pg_restore', '-U', 'postgres', '-d', database, '--no-owner', ...args], { input: data });
  return { container, exec, sql, sqlFile, admin, dump, restore };
}

/** Disposable database with the platform pieces migrations expect (extensions + default ACLs). */
export function provisionDatabase(docker, name) {
  // Never overwrite a pre-existing database, even if its name resembles a rehearsal.
  docker.admin(`create database "${name}";`);
  docker.sql(
    name,
    `create schema extensions;
     create extension pgcrypto with schema extensions;
     create extension "uuid-ossp" with schema extensions;
     alter default privileges for role postgres in schema public grant all on tables to postgres, anon, authenticated, service_role;
     alter default privileges for role postgres in schema public grant all on sequences to postgres, anon, authenticated, service_role;
     alter default privileges for role postgres in schema public grant all on functions to postgres, anon, authenticated, service_role;`
  );
}

export function dropDatabase(docker, name) {
  docker.admin(`drop database if exists "${name}" with (force);`);
}

/** Per-category digests of schema shape, grants and policies: equal digests = same reader/RPC surface. */
export const SCHEMA_FINGERPRINT_SQL = `
select jsonb_build_object(
  'columns', (select md5(coalesce(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable, E'\n' order by table_name, column_name), ''))
     from information_schema.columns where table_schema = 'public'),
  'functions', (select md5(coalesce(string_agg(p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)), E'\n' order by p.oid::regprocedure::text), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
  'rpcGrants', (select md5(coalesce(string_agg(p.oid::regprocedure::text||':'||coalesce(p.proacl, acldefault('f', p.proowner))::text, E'\n' order by p.oid::regprocedure::text), ''))
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
  'tableGrants', (select md5(coalesce(string_agg(c.relname||':'||coalesce(c.relacl, acldefault('r', c.relowner))::text||':'||c.relrowsecurity, E'\n' order by c.relname), ''))
     from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'),
  'policies', (select md5(coalesce(string_agg(tablename||':'||policyname||':'||cmd||':'||coalesce(qual, '')||':'||coalesce(with_check, ''), E'\n' order by tablename, policyname), ''))
     from pg_policies where schemaname = 'public'),
  'migrations', (select md5(coalesce(string_agg(version::text, ',' order by version), '')) from supabase_migrations.schema_migrations),
  'functionCount', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'),
  'tableCount', (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')
)::text;`;

export function schemaFingerprint(docker, database) {
  return JSON.parse(docker.sql(database, SCHEMA_FINGERPRINT_SQL));
}

export function diffFingerprints(left, right) {
  return Object.keys(left).filter(
    (key) => JSON.stringify(left[key]) !== JSON.stringify(right[key])
  );
}
