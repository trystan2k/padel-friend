export const MATCH_RESULT_ERROR_COPY = {
  invalid_request: 'matches.results.errors.invalidRequest',
  invalid_group: 'matches.results.errors.invalidGroup',
  invalid_teams: 'matches.results.errors.invalidTeams',
  duplicate_player: 'matches.results.errors.duplicatePlayer',
  group_players: 'matches.results.errors.groupPlayers',
  invalid_played_at: 'matches.results.errors.invalidPlayedAt',
  future_played_at: 'matches.results.errors.futurePlayedAt',
  invalid_court: 'matches.results.errors.invalidCourt',
  invalid_sets: 'matches.results.errors.invalidSets',
  invalid_set: 'matches.results.errors.invalidSet',
  invalid_set_position: 'matches.results.errors.invalidSetPosition',
  invalid_set_score: 'matches.results.errors.invalidSetScore',
  non_sequential_sets: 'matches.results.errors.nonSequentialSets',
  terminal_score_unfinished: 'matches.results.errors.terminalScoreUnfinished',
  third_set_after_decided: 'matches.results.errors.thirdSetAfterDecided',
  active_proposal: 'matches.results.errors.activeProposal',
  idempotency_conflict: 'matches.results.errors.idempotencyConflict',
  invalid_review: 'matches.results.errors.invalidReview',
  invalid_rejection_reason: 'matches.results.errors.invalidRejectionReason',
  review_forbidden: 'matches.results.errors.reviewForbidden',
  correction_forbidden: 'matches.results.errors.correctionForbidden',
  cancelled: 'matches.results.errors.cancelled',
  forbidden: 'matches.results.errors.forbidden',
  unauthenticated: 'matches.results.errors.unauthenticated',
  not_found: 'matches.results.errors.notFound',
  unavailable: 'matches.results.errors.unavailable'
} as const satisfies Record<string, `matches.results.errors.${string}`>;

export const MATCH_RESULT_CONFLICT_COPY = {
  stale_version: 'matches.results.conflicts.staleVersion',
  deadline_elapsed: 'matches.results.conflicts.deadlineElapsed',
  current_proposal: 'matches.results.conflicts.currentProposal'
} as const satisfies Record<string, `matches.results.conflicts.${string}`>;

export type MatchResultErrorCode = keyof typeof MATCH_RESULT_ERROR_COPY;
