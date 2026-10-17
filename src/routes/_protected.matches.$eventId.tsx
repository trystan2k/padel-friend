import { createFileRoute, useRouter } from '@tanstack/react-router';
import { MatchDetailPage } from '../features/matches/MatchDetailPage';
import { getMatchEvent } from '../features/matches/matches.functions';

export async function loadMatchDetail(eventId: string) {
  try {
    const result = await getMatchEvent({ data: { event_id: eventId } });
    if (result.status === 'ok') return { event: result.event, failed: false };
    return { event: null, failed: result.status === 'error' };
  } catch {
    return { event: null, failed: true };
  }
}

export const Route = createFileRoute('/_protected/matches/$eventId')({
  loader: async ({ params }) => loadMatchDetail(params.eventId),
  component: () => {
    const data = Route.useLoaderData();
    const router = useRouter();
    return (
      <MatchDetailPage
        event={data.event}
        loadError={data.failed}
        onRetry={() => void router.invalidate()}
      />
    );
  }
});
