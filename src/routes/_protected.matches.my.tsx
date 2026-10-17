import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
const EMPTY_ITEMS: import('../features/matches/match-model').MatchEventListItem[] = [];
export const Route = createFileRoute('/_protected/matches/my')({
  loader: () => listMatchEvents({ data: { entry: 'my', limit: 20 } }).catch(() => null),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <MatchesPage
        entry="my"
        initialItems={data?.items ?? EMPTY_ITEMS}
        initialCursor={data?.next_cursor ?? null}
        initialError={!data}
      />
    );
  }
});
