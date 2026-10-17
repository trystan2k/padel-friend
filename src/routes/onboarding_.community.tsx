import { createFileRoute, redirect } from '@tanstack/react-router';
import { CommunityOnboarding } from '../features/community/CommunityOnboarding';
import { listPublicCommunities } from '../features/community/community.functions';
import { getOnboardingStatus } from '../features/player/player.functions';
import { normalizeReturnPath, optionalReturnPath } from '../features/auth/return-path';

export const Route = createFileRoute('/onboarding_/community')({
  validateSearch: (
    search: Record<string, unknown>
  ): { q?: string; view?: 'create'; next?: string } => {
    const q = typeof search.q === 'string' ? search.q.trim() : '';
    return {
      ...(q &&
      Array.from(q).length <= 80 &&
      !Array.from(q).some((char) => char.charCodeAt(0) === 0 || /^[\uD800-\uDFFF]$/u.test(char))
        ? { q }
        : {}),
      ...(search.view === 'create' ? { view: 'create' as const } : {}),
      ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {})
    };
  },
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated)
      throw redirect({ to: '/login', search: optionalReturnPath('/onboarding/community') });
    if (!status.complete)
      throw redirect({ to: '/onboarding', search: optionalReturnPath(search.next) });
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (deps.view === 'create') return { communities: [], next_offset: null, failed: false };
    try {
      return {
        ...(await listPublicCommunities({
          data: { ...(deps.q ? { search: deps.q } : {}), limit: 20, offset: 0 }
        })),
        failed: false
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED')
        throw redirect({ to: '/login', search: optionalReturnPath('/onboarding/community') });
      return { communities: [], next_offset: null, failed: true };
    }
  },
  component: CommunityRoute
});

function CommunityRoute() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  return <CommunityOnboarding search={search} data={data} next={search.next} />;
}
