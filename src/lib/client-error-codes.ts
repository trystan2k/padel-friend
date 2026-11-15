/**
 * Allowlist of error codes a server function may expose to the browser. Database RPCs raise the
 * exact code as the exception message (SQLSTATE P0001); callers match it by exact membership,
 * never by regex or substring. Append new codes here instead of keeping a second list.
 */
export const COMMUNITY_RPC_ERROR_CODES = [
  'UNAUTHENTICATED',
  'NOT_COMMUNITY_ADMIN',
  'COMMUNITY_INVALID_INPUT',
  'COMMUNITY_VENUE_NOT_FOUND',
  'COMMUNITY_NOT_ELIGIBLE',
  'ALREADY_MEMBER_OR_PENDING',
  'INVITATION_ALREADY_OPEN',
  'INVITEE_NOT_FOUND',
  'INVITATION_NOT_FOUND'
] as const;

export type CommunityRpcErrorCode = (typeof COMMUNITY_RPC_ERROR_CODES)[number];

const communityRpcErrorCodes: ReadonlySet<string> = new Set(COMMUNITY_RPC_ERROR_CODES);

export function isCommunityRpcErrorCode(value: unknown): value is CommunityRpcErrorCode {
  return typeof value === 'string' && communityRpcErrorCodes.has(value);
}
