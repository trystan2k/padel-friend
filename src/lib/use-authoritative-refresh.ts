import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createRefreshLoop,
  type RefreshContext,
  type RefreshLoop,
  type RefreshStatus
} from './authoritative-refresh';

/**
 * Keeps a mounted, authorized view converged with the server by re-reading it on a bounded cadence
 * (visible + online only). `scope` identifies the view (user/community/event/League): changing it,
 * disabling the hook or unmounting retires the loop and discards any read still in flight.
 * Callbacks stay current without re-subscribing. The read itself must go through an authorized
 * reader (server function / router loader): nothing here opens a channel or caches private data.
 */
export function useAuthoritativeRefresh({
  scope,
  refresh,
  enabled = true,
  intervalMs,
  onFatal
}: {
  scope: string;
  refresh: (context: RefreshContext) => Promise<unknown>;
  enabled?: boolean;
  intervalMs?: number;
  onFatal?: (error: unknown) => void;
}) {
  const [state, setState] = useState<{ scope: string; status: RefreshStatus }>({
    scope,
    status: 'idle'
  });
  const latest = useRef({ refresh, onFatal });
  const loop = useRef<RefreshLoop | null>(null);
  useEffect(() => {
    latest.current = { refresh, onFatal };
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const next = createRefreshLoop({
      refresh: (context) => latest.current.refresh(context),
      intervalMs,
      onStatus: (status) => setState({ scope, status }),
      onFatal: (error) => latest.current.onFatal?.(error)
    });
    loop.current = next;
    next.start();
    return () => {
      next.stop();
      if (loop.current === next) loop.current = null;
    };
  }, [scope, enabled, intervalMs]);

  const refreshNow = useCallback(() => loop.current?.refreshNow(), []);
  return { status: state.scope === scope ? state.status : 'idle', refreshNow };
}
