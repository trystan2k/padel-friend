import { useEffect, useRef } from 'react';

/**
 * Reloads once whenever the page becomes visible again (other members may have confirmed results
 * meanwhile). Never overlaps itself and stops as soon as it is disabled or unmounted.
 */
export function useRefreshWhenVisible(refresh: () => Promise<unknown>, enabled: boolean) {
  const latest = useRef(refresh);
  const running = useRef(false);
  useEffect(() => {
    latest.current = refresh;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || running.current) return;
      running.current = true;
      void latest.current().finally(() => {
        running.current = false;
      });
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled]);
}
