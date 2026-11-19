import { createFileRoute } from '@tanstack/react-router';
import { CommunitySurface, CommunitySurfaceError } from '../features/community/CommunitySurface';
import { loadCommunitySurface } from '../features/community/community-surface';
import { LoadingProfile } from '../features/player/ProfileStates';
import { parseHomeSearch } from '../features/home/home.validators';

export const Route = createFileRoute('/_protected/community/')({
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => ({ community: search.community }),
  loader: ({ deps }) => loadCommunitySurface(deps.community ?? null, 'overview'),
  pendingComponent: LoadingProfile,
  errorComponent: CommunitySurfaceError,
  component: () => <CommunitySurface data={Route.useLoaderData()} view="overview" />
});
