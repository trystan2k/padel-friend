import { createFileRoute } from '@tanstack/react-router';
import { LeagueDetailPage } from '../features/leagues/LeagueDetailPage';
import { LeagueLoading, LeagueRouteError } from '../features/leagues/LeagueRouteStates';
import { getLeague, getLeagueCounters } from '../features/leagues/league.functions';

export const Route = createFileRoute('/_protected/community/$communityId/leagues/$leagueId')({
  loader: async ({ params }) => {
    const detail = await getLeague({ data: { league_id: params.leagueId } });
    // Counters are supplementary: an unavailable reader must not hide the League itself.
    const counters = await getLeagueCounters({ data: { league_id: params.leagueId } }).catch(
      () => null
    );
    return { detail, counters };
  },
  pendingComponent: LeagueLoading,
  errorComponent: LeagueRouteError,
  component: () => {
    const { detail, counters } = Route.useLoaderData();
    return <LeagueDetailPage data={detail} counters={counters} />;
  }
});
