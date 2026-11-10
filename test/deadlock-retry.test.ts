import { describe, expect, it, vi } from 'vitest';

import { isDeadlockError, retryOnDeadlock } from './helpers/deadlock-retry';

const deadlock = () => Object.assign(new Error('deadlock detected'), { code: '40P01' });

describe('retryOnDeadlock', () => {
  it('retries a deadlock victim and returns the later success', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(deadlock())
      .mockResolvedValueOnce('ok');
    await expect(retryOnDeadlock(run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempt bound and rethrows the deadlock', async () => {
    const run = vi.fn<() => Promise<string>>().mockRejectedValue(deadlock());
    await expect(retryOnDeadlock(run, 3)).rejects.toMatchObject({ code: '40P01' });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does not retry other failures', async () => {
    const run = vi
      .fn<() => Promise<string>>()
      .mockRejectedValue(Object.assign(new Error('boom'), { code: '23503' }));
    await expect(retryOnDeadlock(run)).rejects.toThrow('boom');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('detects a deadlock SQLSTATE on a wrapped cause', () => {
    expect(isDeadlockError(new Error('wrap', { cause: deadlock() }))).toBe(true);
    expect(isDeadlockError(new Error('plain'))).toBe(false);
    expect(isDeadlockError(null)).toBe(false);
  });
});
