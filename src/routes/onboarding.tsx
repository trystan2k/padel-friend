import { createFileRoute, redirect } from '@tanstack/react-router';
import { ClaimPasswordStep } from '../features/player/ClaimPasswordStep';
import { PlayerOnboarding } from '../features/player/PlayerOnboarding';
import { ProvisionalClaimVerify } from '../features/player/ProvisionalClaimVerify';
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
    return { claim: status.claim, needsPasswordSetup: status.needsPasswordSetup };
  },
  component: Onboarding
});

function Onboarding() {
  const { claim, needsPasswordSetup } = Route.useRouteContext();
  const { next } = Route.useSearch();
  // A claim already went through but its password is still owed (reload, other device).
  if (needsPasswordSetup) return <ClaimPasswordStep next={next} />;
  if (claim?.state === 'unverified') return <ProvisionalClaimVerify />;
  return <PlayerOnboarding next={next} claim={claim ?? undefined} />;
}
