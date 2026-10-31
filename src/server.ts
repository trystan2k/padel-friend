import handler from '@tanstack/react-start/server-entry';
import { sweepMatchPlayerAddsOnSchedule } from './features/matches/match-add-player.server';

type WorkerContext = { waitUntil: (promise: Promise<unknown>) => void };

// Custom Workers entry (wrangler `main`): TanStack Start's fetch handler plus the cron
// trigger that re-drives undelivered player-add invitations (see wrangler.jsonc).
export default {
  fetch: handler.fetch,
  scheduled(_controller: unknown, _env: unknown, ctx: WorkerContext) {
    ctx.waitUntil(sweepMatchPlayerAddsOnSchedule());
  }
};
