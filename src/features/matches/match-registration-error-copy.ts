import type { MatchRegistrationErrorCode } from './match-registration-model';

// PAF-5 review F28: a single exhaustive error-code -> translation-key map shared
// by the registration panel and the creator request queue. The server codes are
// snake_case (`pending_duplicate`) while the copy keys are camelCase
// (`pendingDuplicate`), so interpolating the code into a key rendered the raw key
// on screen and `event_not_found` had no copy at all. A total `Record` over the
// union keeps every code covered: a new code without copy is a type error, and no
// surface can fall back to a raw code or key.
export const MATCH_REGISTRATION_ERROR_COPY: Readonly<Record<MatchRegistrationErrorCode, string>> = {
  event_not_found: 'matchRegistration.feedback.eventNotFound',
  invite_only: 'matchRegistration.feedback.inviteOnly',
  closed: 'matchRegistration.feedback.closed',
  started: 'matches.management.errors.started',
  cancelled: 'matches.management.errors.cancelled',
  result_protected: 'matches.management.errors.resultProtected',
  denied: 'matchRegistration.feedback.denied',
  duplicate: 'matchRegistration.feedback.duplicate',
  pending_duplicate: 'matchRegistration.feedback.pendingDuplicate',
  full: 'matchRegistration.feedback.full',
  not_found: 'matchRegistration.feedback.notFound',
  already_resolved: 'matchRegistration.feedback.alreadyResolved',
  requester_ineligible: 'matchRegistration.feedback.requesterIneligible',
  forbidden: 'matchRegistration.feedback.forbidden',
  invalid: 'matchRegistration.feedback.invalid',
  unauthenticated: 'matchRegistration.feedback.unauthenticated',
  unavailable: 'matchRegistration.feedback.unavailable'
};

/** Translation key for a registration action error code; never the raw code. */
export function matchRegistrationErrorKey(code: MatchRegistrationErrorCode): string {
  return MATCH_REGISTRATION_ERROR_COPY[code];
}
