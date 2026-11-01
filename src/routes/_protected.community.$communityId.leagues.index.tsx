import { createFileRoute } from '@tanstack/react-router';
import { LeagueListPage } from '../features/leagues/LeagueListPage';
import { LeagueLoading, LeagueRouteError } from '../features/leagues/LeagueRouteStates';
import { listLeagues } from '../features/leagues/league.functions';

export const Route = createFileRoute('/_protected/community/$communityId/leagues/')({
  loader: ({ params }) => listLeagues({ data: { community_id: params.communityId } }),
  pendingComponent: LeagueLoading,
  errorComponent: LeagueRouteError,
  component: () => <LeagueListPage data={Route.useLoaderData()} />
});
