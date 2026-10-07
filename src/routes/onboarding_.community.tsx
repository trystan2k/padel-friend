import { createFileRoute, redirect } from '@tanstack/react-router';
import { CommunityOnboarding } from '../features/community/CommunityOnboarding';
import { listPublicCommunities } from '../features/community/community.functions';
import { getOnboardingStatus } from '../features/player/player.functions';

export const Route = createFileRoute('/onboarding_/community')({
  validateSearch: (search: Record<string, unknown>): { q?: string; view?: 'create' } => {
    const q = typeof search.q === 'string' ? search.q.trim() : '';
    return {
      ...(q &&
      Array.from(q).length <= 80 &&
      !Array.from(q).some((char) => char.charCodeAt(0) === 0 || /^[\uD800-\uDFFF]$/u.test(char))
        ? { q }
        : {}),
      ...(search.view === 'create' ? { view: 'create' as const } : {})
    };
  },
  beforeLoad: async () => {
    const status = await getOnboardingStatus();
    if (!status.authenticated)
      throw redirect({ to: '/login', search: { next: '/onboarding/community' } });
    if (!status.complete) throw redirect({ to: '/onboarding' });
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
        throw redirect({ to: '/login', search: { next: '/onboarding/community' } });
      return { communities: [], next_offset: null, failed: true };
    }
  },
  component: CommunityRoute
});

function CommunityRoute() {
  const search = Route.useSearch();
  const data = Route.useLoaderData();
  return (
    <CommunityOnboarding
      key={`${search.view ?? 'discovery'}:${search.q ?? ''}`}
      search={search}
      data={data}
    />
  );
}
