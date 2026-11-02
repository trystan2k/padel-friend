import type {
  LeagueCommunityDto,
  LeagueDetailResult,
  LeagueDto,
  LeagueListResult
} from '../../src/features/leagues/league-contracts';
import type {
  LeagueFinalStandings,
  LeagueLiveStandings,
  LeagueStandingEntry,
  LeagueStandingsVersionSummary
} from '../../src/features/leagues/league-standings-contracts';

export const LEAGUE_COMMUNITY_ID = '11111111-1111-4111-8111-111111111111';
export const LEAGUE_ID = '22222222-2222-4222-8222-222222222222';
export const LEAGUE_OWNER_ID = '33333333-3333-4333-8333-333333333333';

/** Wire-shaped League DTO: a Fixed, Upcoming League the caller owns. */
export function makeLeagueDto(overrides: Partial<LeagueDto> = {}): LeagueDto {
  return {
    id: LEAGUE_ID,
    community_id: LEAGUE_COMMUNITY_ID,
    name: 'Autumn League',
    description: null,
    owner_id: LEAGUE_OWNER_ID,
    owner_name: 'Alex Rivera',
    timezone: 'Europe/Madrid',
    start_at: '2030-09-30T22:00:00.000000Z',
    end_mode: 'fixed_date',
    end_at: '2030-12-20T22:59:59.999999Z',
    start_date: '2030-10-01',
    end_date: '2030-12-20',
    status: 'upcoming',
    blocked_reason: null,
    activation_due: false,
    minimum_matches_for_final_award: 1,
    activated_at: null,
    closed_at: null,
    closed_reason: null,
    created_at: '2030-09-01T10:00:00.000000Z',
    version: 1,
    can_manage: true,
    period_locked: false,
    ...overrides
  };
}

export function makeManualLeagueDto(overrides: Partial<LeagueDto> = {}): LeagueDto {
  return makeLeagueDto({ end_mode: 'manual', end_at: null, end_date: null, ...overrides });
}

export function makeLeagueCommunity(
  overrides: Partial<LeagueCommunityDto> = {}
): LeagueCommunityDto {
  return {
    id: LEAGUE_COMMUNITY_ID,
    name: 'Pádel & Amigos',
    timezone: 'Europe/Madrid',
    creation_enabled: true,
    can_create: true,
    ...overrides
  };
}

export function makeLeagueList(
  leagues: LeagueDto[] = [],
  community: Partial<LeagueCommunityDto> = {},
  page: Partial<Pick<LeagueListResult, 'total' | 'truncated' | 'next_cursor'>> = {}
): LeagueListResult {
  return {
    community: makeLeagueCommunity(community),
    leagues,
    total: leagues.length,
    truncated: false,
    next_cursor: null,
    ...page
  };
}

export function makeLeagueDetail(
  league: Partial<LeagueDto> = {},
  community: Partial<LeagueCommunityDto> = {}
): LeagueDetailResult {
  return { community: makeLeagueCommunity(community), league: makeLeagueDto(league) };
}

export const STANDING_USER_A = '33333333-3333-4333-8333-333333333331';
export const STANDING_USER_B = '33333333-3333-4333-8333-333333333332';
export const STANDING_USER_C = '33333333-3333-4333-8333-333333333334';

/** Wire-shaped standing row (3 matches, 2W 1L, sets 5-3) with consistent derived fields. */
export function makeStandingEntry(
  overrides: Partial<LeagueStandingEntry> = {}
): LeagueStandingEntry {
  return {
    user_id: STANDING_USER_A,
    display_name: 'Ana',
    is_provisional: false,
    position: 1,
    matches: 3,
    wins: 2,
    losses: 1,
    draws: 0,
    sets_won: 5,
    sets_lost: 3,
    set_differential: 2,
    award_eligible: true,
    matches_remaining: 0,
    ...overrides
  };
}

export function makeLiveStandings(
  entries: LeagueStandingEntry[],
  overrides: Partial<LeagueLiveStandings> = {}
): LeagueLiveStandings {
  return {
    league_id: LEAGUE_ID,
    status: 'active',
    minimum_matches_for_final_award: 2,
    source: 'live',
    standings_version: null,
    latest_standings_version: null,
    generated_at: null,
    cause: null,
    entries,
    ...overrides
  };
}

export function makeFinalStandings(
  entries: LeagueStandingEntry[],
  overrides: Partial<LeagueFinalStandings> = {}
): LeagueFinalStandings {
  return {
    league_id: LEAGUE_ID,
    status: 'closed',
    minimum_matches_for_final_award: 2,
    source: 'final',
    standings_version: 1,
    latest_standings_version: 1,
    generated_at: '2030-12-21T10:00:00.000000Z',
    cause: 'closed',
    entries,
    ...overrides
  };
}

export function makeVersionSummary(
  overrides: Partial<LeagueStandingsVersionSummary> = {}
): LeagueStandingsVersionSummary {
  return {
    standings_version: 1,
    cause: 'closed',
    basis: 'published',
    generated_at: '2030-12-21T10:00:00.000000Z',
    effective_end_at: '2030-12-20T22:59:59.999999Z',
    minimum_matches_for_final_award: 2,
    entry_count: 1,
    confirmation: null,
    ...overrides
  };
}
