import type { ManagementErrorCode } from './match-management-model';

export const MANAGEMENT_ERROR_COPY: Readonly<
  Record<ManagementErrorCode | 'version_conflict', string>
> = {
  closed: 'matches.management.errors.closed',
  started: 'matches.management.errors.started',
  cancelled: 'matches.management.errors.cancelled',
  result_protected: 'matches.management.errors.resultProtected',
  target_not_accepted: 'matches.management.errors.targetNotAccepted',
  stale_attempt: 'matches.management.errors.staleAttempt',
  stale_generation: 'matches.management.errors.staleGeneration',
  capacity_below_accepted: 'matches.management.errors.capacityBelowAccepted',
  idempotency_conflict: 'matches.management.errors.idempotencyConflict',
  already_resolved: 'matches.management.errors.alreadyResolved',
  not_found: 'matches.management.errors.notFound',
  unauthenticated: 'matches.management.errors.unauthenticated',
  forbidden: 'matches.management.errors.forbidden',
  invalid: 'matches.management.errors.invalid',
  unavailable: 'matches.management.errors.unavailable',
  league_out_of_period: 'matches.management.errors.leagueOutOfPeriod',
  league_unavailable: 'matches.management.errors.leagueUnavailable',
  league_closed: 'matches.management.errors.leagueClosed',
  league_friendly: 'matches.management.errors.leagueFriendly',
  ranked_nonmembers_accepted: 'matches.management.errors.rankedNonmembersAccepted',
  version_conflict: 'matches.management.errors.versionConflict'
};
