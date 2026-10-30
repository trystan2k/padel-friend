import type { Database } from '../../lib/supabase/database.types';

type MatchRow = Database['public']['Tables']['match_events']['Row'];
export type MatchCurrency = 'BRL' | 'USD' | 'EUR';
type StoredProjection = Omit<
  Pick<
    MatchRow,
    | 'community_id'
    | 'court_booked'
    | 'court_notes'
    | 'currency'
    | 'duration_minutes'
    | 'event_type'
    | 'maps_url'
    | 'max_level'
    | 'maximum_registrations'
    | 'min_level'
    | 'notes'
    | 'payment_note'
    | 'price_minor'
    | 'registration_cutoff_at'
    | 'restriction_enabled'
    | 'starts_at'
    | 'team_assignment_mode'
    | 'timezone'
    | 'venue_name'
    | 'visibility'
  >,
  'currency'
> & { currency: MatchCurrency | null };
type IdentityProjection = Pick<MatchRow, 'id' | 'created_by'>;
type CallerEligibility = 'creator' | 'member' | 'out_of_range' | 'nonmember' | null;
export type MatchResultResolution = 'awaiting_results' | 'partially_resolved' | 'completed';
export type MatchEventResultSummary = {
  expected_group_count: number;
  confirmed_group_count: number;
  pending_group_count: number;
  disputed_group_count: number;
  unsubmitted_group_count: number;
  incomplete_result_group_count: number;
  results_roster_frozen: boolean;
  result_resolution: MatchResultResolution;
};
type MatchEventProjection = StoredProjection & {
  status: 'open' | 'cancelled';
  event_id: IdentityProjection['id'];
  community_name: string;
  creator_id: IdentityProjection['created_by'];
  creator_name: string | null;
  creator_level: number | null;
  accepted_count: number;
  reconfirmation_required_count?: number;
  reconfirmation_generation?: number;
  playing_count: number;
  reserve_count: number;
  reserve_not_playing_count: number;
  group_count: number;
  more_needed: number;
  caller_badge: MatchCallerBadge | null;
  caller_is_invited: boolean;
  caller_eligibility: CallerEligibility;
  caller_requires_approval: boolean;
  is_past: boolean;
  registration_open: boolean;
  result_summary: MatchEventResultSummary;
};

export type MatchCallerBadge =
  | 'creator'
  | 'reconfirmation_required'
  | 'playing'
  | 'reserve'
  | 'reserve_not_playing'
  | 'invited';
export type MatchEventCard = MatchEventProjection & { photo_url: string | null };
export type MatchEventListItem = MatchEventCard;
export type MatchEventDetail = MatchEventProjection & { photo_url: string | null; as_of: string };
export type MatchEventRpcDetail = MatchEventProjection & { photo_path: string; as_of: string };
export type MatchEventRpcListRow = MatchEventProjection & {
  photo_path: string;
  as_of: string;
  cursor: string;
};
export type MatchEventListResult = {
  items: MatchEventListItem[];
  next_cursor: string | null;
  as_of: string | null;
};
export type MatchInvitee =
  Database['public']['Functions']['search_match_invitees']['Returns'][number];

type CommunityRow = Database['public']['Tables']['communities']['Row'];
type VenueRow = Database['public']['Tables']['community_venues']['Row'];
export type MatchCreationOptions = {
  communities: (Pick<CommunityRow, 'id' | 'name'> & {
    timezone: string | null;
    currency: string;
  })[];
  saved_venues: Pick<VenueRow, 'id' | 'name' | 'maps_url' | 'photo_path'>[];
  level_defaults: { min: number | null; max: number | null; level: number | null } | null;
};

type EventType = Database['public']['Enums']['match_event_type'];
type Visibility = Database['public']['Enums']['match_event_visibility'];
type TeamMode = Database['public']['Enums']['match_team_assignment_mode'];
export type MatchDraft = {
  type: EventType;
  visibility: Visibility;
  teamMode: TeamMode;
  currency: MatchCurrency;
  community_id: string;
  timezone: string | null;
  date: string;
  startTime: string;
  savedVenue: string;
  venueName: string;
  mapsUrl: string;
  courtNotes: string;
  duration: string;
  notes: string;
  levelRestriction: boolean;
  minLevel: string;
  maxLevel: string;
  courtBooked: boolean;
  price: string;
  paymentNote: string;
  maximumRegistrations: string;
  cutoff: string;
};

/** Exact `publish_match_event` JSON input; optional keys have SQL defaults. */
export type MatchPublishInput = {
  community_id: MatchRow['community_id'];
  date: string;
  start_time: string;
  event_type: EventType;
  visibility: Visibility;
  team_assignment_mode: TeamMode;
  venue_name: MatchRow['venue_name'];
  maps_url: MatchRow['maps_url'];
  photo_path: MatchRow['photo_path'];
  saved_venue_id?: string | null;
  court_notes?: string | null;
  duration_minutes?: number | null;
  notes?: string | null;
  court_booked?: boolean;
  restriction_enabled?: boolean;
  min_level?: number | null;
  max_level?: number | null;
  price?: string | null;
  currency?: MatchCurrency;
  payment_note?: string | null;
  maximum_registrations?: number | null;
  cutoff_at?: string | null;
};
