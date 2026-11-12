import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sourceFingerprint } from '../scripts/source-fingerprint.mjs';

let dir: string;
const git = (...args: string[]) =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Mirrors test/stack/supabase: real files plus a directory symlink and a file symlink.
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'fingerprint-'));
  git('init', '-q');
  git('config', 'user.email', 'probe@example.test');
  git('config', 'user.name', 'Probe');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(path.join(dir, 'supabase/migrations'), { recursive: true });
  writeFileSync(path.join(dir, 'supabase/migrations/1_a.sql'), 'select 1;');
  writeFileSync(path.join(dir, 'supabase/seed.sql'), 'select 2;');
  mkdirSync(path.join(dir, 'test/stack/supabase'), { recursive: true });
  symlinkSync('../../../supabase/migrations', path.join(dir, 'test/stack/supabase/migrations'));
  symlinkSync('../../../supabase/seed.sql', path.join(dir, 'test/stack/supabase/seed.sql'));
  git('add', '-A');
  git('commit', '-q', '-m', 'fixture');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('sourceFingerprint with symlinked test stack entries', () => {
  it('fingerprints a tree holding a directory symlink instead of degrading to undefined', () => {
    // git hash-object --stdin-paths dies with "fatal: Unable to hash" on a directory symlink; the
    // fingerprint then silently disabled e2e prebuilt reuse. Symlinks must never reach it.
    expect(sourceFingerprint({ cwd: dir })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('never hands a symlink path to git hash-object', () => {
    const hashObjects = vi.fn<(input: string, cwd: string) => string>(() => 'hashes');
    const gitRun = (args: string[], cwd: string) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' });
    sourceFingerprint({ cwd: dir, git: gitRun, hashObjects });
    const paths = hashObjects.mock.calls[0]![0].split('\n');
    expect(paths).toContain('supabase/migrations/1_a.sql');
    expect(paths).not.toContain('test/stack/supabase/migrations');
    expect(paths).not.toContain('test/stack/supabase/seed.sql');
  });

  it('is stable, and changes with sources, link targets and the effective public tuple', () => {
    const first = sourceFingerprint({ cwd: dir });
    expect(sourceFingerprint({ cwd: dir })).toBe(first);
    writeFileSync(path.join(dir, 'supabase/migrations/1_a.sql'), 'select 3;');
    const edited = sourceFingerprint({ cwd: dir });
    expect(edited).not.toBe(first);
    rmSync(path.join(dir, 'test/stack/supabase/seed.sql'));
    symlinkSync('../../../supabase/other.sql', path.join(dir, 'test/stack/supabase/seed.sql'));
    writeFileSync(path.join(dir, 'supabase/other.sql'), 'select 2;');
    expect(sourceFingerprint({ cwd: dir })).not.toBe(edited);
    const tuple = {
      VITE_SUPABASE_URL: 'http://127.0.0.1:55421',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'a'
    };
    const withTuple = sourceFingerprint({ cwd: dir, tuple });
    expect(withTuple).not.toBe(sourceFingerprint({ cwd: dir }));
    expect(
      sourceFingerprint({ cwd: dir, tuple: { ...tuple, VITE_SUPABASE_PUBLISHABLE_KEY: 'b' } })
    ).not.toBe(withTuple);
  });

  it('still tracks build env files and returns undefined outside a repository', () => {
    const first = sourceFingerprint({ cwd: dir });
    writeFileSync(path.join(dir, '.env.local'), 'VITE_X=1');
    git('add', '-f', '.env.local');
    expect(sourceFingerprint({ cwd: dir })).not.toBe(first);
    const outside = mkdtempSync(path.join(tmpdir(), 'no-git-'));
    try {
      expect(sourceFingerprint({ cwd: outside })).toBeUndefined();
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
