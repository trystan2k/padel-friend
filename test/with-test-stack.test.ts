import { describe, expect, it, vi } from 'vitest';
import { runWithTestStack } from '../scripts/with-test-stack.mjs';
import { TEST_TUPLE } from './helpers/test-stack-status';

const dev = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'dev-key',
  DATABASE_URL: 'postgresql://postgres:dev@127.0.0.1:55322/postgres',
  SUPABASE_SERVICE_ROLE_KEY: 'dev-service',
  KEEP: 'yes'
};

describe('with-test-stack wrapper', () => {
  it('runs the command under the test tuple, replacing inherited dev values', () => {
    const run = vi.fn<(...args: unknown[]) => { status: number }>(() => ({ status: 0 }));
    const code = runWithTestStack({
      argv: ['pnpm', 'exec', 'playwright', 'test', 'e2e/a.spec.ts'],
      env: dev,
      resolveEnv: () => TEST_TUPLE,
      run: run
    });
    expect(code).toBe(0);
    expect(run).toHaveBeenCalledWith('pnpm', ['exec', 'playwright', 'test', 'e2e/a.spec.ts'], {
      stdio: 'inherit',
      env: { ...TEST_TUPLE, KEEP: 'yes' }
    });
  });

  it('propagates exit codes and signals', () => {
    const base = { argv: ['x'], env: {}, resolveEnv: () => TEST_TUPLE };
    expect(runWithTestStack({ ...base, run: () => ({ status: 7 }) })).toBe(7);
    expect(runWithTestStack({ ...base, run: () => ({ status: null, signal: 'SIGTERM' }) })).toBe(
      143
    );
    expect(
      runWithTestStack({ ...base, run: () => ({ status: null, error: new Error('x') }) })
    ).toBe(127);
  });

  it('aborts before starting the command when the test stack is unavailable', () => {
    const run = vi.fn<() => { status: number }>();
    const written: string[] = [];
    const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      written.push(String(chunk));
      return true;
    });
    try {
      const code = runWithTestStack({
        argv: ['x'],
        env: dev,
        resolveEnv: () => {
          throw new Error('Test Supabase stack is unavailable. Run pnpm test:stack:up first.');
        },
        run: run
      });
      expect(code).toBe(2);
    } finally {
      write.mockRestore();
    }
    expect(run).not.toHaveBeenCalled();
    expect(written.join('')).toContain('pnpm test:stack:up');
    expect(written.join('')).not.toContain('dev-service');
  });

  it('requires a command', () => {
    expect(runWithTestStack({ argv: [], env: {}, resolveEnv: () => TEST_TUPLE })).toBe(2);
  });
});
