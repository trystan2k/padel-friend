import { validateMatchUuid } from '../matches/matches.validators';

export type ResultNotificationKind =
  | 'result_review_needed'
  | 'result_added'
  | 'result_corrected'
  | 'result_disputed'
  | 'result_confirmed'
  | 'result_deadline_reminder'
  | 'result_entry_ready';

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
  score: string | null;
  submitted_by_name: string | null;
  review_deadline_at: string | null;
  venue: string;
  starts_at: string;
  timezone: string;
  entry_ready: boolean;
};

export type NotificationTarget = {
  target_status: string;
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
};
export type NotificationTargetInput = Omit<NotificationTarget, 'result_context'> & {
  result_context?: unknown;
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
  'result_entry_ready'
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

export function decodeNotificationTarget(value: NotificationTargetInput): NotificationTarget {
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
    return { ...value, result_context: resultContext };
  }
  const { result_context: resultContext, ...target } = value;
  if (resultContext !== null && resultContext !== undefined)
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
