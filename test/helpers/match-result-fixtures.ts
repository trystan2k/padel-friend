export const resultIds = Array.from(
  { length: 4 },
  (_, i) => `11111111-1111-4111-8111-11111111111${i}`
);
export const resultCommand = {
  event_id: resultIds[0]!,
  group_number: 1,
  teams: { team_a: resultIds.slice(0, 2), team_b: resultIds.slice(2) },
  sets: [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }],
  played_local: { local: '2020-01-01 12:00:00', offset_seconds: 0 },
  court_label: null,
  request_id: resultIds[0]!
};
export const resultSuccess = {
  event_id: resultIds[0]!,
  proposal_id: resultIds[1]!,
  group_number: 1,
  version: 1,
  submitted_at: '2026-10-01T12:00:00Z',
  review_deadline_at: '2026-10-03T12:00:00Z',
  request_id: resultIds[0]!,
  replayed: false
};
export const resultProposal = {
  event_id: resultSuccess.event_id,
  proposal_id: resultSuccess.proposal_id,
  group_number: 1,
  version: 1,
  status: 'pending',
  submitted_at: resultSuccess.submitted_at,
  review_deadline_at: resultSuccess.review_deadline_at,
  teams: {
    team_a: resultIds.slice(0, 2).map((user_id) => ({ user_id, display_name: 'Player' })),
    team_b: resultIds.slice(2).map((user_id) => ({ user_id, display_name: null }))
  },
  sets: resultCommand.sets,
  classification: 'incomplete',
  played_at_utc: '2020-01-01T12:00:00Z',
  played_at_local: '2020-01-01 12:00:00',
  played_at_offset_seconds: 0,
  court_label: null,
  rating_effective: false,
  submitted_by: resultIds[0],
  submitted_by_name: 'Player',
  can_approve: false,
  can_reject: false,
  can_correct: false,
  caller_decision: null,
  required_team_coverage_count: 1,
  received_team_coverage_count: 0,
  team_a_approval_count: 0,
  team_b_approval_count: 0,
  dispute_evidence: null,
  confirmation: null,
  version_timeline: [
    {
      version: 1,
      status: 'pending',
      submitted_by: resultIds[0],
      submitted_by_name: 'Player',
      submitted_at: resultSuccess.submitted_at,
      review_deadline_at: resultSuccess.review_deadline_at,
      decisions: [],
      confirmation_id: null
    }
  ]
};
