import { createFileRoute, useRouter } from '@tanstack/react-router';
import { MatchDetailPage } from '../features/matches/MatchDetailPage';
import { getMatchEvent } from '../features/matches/matches.functions';
import {
  getMyMatchRegistration,
  listMatchEventRegistrations,
  listMatchEventRegistrationRequests
} from '../features/matches/match-registration.functions';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { getMyMatchInvitation } from '../features/matches/match-invitation.functions';
import {
  getMatchEventManagement,
  listMatchEventManagementParticipants
} from '../features/matches/match-management.functions';

export async function loadMatchDetail(eventId: string) {
  try {
    const result = await getMatchEvent({ data: { event_id: eventId } });
    if (result.status === 'ok') return { event: result.event, failed: false };
    return { event: null, failed: result.status === 'error' };
  } catch {
    return { event: null, failed: true };
  }
}

// The caller's own registration DTO is loaded separately from the flat T04
// event projection so the flat primitive decoder stays intact.
export async function loadMatchRegistration(eventId: string) {
  try {
    const result = await getMyMatchRegistration({ data: { event_id: eventId } });
    if (result.status === 'ok')
      return { registration: result.registration, registrationFailed: false };
    return { registration: null, registrationFailed: true };
  } catch {
    return { registration: null, registrationFailed: true };
  }
}

// Creator-only pending queue. The server returns no rows to non-creators, so
// callers without permission never receive a queue payload.
export async function loadMatchRequestQueue(eventId: string) {
  try {
    const result = await listMatchEventRegistrationRequests({ data: { event_id: eventId } });
    if (result.status === 'ok') return { queue: result.queue, queueFailed: false };
    return { queue: null, queueFailed: result.status === 'unavailable' };
  } catch {
    return { queue: null, queueFailed: true };
  }
}

// Accepted-roster read. The RPC is gated by event readability, so a caller who
// cannot read the event (or a malformed payload) degrades to an absent roster
// rather than throwing; the panel falls back to its own placement row.
export async function loadMatchRoster(eventId: string) {
  try {
    const result = await listMatchEventRegistrations({ data: { event_id: eventId } });
    if (result.status === 'ok') return { roster: result.entries };
    return { roster: null };
  } catch {
    return { roster: null };
  }
}

// Best-effort caller rating for the "Level range … · You: …" caption. An
// un-onboarded caller simply renders the range without the caller figure.
export async function loadCallerLevel() {
  try {
    const profile = await getMyPlayerProfile();
    return typeof profile.display_level === 'number' ? profile.display_level : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute('/_protected/matches/$eventId')({
  loader: async ({ params }) => {
    const detail = await loadMatchDetail(params.eventId);
    const registration = await loadMatchRegistration(params.eventId);
    const capabilities = await getMatchEventManagement({
      data: { event_id: params.eventId }
    }).catch(() => null);
    const eventManagement = capabilities?.status === 'ok' ? capabilities.value : null;
    const isCreator = eventManagement?.is_organizer === true;
    const [callerLevel, requestQueue, roster, invitation, management] = await Promise.all([
      loadCallerLevel(),
      isCreator
        ? loadMatchRequestQueue(params.eventId)
        : Promise.resolve({ queue: null, queueFailed: false }),
      loadMatchRoster(params.eventId),
      getMyMatchInvitation({ data: { event_id: params.eventId } }).catch(() => ({
        status: 'unavailable' as const
      })),
      isCreator
        ? listMatchEventManagementParticipants({ data: { event_id: params.eventId } }).catch(
            () => ({ status: 'error' as const })
          )
        : Promise.resolve(null)
    ]);
    return {
      ...detail,
      ...registration,
      isCreator,
      eventManagement,
      callerLevel,
      ...requestQueue,
      ...roster,
      invitation: invitation.status === 'ok' ? invitation.invitation : null,
      managementParticipants: management?.status === 'ok' ? management.value : [],
      managementError: management !== null && management.status !== 'ok'
    };
  },
  component: () => {
    const data = Route.useLoaderData();
    const router = useRouter();
    return (
      <MatchDetailPage
        event={data.event}
        loadError={data.failed}
        onRetry={() => void router.invalidate()}
        registration={data.registration}
        registrationError={data.registrationFailed}
        callerLevel={data.callerLevel}
        isCreator={data.isCreator}
        management={data.eventManagement}
        queue={data.queue}
        queueError={data.queueFailed}
        roster={data.roster}
        invitation={data.invitation}
        managementParticipants={data.managementParticipants}
        managementError={data.managementError}
      />
    );
  }
});
