import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// PRD §57 measurement driver. The measurement itself is an opt-in integration test (it needs the
// real fixtures and RLS-protected readers), so this script only pins the run: it stamps the build
// hash, runs ONLY that file against the local database, and prints the report path. Percentile
// math lives here so it is unit-tested and shared.
//
//   node scripts/release-performance.mjs [--report /tmp/release-performance.json]
//
// NOTE: the shared local database is used and test data is cleaned up afterwards; it never resets.

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const PERFORMANCE_TEST = 'test/release-integrity.performance.integration.test.ts';
export const TARGETS = { readP95Ms: 500, writeP95Ms: 1000 };

export function percentile(samples, fraction) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil(fraction * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank))];
}

export function summarize(samples) {
  const ok = samples.filter((sample) => sample.ok).map((sample) => sample.ms);
  return {
    samples: samples.length,
    errors: samples.length - ok.length,
    errorRate: samples.length ? (samples.length - ok.length) / samples.length : 0,
    p50: percentile(ok, 0.5),
    p95: percentile(ok, 0.95),
    p99: percentile(ok, 0.99),
    max: ok.length ? Math.max(...ok) : null
  };
}

export function parseArgs(argv) {
  const options = { report: '/tmp/release-performance.json' };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] !== '--report') throw new Error(`Unknown argument ${argv[index]}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error('--report needs a value');
    options.report = value;
  }
  return options;
}

export function buildHash() {
  const hash = createHash('sha256');
  const visit = (relative) => {
    const directory = path.join(ROOT, relative);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        const data = readFileSync(path.join(ROOT, name));
        hash.update(`${name}\0${data.length}\0`).update(data);
      }
    }
  };
  for (const directory of ['src', 'scripts', 'test', 'supabase/migrations']) visit(directory);
  for (const file of ['package.json', 'pnpm-lock.yaml'])
    hash.update(readFileSync(path.join(ROOT, file)));
  return `source-sha256:${hash.digest('hex')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = spawnSync(
      'pnpm',
      ['exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts', PERFORMANCE_TEST],
      {
        cwd: ROOT,
        stdio: 'inherit',
        env: {
          ...process.env,
          RELEASE_PERF: '1',
          RELEASE_PERF_REPORT: options.report,
          RELEASE_PERF_BUILD: buildHash()
        }
      }
    );
    console.log(`report: ${options.report}`);
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Performance run failed');
    process.exitCode = 1;
  }
}
