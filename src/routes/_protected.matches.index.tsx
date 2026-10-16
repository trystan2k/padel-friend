import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
export const Route = createFileRoute('/_protected/matches/')({
  loader: () => listMatchEvents({ data: { entry: 'available', limit: 20 } }).catch(() => null),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <MatchesPage
        entry="available"
        initialItems={data?.items ?? []}
        initialCursor={data?.next_cursor ?? null}
        initialError={!data}
      />
    );
  }
});
