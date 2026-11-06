import { MatchResultValidationError } from '../matches/match-result.validators';
import { validateMatchUuid } from '../matches/matches.validators';

function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

/** Null selects the global (Platform Admin) view; a UUID scopes to one community. */
export function validateResultRepairScope(value: unknown) {
  if (!exact(value, ['community_id'])) throw new MatchResultValidationError('INVALID_REQUEST');
  return {
    community_id: value.community_id === null ? null : validateMatchUuid(value.community_id)
  };
}

export function validateResultRepairJobId(value: unknown) {
  if (!exact(value, ['job_id'])) throw new MatchResultValidationError('INVALID_REQUEST');
  return { job_id: validateMatchUuid(value.job_id) };
}

export function validateResultAdminCapability(value: unknown) {
  if (!exact(value, ['community_id'])) throw new MatchResultValidationError('INVALID_REQUEST');
  return { community_id: validateMatchUuid(value.community_id) };
}
