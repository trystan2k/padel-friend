import { validateMatchUuid } from './matches.validators';
import {
  MATCH_EDIT_KEYS,
  validMatchMapsUrl,
  hasMatchControlCharacters,
  validateEditInstant,
  validateMergedMatchEdit,
  matchEditDraftPatch,
  type MatchEditPatch,
  type MatchEditDraft
} from './match-management-edit';
import type { MatchEventDetail } from './match-contracts';

export function validateMatchEditDraft(
  draft: MatchEditDraft,
  event: MatchEventDetail,
  expectedVersion: number
): { patch: MatchEditPatch; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const validate = (patch: unknown) =>
    validateEditMatchEvent({
      event_id: event.event_id,
      expected_version: expectedVersion,
      request_id: event.event_id,
      patch
    });
  const values = {
    venueName: ['venue_name', draft.venueName],
    mapsUrl: ['maps_url', draft.mapsUrl],
    courtNotes: ['court_notes', draft.courtNotes || null],
    paymentNote: ['payment_note', draft.paymentNote || null],
    notes: ['notes', draft.notes || null],
    maximumRegistrations: [
      'maximum_registrations',
      draft.maximumRegistrations === '' ? null : Number(draft.maximumRegistrations)
    ]
  } as const;
  for (const [field, [key, value]] of Object.entries(values)) {
    try {
      validate({ [key]: value });
    } catch {
      errors[field] =
        field === 'mapsUrl'
          ? 'invalidMapsUrl'
          : field === 'maximumRegistrations'
            ? 'invalidCapacity'
            : 'invalid';
    }
  }
  try {
    validate({ currency: draft.currency });
  } catch {
    errors.currency = 'unsupportedCurrency';
  }
  if (draft.price !== '' && !/^\d+(\.\d{1,2})?$/.test(draft.price))
    errors.price = Number(draft.price) < 0 ? 'negativePrice' : 'invalidPrice';
  if (Object.keys(errors).length) return { patch: {}, errors };
  let patch: MatchEditPatch;
  try {
    patch = matchEditDraftPatch(draft, event);
  } catch {
    return { patch: {}, errors: { cutoff: 'invalidCutoff' } };
  }
  try {
    validate(patch);
  } catch {
    return { patch: {}, errors: { price: 'invalidPrice' } };
  }
  try {
    validateMergedMatchEdit(event, patch, event.accepted_count);
  } catch (error) {
    if (error instanceof Error && error.message === 'CAPACITY_BELOW_ACCEPTED')
      errors.maximumRegistrations = 'capacityBelowAccepted';
    else errors.cutoff = 'futureCutoff';
  }
  return { patch, errors };
}

export function validateEditMatchEvent(value: unknown) {
  const data = exact(value, ['event_id', 'expected_version', 'patch', 'request_id']);
  const raw = exact(data.patch, MATCH_EDIT_KEYS);
  const patch: MatchEditPatch = {};
  for (const key of MATCH_EDIT_KEYS) {
    if (!Object.hasOwn(raw, key)) continue;
    const item = raw[key];
    if (key === 'price_minor' || key === 'maximum_registrations') {
      if (
        item !== null &&
        (typeof item !== 'number' ||
          !Number.isSafeInteger(item) ||
          item < (key === 'price_minor' ? 0 : 1) ||
          (key === 'maximum_registrations' && item > 2147483647))
      )
        throw new Error('INVALID_MATCH_INPUT');
      patch[key] = item;
    } else if (key === 'currency') {
      if (item !== null && item !== 'BRL' && item !== 'USD' && item !== 'EUR')
        throw new Error('INVALID_MATCH_INPUT');
      patch.currency = item;
    } else if (key === 'registration_cutoff_at' || key === 'starts_at')
      patch[key] = validateEditInstant(item);
    else if (key === 'event_type') {
      if (item !== 'competitive' && item !== 'friendly') throw new Error('INVALID_MATCH_INPUT');
      patch[key] = item;
    } else {
      const nullable = key !== 'venue_name' && key !== 'maps_url';
      const max =
        key === 'venue_name' ? 120 : key === 'maps_url' ? 2048 : key === 'notes' ? 2000 : 300;
      if (nullable && item === null) {
        patch[key] = null;
        continue;
      }
      if (
        typeof item !== 'string' ||
        item !== item.trim() ||
        item.length > max ||
        (key === 'venue_name' && !item.length) ||
        hasMatchControlCharacters(item) ||
        (key === 'maps_url' && !validMatchMapsUrl(item))
      )
        throw new Error('INVALID_MATCH_INPUT');
      patch[key] = item;
    }
  }
  if (
    Object.hasOwn(patch, 'price_minor') &&
    Object.hasOwn(patch, 'currency') &&
    (patch.price_minor === null) !== (patch.currency === null)
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    expected_version: version(data.expected_version),
    request_id: validateMatchUuid(data.request_id),
    patch
  };
}

function exact(value: unknown, keys: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('INVALID_MATCH_INPUT');
  return data;
}

export function validateListMatchEventManagementParticipants(value: unknown) {
  const data = exact(value, ['event_id']);
  return { event_id: validateMatchUuid(data.event_id) };
}

export function validateGetMatchEventManagement(value: unknown) {
  return validateListMatchEventManagementParticipants(value);
}
function version(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)
    throw new Error('INVALID_MATCH_INPUT');
  return value;
}
export function validateTransferMatchEventOwnership(value: unknown) {
  const data = exact(value, ['event_id', 'target_user_id', 'expected_version', 'request_id']);
  return {
    event_id: validateMatchUuid(data.event_id),
    target_user_id: validateMatchUuid(data.target_user_id),
    expected_version: version(data.expected_version),
    request_id: validateMatchUuid(data.request_id)
  };
}
export function validateCancelMatchEvent(value: unknown) {
  const data = exact(value, ['event_id', 'reason', 'expected_version', 'request_id']);
  return {
    event_id: validateMatchUuid(data.event_id),
    reason: validateReason(data.reason),
    request_id: validateMatchUuid(data.request_id),
    expected_version: version(data.expected_version)
  };
}

export function validateWithdrawMatchRegistration(value: unknown) {
  const data = exact(value, ['event_id', 'attempt_id', 'request_id']);
  return {
    event_id: validateMatchUuid(data.event_id),
    attempt_id: validateMatchUuid(data.attempt_id),
    request_id: validateMatchUuid(data.request_id)
  };
}

function validateReason(value: unknown) {
  if (
    typeof value !== 'string' ||
    value
      .split('')
      .some(
        (char) =>
          char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
      )
  )
    throw new Error('INVALID_MATCH_INPUT');
  const reason = value.trim();
  if (reason.length < 1 || reason.length > 500) throw new Error('INVALID_MATCH_INPUT');
  return reason;
}
export function validateRemoveMatchRegistration(value: unknown) {
  const data = exact(value, ['event_id', 'target_user_id', 'attempt_id', 'reason', 'request_id']);
  return {
    event_id: validateMatchUuid(data.event_id),
    target_user_id: validateMatchUuid(data.target_user_id),
    attempt_id: validateMatchUuid(data.attempt_id),
    reason: validateReason(data.reason),
    request_id: validateMatchUuid(data.request_id)
  };
}

export function validateListMatchEventAudit(value: unknown) {
  const data = exact(value, ['event_id', 'before_at', 'before_id', 'limit']);
  const before_at = data.before_at ?? null;
  const before_id = data.before_id ?? null;
  const limit = data.limit ?? 20;
  if (
    (before_at === null) !== (before_id === null) ||
    (before_at !== null &&
      (typeof before_at !== 'string' || !Number.isFinite(Date.parse(before_at)))) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    before_at: before_at === null ? null : new Date(before_at).toISOString(),
    before_id: before_id === null ? null : validateMatchUuid(before_id),
    limit
  };
}
