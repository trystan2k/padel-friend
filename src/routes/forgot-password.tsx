import { createFileRoute, redirect } from '@tanstack/react-router';
import { ForgotPassword } from '../features/auth/ForgotPassword';
import { normalizeReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/forgot-password')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {})
  }),
  beforeLoad: async () => {
    const status = await getOnboardingStatus();
    if (status.authenticated) throw redirect({ to: '/dashboard' });
  },
  component: ForgotPasswordRoute
});

function ForgotPasswordRoute() {
  const { next } = Route.useSearch();
  return <ForgotPassword next={next} />;
}
