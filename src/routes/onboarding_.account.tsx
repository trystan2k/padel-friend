import { createFileRoute, redirect } from '@tanstack/react-router';
import { AccountSignup } from '../features/auth/AccountSignup';
import { normalizeReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/onboarding_/account')({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({
    ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {})
  }),
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) return;
    if (!status.complete) throw redirect({ to: '/onboarding' });
    throw redirect({ href: normalizeReturnPath(search.next) });
  },
  component: Account
});

function Account() {
  const { next } = Route.useSearch();
  return <AccountSignup next={next} />;
}
