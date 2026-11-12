import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_WEB_PUSH_ENV } from './e2e-build-env.mjs';
import { TEST_API_URL } from './test-stack.mjs';
import { resolveTestStackEnv } from './test-stack-env.mjs';

// CI glue for the test stack's PUBLIC build contract. The service-free static job bakes the
// descriptor's public pair into the shared build; each E2E lane then proves its live test stack
// reports exactly that pair before the build is previewed. The descriptor holds public, local-only
// values (the pinned CLI derives the same publishable key for every local project); no service key,
// password or URL with credentials ever enters it, the manifest or logs.
export const PUBLIC_BUILD_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../test/stack/public-build.json'
);

const PUBLISHABLE_KEY = /^sb_publishable_[\w-]+$/;

/** Parses and validates a public build pair ({ supabaseUrl, publishableKey }). Reason-only errors. */
export function parsePublicBuild(text, label = 'public build descriptor') {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(label + ' is not valid JSON');
  }
  if (value?.supabaseUrl !== TEST_API_URL)
    throw new Error(label + ' must target the test API ' + TEST_API_URL);
  if (typeof value.publishableKey !== 'string' || !PUBLISHABLE_KEY.test(value.publishableKey))
    throw new Error(label + ' needs a local publishable key');
  return { supabaseUrl: value.supabaseUrl, publishableKey: value.publishableKey };
}

export function readPublicBuild(file = PUBLIC_BUILD_FILE) {
  return parsePublicBuild(readFileSync(file, 'utf8'));
}

/** GITHUB_ENV lines for the static build step. */
export function buildEnvLines(build) {
  return (
    'BUILD_SUPABASE_URL=' +
    build.supabaseUrl +
    '\nBUILD_SUPABASE_PUBLISHABLE_KEY=' +
    build.publishableKey +
    '\n'
  );
}

/** The same-run build manifest: SHA, run id and the public pair that was baked in. */
export function manifestJson({ sha, runId }, build) {
  return (
    JSON.stringify({
      sha,
      supabaseUrl: build.supabaseUrl,
      publishableKey: build.publishableKey,
      runId
    }) + '\n'
  );
}

/** Throws (no values echoed) unless the live tuple's public pair equals the baked build pair. */
export function assertTupleMatchesBuild(tuple, build) {
  if (
    tuple.VITE_SUPABASE_URL !== build.supabaseUrl ||
    tuple.VITE_SUPABASE_PUBLISHABLE_KEY !== build.publishableKey
  )
    throw new Error(
      'Local Supabase stack differs from the public config baked into the shared build'
    );
}

/** Server-only preview env: the live stack's service key plus the public Web Push e2e config. */
export function devVarsContent(tuple) {
  const lines = ['SUPABASE_SERVICE_ROLE_KEY=' + tuple.SUPABASE_SERVICE_ROLE_KEY];
  for (const [key, value] of Object.entries(E2E_WEB_PUSH_ENV)) lines.push(key + '=' + value);
  return lines.join('\n') + '\n';
}

/**
 * E2E lane provisioning: the manifest and descriptor must agree, the live test stack must report the
 * baked pair, then only the per-run extracted dist/server/.dev.vars receives the masked service key.
 */
export function provisionE2e({
  manifestFile,
  devVarsFile,
  descriptorFile = PUBLIC_BUILD_FILE,
  exec = execFileSync,
  write = writeFileSync,
  out = process.stdout
}) {
  const descriptor = readPublicBuild(descriptorFile);
  const manifest = parsePublicBuild(readFileSync(manifestFile, 'utf8'), 'build manifest');
  if (
    manifest.supabaseUrl !== descriptor.supabaseUrl ||
    manifest.publishableKey !== descriptor.publishableKey
  )
    throw new Error('Build manifest public config differs from the checked-in test descriptor');
  const tuple = resolveTestStackEnv(exec);
  assertTupleMatchesBuild(tuple, manifest);
  out.write('::add-mask::' + tuple.SUPABASE_SERVICE_ROLE_KEY + '\n');
  write(devVarsFile, devVarsContent(tuple));
}

export function main(argv, io = {}) {
  const [command, ...rest] = argv;
  const out = io.out ?? process.stdout;
  if (command === 'build-env') out.write(buildEnvLines(readPublicBuild()));
  else if (command === 'manifest')
    out.write(manifestJson({ sha: rest[0], runId: rest[1] }, readPublicBuild()));
  else if (command === 'provision-e2e')
    provisionE2e({ manifestFile: rest[0], devVarsFile: rest[1], out, ...io });
  else
    throw new Error(
      'Usage: node scripts/ci-test-env.mjs build-env | manifest <sha> <runId> | provision-e2e <manifest> <devVars>'
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      '[ci-test-env] ' + (error instanceof Error ? error.message : 'failed') + '\n'
    );
    process.exit(1);
  }
}
