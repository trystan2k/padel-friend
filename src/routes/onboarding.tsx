import { createFileRoute, redirect } from '@tanstack/react-router';
import { PlayerOnboarding } from '../features/player/PlayerOnboarding';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/onboarding')({
  beforeLoad: async () => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) throw redirect({ to: '/login', search: { next: '/onboarding' } });
    if (status.complete) throw redirect({ to: '/dashboard' });
  },
  component: PlayerOnboarding
});
