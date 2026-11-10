import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { optionalReturnPath } from '../features/auth/return-path';
import { useAuthIdentityGuard } from '../lib/use-auth-identity-guard';
import { getOnboardingStatus } from '../features/player/player.functions';

// Retires every mounted private view the moment the browser identity ends or is replaced.
function ProtectedLayout() {
  useAuthIdentityGuard(Route.useRouteContext({ select: (context) => context.authUserId }));
  return <Outlet />;
}

export const Route = createFileRoute('/_protected')({
  beforeLoad: async ({ location }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) {
      throw redirect({
        to: '/login',
        search: optionalReturnPath(location.href),
        headers: { 'Cache-Control': 'private, no-store' }
      });
    }
    if (!status.complete)
      throw redirect({ to: '/onboarding', search: optionalReturnPath(location.href) });
    return { authUserId: status.userId };
  },
  component: ProtectedLayout
});
