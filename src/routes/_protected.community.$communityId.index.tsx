import { createFileRoute } from '@tanstack/react-router';
import { CommunitySurface, CommunitySurfaceError } from '../features/community/CommunitySurface';
import { loadCommunitySurface } from '../features/community/community-surface';
import { LoadingProfile } from '../features/player/ProfileStates';

export const Route = createFileRoute('/_protected/community/$communityId/')({
  loader: ({ params }) => loadCommunitySurface(params.communityId, 'overview'),
  pendingComponent: LoadingProfile,
  errorComponent: CommunitySurfaceError,
  component: () => <CommunitySurface data={Route.useLoaderData()} view="overview" />
});
