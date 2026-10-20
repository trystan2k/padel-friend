import type {
  MatchCreationOptions,
  MatchDraft,
  MatchEventCard,
  MatchEventDetail,
  MatchEventRpcDetail,
  MatchEventRpcListRow,
  MatchInvitee,
  MatchPublishInput
} from '../../src/features/matches/match-contracts';

const id = '11111111-1111-4111-8111-111111111111';
const photo = `${id}/cover.jpg`;
type Counts = Pick<
  MatchEventCard,
  | 'accepted_count'
  | 'playing_count'
  | 'reserve_count'
  | 'reserve_not_playing_count'
  | 'group_count'
  | 'more_needed'
>;

export function matchCountScenario(
  input: { accepted: number; notPlaying?: number } & Partial<Counts>
): Counts {
  const accepted = input.accepted;
  const playing = Math.floor(accepted / 4) * 4;
  const reserve = accepted - playing;
  const derived: Counts = {
    accepted_count: accepted,
    playing_count: playing,
    reserve_count: reserve,
    reserve_not_playing_count: input.notPlaying ?? 0,
    group_count: Math.floor(accepted / 4),
    more_needed: 4 - reserve
  };
  return {
    accepted_count: input.accepted_count ?? derived.accepted_count,
    playing_count: input.playing_count ?? derived.playing_count,
    reserve_count: input.reserve_count ?? derived.reserve_count,
    reserve_not_playing_count: input.reserve_not_playing_count ?? derived.reserve_not_playing_count,
    group_count: input.group_count ?? derived.group_count,
    more_needed: input.more_needed ?? derived.more_needed
  };
}

const projection = {
  event_id: id,
  community_id: id,
  community_name: 'Padel Club',
  creator_id: id,
  creator_name: 'Alex Rivera',
  creator_level: 3.5,
  starts_at: '2030-06-15T18:00:00.000Z',
  timezone: 'Europe/Madrid',
  event_type: 'friendly',
  visibility: 'community_open',
  team_assignment_mode: 'POST_MATCH_TEAMS',
  venue_name: 'Central Courts',
  maps_url: 'https://maps.google.com/?q=padel',
  court_notes: null,
  duration_minutes: 90,
  notes: null,
  court_booked: true,
  restriction_enabled: false,
  min_level: null,
  max_level: null,
  price_minor: null,
  currency: null,
  payment_note: null,
  maximum_registrations: null,
  registration_cutoff_at: '2030-06-15T17:00:00.000Z',
  caller_badge: 'creator',
  caller_is_invited: false,
  caller_eligibility: 'creator',
  caller_requires_approval: false,
  is_past: false,
  registration_open: true,
  ...matchCountScenario({ accepted: 5 })
} satisfies Omit<MatchEventCard, 'photo_url'>;

export function makeMatchCard(overrides: Partial<MatchEventCard> = {}): MatchEventCard {
  return { ...projection, photo_url: null, ...overrides };
}
export function makeMatchRpcDetail(
  overrides: Partial<MatchEventRpcDetail> = {}
): MatchEventRpcDetail {
  const { photo_url: _photoUrl, ...rest } = makeMatchCard();
  return { ...rest, photo_path: photo, as_of: '2030-06-01T12:00:00.000Z', ...overrides };
}
export function makeMatchRpcListRow(
  overrides: Partial<MatchEventRpcListRow> = {}
): MatchEventRpcListRow {
  const { photo_url: _photoUrl, ...rest } = makeMatchCard();
  return {
    ...rest,
    photo_path: photo,
    as_of: '2030-06-01T12:00:00.000Z',
    cursor: '2030-06-15T18:00:00.000000+00|11111111-1111-4111-8111-111111111111',
    ...overrides
  };
}
export function makeMatchDetail(overrides: Partial<MatchEventDetail> = {}): MatchEventDetail {
  return { ...makeMatchCard(), as_of: '2030-06-01T12:00:00.000Z', ...overrides };
}
export function makeMatchCreationOptions(
  overrides: Partial<MatchCreationOptions> = {}
): MatchCreationOptions {
  const defaults = {
    communities: [{ id, name: 'Padel Club', timezone: 'Europe/Madrid', currency: 'EUR' }],
    saved_venues: [
      { id, name: 'Central Courts', maps_url: 'https://maps.google.com/?q=padel', photo_path: null }
    ],
    level_defaults: { min: 3, max: 5, level: 3.5 }
  } satisfies MatchCreationOptions;
  return {
    communities: (overrides.communities ?? defaults.communities).map((item) => ({ ...item })),
    saved_venues: (overrides.saved_venues ?? defaults.saved_venues).map((item) => ({ ...item })),
    level_defaults:
      overrides.level_defaults === undefined
        ? defaults.level_defaults && { ...defaults.level_defaults }
        : overrides.level_defaults && { ...overrides.level_defaults }
  };
}
export function makeMatchDraft(overrides: Partial<MatchDraft> = {}): MatchDraft {
  const defaults = {
    type: 'friendly',
    visibility: 'community_open',
    teamMode: 'POST_MATCH_TEAMS',
    currency: 'EUR',
    community_id: '',
    timezone: null,
    date: '',
    startTime: '',
    savedVenue: '',
    venueName: '',
    mapsUrl: '',
    courtNotes: '',
    duration: '',
    notes: '',
    levelRestriction: true,
    minLevel: '',
    maxLevel: '',
    courtBooked: false,
    price: '',
    paymentNote: '',
    maximumRegistrations: '',
    cutoff: ''
  } satisfies MatchDraft;
  return { ...defaults, ...overrides };
}
export function makeMatchInvitee(overrides: Partial<MatchInvitee> = {}): MatchInvitee {
  return {
    user_id: '22222222-2222-4222-8222-222222222222',
    display_name: 'Jamie Chen',
    ...overrides
  };
}
export function makeMatchPublishInput(
  overrides: Partial<MatchPublishInput> = {}
): MatchPublishInput {
  const defaults = {
    community_id: id,
    date: '2030-06-15',
    start_time: '20:00',
    event_type: 'friendly',
    visibility: 'community_open',
    team_assignment_mode: 'POST_MATCH_TEAMS',
    venue_name: 'Central Courts',
    maps_url: 'https://maps.google.com/?q=padel',
    photo_path: photo,
    saved_venue_id: null,
    court_notes: null,
    duration_minutes: 90,
    notes: null,
    court_booked: true,
    restriction_enabled: false,
    min_level: null,
    max_level: null,
    price: null,
    currency: 'EUR',
    payment_note: null,
    maximum_registrations: null,
    cutoff_at: '2030-06-15T17:00:00.000Z'
  } satisfies MatchPublishInput;
  return { ...defaults, ...overrides };
}
