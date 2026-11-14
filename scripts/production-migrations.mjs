import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import * as nativeFS from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCredentials } from './production-release-guard.mjs';

const PROJECT = 'nojecmdknaebczpfnfwa';
const PUBLIC_URL = 'https://' + PROJECT + '.supabase.co';
const CONFIG =
  'project_id = "production-release"\n[db.migrations]\nenabled = true\nschema_paths = []\n[db.seed]\nenabled = false\nsql_paths = []\n';
const NAME = /^(\d{14})_([a-z0-9][a-z0-9_-]*)\.sql$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const text = (bytes) => Buffer.from(bytes).toString('utf8');

class MigrationError extends Error {}
const fail = (reason) => {
  throw new MigrationError(reason);
};

async function manifest(dir, fs) {
  if ((await fs.type(dir)) !== 'directory') fail('migration directory invalid');
  const files = [];
  const versions = new Set();
  for (const name of (await fs.list(dir)).sort()) {
    const match = NAME.exec(name);
    if (!match || name.includes('..')) fail('migration filename invalid');
    const version = match[1];
    if (versions.has(version)) fail('duplicate migration version');
    if (files.length === 0 && match[2] === 'init' && version < '20211209000000')
      fail('deprecated init migration unsupported');
    versions.add(version);
    const file = path.join(dir, name);
    if ((await fs.type(file)) !== 'file') fail('migration must be regular file');
    files.push({ name, version, hash: hash(await fs.read(file)) });
  }
  return files;
}

function same(actual, expected, reason) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail(reason);
}

function json(value) {
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('malformed CLI result');
  }
  if (
    !parsed ||
    Array.isArray(parsed) ||
    typeof parsed !== 'object' ||
    parsed.error ||
    Object.hasOwn(parsed, '_tag')
  )
    fail('malformed CLI result');
  return parsed;
}

// v2.121.0 source: commands/migration/list/list.format.ts. Applied history must be
// an exact prefix; remote-only versions, gaps, duplicates and reordered rows fail closed.
function pendingHistory(result, files) {
  if (!Array.isArray(result.migrations) || result.migrations.length !== files.length)
    fail('migration history inconsistent');
  let pending = false;
  const names = [];
  result.migrations.forEach((row, index) => {
    const file = files[index];
    if (
      !row ||
      row.local !== file.version ||
      !['', file.version].includes(row.remote) ||
      typeof row.time !== 'string'
    )
      fail('migration history inconsistent');
    if (row.remote === '') {
      pending = true;
      names.push(file.name);
    } else if (pending) fail('migration history out of order');
  });
  return names;
}

// v2.121.0 source: command-internal/db-push-core.ts + shared/output/output.layer.ts.
// JSON success is a flat object. Human stdout/stderr is never parsed as success.
function checkPush(result, expected, dryRun) {
  if (result.dryRun !== dryRun || result.upToDate !== (expected.length === 0))
    fail('unexpected migration plan');
  same(result.migrations, expected, 'unexpected migration plan');
  same(result.seeds, [], 'unexpected seed plan');
  same(result.roles, [], 'unexpected role plan');
}

async function linkedIdentity(root, fs) {
  const temp = path.join(root, 'supabase', '.temp');
  if ((await fs.type(temp)) !== 'directory') fail('linked metadata invalid');
  const read = async (name) => {
    const file = path.join(temp, name);
    if ((await fs.type(file)) !== 'file') fail('linked metadata invalid');
    return text(await fs.read(file)).trim();
  };
  if (
    (await read('project-ref')) !== PROJECT ||
    json(await read('linked-project.json')).ref !== PROJECT
  )
    fail('linked project mismatch');
  const pooler = path.join(temp, 'pooler-url');
  if (await fs.exists(pooler)) {
    let url;
    try {
      url = new URL(await read('pooler-url'));
    } catch {
      fail('linked routing invalid');
    }
    const user = decodeURIComponent(url.username);
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      url.password !== '' ||
      !/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname) ||
      url.port !== '5432' ||
      url.pathname !== '/postgres' ||
      url.hash !== '' ||
      user !== 'postgres.' + PROJECT ||
      [...url.searchParams].length !== 0
    )
      fail('linked routing invalid');
  }
}

const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const MARKER = /^Approved-pending:[ \t]*(.*?)[ \t]*\r?$/gm;

// Reviewer binding: the pre-approval review records the reviewed pending versions in the release
// body as one `Approved-pending: <v1>,<v2>` line (or `none`). Only versions and counts are surfaced.
function approvedPending(body, files) {
  if (typeof body !== 'string') fail('approved pending marker missing');
  const markers = [...body.matchAll(MARKER)];
  if (markers.length === 0) fail('approved pending marker missing');
  if (markers.length > 1) fail('approved pending marker ambiguous');
  const value = markers[0][1];
  if (value === 'none') return [];
  const versions = value.split(/\s*,\s*/);
  const known = new Set(files.map((file) => file.version));
  if (
    versions.some((version) => !/^\d{14}$/.test(version) || !known.has(version)) ||
    new Set(versions).size !== versions.length
  )
    fail('approved pending marker invalid');
  return versions.sort();
}

async function releaseBody({ env, fetch }) {
  const url =
    'https://api.github.com/repos/' +
    env.GITHUB_REPOSITORY +
    '/releases/tags/' +
    encodeURIComponent(env.RELEASE_TAG);
  let release;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + env.GITHUB_TOKEN,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error'
    });
    if (!response.ok) fail('release lookup failed');
    release = await response.json();
  } catch (error) {
    fail(error instanceof MigrationError ? error.message : 'release lookup failed');
  }
  if (
    !release ||
    Array.isArray(release) ||
    typeof release !== 'object' ||
    release.tag_name !== env.RELEASE_TAG ||
    release.draft !== false
  )
    fail('release identity mismatch');
  return release.body;
}

async function cleanup(root, fs) {
  try {
    await fs.remove(root);
  } catch {
    fail('cleanup: operation failed');
  }
}

/** All external boundaries required, not defaulted: tests cannot accidentally reach real IO. */
export async function runMigrations({ env, checkout, runnerTemp, fs, exec, fetch, out }) {
  let stage = 'preflight';
  let root;
  try {
    try {
      assertCredentials(env);
    } catch {
      fail('required credential missing');
    }
    if (env.VITE_SUPABASE_URL !== PUBLIC_URL) fail('public project URL mismatch');
    if (!/^sb_publishable_[\w-]+$/.test(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? ''))
      fail('publishable key invalid');
    if (
      typeof env.GITHUB_TOKEN !== 'string' ||
      env.GITHUB_TOKEN.trim() === '' ||
      !REPOSITORY.test(env.GITHUB_REPOSITORY ?? '') ||
      !RELEASE_TAG.test(env.RELEASE_TAG ?? '')
    )
      fail('release context invalid');
    if (!path.isAbsolute(checkout) || !path.isAbsolute(runnerTemp)) fail('workspace path invalid');
    // Never inherit PG*, SUPABASE_PROJECT_ID/profile/host overrides, release PAT, or Cloudflare
    // values. CLI reads only the fresh explicit workdir and an isolated, empty home.
    const childEnv = { PATH: env.PATH ?? '', CI: 'true', NO_COLOR: '1' };
    const command = (args, timeout = 120_000) => {
      let result;
      try {
        result = exec('pnpm', ['exec', 'supabase', ...args], {
          cwd: checkout,
          env: { ...childEnv },
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout,
          maxBuffer: 4 * 1024 * 1024
        });
      } catch {
        fail('CLI execution failed');
      }
      if (result.status !== 0) {
        const code =
          Number.isInteger(result.status) && result.status > 0 && result.status < 256
            ? result.status
            : 'unavailable';
        fail('CLI exit ' + code);
      }
      if (typeof result.stdout !== 'string' || typeof result.stderr !== 'string')
        fail('malformed CLI result');
      return result.stdout;
    };
    if (command(['--version'], 60_000).trim() !== '2.121.0') fail('CLI version mismatch');

    stage = 'workspace';
    if ((await fs.type(path.join(checkout, 'supabase'))) !== 'directory')
      fail('source directory invalid');
    const source = path.join(checkout, 'supabase', 'migrations');
    const files = await manifest(source, fs);
    root = await fs.mkdtemp(path.join(runnerTemp, 'production-migrations-'));
    if (
      path.dirname(root) !== runnerTemp ||
      !path.basename(root).startsWith('production-migrations-')
    )
      fail('workspace path invalid');
    const supabase = path.join(root, 'supabase');
    const copied = path.join(supabase, 'migrations');
    await fs.mkdir(copied);
    await fs.mkdir(path.join(root, 'home'));
    await fs.write(path.join(supabase, 'config.toml'), CONFIG);
    for (const file of files)
      await fs.write(path.join(copied, file.name), await fs.read(path.join(source, file.name)));
    same(await manifest(copied, fs), files, 'copied migration manifest mismatch');
    childEnv.HOME = path.join(root, 'home');
    childEnv.XDG_CONFIG_HOME = path.join(root, 'home', '.config');
    childEnv.SUPABASE_ACCESS_TOKEN = env.SUPABASE_ACCESS_TOKEN;
    childEnv.SUPABASE_DB_PASSWORD = env.SUPABASE_DB_PASSWORD;

    stage = 'project';
    const response = await fetch('https://api.supabase.com/v1/projects/' + PROJECT, {
      headers: { Authorization: 'Bearer ' + env.SUPABASE_ACCESS_TOKEN },
      signal: AbortSignal.timeout(30_000),
      redirect: 'error'
    });
    if (!response.ok) fail('project lookup failed');
    const project = await response.json();
    if (
      !project ||
      project.ref !== PROJECT ||
      project.status !== 'ACTIVE_HEALTHY' ||
      project.database?.host !== 'db.' + PROJECT + '.supabase.co'
    )
      fail('project identity mismatch');

    const cli = (args) => [...args, '--workdir', root, '--output-format', 'json', '--yes'];
    stage = 'link';
    const link = json(command(cli(['link', '--project-ref', PROJECT])));
    if (link.project_ref !== PROJECT || link.branch || link.parent_project_ref)
      fail('linked project mismatch');
    await linkedIdentity(root, fs);
    const history = () => json(command(cli(['migration', 'list', '--linked'])));
    const push = (dryRun) =>
      json(
        command(
          cli(['db', 'push', '--linked', '--skip-vault', ...(dryRun ? ['--dry-run'] : [])]),
          dryRun ? 120_000 : 1_800_000
        )
      );

    stage = 'history';
    const pending = pendingHistory(history(), files);
    stage = 'dry-run';
    checkPush(push(true), pending, true);
    stage = 'approval';
    const reviewed = approvedPending(await releaseBody({ env, fetch }), files);
    const derived = pending.map((name) => files.find((file) => file.name === name).version).sort();
    if (JSON.stringify(reviewed) !== JSON.stringify(derived))
      fail(
        'approved pending set mismatch (reviewed=' +
          reviewed.length +
          ' derived=' +
          derived.length +
          ')'
      );
    stage = 'verify-manifest';
    same(await manifest(copied, fs), files, 'copied migration manifest mismatch');
    same(
      text(await fs.read(path.join(supabase, 'config.toml'))),
      CONFIG,
      'deployment config changed'
    );
    same(
      (await fs.list(supabase)).sort(),
      ['.temp', 'config.toml', 'migrations'],
      'unexpected deployment input'
    );
    same((await fs.list(root)).sort(), ['home', 'supabase'], 'unexpected deployment input');
    await linkedIdentity(root, fs);
    for (const file of files)
      out.write('Migration manifest: ' + file.version + ' ' + file.hash + '\n');
    for (const file of files.filter((candidate) => pending.includes(candidate.name)))
      out.write('Migration pending: ' + file.version + '\n');
    stage = 'apply';
    checkPush(push(false), pending, false);
    stage = 'post-check';
    checkPush(push(true), [], true);
    same(pendingHistory(history(), files), [], 'post-apply history inconsistent');
    out.write(
      'Production migrations verified: applied=' + pending.length + ' total=' + files.length + '\n'
    );
    return { applied: pending.length, total: files.length };
  } catch (error) {
    throw new MigrationError(
      stage + ': ' + (error instanceof MigrationError ? error.message : 'operation failed')
    );
  } finally {
    if (root) await cleanup(root, fs);
  }
}

export async function main(argv, options) {
  if (argv.length !== 0) throw new MigrationError('preflight: unexpected arguments');
  await runMigrations(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const fs = {
    type: async (file) => {
      const stat = await nativeFS.lstat(file);
      return stat.isSymbolicLink()
        ? 'symlink'
        : stat.isFile()
          ? 'file'
          : stat.isDirectory()
            ? 'directory'
            : 'other';
    },
    exists: async (file) => {
      try {
        await nativeFS.lstat(file);
        return true;
      } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
      }
    },
    list: (dir) => nativeFS.readdir(dir),
    read: (file) => nativeFS.readFile(file, { flag: constants.O_RDONLY | constants.O_NOFOLLOW }),
    write: (file, bytes) => nativeFS.writeFile(file, bytes, { mode: 0o600 }),
    mkdir: async (dir) => {
      await nativeFS.mkdir(dir, { recursive: true, mode: 0o700 });
    },
    mkdtemp: (prefix) => nativeFS.mkdtemp(prefix),
    remove: (dir) => nativeFS.rm(dir, { recursive: true, force: true })
  };
  main(process.argv.slice(2), {
    env: process.env,
    checkout: process.cwd(),
    runnerTemp: process.env.RUNNER_TEMP ?? '',
    fs,
    exec: spawnSync,
    fetch: globalThis.fetch,
    out: process.stdout
  }).catch((error) => {
    process.stderr.write(
      '[production-migrations] ' +
        (error instanceof MigrationError ? error.message : 'operation failed') +
        '\n'
    );
    process.exitCode = 1;
  });
}
