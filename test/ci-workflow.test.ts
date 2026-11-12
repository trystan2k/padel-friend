import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PUBLIC_BUILD_FILE,
  assertTupleMatchesBuild,
  buildEnvLines,
  devVarsContent,
  main,
  manifestJson,
  parsePublicBuild,
  provisionE2e,
  readPublicBuild
} from '../scripts/ci-test-env.mjs';
import { FAKE_SERVICE_KEY, TEST_TUPLE, testStatusOutput } from './helpers/test-stack-status';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const action = readFileSync('.github/actions/supabase-start/action.yml', 'utf8');

function job(name: string): string {
  const match = new RegExp(
    `^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z0-9-]+:\\n|(?![\\s\\S]))`,
    'm'
  ).exec(workflow);
  const body = match?.[1];
  if (body === undefined) throw new Error(`job ${name} not found`);
  return body;
}

const BUILD = { supabaseUrl: 'http://127.0.0.1:55421', publishableKey: 'sb_publishable_fake' };
const liveExec = (overrides = {}) => vi.fn<() => string>(() => testStatusOutput(overrides));
const sink = () => ({ write: vi.fn<(text: string) => unknown>() });

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'ci-test-env-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('public test build descriptor', () => {
  it('pins the test API and a local publishable key, never a private value', () => {
    const text = readFileSync(PUBLIC_BUILD_FILE, 'utf8');
    const build = readPublicBuild();
    expect(build.supabaseUrl).toBe('http://127.0.0.1:55421');
    expect(build.publishableKey).toMatch(/^sb_publishable_/);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['publishableKey', 'supabaseUrl']);
    expect(text).not.toMatch(/service|secret|eyJ|postgres/i);
  });

  it('rejects the dev API, other keys and malformed input', () => {
    expect(() => parsePublicBuild('{')).toThrow(/not valid JSON/);
    expect(() =>
      parsePublicBuild(JSON.stringify({ ...BUILD, supabaseUrl: 'http://127.0.0.1:55321' }))
    ).toThrow(/test API/);
    expect(() => parsePublicBuild(JSON.stringify({ ...BUILD, publishableKey: 'eyJ.a.b' }))).toThrow(
      /publishable key/
    );
  });

  it('renders GITHUB_ENV lines and a manifest with the public pair only', () => {
    expect(buildEnvLines(BUILD)).toBe(
      'BUILD_SUPABASE_URL=http://127.0.0.1:55421\nBUILD_SUPABASE_PUBLISHABLE_KEY=sb_publishable_fake\n'
    );
    expect(JSON.parse(manifestJson({ sha: 'abc', runId: '7' }, BUILD))).toEqual({
      sha: 'abc',
      runId: '7',
      ...BUILD
    });
  });
});

describe('E2E lane provisioning', () => {
  const descriptor = (dir: string) => {
    const file = path.join(dir, 'descriptor.json');
    writeFileSync(file, JSON.stringify(BUILD));
    return file;
  };
  const manifest = (dir: string, value: object = BUILD) => {
    const file = path.join(dir, 'build-manifest.json');
    writeFileSync(file, JSON.stringify({ sha: 'abc', runId: '1', ...value }));
    return file;
  };

  it('masks the live service key and writes it only to the extracted .dev.vars', () => {
    withTempDir((dir) => {
      const devVarsFile = path.join(dir, '.dev.vars');
      const out = sink();
      provisionE2e({
        manifestFile: manifest(dir),
        devVarsFile,
        descriptorFile: descriptor(dir),
        exec: liveExec(),
        out
      });
      expect(out.write).toHaveBeenCalledWith(`::add-mask::${FAKE_SERVICE_KEY}\n`);
      const text = readFileSync(devVarsFile, 'utf8');
      expect(text).toBe(devVarsContent(TEST_TUPLE));
      expect(text).toContain(`SUPABASE_SERVICE_ROLE_KEY=${FAKE_SERVICE_KEY}\n`);
      expect(text).toContain('WEB_PUSH_ENABLED=true');
      expect(text).not.toMatch(/postgres|DATABASE_URL/);
    });
  });

  it('fails without writing when the live public pair differs from the baked build', () => {
    withTempDir((dir) => {
      const devVarsFile = path.join(dir, '.dev.vars');
      const write = vi.fn<(file: string, data: string) => void>();
      expect(() =>
        provisionE2e({
          manifestFile: manifest(dir),
          devVarsFile,
          descriptorFile: descriptor(dir),
          exec: liveExec({ PUBLISHABLE_KEY: 'sb_publishable_other' }),
          write,
          out: sink()
        })
      ).toThrow(/differs from the public config baked/);
      expect(write).not.toHaveBeenCalled();
    });
  });

  it('fails when the manifest disagrees with the checked-in descriptor', () => {
    withTempDir((dir) => {
      expect(() =>
        provisionE2e({
          manifestFile: manifest(dir, { ...BUILD, publishableKey: 'sb_publishable_other' }),
          devVarsFile: path.join(dir, '.dev.vars'),
          descriptorFile: descriptor(dir),
          exec: liveExec(),
          out: sink()
        })
      ).toThrow(/differs from the checked-in/);
    });
  });

  it('fails closed without a test stack and never echoes values', () => {
    withTempDir((dir) => {
      const exec = () => {
        throw new Error('no stack');
      };
      const attempt = () =>
        provisionE2e({
          manifestFile: manifest(dir),
          devVarsFile: path.join(dir, '.dev.vars'),
          descriptorFile: descriptor(dir),
          exec,
          out: sink()
        });
      expect(attempt).toThrow(/pnpm test:stack:up/);
    });
  });

  it('compares the public pair exactly', () => {
    expect(() =>
      assertTupleMatchesBuild(
        { ...TEST_TUPLE, VITE_SUPABASE_PUBLISHABLE_KEY: BUILD.publishableKey },
        BUILD
      )
    ).not.toThrow();
    expect(() =>
      assertTupleMatchesBuild(TEST_TUPLE, { ...BUILD, publishableKey: 'sb_publishable_other' })
    ).toThrow(/differs from the public config baked/);
  });

  it('rejects unknown commands', () => {
    expect(() => main(['nope'])).toThrow(/Usage/);
  });
});

describe('ci.yml test-stack contract', () => {
  it('keeps job names, the five-lane matrix and the checks aggregate', () => {
    for (const name of ['static', 'unit', 'integration', 'e2e', 'e2e-report', 'checks'])
      expect(workflow).toMatch(
        new RegExp(`^  ${name}:\\n    name: ${name === 'e2e' ? 'e2e \\(' : name}`, 'm')
      );
    expect(workflow).toContain('lane: [functional-1, functional-2, functional-3, serial, visual]');
    expect(workflow).toContain('needs: [static, unit, integration, e2e]');
  });

  it('never addresses the dev stack or a root .env', () => {
    expect(workflow).not.toMatch(/5532\d/);
    expect(workflow).not.toMatch(/pnpm exec supabase|supabase (start|status|db reset)/);
    expect(workflow).not.toMatch(/>>?\s*\.env\b/);
    expect(workflow).not.toContain('sb_publishable_');
    expect(action).not.toMatch(/pnpm exec supabase/);
  });

  it('keeps static service-free and bakes the descriptor pair', () => {
    const body = job('static');
    expect(body).not.toContain('supabase-start');
    expect(body).not.toMatch(/docker|test:stack|supabase-start|supabase (start|status)/i);
    expect(body).toContain('node scripts/ci-test-env.mjs build-env >> "$GITHUB_ENV"');
    expect(body).toContain('VITE_SUPABASE_URL: ${{ env.BUILD_SUPABASE_URL }}');
    expect(body).toContain(
      'VITE_SUPABASE_PUBLISHABLE_KEY: ${{ env.BUILD_SUPABASE_PUBLISHABLE_KEY }}'
    );
    expect(body).toContain('node scripts/ci-test-env.mjs manifest "$GITHUB_SHA" "$GITHUB_RUN_ID"');
    expect(body).not.toMatch(/SERVICE_ROLE/);
  });

  it('starts only the test stack through the composite action', () => {
    expect(action).toContain('pnpm test:stack:up');
    expect(action).toContain("'test/stack/supabase/config.toml'");
    expect(action).toContain("'pnpm-lock.yaml'");
    expect(action).toContain('docker save');
    expect(action).not.toMatch(/docker volume|\.env|SERVICE_ROLE|KEY=/i);
    expect(job('unit')).not.toContain('supabase-start');
    expect(job('integration').match(/uses: \.\/\.github\/actions\/supabase-start/g)).toHaveLength(
      1
    );
    expect(job('e2e').match(/uses: \.\/\.github\/actions\/supabase-start/g)).toHaveLength(1);
  });

  it('restores the populated-upgrade state on the test stack and watches the stack files', () => {
    const body = job('integration');
    expect(body).toMatch(/id: final-reset\n\s+if: always\(\) && [^\n]+\n\s+run: pnpm db:reset\n/);
    expect(body).toContain('run: pnpm db:types:check');
    expect(body).toContain('pnpm test:integration');
    const pattern = /pattern='([^']+)'/.exec(workflow)?.[1] ?? '';
    const watched = new RegExp(pattern);
    for (const file of [
      'test/stack/supabase/config.toml',
      'test/stack/public-build.json',
      'scripts/test-stack.mjs',
      'scripts/test-stack-env.mjs',
      'scripts/test-populated-migration-up.mjs',
      'supabase/migrations/1.sql'
    ])
      expect(file).toMatch(watched);
  });

  it('verifies the live public pair per lane and writes the key only to the extracted .dev.vars', () => {
    const body = job('e2e');
    expect(body).toContain(
      'node scripts/ci-test-env.mjs provision-e2e "$RUNNER_TEMP/app-build/build-manifest.json" dist/server/.dev.vars'
    );
    expect(body).toContain('pnpm test:e2e');
    expect(body).toContain("E2E_GATE_PREBUILT: '1'");
    expect(body).not.toMatch(/GITHUB_ENV|SERVICE_ROLE/);
  });
});

describe('static job knip is service-free', () => {
  it('never lets knip execute the stack-bound Playwright/Vitest integration configs', () => {
    const knip: unknown = JSON.parse(readFileSync('knip.json', 'utf8'));
    expect(knip).toMatchObject({ vitest: false, playwright: { config: [] } });
  });

  it('passes with no test stack available (static job has no Supabase)', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'knip-no-stack-'));
    try {
      writeFileSync(path.join(dir, 'pnpm'), '#!/bin/sh\necho no stack >&2\nexit 1\n', {
        mode: 0o755
      });
      const result = spawnSync('node_modules/.bin/knip', [], {
        encoding: 'utf8',
        env: { ...process.env, PATH: dir + path.delimiter + process.env.PATH }
      });
      expect(result.stdout + result.stderr).not.toMatch(/Error loading|Test Supabase stack/);
      expect(result.status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
