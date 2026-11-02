import { useEffect, useRef } from 'react';

/** Cadence of the visible-page reload: slow enough to avoid fetch storms, fast enough to follow play. */
export const LEAGUE_STANDINGS_REFRESH_INTERVAL_MS = 60_000;
/** Longest delay `setTimeout` accepts; a farther cutoff is reached through the interval instead. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Reloads while the page is visible: once whenever it becomes visible again (other members may
 * have confirmed results meanwhile), on a bounded interval while it stays visible, and once at
 * `cutoffAt` so a Fixed League's close is picked up without user action. Never overlaps itself
 * (a tick that finds a reload running is dropped) and stops as soon as it is disabled or unmounted.
 */
export function useRefreshWhenVisible(
  refresh: () => Promise<unknown>,
  enabled: boolean,
  cutoffAt: string | null = null
) {
  const latest = useRef(refresh);
  const running = useRef(false);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => {
      if (document.visibilityState !== 'visible' || running.current) return;
      running.current = true;
      // A failed reload is retried by the next tick; it must not surface as an unhandled rejection.
      void latest
        .current()
        .catch(() => undefined)
        .finally(() => {
          running.current = false;
        });
    };
    const interval = setInterval(run, LEAGUE_STANDINGS_REFRESH_INTERVAL_MS);
    const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.NaN;
    // An already-passed cutoff needs no timer: the interval keeps polling until the close lands.
    const delay = cutoff - Date.now();
    const timer = delay > 0 ? setTimeout(run, Math.min(delay, MAX_TIMER_DELAY_MS)) : null;
    document.addEventListener('visibilitychange', run);
    return () => {
      clearInterval(interval);
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [enabled, cutoffAt]);
}
