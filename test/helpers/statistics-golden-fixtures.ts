/** Guest fixture: two home Friendly groups, one away Friendly group, and two home Competitive groups. */
export const GOLDEN_GUEST_LEAGUE = {
  allSubject: { played: 5, friendly: 3, competitive: 2 },
  homeCommunity: { played: 4, friendly: 2, competitive: 2 },
  league: { played: 1, friendly: 0, competitive: 1 },
  activeRankingGroups: 1
} as const;

/** Hand-calculated normal-game cases; expectations do not call production reducers. */
export const GOLDEN_SCORES = [
  {
    type: 'competitive',
    sets: [
      { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
      { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
    ],
    classification: 'team_a',
    sets_a: 2,
    sets_b: 0,
    games_a: 12,
    games_b: 7
  },
  {
    type: 'friendly',
    sets: [
      { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
      { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
      { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
    ],
    classification: 'draw',
    sets_a: 1,
    sets_b: 1,
    games_a: 11,
    games_b: 11
  },
  {
    type: 'friendly',
    sets: [
      { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
      { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
      { position: 3, team_a_games: 0, team_b_games: 4, completed: false }
    ],
    classification: 'draw',
    sets_a: 1,
    sets_b: 1,
    games_a: 9,
    games_b: 14
  },
  {
    type: 'competitive',
    sets: [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }],
    classification: 'incomplete',
    sets_a: 1,
    sets_b: 0,
    games_a: 6,
    games_b: 4
  },
  {
    type: 'competitive',
    sets: [
      { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
      { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
      { position: 3, team_a_games: 6, team_b_games: 3, completed: true }
    ],
    classification: 'team_a',
    sets_a: 2,
    sets_b: 1,
    games_a: 15,
    games_b: 13
  }
] as const;

export const GOLDEN_FOCAL = {
  confirmed_groups: 5,
  wins: 2,
  losses: 0,
  draws: 2,
  incomplete_groups: 1,
  competitive_groups: 3,
  friendly_groups: 2,
  sets_won: 7,
  sets_lost: 3,
  games_won: 53,
  games_lost: 49
} as const;
export const GOLDEN_OPPONENT = {
  confirmed_groups: 5,
  wins: 0,
  losses: 2,
  draws: 2,
  incomplete_groups: 1,
  competitive_groups: 3,
  friendly_groups: 2,
  sets_won: 3,
  sets_lost: 7,
  games_won: 49,
  games_lost: 53
} as const;
export const GOLDEN_COMMUNITY = {
  confirmed_groups: 5,
  wins: 2,
  losses: 0,
  draws: 2,
  incomplete_groups: 1,
  competitive_groups: 3,
  friendly_groups: 2,
  sets_won: 10,
  sets_lost: 0,
  games_won: 102,
  games_lost: 0
} as const;
