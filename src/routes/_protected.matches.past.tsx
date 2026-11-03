import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
import { MatchHistory } from '../features/statistics/MatchHistory';
import { getStatisticsHistory } from '../features/statistics/statistics-history.functions';
import type { StatisticsFilters } from '../features/statistics/statistics-contracts';
const EMPTY_ITEMS: import('../features/matches/match-model').MatchEventListItem[] = [];
const filters: StatisticsFilters = {
  communityId: null,
  leagueId: null,
  type: 'all',
  from: null,
  through: null
};
export const Route = createFileRoute('/_protected/matches/past')({
  loader: async () => {
    const [events, history] = await Promise.all([
      listMatchEvents({ data: { entry: 'past', limit: 20 } }).catch(() => null),
      getStatisticsHistory({ data: { ...filters, limit: 20, cursor: null } }).catch(() => ({
        status: 'error' as const,
        code: 'STATISTICS_UNAVAILABLE' as const
      }))
    ]);
    return { events, history };
  },
  component: () => {
    const { events, history } = Route.useLoaderData();
    return (
      <MatchesPage
        entry="past"
        initialItems={events?.items ?? EMPTY_ITEMS}
        initialCursor={events?.next_cursor ?? null}
        initialAsOf={events?.as_of ?? null}
        initialError={!events}
        history={
          <MatchHistory
            filters={filters}
            initial={history.status === 'ok' ? history.value : null}
            initialError={history.status === 'error' ? history.code : null}
          />
        }
      />
    );
  }
});
