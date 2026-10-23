export type ResultClassification = 'team_a' | 'team_b' | 'draw' | 'incomplete';

export type ResultSetRow = {
  position: number;
  team_a_games: number;
  team_b_games: number;
  completed: boolean;
};

export type ResultTeams = {
  team_a: [string, string];
  team_b: [string, string];
};

export type ResultValidationDetail = {
  // One-based array index, not an untrusted submitted position; null for collection errors.
  set_index: number | null;
  side: 'team_a' | 'team_b' | null;
  reason_token: string;
};
