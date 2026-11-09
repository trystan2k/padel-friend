import { useEffect } from 'react';
import { REFRESH_INTERVAL_MS } from '../../lib/authoritative-refresh';
import { useAuthoritativeRefresh } from '../../lib/use-authoritative-refresh';

/** Cadence of the visible-page reload: the shared authoritative refresh cadence. */
export const LEAGUE_STANDINGS_REFRESH_INTERVAL_MS = REFRESH_INTERVAL_MS;
/** Longest delay `setTimeout` accepts; a farther cutoff is reached through the cadence instead. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Reloads while the page is visible: on the shared authoritative cadence (other members may have
 * confirmed results meanwhile), once whenever it becomes visible again, and once at `cutoffAt` so a
 * Fixed League's close is picked up without user action. Never overlaps itself and stops as soon
 * as it is disabled or unmounted.
 */
export function useRefreshWhenVisible(
  refresh: () => Promise<unknown>,
  enabled: boolean,
  cutoffAt: string | null = null,
  scope = 'league'
) {
  const { refreshNow } = useAuthoritativeRefresh({ scope, enabled, refresh });
  useEffect(() => {
    if (!enabled) return undefined;
    const cutoff = cutoffAt ? Date.parse(cutoffAt) : Number.NaN;
    // An already-passed cutoff needs no timer: the cadence keeps polling until the close lands.
    const delay = cutoff - Date.now();
    if (!(delay > 0)) return undefined;
    const timer = setTimeout(refreshNow, Math.min(delay, MAX_TIMER_DELAY_MS));
    return () => clearTimeout(timer);
  }, [enabled, cutoffAt, refreshNow]);
}
