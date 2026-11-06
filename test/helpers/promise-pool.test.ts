import { describe, expect, it } from 'vitest';
import { runPool } from './promise-pool';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

describe('runPool', () => {
  it('returns results in task order and handles empty input', async () => {
    expect(await runPool([], 8)).toEqual([]);
    expect(await runPool([async () => 'a', async () => 'b'], 8)).toEqual(['a', 'b']);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await tick();
      active -= 1;
      return i;
    });
    expect(await runPool(tasks, 3)).toEqual(tasks.map((_, i) => i));
    expect(peak).toBe(3);
  });

  it('stops scheduling after a failure and drains in-flight work before rejecting', async () => {
    const started: number[] = [];
    let settled = 0;
    const tasks = Array.from({ length: 6 }, (_, i) => async () => {
      started.push(i);
      await tick();
      settled += 1;
      if (i === 0) throw new Error('boom');
    });
    await expect(runPool(tasks, 2)).rejects.toThrow('boom');
    expect(settled).toBe(started.length);
    expect(started.length).toBeLessThan(tasks.length);
  });

  it('rejects an invalid limit', async () => {
    await expect(runPool([async () => 1], 0)).rejects.toThrow('positive integer');
  });
});
