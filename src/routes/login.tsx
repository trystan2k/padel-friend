import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginWelcome } from '../features/auth/LoginWelcome';
import { normalizeReturnPath, optionalReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>
  ): { next?: string; authError?: boolean; expired?: boolean; reset?: 'sent' } => ({
    ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {}),
    ...(search.authError === '1' ? { authError: true } : {}),
    ...(search.expired === '1' ? { expired: true } : {}),
    ...(search.reset === 'sent' ? { reset: 'sent' } : {})
  }),
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) return;
    if (!status.complete)
      throw redirect({ to: '/onboarding', search: optionalReturnPath(search.next) });
    throw redirect({ href: normalizeReturnPath(search.next) });
  },
  component: Login
});

function Login() {
  const { next, authError, expired, reset } = Route.useSearch();
  return (
    <LoginWelcome
      next={next}
      authError={authError}
      expired={expired}
      resetSent={reset === 'sent'}
    />
  );
}
