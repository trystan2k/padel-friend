import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoginWelcome } from '../features/auth/LoginWelcome';
import { normalizeReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/login')({
  validateSearch: (
    search: Record<string, unknown>
  ): { next?: string; authError?: boolean; reset?: 'sent' } => ({
    ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {}),
    ...(search.authError === '1' ? { authError: true } : {}),
    ...(search.reset === 'sent' ? { reset: 'sent' } : {})
  }),
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) return;
    if (!status.complete) throw redirect({ to: '/onboarding' });
    throw redirect({ href: normalizeReturnPath(search.next) });
  },
  component: Login
});

function Login() {
  const { next, authError, reset } = Route.useSearch();
  return <LoginWelcome next={next} authError={authError} resetSent={reset === 'sent'} />;
}
