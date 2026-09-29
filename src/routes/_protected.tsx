import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { normalizeReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) {
      throw redirect({
        to: '/login',
        search: { next: normalizeReturnPath(location.href) },
        headers: { 'Cache-Control': 'private, no-store' }
      });
    }
    if (!status.complete) throw redirect({ to: '/onboarding' });
  },
  component: () => <Outlet />
});
