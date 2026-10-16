import { createFileRoute } from '@tanstack/react-router';
import { MatchesPage } from '../features/matches/MatchesPage';
import { listMatchEvents } from '../features/matches/matches.functions';
export const Route = createFileRoute('/_protected/matches/my')({
  loader: () => listMatchEvents({ data: { entry: 'my', limit: 20 } }).catch(() => null),
  component: () => {
    const data = Route.useLoaderData();
    return (
      <MatchesPage
        entry="my"
        initialItems={data?.items ?? []}
        initialCursor={data?.next_cursor ?? null}
        initialError={!data}
      />
    );
  }
});
