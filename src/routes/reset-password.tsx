import { createFileRoute, redirect } from '@tanstack/react-router';
import { ResetPassword } from '../features/auth/ResetPassword';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/reset-password')({
  beforeLoad: async () => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) throw redirect({ to: '/forgot-password' });
  },
  component: ResetPassword
});
