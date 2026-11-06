import { getMyPlayerProfile } from '../player/player.functions';
import { getResultAdminCapability } from '../result-repairs/repair.functions';
import { getMatchEventResultProposals } from './match-result.functions';
import type { ResultCorrectionsData } from './MatchResultCorrections';
import { getResultAmendments } from './result-amendment.functions';

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

/**
 * Best-effort correction read for the match route adapter. A failed read degrades to a visible
 * unavailable note; the admin flag only gates display, since each command is authorized by SQL.
 */
export async function loadResultCorrections(
  eventId: string,
  communityId: string | null
): Promise<ResultCorrectionsData> {
  const [amendments, isAdmin, caller] = await Promise.all([
    getResultAmendments({ data: { event_id: eventId } }).catch(() => null),
    communityId
      ? getResultAdminCapability({ data: { community_id: communityId } }).catch(() => false)
      : Promise.resolve(false),
    getMyPlayerProfile().catch(() => null)
  ]);
  if (amendments?.status === 'ok')
    return {
      amendments: amendments.value,
      amendmentsError: false,
      isAdmin,
      callerId: caller?.user_id ?? null
    };
  // Unreadable corrections look like none for callers without access to them.
  const forbidden =
    amendments?.status === 'error' &&
    (amendments.code === 'forbidden' || amendments.code === 'not_found');
  return {
    amendments: [],
    amendmentsError: !forbidden,
    isAdmin,
    callerId: caller?.user_id ?? null
  };
}
