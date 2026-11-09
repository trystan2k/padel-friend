import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<Response>>(),
  sweep: vi.fn<() => Promise<void>>(),
  push: vi.fn<() => Promise<void>>()
}));
vi.mock('@tanstack/react-start/server-entry', () => ({ default: { fetch: mocks.fetch } }));
vi.mock('../src/features/matches/match-add-player.server', () => ({
  sweepMatchPlayerAddsOnSchedule: mocks.sweep
}));
vi.mock('../src/features/notifications/push-dispatch.server', () => ({
  sweepNotificationPushOnSchedule: mocks.push
}));
import worker from '../src/server';

describe('Worker entry', () => {
  beforeEach(() => {
    mocks.sweep.mockReset().mockResolvedValue(undefined);
    mocks.push.mockReset().mockResolvedValue(undefined);
  });
  it('keeps TanStack Start fetch handler', () => expect(worker.fetch).toBe(mocks.fetch));
  it('runs both independent sweeps inside waitUntil', async () => {
    const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
    worker.scheduled({}, {}, { waitUntil });
    await expect(waitUntil.mock.calls[0]?.[0]).resolves.toBeUndefined();
    expect(mocks.sweep).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledTimes(1);
  });
  it.each(['sweep', 'push'] as const)(
    'surfaces %s failure without starving other sweep',
    async (name) => {
      mocks[name].mockRejectedValue(new Error('sensitive provider error'));
      const waitUntil = vi.fn<(promise: Promise<unknown>) => void>();
      worker.scheduled({}, {}, { waitUntil });
      await expect(waitUntil.mock.calls[0]?.[0]).rejects.toThrow('SCHEDULED_SWEEP_FAILED');
      expect(mocks.sweep).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledTimes(1);
    }
  );
});
