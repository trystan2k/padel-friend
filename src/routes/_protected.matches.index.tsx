import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
const EMPTY_ITEMS: import('../features/matches/match-model').MatchEventListItem[] = [];
export const Route = createFileRoute('/_protected/matches/')({
  loader: () => listMatchEvents({ data: { entry: 'available', limit: 20 } }).catch(() => null),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <MatchesPage
        entry="available"
        initialItems={data?.items ?? EMPTY_ITEMS}
        initialCursor={data?.next_cursor ?? null}
        initialAsOf={data?.as_of ?? null}
        initialError={!data}
      />
    );
  }
});
