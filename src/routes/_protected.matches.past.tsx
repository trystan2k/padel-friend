import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
export const Route = createFileRoute('/_protected/matches/past')({
  loader: () => listMatchEvents({ data: { entry: 'past', limit: 20 } }).catch(() => null),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <MatchesPage
        entry="past"
        initialItems={data?.items ?? []}
        initialCursor={data?.next_cursor ?? null}
        initialError={!data}
      />
    );
  }
});
