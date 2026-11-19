import { createFileRoute } from '@tanstack/react-router';
import { CommunitySurface, CommunitySurfaceError } from '../features/community/CommunitySurface';
import { loadCommunitySurface, parseRankingSearch } from '../features/community/community-surface';
import { LoadingProfile } from '../features/player/ProfileStates';

export const Route = createFileRoute('/_protected/community/$communityId/ranking')({
  validateSearch: parseRankingSearch,
  loader: ({ params }) => loadCommunitySurface(params.communityId, 'ranking'),
  pendingComponent: LoadingProfile,
  errorComponent: CommunitySurfaceError,
  component: () => (
    <CommunitySurface
      data={Route.useLoaderData()}
      view="ranking"
      ranking={Route.useSearch().by ?? 'skill'}
    />
  )
});
