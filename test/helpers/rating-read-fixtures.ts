// Wire-shaped payloads of the rating reader RPCs, shared by the contract and handler tests.
export const GROUP_ID = '11111111-1111-4111-8111-111111111111';
export const EVENT_ID = '22222222-2222-4222-8222-222222222222';
export const PLAYED_AT = '2026-11-01T10:00:00.000000Z';
export const INVITER_ID = '99999999-9999-4999-8999-999999999999';

export const summaryPayload = {
  revision: 3,
  state: 'ready',
  summary: {
    initial_display_level: 4,
    display_level: 4.12,
    highest_display_level: 4.12,
    reliability_percent: 16,
    confirmed_competitive_game_groups: 1,
    last_rating_at: PLAYED_AT,
    rating_engine: 'app-wide-level',
    rating_engine_version: '1.0.0',
    rating_config_version: 1
  }
};

export const historyItemPayload = {
  kind: 'match',
  game_group_id: GROUP_ID,
  match_event_id: EVENT_ID,
  game_group_number: 1,
  played_at: PLAYED_AT,
  classification: 'team_a',
  team: 'team_a',
  outcome_value: 1,
  expected_score: 0.52,
  before_display_level: 4,
  after_display_level: 4.12,
  applied_delta: 0.12,
  clamped: false,
  before_reliability_percent: 10,
  after_reliability_percent: 16,
  after_confirmed_groups: 1,
  calculation_revision: 3,
  recalculated: false
};

export const historyPayload = {
  revision: 3,
  state: 'ready',
  total_events: 1,
  items: [historyItemPayload],
  next_cursor: null
};

export const progressPayload = {
  revision: 3,
  state: 'ready',
  scope: 'lifetime',
  resolution: 'event',
  abbreviated: false,
  total_events: 1,
  total_points: 1,
  baseline: { display_level: 4 },
  range: { from: PLAYED_AT, to: PLAYED_AT },
  points: [
    {
      ordinal: 1,
      kind: 'match',
      event_id: GROUP_ID,
      game_group_id: GROUP_ID,
      played_at: PLAYED_AT,
      display_level: 4.12
    }
  ]
};

const player = (index: number, team: 'team_a' | 'team_b', provisional: boolean) => ({
  user_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index}`,
  display_name: `Player ${index}`,
  is_provisional: provisional,
  team,
  calculation_revision: 3,
  recalculated: false,
  engine: 'app-wide-level',
  engine_version: '1.0.0',
  config_version: 1,
  before_display_level: 4,
  after_display_level: 4.12,
  before_reliability_percent: 10,
  after_reliability_percent: 16,
  before_confirmed_groups: 0,
  after_confirmed_groups: 1,
  own_team_strength: 4.25,
  opponent_team_strength: 4.1,
  expected_score: 0.52,
  outcome_value: 1,
  reliability_factor: 0.2,
  raw_delta: 0.115,
  rounded_delta: 0.12,
  applied_delta: 0.12,
  clamped: false
});

export const explanationPayload = {
  revision: 3,
  game_group_id: GROUP_ID,
  match_event_id: EVENT_ID,
  game_group_number: 1,
  played_at: PLAYED_AT,
  players: [
    player(1, 'team_a', false),
    player(2, 'team_a', true),
    player(3, 'team_b', false),
    player(4, 'team_b', false)
  ]
};

export const changesPayload = {
  revision: 3,
  match_event_id: EVENT_ID,
  groups: [
    {
      game_group_id: GROUP_ID,
      game_group_number: 1,
      played_at: PLAYED_AT,
      players: explanationPayload.players.map((entry) => ({
        user_id: entry.user_id,
        display_name: entry.display_name,
        is_provisional: entry.is_provisional,
        team: entry.team,
        before_display_level: entry.before_display_level,
        after_display_level: entry.after_display_level,
        before_reliability_percent: entry.before_reliability_percent,
        after_reliability_percent: entry.after_reliability_percent,
        applied_delta: entry.applied_delta,
        clamped: entry.clamped
      }))
    }
  ]
};
