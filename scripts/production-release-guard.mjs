import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = /^[a-f0-9]{40}$/;
const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const CREDENTIALS = [
  'SUPABASE_ACCESS_TOKEN',
  'SUPABASE_DB_PASSWORD',
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_API_TOKEN'
];

/** Only fixed reasons escape this module; never attach command errors or their output. */
class GuardError extends Error {}

export function validateCandidate({ event, repository, created, tag, releaseSha }) {
  const run = event?.workflow_run;
  if (
    typeof repository !== 'string' ||
    !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
    event?.repository?.full_name !== repository ||
    run?.head_repository?.full_name !== repository ||
    run?.head_branch !== 'main' ||
    run?.event !== 'push' ||
    run?.conclusion !== 'success'
  )
    throw new GuardError('ineligible CI provenance');
  if (created !== 'true') throw new GuardError('release was not created');
  if (typeof tag !== 'string' || tag.length > 128 || !TAG.test(tag))
    throw new GuardError('invalid release tag');
  if (typeof releaseSha !== 'string' || !SHA.test(releaseSha) || !SHA.test(run.head_sha ?? ''))
    throw new GuardError('invalid release SHA');
  if (releaseSha !== run.head_sha) throw new GuardError('release and CI identity mismatch');
  return { tag, releaseSha };
}

function git(args, exec) {
  try {
    const result = exec('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
      maxBuffer: 64 * 1024
    });
    if (typeof result !== 'string') throw new GuardError('invalid ref response');
    return result.trim();
  } catch {
    throw new GuardError('ref lookup failed');
  }
}

function remoteRefs(refs, exec) {
  const text = git(['ls-remote', '--exit-code', 'origin', ...refs], exec);
  const values = new Map();
  for (const line of text.split('\n')) {
    const fields = line.split('\t');
    if (
      fields.length !== 2 ||
      !SHA.test(fields[0]) ||
      !refs.includes(fields[1]) ||
      values.has(fields[1])
    )
      throw new GuardError('invalid remote ref response');
    values.set(fields[1], fields[0]);
  }
  return values;
}

/** Resolve fresh remote refs on every call, including annotated-tag peeling. No cached refs. */
export function guardRelease(candidate, exec = execFileSync) {
  const identity = validateCandidate(candidate);
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}'], exec);
  if (!SHA.test(head) || head !== identity.releaseSha)
    throw new GuardError('checkout identity mismatch');
  const ref = 'refs/tags/' + identity.tag;
  const tags = remoteRefs([ref, ref + '^{}'], exec);
  if (!tags.has(ref)) throw new GuardError('release tag inaccessible');
  if ((tags.get(ref + '^{}') ?? tags.get(ref)) !== identity.releaseSha)
    throw new GuardError('remote tag identity mismatch');
  const remoteMain = remoteRefs(['refs/heads/main'], exec).get('refs/heads/main');
  if (!remoteMain) throw new GuardError('remote main inaccessible');
  if (remoteMain !== identity.releaseSha) throw new GuardError('stale release: main advanced');
  return identity;
}

export function assertCredentials(env) {
  for (const name of CREDENTIALS) {
    if (typeof env[name] !== 'string' || env[name].trim() === '')
      throw new GuardError('missing credential: ' + name);
  }
}

/** CLI dependencies injectable; importing never reads files, runs commands or writes output. */
export function main(argv, io = {}) {
  const [command] = argv;
  const env = io.env ?? process.env;
  if (argv.length !== 1 || !['record', 'verify', 'credentials'].includes(command))
    throw new GuardError('invalid guard command');
  if (command === 'credentials') {
    assertCredentials(env);
    return;
  }
  let event;
  try {
    event = JSON.parse((io.read ?? readFileSync)(env.GITHUB_EVENT_PATH, 'utf8'));
  } catch {
    throw new GuardError('CI event inaccessible');
  }
  const identity = guardRelease(
    {
      event,
      repository: env.GITHUB_REPOSITORY,
      created: env.RELEASE_CREATED,
      tag: env.RELEASE_TAG,
      releaseSha: command === 'record' ? event?.workflow_run?.head_sha : env.RELEASE_SHA
    },
    io.exec
  );
  try {
    if (command === 'record') {
      if (!env.GITHUB_OUTPUT) throw new GuardError('release output inaccessible');
      (io.append ?? appendFileSync)(env.GITHUB_OUTPUT, 'release_sha=' + identity.releaseSha + '\n');
    }
    (io.out ?? process.stdout).write(
      'Release identity verified: ' + identity.tag + ' ' + identity.releaseSha + '\n'
    );
  } catch {
    throw new GuardError('release output inaccessible');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      '[production-release-guard] ' +
        (error instanceof GuardError ? error.message : 'guard failed') +
        '\n'
    );
    process.exitCode = 1;
  }
}
