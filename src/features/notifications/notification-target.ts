export type NotificationTarget = {
  target_status: string;
  community_id: string | null;
  community_name: string | null;
  invitation_id: string | null;
  membership_status: string | null;
  match_event_id?: string | null;
  match_available?: boolean;
};

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
};
