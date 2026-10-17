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

export type MatchNotificationParticipation = 'playing' | 'reserve' | 'reserve_not_playing';

export type MatchNotificationContext = {
  match_event_id: string;
  creator_display_name: string | null;
  scheduled_at: string;
  timezone: string;
  venue: string;
  event_type: string;
  playing_count: number;
  reserve_count: number;
  price_minor: number | null;
  currency: string | null;
  // Added by the PAF-5.2 context projection for registration notifications.
  requester_display_name?: string | null;
  caller_participation?: MatchNotificationParticipation | null;
  caller_accepted_order?: number | null;
};
