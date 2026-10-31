import type { AddMatchPlayerErrorCode } from './match-add-player-model';

// Stable server codes only: no copy depends on what the email resolved to.
export const ADD_PLAYER_ERROR_COPY: Readonly<Record<AddMatchPlayerErrorCode, string>> = {
  closed: 'matches.addPlayer.errors.closed',
  started: 'matches.addPlayer.errors.started',
  cancelled: 'matches.addPlayer.errors.cancelled',
  result_protected: 'matches.addPlayer.errors.resultProtected',
  full: 'matches.addPlayer.errors.full',
  rate_limited: 'matches.addPlayer.errors.rateLimited',
  idempotency_conflict: 'matches.addPlayer.errors.idempotencyConflict',
  not_found: 'matches.addPlayer.errors.notFound',
  unauthenticated: 'matches.addPlayer.errors.unauthenticated',
  forbidden: 'matches.addPlayer.errors.forbidden',
  invalid: 'matches.addPlayer.errors.invalid',
  unavailable: 'matches.addPlayer.errors.unavailable'
};
