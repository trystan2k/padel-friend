import { createFileRoute } from '@tanstack/react-router';
import { CreateLeaguePage } from '../features/leagues/CreateLeaguePage';
import { LeagueLoading, LeagueRouteError } from '../features/leagues/LeagueRouteStates';
import { todayInZone } from '../features/leagues/league-form';
import { listLeagues } from '../features/leagues/league.functions';

export const Route = createFileRoute('/_protected/community/$communityId/leagues/create')({
  loader: async ({ params }) => {
    const data = await listLeagues({ data: { community_id: params.communityId } });
    // Resolved once in the loader so server render and hydration agree on the default start date.
    return { data, today: todayInZone(data.community.timezone) };
  },
  pendingComponent: LeagueLoading,
  errorComponent: LeagueRouteError,
  component: () => {
    const { data, today } = Route.useLoaderData();
    return <CreateLeaguePage data={data} today={today} />;
  }
});
