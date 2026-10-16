import { createFileRoute } from '@tanstack/react-router';
import { MatchDetailPage } from '../features/matches/MatchDetailPage';
import { getMatchEvent } from '../features/matches/matches.functions';
export const Route = createFileRoute('/_protected/matches/$eventId')({
  loader: ({ params }) => getMatchEvent({ data: { event_id: params.eventId } }).catch(() => null),
  component: () => (
    <MatchDetailPage event={Route.useLoaderData() as Record<string, unknown> | null} />
  )
});
