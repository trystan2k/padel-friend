import type { Database } from '../../lib/supabase/database.types';

// PAF-5.2 roster/request projection DTOs. These are deliberately separate from
// the flat T04 event DTO in match-model.ts; the RPC jsonb contracts are parsed
// defensively here so malformed payloads can never reach the UI as raw columns.
export type MatchRegistrationParticipation =
  Database['public']['Enums']['match_registration_participation'];
export type MatchRegistrationSource = Database['public']['Enums']['match_registration_source'];
export type MatchRegistrationAction = 'join' | 'request' | 'full' | 'closed' | 'invited' | 'none';

// Every domain/auth failure the four registration RPCs can raise, collapsed to a
// distinct, user-actionable code. The UI never sees the raw Postgres token.
export type MatchRegistrationErrorCode =
  | 'event_not_found'
  | 'invite_only'
  | 'closed'
  | 'started'
  | 'cancelled'
  | 'result_protected'
  | 'denied'
  | 'duplicate'
  | 'pending_duplicate'
  | 'full'
  | 'not_found'
  | 'already_resolved'
  | 'requester_ineligible'
  | 'forbidden'
  | 'invalid'
  | 'unauthenticated'
  | 'unavailable';

export type MatchRegistrationActionError = {
  status: 'error';
  code: MatchRegistrationErrorCode;
};

const ERROR_TOKENS: Readonly<Record<string, MatchRegistrationErrorCode>> = {
  MATCH_MANAGEMENT_CLOSED: 'closed',
  MATCH_MANAGEMENT_NOT_FOUND: 'event_not_found',
  MATCH_MANAGEMENT_STARTED: 'started',
  MATCH_MANAGEMENT_CANCELLED: 'cancelled',
  MATCH_MANAGEMENT_RESULT_PROTECTED: 'result_protected',
  MATCH_REGISTRATION_EVENT_NOT_FOUND: 'event_not_found',
  MATCH_REGISTRATION_INVITE_ONLY: 'invite_only',
  MATCH_REGISTRATION_CLOSED: 'closed',
  MATCH_REGISTRATION_DENIED: 'denied',
  MATCH_REGISTRATION_DUPLICATE: 'duplicate',
  MATCH_REGISTRATION_PENDING_DUPLICATE: 'pending_duplicate',
  MATCH_REGISTRATION_FULL: 'full',
  MATCH_REGISTRATION_NOT_FOUND: 'not_found',
  MATCH_REGISTRATION_ALREADY_RESOLVED: 'already_resolved',
  MATCH_REGISTRATION_REQUESTER_INELIGIBLE: 'requester_ineligible'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function asUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value : null;
}
function asText(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function asNullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : asText(value);
}
function asSource(value: unknown): MatchRegistrationSource | null {
  return value === 'creator' || value === 'member' || value === 'guest' ? value : null;
}
function asParticipation(value: unknown): MatchRegistrationParticipation | null {
  return value === 'playing' || value === 'reserve' || value === 'reserve_not_playing'
    ? value
    : null;
}
function asPositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : null;
}
function asCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

// Maps a Supabase/Postgres error to a typed result. Returns null for an unknown
// failure so callers can surface a generic retry state instead of leaking it.
export function matchRegistrationActionError(
  error: { code?: string | null; message?: string | null } | null | undefined
): MatchRegistrationActionError | null {
  if (!error) return null;
  const message = typeof error.message === 'string' ? error.message : '';
  for (const token of Object.keys(ERROR_TOKENS)) {
    if (message.includes(token)) {
      const code = ERROR_TOKENS[token];
      if (code) return { status: 'error', code };
    }
  }
  if (error.code === '28000') return { status: 'error', code: 'unauthenticated' };
  if (error.code === '22023') return { status: 'error', code: 'invalid' };
  if (error.code === '42501') return { status: 'error', code: 'forbidden' };
  return null;
}

// --- Accepted / pending / rejected projections ---------------------------------

export type AcceptedMatchRegistration = {
  event_id: string;
  user_id: string;
  lifecycle: 'accepted';
  participation: MatchRegistrationParticipation | null;
  required_generation?: number;
  confirmed_generation?: number;
  accepted_order: number;
  registration_source: MatchRegistrationSource;
  approved_at: string | null;
  accepted_at: string;
};

export type PendingMatchRegistration = {
  event_id: string;
  user_id: string;
  lifecycle: 'pending';
  registration_source: MatchRegistrationSource;
  requested_at: string;
};

export type RejectedMatchRegistration = {
  event_id: string;
  user_id: string;
  lifecycle: 'rejected';
  registration_source: MatchRegistrationSource;
  resolved_at: string;
};

export type SubmitMatchRegistrationResult =
  | { status: 'accepted'; registration: AcceptedMatchRegistration }
  | { status: 'pending'; registration: PendingMatchRegistration }
  | MatchRegistrationActionError;

export type DecideMatchRegistrationResult =
  | { status: 'approved'; replayed: boolean; registration: AcceptedMatchRegistration }
  | { status: 'rejected'; replayed: boolean; registration: RejectedMatchRegistration }
  | MatchRegistrationActionError;

function parseAccepted(value: Record<string, unknown>): AcceptedMatchRegistration | null {
  const event_id = asUuid(value.event_id);
  const user_id = asUuid(value.user_id);
  const participation = asParticipation(value.participation);
  const accepted_order = asPositiveInteger(value.accepted_order);
  const registration_source = asSource(value.registration_source);
  const accepted_at = asText(value.accepted_at);
  const approved_at = asNullableText(value.approved_at);
  if (
    !event_id ||
    !user_id ||
    (!participation &&
      !(
        value.participation === null &&
        asCount(value.required_generation) !== null &&
        asCount(value.confirmed_generation) !== null &&
        Number(value.confirmed_generation) < Number(value.required_generation)
      )) ||
    accepted_order === null ||
    !registration_source ||
    !accepted_at
  )
    return null;
  return {
    event_id,
    user_id,
    lifecycle: 'accepted',
    participation,
    ...(asCount(value.required_generation) !== null && asCount(value.confirmed_generation) !== null
      ? {
          required_generation: Number(value.required_generation),
          confirmed_generation: Number(value.confirmed_generation)
        }
      : {}),
    accepted_order,
    registration_source,
    approved_at,
    accepted_at
  };
}

function parsePendingForAction(value: Record<string, unknown>): PendingMatchRegistration | null {
  const event_id = asUuid(value.event_id);
  const user_id = asUuid(value.user_id);
  const registration_source = asSource(value.registration_source);
  const requested_at = asText(value.requested_at);
  if (!event_id || !user_id || !registration_source || !requested_at) return null;
  return { event_id, user_id, lifecycle: 'pending', registration_source, requested_at };
}

function parseRejected(value: Record<string, unknown>): RejectedMatchRegistration | null {
  const event_id = asUuid(value.event_id);
  const user_id = asUuid(value.user_id);
  const registration_source = asSource(value.registration_source);
  const resolved_at = asText(value.resolved_at);
  if (!event_id || !user_id || !registration_source || !resolved_at) return null;
  return { event_id, user_id, lifecycle: 'rejected', registration_source, resolved_at };
}

export function parseSubmitMatchRegistrationResult(
  value: unknown
): SubmitMatchRegistrationResult | null {
  if (!isRecord(value)) return null;
  if (value.lifecycle === 'accepted') {
    const registration = parseAccepted(value);
    return registration ? { status: 'accepted', registration } : null;
  }
  if (value.lifecycle === 'pending') {
    const registration = parsePendingForAction(value);
    return registration ? { status: 'pending', registration } : null;
  }
  return null;
}

export function parseDecideMatchRegistrationResult(
  value: unknown
): DecideMatchRegistrationResult | null {
  if (!isRecord(value)) return null;
  const replayed = value.replayed === true;
  if (value.lifecycle === 'accepted') {
    const registration = parseAccepted(value);
    return registration ? { status: 'approved', replayed, registration } : null;
  }
  if (value.lifecycle === 'rejected') {
    const registration = parseRejected(value);
    return registration ? { status: 'rejected', replayed, registration } : null;
  }
  return null;
}

// --- Caller's own registration read --------------------------------------------

export type MyMatchRegistration =
  | { state: 'none' }
  | {
      state: 'reconfirmation_required';
      event_id: string;
      attempt_id: string;
      accepted_order: number;
      accepted_at: string;
      required_generation: number;
      confirmed_generation: number;
      registration_source: MatchRegistrationSource;
      registration_cutoff_at: string;
    }
  | {
      state: 'cancelled';
      event_id: string;
      registration_source: MatchRegistrationSource;
      cancelled_at: string;
    }
  | {
      state: 'pending';
      event_id: string;
      registration_source: MatchRegistrationSource;
      requested_at: string | null;
    }
  | {
      state: 'accepted';
      attempt_id?: string;
      event_id: string;
      participation: MatchRegistrationParticipation;
      accepted_order: number;
      position: number;
      registration_source: MatchRegistrationSource;
      requested_at: string | null;
      approved_at: string | null;
      accepted_at: string;
    }
  | {
      state: 'rejected';
      event_id: string;
      registration_source: MatchRegistrationSource;
      resolved_at: string | null;
    }
  | {
      state: 'expired' | 'reconfirmation_excluded';
      event_id: string;
      registration_source: MatchRegistrationSource;
      resolved_at: string | null;
    }
  | {
      state: 'withdrawn' | 'removed_by_creator';
      event_id: string;
      attempt_id: string;
      accepted_order: number;
      accepted_at: string;
      left_at: string | null;
      removal_reason: string | null;
      registration_source: MatchRegistrationSource;
    };

export type MyMatchRegistrationResult =
  | { status: 'ok'; registration: MyMatchRegistration }
  | { status: 'unavailable' };

export function parseMyMatchRegistration(value: unknown): MyMatchRegistration | null {
  if (!isRecord(value)) return null;
  const event_id = asUuid(value.event_id);
  if (!event_id) return null;
  const lifecycle = value.lifecycle;
  if (lifecycle === null || lifecycle === undefined) return { state: 'none' };
  const registration_source = asSource(value.registration_source);
  if (!registration_source) return null;
  if (value.event_status === 'cancelled') {
    const cancelled_at = asText(value.cancelled_at);
    return cancelled_at && Number.isFinite(Date.parse(cancelled_at))
      ? { state: 'cancelled', event_id, registration_source, cancelled_at }
      : null;
  }
  if (lifecycle === 'withdrawn' || lifecycle === 'removed_by_creator') {
    const attempt_id = asUuid(value.attempt_id);
    const accepted_order = asPositiveInteger(value.accepted_order);
    const accepted_at = asText(value.accepted_at);
    const left_at = asNullableText(value.left_at);
    const removal_reason = asNullableText(value.removal_reason);
    if (
      !attempt_id ||
      accepted_order === null ||
      !accepted_at ||
      value.participation !== null ||
      (lifecycle === 'withdrawn' && !left_at) ||
      (lifecycle === 'removed_by_creator' && !removal_reason)
    )
      return null;
    return {
      state: lifecycle,
      event_id,
      attempt_id,
      accepted_order,
      accepted_at,
      left_at,
      removal_reason,
      registration_source
    };
  }
  if (lifecycle === 'pending')
    return {
      state: 'pending',
      event_id,
      registration_source,
      requested_at: asNullableText(value.requested_at)
    };
  if (lifecycle === 'accepted') {
    const required = asCount(value.required_generation ?? 0);
    const confirmed = asCount(value.confirmed_generation ?? 0);
    if (required === null || confirmed === null || confirmed > required) return null;
    if (confirmed < required) {
      const attempt_id = asUuid(value.attempt_id);
      const accepted_order = asPositiveInteger(value.accepted_order);
      const accepted_at = asText(value.accepted_at);
      const deadline = asText(value.registration_cutoff_at);
      if (
        !attempt_id ||
        accepted_order === null ||
        !accepted_at ||
        !deadline ||
        !Number.isFinite(Date.parse(deadline)) ||
        value.participation !== null
      )
        return null;
      return {
        state: 'reconfirmation_required',
        event_id,
        attempt_id,
        accepted_order,
        accepted_at,
        required_generation: required,
        confirmed_generation: confirmed,
        registration_source,
        registration_cutoff_at: deadline
      };
    }
    if (value.attempt_id !== undefined && !asUuid(value.attempt_id)) return null;
    const participation = asParticipation(value.participation);
    const accepted_order = asPositiveInteger(value.accepted_order);
    const position = asCount(value.position);
    const accepted_at = asText(value.accepted_at);
    if (!participation || accepted_order === null || position === null || !accepted_at) return null;
    return {
      state: 'accepted',
      ...(asUuid(value.attempt_id) ? { attempt_id: asUuid(value.attempt_id)! } : {}),
      event_id,
      participation,
      accepted_order,
      position,
      registration_source,
      requested_at: asNullableText(value.requested_at),
      approved_at: asNullableText(value.approved_at),
      accepted_at
    };
  }
  if (lifecycle === 'expired' && value.accepted_at != null) {
    const required = asCount(value.required_generation);
    const confirmed = asCount(value.confirmed_generation);
    if (
      !asPositiveInteger(value.accepted_order) ||
      !asText(value.accepted_at) ||
      value.participation !== null ||
      required === null ||
      confirmed === null ||
      confirmed >= required
    )
      return null;
    return {
      state: 'reconfirmation_excluded',
      event_id,
      registration_source,
      resolved_at: asNullableText(value.resolved_at)
    };
  }
  if (lifecycle === 'rejected' || lifecycle === 'expired')
    return {
      state: lifecycle,
      event_id,
      registration_source,
      resolved_at: asNullableText(value.resolved_at)
    };
  return null;
}

// --- Creator-only request queue -------------------------------------------------

export type MatchRegistrationRequest = {
  user_id: string;
  // The immutable attempt identity the creator must echo back to
  // decide_match_registration, so a stale decision can never resolve a newer
  // attempt after a rejection and re-application.
  attempt_id: string;
  display_name: string | null;
  display_level: number | null;
  registration_source: MatchRegistrationSource;
  requested_at: string;
};

export type MatchRegistrationQueue = {
  event_id: string;
  accepted_count: number;
  playing_count: number;
  reserve_count: number;
  // `list_match_event_registration_requests` now also carries the Reserve Not
  // Playing count so the creator queue can never merge it into ordinary
  // Reserve. Optional because a pre-cutoff payload (and the existing parser
  // fixture) may omit the additive key; when present it must be a valid count.
  reserve_not_playing_count?: number;
  maximum_registrations: number | null;
  registration_cutoff_at: string;
  requests: MatchRegistrationRequest[];
};

export type MatchRegistrationQueueResult =
  | { status: 'ok'; queue: MatchRegistrationQueue }
  | { status: 'empty' }
  | { status: 'unavailable' };

function parseRequest(value: unknown): MatchRegistrationRequest | null {
  if (!isRecord(value)) return null;
  const user_id = asUuid(value.user_id);
  const attempt_id = asUuid(value.attempt_id);
  const registration_source = asSource(value.registration_source);
  const requested_at = asText(value.requested_at);
  if (!user_id || !attempt_id || !registration_source || !requested_at) return null;
  const display_name = asNullableText(value.display_name);
  const rawLevel = value.display_level;
  let display_level: number | null;
  if (rawLevel === null || rawLevel === undefined) display_level = null;
  else if (typeof rawLevel === 'number' && Number.isFinite(rawLevel)) display_level = rawLevel;
  else return null;
  return { user_id, attempt_id, display_name, display_level, registration_source, requested_at };
}

export function parseMatchRegistrationQueue(value: unknown): MatchRegistrationQueue | null {
  if (!isRecord(value)) return null;
  const event_id = asUuid(value.event_id);
  const accepted_count = asCount(value.accepted_count);
  const playing_count = asCount(value.playing_count);
  const reserve_count = asCount(value.reserve_count);
  const registration_cutoff_at = asText(value.registration_cutoff_at);
  if (
    !event_id ||
    accepted_count === null ||
    playing_count === null ||
    reserve_count === null ||
    !registration_cutoff_at ||
    !Array.isArray(value.requests)
  )
    return null;
  const rawMaximum = value.maximum_registrations;
  let maximum_registrations: number | null;
  if (rawMaximum === null || rawMaximum === undefined) maximum_registrations = null;
  else {
    const parsedMaximum = asCount(rawMaximum);
    if (parsedMaximum === null) return null;
    maximum_registrations = parsedMaximum;
  }
  const rawReserveNotPlaying = value.reserve_not_playing_count;
  let reserve_not_playing_count: number | undefined;
  if (rawReserveNotPlaying !== null && rawReserveNotPlaying !== undefined) {
    const parsedReserveNotPlaying = asCount(rawReserveNotPlaying);
    if (parsedReserveNotPlaying === null) return null;
    reserve_not_playing_count = parsedReserveNotPlaying;
  }
  const requests: MatchRegistrationRequest[] = [];
  for (const raw of value.requests) {
    const request = parseRequest(raw);
    if (!request) return null;
    requests.push(request);
  }
  return {
    event_id,
    accepted_count,
    playing_count,
    reserve_count,
    ...(reserve_not_playing_count === undefined ? {} : { reserve_not_playing_count }),
    maximum_registrations,
    registration_cutoff_at,
    requests
  };
}

// --- FIFO quartet group / reserve position ------------------------------------
//
// The four PAF-5.3 FIFO notification kinds render a quartet group number and a
// reserve queue position. Both derive from the immutable accepted ordinal (plus
// the derived playing headcount) that the notification context already carries,
// so the arithmetic lives here instead of being duplicated in the notification
// layer. A missing or non-positive ordinal yields null so callers never render a
// fabricated group or position.

/** Quartet group for a 1-based accepted ordinal: seats 1-4 are group 1, 5-8 group 2, ... */
export function matchRegistrationGroup(acceptedOrder: number | null | undefined): number | null {
  if (
    typeof acceptedOrder !== 'number' ||
    !Number.isSafeInteger(acceptedOrder) ||
    acceptedOrder < 1
  )
    return null;
  return Math.ceil(acceptedOrder / 4);
}

/** Reserve queue position: the accepted ordinal minus the playing seats ahead of it. */
export function matchRegistrationReservePosition(
  acceptedOrder: number | null | undefined,
  playingCount: number | null | undefined
): number | null {
  if (
    typeof acceptedOrder !== 'number' ||
    !Number.isSafeInteger(acceptedOrder) ||
    acceptedOrder < 1
  )
    return null;
  if (typeof playingCount !== 'number' || !Number.isSafeInteger(playingCount) || playingCount < 0)
    return null;
  return Math.max(1, acceptedOrder - playingCount);
}

// --- Accepted roster read (PAF-5.1 gap) ---------------------------------------
//
// `list_match_event_registrations` projects the ordered accepted roster into a
// flat, safe row per player: no user ids (the caller matches its own row by the
// immutable accepted_order), no pending/rejected/expired rows and no resolution
// metadata. Every field is a primitive so the jsonb contract stays defensively
// parseable; a malformed payload degrades to null so the caller can render an
// absent roster instead of throwing.

export type MatchRosterEntry = {
  display_name: string | null;
  display_level: number | null;
  participation: MatchRegistrationParticipation;
  group_number: number | null;
  reserve_position: number | null;
  registration_source: MatchRegistrationSource;
  accepted_order: number;
};

export type MatchRosterResult =
  | { status: 'ok'; entries: MatchRosterEntry[] }
  | { status: 'empty' }
  | { status: 'unavailable' };

function parseMatchRosterEntry(value: unknown): MatchRosterEntry | null {
  if (!isRecord(value)) return null;
  const participation = asParticipation(value.participation);
  const registration_source = asSource(value.registration_source);
  const accepted_order = asPositiveInteger(value.accepted_order);
  if (!participation || !registration_source || accepted_order === null) return null;

  const display_name = asNullableText(value.display_name);
  const rawLevel = value.display_level;
  let display_level: number | null;
  if (rawLevel === null || rawLevel === undefined) display_level = null;
  else if (typeof rawLevel === 'number' && Number.isFinite(rawLevel)) display_level = rawLevel;
  else return null;

  const rawGroup = value.group_number;
  let group_number: number | null;
  if (rawGroup === null || rawGroup === undefined) group_number = null;
  else {
    const parsedGroup = asPositiveInteger(rawGroup);
    if (parsedGroup === null) return null;
    group_number = parsedGroup;
  }

  const rawReserve = value.reserve_position;
  let reserve_position: number | null;
  if (rawReserve === null || rawReserve === undefined) reserve_position = null;
  else {
    const parsedReserve = asPositiveInteger(rawReserve);
    if (parsedReserve === null) return null;
    reserve_position = parsedReserve;
  }

  // The server contract carries a group for playing rows and a reserve position
  // for the reserve tail; a row missing its own marker is malformed.
  if (participation === 'playing' && group_number === null) return null;
  if (participation !== 'playing' && reserve_position === null) return null;

  return {
    display_name,
    display_level,
    participation,
    group_number,
    reserve_position,
    registration_source,
    accepted_order
  };
}

/** Parses the whole accepted-roster payload; null means the payload is unusable. */
export function parseMatchRoster(value: unknown): MatchRosterEntry[] | null {
  if (!Array.isArray(value)) return null;
  const entries: MatchRosterEntry[] = [];
  for (const raw of value) {
    const entry = parseMatchRosterEntry(raw);
    if (!entry) return null;
    entries.push(entry);
  }
  return entries;
}
