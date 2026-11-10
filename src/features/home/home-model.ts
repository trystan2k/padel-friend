import type { MatchEventRpcListRow } from '../matches/match-contracts';
import type { RatingHistoryItem } from '../player/rating-contracts';
import type { PlayerRankTransition } from '../statistics/statistics-player-contracts';
import type {
  HomeAction,
  HomeActivity,
  HomeCommunity,
  HomeMatchCard,
  HomeRankMovement,
  HomeSelection,
  HomeSkillRank
} from './home-contracts';

export const HOME_ACTIVITY_LIMIT = 5;
export const HOME_AVAILABLE_LIMIT = 3;
export const HOME_LEAGUE_TOP = 3;

type CardSource = Pick<
  MatchEventRpcListRow,
  | 'event_id'
  | 'venue_name'
  | 'starts_at'
  | 'timezone'
  | 'community_name'
  | 'caller_badge'
  | 'playing_count'
  | 'more_needed'
  | 'competition_status'
>;

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Stable membership order: name, then id. The first entry is the deterministic default. */
export function sortCommunities(communities: HomeCommunity[]): HomeCommunity[] {
  return [...communities].sort(
    (a, b) => compareText(a.name.toLowerCase(), b.name.toLowerCase()) || compareText(a.id, b.id)
  );
}

/** Selection is navigation context only: an unknown id falls back without echoing anything. */
export function resolveSelection(
  communities: HomeCommunity[],
  requested: string | null
): HomeSelection {
  const sorted = sortCommunities(communities);
  const match = requested === null ? undefined : sorted.find(({ id }) => id === requested);
  return {
    selectedId: match?.id ?? sorted[0]?.id ?? null,
    requestedUnavailable: requested !== null && match === undefined
  };
}

export function toMatchCard(row: CardSource): HomeMatchCard {
  return {
    event_id: row.event_id,
    venue_name: row.venue_name,
    starts_at: row.starts_at,
    timezone: row.timezone,
    community_name: row.community_name,
    caller_badge: row.caller_badge,
    playing_count: row.playing_count,
    more_needed: row.more_needed,
    competition_status: row.competition_status
  };
}

/** Authoritative instant (not localized text) then event id; past and cancelled never qualify. */
export function pickNearestUpcoming<
  T extends Pick<MatchEventRpcListRow, 'event_id' | 'starts_at' | 'status' | 'is_past'>
>(rows: T[], asOf: string): T | null {
  const now = Date.parse(asOf);
  const eligible = rows
    .map((row) => ({ row, instant: Date.parse(row.starts_at) }))
    .filter(
      ({ row, instant }) =>
        Number.isFinite(instant) && row.status === 'open' && !row.is_past && instant > now
    )
    .sort((a, b) => a.instant - b.instant || compareText(a.row.event_id, b.row.event_id));
  return eligible[0]?.row ?? null;
}

/** Position 1 is best: a lower position than before is a move up. No prior point is "new". */
export function rankMovement(
  current: number | null,
  previous: number | null | undefined
): HomeRankMovement | null {
  if (current === null) return null;
  if (previous === null || previous === undefined) return { state: 'new' };
  if (previous === current) return { state: 'same' };
  return current < previous
    ? { state: 'up', places: previous - current }
    : { state: 'down', places: current - previous };
}

/** Transitions arrive newest first for one community; only a proven ranked point has a position. */
export function skillRankOf(transitions: PlayerRankTransition[]): HomeSkillRank | null {
  const [latest, ...older] = transitions;
  if (!latest) return null;
  if (latest.status !== 'ranked' || latest.position === null || !latest.complete)
    return {
      status: latest.status,
      position: null,
      rankedMembers: null,
      movement: null
    };
  const previous = older.find((item) => item.status === 'ranked' && item.complete);
  return {
    status: 'ranked',
    position: latest.position,
    rankedMembers: latest.rankedMembers,
    movement: rankMovement(latest.position, previous?.position)
  };
}

type ActionRow = Pick<
  MatchEventRpcListRow,
  | 'event_id'
  | 'venue_name'
  | 'starts_at'
  | 'timezone'
  | 'caller_badge'
  | 'result_summary'
  | 'status'
>;

function action(row: ActionRow, kind: HomeAction['kind'], count: number | null): HomeAction {
  return {
    kind,
    event_id: row.event_id,
    venue_name: row.venue_name,
    starts_at: row.starts_at,
    timezone: row.timezone,
    count
  };
}

/** Past events where the caller may have a result to review; the reader confirms eligibility. */
export function isResultReviewCandidate(row: ActionRow) {
  const participant = row.caller_badge === 'playing' || row.caller_badge === 'creator';
  return row.status === 'open' && participant && row.result_summary.pending_group_count > 0;
}

/**
 * Actionable items from authoritative statuses only. Upcoming rows yield reconfirmation, Reserve
 * standby and organizer requests; past rows yield result review only for groups the caller may
 * approve or reject (`reviewCounts`). Ordered by urgency kind, then
 * instant and id so the list is stable.
 */
export function deriveActions(
  upcoming: ActionRow[],
  past: ActionRow[],
  requestCounts: ReadonlyMap<string, number>,
  reviewCounts: ReadonlyMap<string, number>
): HomeAction[] {
  const items: HomeAction[] = [];
  for (const row of past) {
    const reviewable = reviewCounts.get(row.event_id) ?? 0;
    if (isResultReviewCandidate(row) && reviewable > 0)
      items.push(action(row, 'result_review', reviewable));
  }
  for (const row of upcoming) {
    if (row.status !== 'open') continue;
    if (row.caller_badge === 'reconfirmation_required')
      items.push(action(row, 'reconfirmation', null));
    else if (row.caller_badge === 'reserve' || row.caller_badge === 'reserve_not_playing')
      items.push(action(row, 'reserve_standby', null));
    const requests = requestCounts.get(row.event_id) ?? 0;
    if (requests > 0) items.push(action(row, 'organizer_requests', requests));
  }
  const order = ['result_review', 'reconfirmation', 'organizer_requests', 'reserve_standby'];
  return items.sort(
    (a, b) =>
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      Date.parse(a.starts_at) - Date.parse(b.starts_at) ||
      compareText(a.event_id, b.event_id)
  );
}

/** Committed ledger changes and committed rank transitions only, newest first and bounded. */
export function mergeActivity(
  ratingItems: RatingHistoryItem[],
  transitions: PlayerRankTransition[],
  truncated = false
): HomeActivity[] {
  const rating: HomeActivity[] = ratingItems.map((item) =>
    item.kind === 'match'
      ? {
          kind: 'rating',
          at: item.played_at,
          scope: 'global',
          event_id: item.match_event_id,
          delta: item.applied_delta,
          level: item.after_display_level,
          reliability: item.after_reliability_percent
        }
      : {
          kind: 'adjustment',
          at: item.effective_at,
          scope: 'global',
          level: item.after_display_level,
          reliability: item.after_reliability_percent
        }
  );
  const ranked = transitions.filter(
    (item) => item.status === 'ranked' && item.position !== null && item.complete
  );
  const rank: HomeActivity[] = ranked.flatMap((item, index) => {
    const before = ranked[index + 1]?.position ?? null;
    // Only an actual change is activity. The oldest point of a truncated page has an unknown
    // prior, so it is dropped rather than shown as a new entry.
    if (truncated && index === ranked.length - 1) return [];
    return item.position === before || item.position === null
      ? []
      : [
          {
            kind: 'rank' as const,
            at: item.effectiveFrom,
            scope: 'community' as const,
            position: item.position,
            previous: before
          }
        ];
  });
  return [...rating, ...rank]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || compareText(a.kind, b.kind))
    .slice(0, HOME_ACTIVITY_LIMIT);
}
