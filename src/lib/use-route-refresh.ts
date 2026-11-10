import { useRouter } from '@tanstack/react-router';
import { useAuthoritativeRefresh } from './use-authoritative-refresh';

/**
 * Authoritative refresh for loader-backed surfaces: invalidating the router re-runs the route's
 * authorized loaders, so children never keep an old loader seed.
 */
export function useRouteRefresh({ scope, enabled = true }: { scope: string; enabled?: boolean }) {
  const router = useRouter();
  return useAuthoritativeRefresh({ scope, enabled, refresh: () => router.invalidate() });
}
