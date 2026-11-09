import { validateMatchUuid } from '../matches/matches.validators';

export type ResultNotificationKind =
  | 'result_review_needed'
  | 'result_added'
  | 'result_corrected'
  | 'result_disputed'
  | 'result_confirmed'
  | 'result_deadline_reminder'
  | 'result_entry_ready'
  | 'result_amendment_resolved'
  | 'result_amendment_requested'
  | 'result_amendment_accepted'
  | 'result_amendment_rejected'
  | 'result_repair_queued'
  | 'result_repair_applied'
  | 'result_repair_failed';

export type ResultNotificationContext = {
  notification_id: string;
  notification_kind: ResultNotificationKind;
  match_event_id: string;
  community_id: string;
  proposal_id: string | null;
  proposal_version: number | null;
  group_number: number | null;
  proposal_status: 'pending' | 'disputed' | 'confirmed' | 'superseded' | null;
  current_version: number | null;
  current_status: 'pending' | 'disputed' | 'confirmed' | null;
  is_current: boolean;
  classification: 'team_a' | 'team_b' | 'draw' | 'incomplete' | null;
  winner_sets: number | null;
  loser_sets: number | null;
  score: string | null;
  submitted_by_name: string | null;
  review_deadline_at: string | null;
  venue: string;
  starts_at: string;
  timezone: string;
  entry_ready: boolean;
};

export type LevelReviewNotificationContext = {
  request_id: string;
  outcome: 'approved' | 'rejected';
  requested_min_level: number;
  requested_max_level: number;
  approved_level: number | null;
  decided_at: string;
  decision_note: string;
  adjustment_id: string | null;
};

export type NotificationTarget = {
  target_status: string;
  destination_href?: string | null;
  community_id: string | null;
  community_name: string | null;
  invitation_id: string | null;
  membership_status: string | null;
  match_event_id?: string | null;
  match_available?: boolean;
  // The store has no payload column: kind drives the heading/body and created_at
  // supplies the approval instant for registration notifications.
  kind?: string | null;
  created_at?: string | null;
  result_context?: ResultNotificationContext | null;
  level_review_context?: LevelReviewNotificationContext | null;
};
export type NotificationTargetInput = Omit<
  NotificationTarget,
  'result_context' | 'level_review_context'
> & {
  result_context?: unknown;
  level_review_context?: unknown;
};

/** Cancelled events intentionally resolve through the same safe target as open
 * events. Readability is authoritative SQL-side, never inferred from the kind. */
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resultKinds = [
  'result_review_needed',
  'result_added',
  'result_corrected',
  'result_disputed',
  'result_confirmed',
  'result_deadline_reminder',
  'result_entry_ready',
  'result_amendment_resolved',
  'result_amendment_requested',
  'result_amendment_accepted',
  'result_amendment_rejected',
  'result_repair_queued',
  'result_repair_applied',
  'result_repair_failed'
] as const satisfies readonly ResultNotificationKind[];
const resultKindSet: ReadonlySet<string> = new Set(resultKinds);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResultNotificationKind(value: unknown): value is ResultNotificationKind {
  return typeof value === 'string' && resultKindSet.has(value);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

export function decodeResultNotificationContext(value: unknown): ResultNotificationContext {
  if (!isRecord(value)) throw new Error('INVALID_NOTIFICATION_RESULT_CONTEXT');
  const row = value;
  const notificationKind = row.notification_kind;
  const entryReady = row.entry_ready;
  const isCurrent = row.is_current;
  const proposalVersion = row.proposal_version;
  const currentVersion = row.current_version;
  const groupNumber = row.group_number;
  const proposalStatus = row.proposal_status;
  const currentStatus = row.current_status;
  const classification = row.classification;
  const winnerSets = row.winner_sets;
  const loserSets = row.loser_sets;
  const submittedByName = row.submitted_by_name;
  const reviewDeadline = row.review_deadline_at;
  const score = row.score;
  const venue = row.venue;
  const startsAt = row.starts_at;
  const timezone = row.timezone;
  if (
    !isResultNotificationKind(notificationKind) ||
    typeof entryReady !== 'boolean' ||
    typeof isCurrent !== 'boolean' ||
    (submittedByName !== null && typeof submittedByName !== 'string') ||
    (score !== null && typeof score !== 'string') ||
    typeof venue !== 'string' ||
    !validTimestamp(startsAt) ||
    typeof timezone !== 'string' ||
    (winnerSets !== null && !positiveInteger(winnerSets)) ||
    (loserSets !== null && !nonNegativeInteger(loserSets)) ||
    (classification !== null &&
      classification !== 'team_a' &&
      classification !== 'team_b' &&
      classification !== 'draw' &&
      classification !== 'incomplete')
  )
    throw new Error('INVALID_NOTIFICATION_RESULT_CONTEXT');

  const notificationId = validateMatchUuid(row.notification_id);
  const eventId = validateMatchUuid(row.match_event_id);
  const communityId = validateMatchUuid(row.community_id);
  const proposalId = row.proposal_id === null ? null : validateMatchUuid(row.proposal_id);
  if (entryReady) {
    if (
      notificationKind !== 'result_entry_ready' ||
      !isCurrent ||
      proposalId !== null ||
      proposalVersion !== null ||
      groupNumber !== null ||
      proposalStatus !== null ||
      currentVersion !== null ||
      currentStatus !== null ||
      classification !== null ||
      winnerSets !== null ||
      loserSets !== null ||
      score !== null ||
      submittedByName !== null ||
      reviewDeadline !== null
    )
      throw new Error('INVALID_NOTIFICATION_RESULT_CONTEXT');
    return {
      notification_id: notificationId,
      notification_kind: notificationKind,
      match_event_id: eventId,
      community_id: communityId,
      proposal_id: null,
      proposal_version: null,
      group_number: null,
      proposal_status: null,
      current_version: null,
      current_status: null,
      is_current: true,
      classification: null,
      winner_sets: null,
      loser_sets: null,
      score: null,
      submitted_by_name: null,
      review_deadline_at: null,
      venue,
      starts_at: startsAt,
      timezone,
      entry_ready: true
    };
  }

  if (
    notificationKind === 'result_entry_ready' ||
    proposalId === null ||
    !positiveInteger(proposalVersion) ||
    !positiveInteger(currentVersion) ||
    !positiveInteger(groupNumber) ||
    (proposalStatus !== 'pending' &&
      proposalStatus !== 'disputed' &&
      proposalStatus !== 'confirmed' &&
      proposalStatus !== 'superseded') ||
    (currentStatus !== 'pending' &&
      currentStatus !== 'disputed' &&
      currentStatus !== 'confirmed') ||
    typeof reviewDeadline !== 'string' ||
    !validTimestamp(reviewDeadline) ||
    classification === null ||
    isCurrent !== (proposalVersion === currentVersion) ||
    (isCurrent ? proposalStatus !== currentStatus : proposalStatus !== 'superseded')
  )
    throw new Error('INVALID_NOTIFICATION_RESULT_CONTEXT');

  const teamOutcome = classification === 'team_a' || classification === 'team_b';
  if (
    (teamOutcome && (!positiveInteger(winnerSets) || !nonNegativeInteger(loserSets))) ||
    (!teamOutcome && (winnerSets !== null || loserSets !== null))
  )
    throw new Error('INVALID_NOTIFICATION_RESULT_CONTEXT');

  return {
    notification_id: notificationId,
    notification_kind: notificationKind,
    match_event_id: eventId,
    community_id: communityId,
    proposal_id: proposalId,
    proposal_version: proposalVersion,
    group_number: groupNumber,
    proposal_status: proposalStatus,
    current_version: currentVersion,
    current_status: currentStatus,
    is_current: isCurrent,
    classification,
    winner_sets: winnerSets,
    loser_sets: loserSets,
    score,
    submitted_by_name: submittedByName,
    review_deadline_at: reviewDeadline,
    venue,
    starts_at: startsAt,
    timezone,
    entry_ready: false
  };
}

export function notificationResultHref(context: ResultNotificationContext): string {
  const eventId = validateMatchUuid(context.match_event_id);
  if (context.entry_ready) return `/matches/${encodeURIComponent(eventId)}`;
  if (
    context.proposal_id === null ||
    context.proposal_version === null ||
    context.group_number === null ||
    !positiveInteger(context.proposal_version) ||
    !positiveInteger(context.group_number)
  )
    throw new Error('INVALID_NOTIFICATION_RESULT_LOCATOR');
  const proposalId = validateMatchUuid(context.proposal_id);
  const query = new URLSearchParams({
    result_group: String(context.group_number),
    result_proposal: proposalId,
    result_version: String(context.proposal_version)
  });
  return `/matches/${encodeURIComponent(eventId)}?${query.toString()}#result-group-${context.group_number}`;
}

/** A failed repair notice also links the community repair diagnostics; its recipients are the
 * community admins the route already authorizes. Other kinds have no diagnostics link. */
export function notificationRepairDiagnosticsHref(
  context: ResultNotificationContext
): string | null {
  if (context.notification_kind !== 'result_repair_failed') return null;
  return `/community/${encodeURIComponent(validateMatchUuid(context.community_id))}/repairs`;
}

function isLevel(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 7;
}

export function decodeLevelReviewNotificationContext(
  value: unknown
): LevelReviewNotificationContext {
  if (!isRecord(value)) throw new Error('INVALID_NOTIFICATION_LEVEL_REVIEW_CONTEXT');
  const row = value;
  const outcome = row.outcome;
  const note = row.decision_note;
  if (
    (outcome !== 'approved' && outcome !== 'rejected') ||
    !isLevel(row.requested_min_level) ||
    !isLevel(row.requested_max_level) ||
    row.requested_min_level > row.requested_max_level ||
    !validTimestamp(row.decided_at) ||
    typeof note !== 'string' ||
    note.length === 0
  )
    throw new Error('INVALID_NOTIFICATION_LEVEL_REVIEW_CONTEXT');
  const approvedLevel = row.approved_level;
  const adjustmentId = row.adjustment_id;
  // An approval always carries its corrected level and adjustment event; a rejection never does.
  if (outcome === 'approved') {
    if (!isLevel(approvedLevel) || adjustmentId === null)
      throw new Error('INVALID_NOTIFICATION_LEVEL_REVIEW_CONTEXT');
  } else if (approvedLevel !== null || adjustmentId !== null) {
    throw new Error('INVALID_NOTIFICATION_LEVEL_REVIEW_CONTEXT');
  }
  return {
    request_id: validateMatchUuid(row.request_id),
    outcome,
    requested_min_level: row.requested_min_level,
    requested_max_level: row.requested_max_level,
    approved_level: outcome === 'approved' ? approvedLevel : null,
    decided_at: row.decided_at,
    decision_note: note,
    adjustment_id: outcome === 'approved' ? validateMatchUuid(adjustmentId) : null
  };
}

export function decodeNotificationTarget(value: NotificationTargetInput): NotificationTarget {
  if (value.target_status === 'destination_available') {
    const id = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
    const path = new RegExp(
      '^/(?:players/' +
        id +
        '|(?:platform-admin/)?level-reviews/' +
        id +
        '|community/' +
        id +
        '/leagues/' +
        id +
        ')$',
      'i'
    );
    if (
      typeof value.destination_href !== 'string' ||
      !path.test(value.destination_href) ||
      value.result_context != null ||
      value.level_review_context != null
    )
      throw new Error('INVALID_NOTIFICATION_TARGET');
  } else if (value.destination_href != null) throw new Error('INVALID_NOTIFICATION_TARGET');
  if (
    value.target_status === 'match_available' &&
    (value.match_available !== true ||
      typeof value.match_event_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.match_event_id))
  )
    throw new Error('INVALID_NOTIFICATION_TARGET');
  if (value.target_status === 'result_available') {
    if (
      value.match_available !== true ||
      typeof value.match_event_id !== 'string' ||
      !uuidPattern.test(value.match_event_id) ||
      value.result_context === null ||
      value.result_context === undefined
    )
      throw new Error('INVALID_NOTIFICATION_TARGET');
    const resultContext = decodeResultNotificationContext(value.result_context);
    if (resultContext.match_event_id !== value.match_event_id)
      throw new Error('INVALID_NOTIFICATION_TARGET');
    if (value.level_review_context !== null && value.level_review_context !== undefined)
      throw new Error('INVALID_NOTIFICATION_TARGET');
    const { level_review_context: _levelReview, ...resultTarget } = value;
    return { ...resultTarget, result_context: resultContext };
  }
  const {
    result_context: resultContext,
    level_review_context: levelReviewContext,
    ...target
  } = value;
  if (resultContext !== null && resultContext !== undefined)
    throw new Error('INVALID_NOTIFICATION_TARGET');
  if (value.target_status === 'level_review_available') {
    const context = decodeLevelReviewNotificationContext(levelReviewContext);
    const expectedKind =
      context.outcome === 'approved' ? 'level_review_approved' : 'level_review_rejected';
    if (value.kind !== expectedKind) throw new Error('INVALID_NOTIFICATION_TARGET');
    return { ...target, level_review_context: context };
  }
  if (levelReviewContext !== null && levelReviewContext !== undefined)
    throw new Error('INVALID_NOTIFICATION_TARGET');
  return target;
}

export type MatchNotificationParticipation = 'playing' | 'reserve' | 'reserve_not_playing';

export type MatchNotificationContext = {
  event_status?: string;
  match_event_id: string;
  creator_display_name: string | null;
  scheduled_at: string;
  timezone: string;
  venue: string;
  event_type: string;
  playing_count: number;
  accepted_count?: number;
  reconfirmation_required_count?: number;
  reserve_count: number;
  // Additive context count: ordinary Reserve excludes Reserve Not Playing, so a
  // notification surface can distinguish the two. Optional for older contexts.
  reserve_not_playing_count?: number;
  price_minor: number | null;
  currency: string | null;
  // Added by the PAF-5.2 context projection for registration notifications.
  requester_display_name?: string | null;
  caller_participation?: MatchNotificationParticipation | null;
  caller_accepted_order?: number | null;
  caller_roster_position?: number | null;
};

/** Placement derives from current FIFO position, never the immutable ordinal
 * after departures. Missing position supports older notification contexts. */
export function notificationRosterPosition(context: MatchNotificationContext): number | null {
  const value =
    context.caller_roster_position === undefined
      ? context.caller_accepted_order
      : context.caller_roster_position;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}
