import { getMatchEventResultProposals } from './match-result.functions';

/** Best-effort private proposal read consumed by the match route adapter. */
export async function loadMatchResultProposals(eventId: string) {
  try {
    const result = await getMatchEventResultProposals({ data: { event_id: eventId } });
    // This route still renders the pending-only placeholder. Keep its current
    // UI semantics until the lifecycle UI lands; the feature read retains every
    // authoritative status for lifecycle-aware consumers.
    return {
      proposals:
        result.status === 'ok'
          ? result.value.filter((proposal) => proposal.status === 'pending')
          : [],
      proposalsError: result.status === 'error' ? result.code !== 'forbidden' : false
    };
  } catch {
    return { proposals: [], proposalsError: true };
  }
}
