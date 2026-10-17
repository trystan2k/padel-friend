import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const tempDirs: string[] = [];
const originalConfig = readFileSync(path.join(repoRoot, '.lintstagedrc.json'), 'utf8');
const originalStatus = execFileSync('git', ['status', '--porcelain'], {
  cwd: repoRoot,
  encoding: 'utf8'
});

// Git-local variables exported by the parent process (e.g. inside a linked-worktree hook)
// would redirect scratch `git`/`lint-staged` subprocesses at the PARENT repository.
const gitLocalEnvKeys = [
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  'GIT_PREFIX',
  'GIT_NAMESPACE',
  'GIT_CEILING_DIRECTORIES'
] as const;

function scratchEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of gitLocalEnvKeys) delete env[key];
  return env;
}

function createFixture(configText = originalConfig): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lint-staged-probe-'));
  tempDirs.push(dir);
  const env = scratchEnv();
  execFileSync('git', ['init', '-q'], { cwd: dir, env });
  execFileSync('git', ['config', 'user.email', 'probe@example.test'], { cwd: dir, env });
  execFileSync('git', ['config', 'user.name', 'Lint Probe'], { cwd: dir, env });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, env });
  writeFileSync(path.join(dir, '.lintstagedrc.json'), configText);
  copyFileSync(path.join(repoRoot, '.oxlintrc.json'), path.join(dir, '.oxlintrc.json'));
  return dir;
}

function runHook(dir: string): ReturnType<typeof spawnSync> {
  const bin = path.join(repoRoot, 'node_modules', '.bin');
  const env = scratchEnv({
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    HUSKY: '0'
  });
  const pnpm = spawnSync('pnpm', ['exec', 'lint-staged'], { cwd: dir, env, encoding: 'utf8' });
  if (!pnpm.error && pnpm.status === 0) return pnpm;
  // pnpm exec requires a project context; lint-staged itself is installed in this repository.
  const direct = spawnSync(path.join(bin, 'lint-staged'), [], { cwd: dir, env, encoding: 'utf8' });
  return direct;
}

function output(result: ReturnType<typeof spawnSync>): string {
  return `${String(result.stdout ?? '')}\n${String(result.stderr ?? '')}`;
}

function stage(dir: string, relativePath: string, source: string): void {
  const filePath = path.join(dir, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, source);
  execFileSync('git', ['add', relativePath], { cwd: dir, env: scratchEnv() });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('lint-staged oxlint coverage', () => {
  it('uses a slash-free extension glob and preserves other tasks', () => {
    const config: Record<string, string> = JSON.parse(
      readFileSync(path.join(repoRoot, '.lintstagedrc.json'), 'utf8')
    );
    expect(config['*.{ts,tsx,js,mjs}']).toBe('oxlint --fix --deny-warnings');
    expect(Object.keys(config).every((key) => !key.includes('/'))).toBe(true);
    expect(config['*.css']).toBe('stylelint --fix');
    expect(config['*']).toBe('oxfmt --no-error-on-unmatched-pattern');
    expect(originalConfig).not.toContain('!(src/lib/supabase/database.types.ts)');
  });

  // Spawns lint-staged once per extension (a real pnpm/node process chain per run);
  // measured near the 5s default under full-suite worker contention, so each run
  // carries an explicit timeout like the other process-spawning suites in this repo.
  it.each(['ts', 'tsx', 'js', 'mjs'])(
    'catches nested .%s correctness errors',
    (extension) => {
      const dir = createFixture();
      const relativePath = `src/features/probe/deep/file.${extension}`;
      stage(dir, relativePath, 'const value = missingProbeIdentifier;\n');
      const result = runHook(dir);
      expect(result.status).not.toBe(0);
      expect(output(result)).toContain(relativePath);
      expect(output(result)).toMatch(/eslint\(no-unused-vars\)/i);
    },
    30_000
  );

  // Spawns lint-staged twice (one scratch repo per scenario); measured 7.8s under a
  // loaded full-suite run (80 workers), well over the 5s default, so it carries an
  // explicit generous timeout instead of a weaker assertion.
  it('passes a clean nested file and ignores only generated database types', () => {
    const cleanDir = createFixture();
    stage(cleanDir, 'src/features/probe/deep/clean.ts', 'export const clean = true;\n');
    expect(runHook(cleanDir).status).toBe(0);

    const generatedDir = createFixture();
    stage(
      generatedDir,
      'src/lib/supabase/database.types.ts',
      'const value = missingProbeIdentifier;\n'
    );
    stage(generatedDir, 'src/features/probe/ordinary.ts', 'export const ordinary = true;\n');
    const generatedResult = runHook(generatedDir);
    expect(generatedResult.status).toBe(0);
    expect(existsSync(path.join(generatedDir, 'src/lib/supabase/database.types.ts'))).toBe(true);
  }, 30_000);

  // Spawns git (status) against the real repository; worker contention can add
  // seconds to a single child spawn, so it carries an explicit timeout too.
  it('leaves the real repository index and working tree unchanged', () => {
    expect(
      execFileSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' })
    ).toBe(originalStatus);
  }, 15_000);
});
