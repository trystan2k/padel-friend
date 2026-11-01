import { createFileRoute } from '@tanstack/react-router';
import { LeagueDetailPage } from '../features/leagues/LeagueDetailPage';
import { LeagueLoading, LeagueRouteError } from '../features/leagues/LeagueRouteStates';
import { getLeague } from '../features/leagues/league.functions';

export const Route = createFileRoute('/_protected/community/$communityId/leagues/$leagueId')({
  loader: ({ params }) => getLeague({ data: { league_id: params.leagueId } }),
  pendingComponent: LeagueLoading,
  errorComponent: LeagueRouteError,
  component: () => <LeagueDetailPage data={Route.useLoaderData()} />
});
