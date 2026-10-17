import { createFileRoute, redirect } from '@tanstack/react-router';
import { PlayerOnboarding } from '../features/player/PlayerOnboarding';
import { getOnboardingStatus } from '../features/player/player.functions';
import { normalizeReturnPath, optionalReturnPath } from '../features/auth/return-path';

export const Route = createFileRoute('/onboarding')({
  validateSearch: (search: Record<string, unknown>): { next?: string } =>
    search.next === undefined ? {} : { next: normalizeReturnPath(search.next) },
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated)
      throw redirect({ to: '/login', search: optionalReturnPath('/onboarding') });
    if (status.complete) throw redirect({ href: search.next ?? '/dashboard' });
  },
  component: Onboarding
});

function Onboarding() {
  return <PlayerOnboarding next={Route.useSearch().next} />;
}
