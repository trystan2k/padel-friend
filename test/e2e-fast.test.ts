import { describe, expect, it } from 'vitest';
import { fastArgs, runFast } from '../scripts/e2e-fast.mjs';
import { VISUAL_GREP } from '../scripts/e2e-shards.mjs';

describe('e2e fast lane', () => {
  it('appends the shared visual inverse filter and keeps caller file filters', () => {
    expect(fastArgs(['e2e/home.spec.ts', '--retries=0'])).toEqual([
      'e2e/home.spec.ts',
      '--retries=0',
      '--grep-invert',
      VISUAL_GREP
    ]);
  });

  it.each([['--grep'], ['-g'], ['--grep=foo'], ['--grep-invert'], ['--grep-invert=foo']])(
    'rejects the conflicting selection flag %s',
    (flag) => {
      expect(() => fastArgs([flag, 'x'])).toThrow(/owns test selection/);
    }
  );

  it('resets, frees the port, then runs Playwright with the inverse filter', () => {
    const calls: string[][] = [];
    const status = runFast({
      args: ['e2e/home.spec.ts'],
      run: (command, args) => {
        calls.push([command, ...args]);
        return { status: 0 };
      }
    });

    expect(status).toBe(0);
    expect(calls).toEqual([
      ['pnpm', 'db:reset'],
      ['node', 'scripts/free-port.mjs', '4173'],
      ['pnpm', 'exec', 'playwright', 'test', 'e2e/home.spec.ts', '--grep-invert', VISUAL_GREP]
    ]);
  });

  it('never forwards an inherited gate-only prebuilt flag, so the build is always fresh', () => {
    const envs: Array<Record<string, string | undefined>> = [];
    runFast({
      env: { E2E_GATE_PREBUILT: '1', KEEP: 'yes' },
      run: (_command, _args, options) => {
        envs.push(options.env);
        return { status: 0 };
      }
    });

    expect(envs).toHaveLength(3);
    for (const env of envs) {
      expect(env).toEqual({ KEEP: 'yes' });
    }
  });

  it('stops at the first failing step', () => {
    const calls: string[][] = [];
    const status = runFast({
      run: (command, args) => {
        calls.push([command, ...args]);
        return { status: 3 };
      }
    });

    expect(status).toBe(3);
    expect(calls).toEqual([['pnpm', 'db:reset']]);
  });
});
