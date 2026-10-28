import { getMatchEventResultProposals } from './match-result.functions';

/** Best-effort private proposal read consumed by the match route adapter. */
export async function loadMatchResultProposals(eventId: string) {
  try {
    const result = await getMatchEventResultProposals({ data: { event_id: eventId } });
    return {
      proposals: result.status === 'ok' ? result.value : [],
      proposalsError: result.status === 'error' ? result.code !== 'forbidden' : false,
      proposalsForbidden: result.status === 'error' && result.code === 'forbidden'
    };
  } catch {
    return { proposals: [], proposalsError: true, proposalsForbidden: false };
  }
}
