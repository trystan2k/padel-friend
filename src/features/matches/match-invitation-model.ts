import {
  matchRegistrationActionError,
  parseSubmitMatchRegistrationResult,
  type MatchRegistrationErrorCode,
  type AcceptedMatchRegistration,
  type PendingMatchRegistration
} from './match-registration-model';

export type MatchInvitationStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'cancelled';
export type MatchInvitation = {
  invitation_id: string;
  status: MatchInvitationStatus;
  effective_status: MatchInvitationStatus;
  expires_at: string;
  responded_at: string | null;
};
export type MyMatchInvitationResult =
  | { status: 'ok'; invitation: MatchInvitation }
  | { status: 'empty' | 'unavailable' };
export type InvitationErrorCode = MatchRegistrationErrorCode | 'expired';
export const MATCH_INVITATION_ERROR_COPY: Readonly<Record<InvitationErrorCode, string>> = {
  expired: 'matches.invitations.errors.expired',
  already_resolved: 'matches.invitations.errors.alreadyResolved',
  not_found: 'matches.invitations.errors.notFound',
  event_not_found: 'matches.invitations.errors.eventNotFound',
  invite_only: 'matches.invitations.errors.inviteOnly',
  closed: 'matches.invitations.errors.closed',
  denied: 'matches.invitations.errors.denied',
  duplicate: 'matches.invitations.errors.duplicate',
  pending_duplicate: 'matches.invitations.errors.pendingDuplicate',
  full: 'matches.invitations.errors.full',
  requester_ineligible: 'matches.invitations.errors.requesterIneligible',
  forbidden: 'matches.invitations.errors.forbidden',
  invalid: 'matches.invitations.errors.invalid',
  unauthenticated: 'matches.invitations.errors.unauthenticated',
  unavailable: 'matches.invitations.errors.unavailable'
};
export type InvitationResult =
  | {
      status: 'accepted';
      event_id: string;
      invitation_id: string;
      replayed: boolean;
      registration: AcceptedMatchRegistration | PendingMatchRegistration;
    }
  | {
      status: 'declined' | 'expired';
      event_id: string;
      invitation_id: string;
      replayed: boolean;
      registration: null;
    }
  | { status: 'error'; code: InvitationErrorCode };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function status(value: unknown): value is MatchInvitationStatus {
  return (
    value === 'pending' ||
    value === 'accepted' ||
    value === 'declined' ||
    value === 'expired' ||
    value === 'cancelled'
  );
}

export function parseMatchInvitation(value: unknown): MatchInvitation | null {
  if (
    !record(value) ||
    !isUuid(value.invitation_id) ||
    !status(value.status) ||
    !status(value.effective_status) ||
    !timestamp(value.expires_at) ||
    !(value.responded_at === null || timestamp(value.responded_at))
  )
    return null;
  const responded =
    value.status === 'accepted' || value.status === 'declined' || value.status === 'cancelled';
  if (responded !== (value.responded_at !== null)) return null;
  if (
    value.effective_status !== value.status &&
    !(value.status === 'pending' && value.effective_status === 'expired')
  )
    return null;
  return {
    invitation_id: value.invitation_id,
    status: value.status,
    effective_status: value.effective_status,
    expires_at: value.expires_at,
    responded_at: value.responded_at
  };
}

export function parseInvitationResult(value: unknown): InvitationResult | null {
  if (
    !record(value) ||
    !isUuid(value.event_id) ||
    !isUuid(value.invitation_id) ||
    typeof value.replayed !== 'boolean'
  )
    return null;
  const base = {
    event_id: value.event_id,
    invitation_id: value.invitation_id,
    replayed: value.replayed
  };
  if (value.status === 'accepted') {
    const result = parseSubmitMatchRegistrationResult(value.registration);
    if (!result || result.status === 'error' || result.registration.event_id !== value.event_id)
      return null;
    const registration = result.registration;
    if (registration.lifecycle === 'pending' && !timestamp(registration.requested_at)) return null;
    if (
      registration.lifecycle === 'accepted' &&
      (!timestamp(registration.accepted_at) ||
        !(registration.approved_at === null || timestamp(registration.approved_at)))
    )
      return null;
    return { ...base, status: 'accepted', registration: result.registration };
  }
  if ((value.status === 'declined' || value.status === 'expired') && value.registration === null)
    return { ...base, status: value.status, registration: null };
  return null;
}

export function invitationActionError(error: {
  code?: string | null;
  message?: string | null;
}): InvitationResult {
  const tokens = {
    MATCH_INVITATION_EXPIRED: 'expired',
    MATCH_INVITATION_ALREADY_RESOLVED: 'already_resolved',
    MATCH_INVITATION_NOT_FOUND: 'not_found'
  } as const;
  for (const [token, code] of Object.entries(tokens))
    if (error.message === token) return { status: 'error', code };
  if (error.code === '23514') return { status: 'error', code: 'invalid' };
  return matchRegistrationActionError(error) ?? { status: 'error', code: 'unavailable' };
}
