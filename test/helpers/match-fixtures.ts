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
// Publication-valid defaults: photo keys must be four UUID segments with an
// image extension (validateMatchPhotoKey) and maps URLs must carry a non-root
// path on an allowlisted Google Maps host (public.valid_match_maps_url). The
// community/event/owner segments reuse the fixture identity so builders stay
// identity-consistent and always produce publishable values.
const mapsUrl = 'https://maps.google.com/maps/place/central-courts';
const photoObjectId = '44444444-4444-4444-8444-444444444444';
const photo = `${id}/${id}/${id}/${photoObjectId}.jpg`;
type Counts = Pick<
  MatchEventCard,
  | 'accepted_count'
  | 'playing_count'
  | 'reserve_count'
  | 'reserve_not_playing_count'
  | 'group_count'
  | 'more_needed'
>;

// Derivation inputs must be nonnegative safe integers: Number.isSafeInteger
// already rejects NaN, ±Infinity, fractional values, and integers beyond
// 2**53 - 1, so the only extra check is the sign. Explicitly supplied count
// overrides stay exempt — callers own their coherence (see below).
function assertNonnegativeSafeInteger(name: 'accepted' | 'notPlaying', value: number): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a nonnegative safe integer, received ${value}`);
}

export function matchCountScenario(
  input: { accepted: number; notPlaying?: number } & Partial<Counts>
): Counts {
  const accepted = input.accepted;
  assertNonnegativeSafeInteger('accepted', accepted);
  // Playing occupies the quartet multiples; the residual players sit on the
  // reserve, and the not-playing participants are the tail of that residual
  // reserve that stopped after the cutoff, leaving the rest still waiting.
  const playing = Math.floor(accepted / 4) * 4;
  const residualReserve = accepted - playing;
  const notPlaying = input.notPlaying ?? 0;
  assertNonnegativeSafeInteger('notPlaying', notPlaying);
  if (notPlaying > residualReserve)
    throw new Error(
      `Impossible roster scenario: notPlaying=${notPlaying} exceeds the ${residualReserve} residual reserve players for accepted=${accepted}`
    );
  const derived: Counts = {
    accepted_count: accepted,
    playing_count: playing,
    reserve_count: residualReserve - notPlaying,
    reserve_not_playing_count: notPlaying,
    group_count: Math.floor(accepted / 4),
    more_needed: 4 - residualReserve
  };
  // Explicitly supplied counts bypass derivation entirely and are NOT
  // re-validated: callers own coherence when overriding.
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
  maps_url: mapsUrl,
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
  result_summary: {
    expected_group_count: 0,
    confirmed_group_count: 0,
    pending_group_count: 0,
    disputed_group_count: 0,
    unsubmitted_group_count: 0,
    incomplete_result_group_count: 0,
    results_roster_frozen: false,
    result_resolution: 'awaiting_results'
  },
  status: 'open',
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
    saved_venues: [{ id, name: 'Central Courts', maps_url: mapsUrl, photo_path: null }],
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
    maps_url: mapsUrl,
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
