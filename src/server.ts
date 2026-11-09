import handler from '@tanstack/react-start/server-entry';
import { sweepMatchPlayerAddsOnSchedule } from './features/matches/match-add-player.server';
import { sweepNotificationPushOnSchedule } from './features/notifications/push-dispatch.server';

import { applyPrivateResponsePolicy } from './lib/private-response';

type WorkerContext = { waitUntil: (promise: Promise<unknown>) => void };

export default {
  async fetch(...args: Parameters<typeof handler.fetch>) {
    const response = await handler.fetch(...args);
    return applyPrivateResponsePolicy(args[0], response);
  },
  scheduled(_controller: unknown, _env: unknown, ctx: WorkerContext) {
    // Start independently. A disabled/misconfigured Push channel must never starve player-add recovery.
    ctx.waitUntil(
      Promise.allSettled([
        Promise.resolve().then(() => sweepMatchPlayerAddsOnSchedule()),
        Promise.resolve().then(() => sweepNotificationPushOnSchedule())
      ]).then((results) => {
        const failures = results.filter((result) => result.status === 'rejected');
        if (failures.length) throw new Error('SCHEDULED_SWEEP_FAILED');
      })
    );
  }
};
