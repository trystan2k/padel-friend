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
};

/** Cancelled events intentionally resolve through the same safe target as open
 * events. Readability is authoritative SQL-side, never inferred from the kind. */
export function decodeNotificationTarget(value: NotificationTarget): NotificationTarget {
  if (
    value.target_status === 'match_available' &&
    (value.match_available !== true ||
      typeof value.match_event_id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.match_event_id))
  )
    throw new Error('INVALID_NOTIFICATION_TARGET');
  return value;
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
