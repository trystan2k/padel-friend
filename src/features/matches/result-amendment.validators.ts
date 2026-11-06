import {
  MatchResultValidationError,
  validateMatchResultSets,
  validateMatchResultTeams,
  validateResultPlayedLocal,
  RESULT_REJECTION_REASONS
} from './match-result.validators';
import { validateMatchUuid } from './matches.validators';

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function boundedText(value: unknown, reason: string, max: number): string {
  if (typeof value !== 'string') throw new MatchResultValidationError(reason);
  const text = value.trim();
  if (text.length < 1 || text.length > max || /\p{Cc}/u.test(text))
    throw new MatchResultValidationError(reason);
  return text;
}

export function validateGetResultAmendments(value: unknown) {
  if (!exact(value, ['event_id'])) throw new MatchResultValidationError('INVALID_REQUEST');
  return { event_id: validateMatchUuid(value.event_id) };
}

export function validateRequestResultAmendment(value: unknown) {
  if (!exact(value, ['proposal_id', 'expected_confirmation_id', 'reason', 'command_id']))
    throw new MatchResultValidationError('INVALID_REQUEST');
  return {
    proposal_id: validateMatchUuid(value.proposal_id),
    expected_confirmation_id: validateMatchUuid(value.expected_confirmation_id),
    reason: boundedText(value.reason, 'INVALID_REASON', 500),
    command_id: validateMatchUuid(value.command_id)
  };
}

function expectedVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new MatchResultValidationError('INVALID_REQUEST');
  return value;
}

export function validateSubmitResultAmendmentCandidate(value: unknown) {
  if (
    !exact(value, [
      'event_id',
      'amendment_id',
      'expected_base_confirmation_id',
      'expected_candidate_version',
      'teams',
      'sets',
      'played_local',
      'court_label',
      'command_id'
    ])
  )
    throw new MatchResultValidationError('INVALID_REQUEST');
  if (
    value.court_label !== null &&
    (typeof value.court_label !== 'string' ||
      value.court_label.trim().length < 1 ||
      value.court_label.trim().length > 100 ||
      /\p{Cc}/u.test(value.court_label))
  )
    throw new MatchResultValidationError('INVALID_COURT');
  return {
    event_id: validateMatchUuid(value.event_id),
    amendment_id: validateMatchUuid(value.amendment_id),
    expected_base_confirmation_id: validateMatchUuid(value.expected_base_confirmation_id),
    expected_candidate_version:
      value.expected_candidate_version === null
        ? null
        : expectedVersion(value.expected_candidate_version),
    teams: validateMatchResultTeams(value.teams),
    sets: validateMatchResultSets(value.sets),
    played_local: validateResultPlayedLocal(value.played_local),
    court_label: typeof value.court_label === 'string' ? value.court_label.trim() : null,
    command_id: validateMatchUuid(value.command_id)
  };
}

export function validateReviewResultAmendment(value: unknown) {
  if (
    !exact(value, [
      'amendment_id',
      'expected_base_confirmation_id',
      'expected_candidate_version',
      'decision',
      'reason_code',
      'reason_note',
      'command_id'
    ]) ||
    (value.decision !== 'approve' && value.decision !== 'reject')
  )
    throw new MatchResultValidationError('INVALID_REQUEST');
  const common = {
    amendment_id: validateMatchUuid(value.amendment_id),
    expected_base_confirmation_id: validateMatchUuid(value.expected_base_confirmation_id),
    expected_candidate_version: expectedVersion(value.expected_candidate_version),
    command_id: validateMatchUuid(value.command_id)
  };
  if (value.decision === 'approve') {
    if (value.reason_code !== null || value.reason_note !== null)
      throw new MatchResultValidationError('INVALID_REVIEW');
    return { ...common, decision: 'approve' as const, reason_code: null, reason_note: null };
  }
  if (
    typeof value.reason_code !== 'string' ||
    !RESULT_REJECTION_REASONS.some((reason) => reason === value.reason_code) ||
    (value.reason_note !== null &&
      (typeof value.reason_note !== 'string' ||
        !value.reason_note.trim() ||
        value.reason_note.length > 500 ||
        /\p{Cc}/u.test(value.reason_note))) ||
    (value.reason_code === 'OTHER' && value.reason_note === null)
  )
    throw new MatchResultValidationError('INVALID_REJECTION_REASON');
  return {
    ...common,
    decision: 'reject' as const,
    reason_code: value.reason_code,
    reason_note: typeof value.reason_note === 'string' ? value.reason_note.trim() : null
  };
}

export function validateResolveResultDispute(value: unknown) {
  if (
    !exact(value, [
      'proposal_id',
      'expected_base_confirmation_id',
      'expected_candidate_version',
      'decision',
      'justification',
      'command_id'
    ]) ||
    (value.decision !== 'uphold' && value.decision !== 'replace' && value.decision !== 'void')
  )
    throw new MatchResultValidationError('INVALID_REQUEST');
  return {
    proposal_id: validateMatchUuid(value.proposal_id),
    // Null selects the first-confirmation branch of a result that was never official.
    expected_base_confirmation_id:
      value.expected_base_confirmation_id === null
        ? null
        : validateMatchUuid(value.expected_base_confirmation_id),
    expected_candidate_version: expectedVersion(value.expected_candidate_version),
    decision: value.decision,
    justification: boundedText(value.justification, 'INVALID_JUSTIFICATION', 500),
    command_id: validateMatchUuid(value.command_id)
  };
}

export function validateCancelResultAmendment(value: unknown) {
  if (!exact(value, ['amendment_id', 'command_id']))
    throw new MatchResultValidationError('INVALID_REQUEST');
  return {
    amendment_id: validateMatchUuid(value.amendment_id),
    command_id: validateMatchUuid(value.command_id)
  };
}
