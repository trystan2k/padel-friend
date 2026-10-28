import { createFileRoute, useRouter } from '@tanstack/react-router';
import { RecordMatchResultPage } from '../features/matches/RecordMatchResultPage';
import { getMatchEvent } from '../features/matches/matches.functions';
import {
  getMatchEventManagement,
  listMatchEventManagementParticipants
} from '../features/matches/match-management.functions';
import { listMatchEventRegistrations } from '../features/matches/match-registration.functions';
import { getMatchEventResultProposals } from '../features/matches/match-result.functions';

export const Route = createFileRoute('/_protected/matches/$eventId/record')({
  validateSearch: (search: Record<string, unknown>) => {
    const groupNumber = Number(search.groupNumber);
    return {
      correctionProposalId:
        typeof search.correctionProposalId === 'string' ? search.correctionProposalId : undefined,
      groupNumber: Number.isSafeInteger(groupNumber) && groupNumber > 0 ? groupNumber : undefined
    };
  },
  loader: async ({ params }) => {
    const data = { event_id: params.eventId };
    const [event, management, roster, participants, proposals] = await Promise.all([
      getMatchEvent({ data }).catch(() => null),
      getMatchEventManagement({ data }).catch(() => null),
      listMatchEventRegistrations({ data }).catch(() => null),
      listMatchEventManagementParticipants({ data }).catch(() => null),
      getMatchEventResultProposals({ data }).catch(() => null)
    ]);
    return {
      event: event?.status === 'ok' ? event.event : null,
      management: management?.status === 'ok' ? management.value : null,
      roster: roster?.status === 'ok' ? roster.entries : [],
      participants: participants?.status === 'ok' ? participants.value : [],
      proposals: proposals?.status === 'ok' ? proposals.value : [],
      loadError:
        event?.status !== 'ok' ||
        !roster ||
        roster.status === 'unavailable' ||
        participants?.status !== 'ok' ||
        !proposals ||
        (proposals.status === 'error' && proposals.code !== 'forbidden')
    };
  },
  component: () => {
    const data = Route.useLoaderData();
    const search = Route.useSearch();
    const router = useRouter();
    return (
      <RecordMatchResultPage
        key={`${data.event?.event_id}:${data.event?.as_of}`}
        {...data}
        correctionProposalId={search.correctionProposalId}
        initialGroup={search.groupNumber}
        onReload={() => void router.invalidate()}
        onCorrected={async () => {
          await router.invalidate();
          if (data.event)
            await router.navigate({
              to: '/matches/$eventId',
              params: { eventId: data.event.event_id }
            });
        }}
      />
    );
  }
});
