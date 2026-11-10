import { describe, expect, it, vi } from 'vitest';
import {
  SPAWN_MAX_ATTEMPTS,
  isTransientSpawnError,
  spawnWithTransientRetry
} from '../scripts/release-rehearsal-lib.mjs';

type SpawnFn = () => { status?: number; stdout?: string; stderr?: string; error?: Error };

const transient = (code: string) => ({ error: Object.assign(new Error(code), { code }) });

describe('spawnWithTransientRetry', () => {
  it('retries a transient EPIPE and returns the later success', () => {
    const ok = { status: 0, stdout: 'ok' };
    const run = vi.fn<SpawnFn>().mockReturnValueOnce(transient('EPIPE')).mockReturnValueOnce(ok);
    expect(spawnWithTransientRetry(run, 'docker', [], {})).toBe(ok);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('does not retry a command that ran and failed', () => {
    const failed = { status: 1, stderr: 'boom' };
    const run = vi.fn<SpawnFn>().mockReturnValue(failed);
    expect(spawnWithTransientRetry(run, 'docker', [], {})).toBe(failed);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-transient spawn error', () => {
    const missing = transient('ENOENT');
    const run = vi.fn<SpawnFn>().mockReturnValue(missing);
    expect(spawnWithTransientRetry(run, 'docker', [], {})).toBe(missing);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('stops after the attempt bound and surfaces the last error', () => {
    const run = vi.fn<SpawnFn>().mockReturnValue(transient('ECONNRESET'));
    const result = spawnWithTransientRetry(run, 'docker', [], {});
    expect(result.error).toBeInstanceOf(Error);
    expect(run).toHaveBeenCalledTimes(SPAWN_MAX_ATTEMPTS);
  });

  it('classifies transient codes only', () => {
    expect(isTransientSpawnError({ code: 'EAGAIN' })).toBe(true);
    expect(isTransientSpawnError({ code: 'ENOENT' })).toBe(false);
    expect(isTransientSpawnError(undefined)).toBe(false);
  });
});
