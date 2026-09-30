import { createFileRoute, redirect } from '@tanstack/react-router';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const status = await getOnboardingStatus();
    throw redirect({
      to: status.authenticated ? '/dashboard' : '/login',
      headers: { 'Cache-Control': 'private, no-store' }
    });
  }
});
