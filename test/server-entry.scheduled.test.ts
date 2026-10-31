import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Worker cron entry (F20) only wires the platform event to the shared sweep.
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
  sweep: vi.fn<() => Promise<void>>()
}));
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: mocks.fetch } }));
vi.mock('../src/features/matches/match-add-player.server', () => ({
  sweepMatchPlayerAddsOnSchedule: mocks.sweep
}));

import worker from '../src/server';

describe('Worker entry', () => {
  beforeEach(() => {
    mocks.sweep.mockReset();
  });

  it('keeps TanStack Start as the fetch handler', () => {
    expect(worker.fetch).toBe(mocks.fetch);
  });

  it('runs the player-add sweep from the cron trigger inside waitUntil', async () => {
    mocks.sweep.mockResolvedValue(undefined);
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
  });

  it('surfaces a failed sweep through waitUntil so the cron run is recorded as failed', async () => {
    mocks.sweep.mockRejectedValue(new Error('APP_ORIGIN_UNAVAILABLE'));
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow('APP_ORIGIN_UNAVAILABLE');
  });
});
