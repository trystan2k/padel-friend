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

/**
 * Generic outcomes the central mapper (`toClientError`) collapses SQLSTATE classes and unexpected
 * failures into. They carry no database detail; the UI shows its generic failure copy for them.
 */
export const GENERIC_CLIENT_ERROR_CODES = [
  'REQUEST_INVALID',
  'REQUEST_CONFLICT',
  'RESOURCE_NOT_FOUND',
  'FORBIDDEN',
  'OPERATION_FAILED'
] as const;

export type GenericClientErrorCode = (typeof GENERIC_CLIENT_ERROR_CODES)[number];
export type ClientErrorCode = CommunityRpcErrorCode | GenericClientErrorCode;

export type CommunityRpcErrorCode = (typeof COMMUNITY_RPC_ERROR_CODES)[number];

const communityRpcErrorCodes: ReadonlySet<string> = new Set(COMMUNITY_RPC_ERROR_CODES);
const clientErrorCodes: ReadonlySet<string> = new Set([
  ...COMMUNITY_RPC_ERROR_CODES,
  ...GENERIC_CLIENT_ERROR_CODES
]);

export function isCommunityRpcErrorCode(value: unknown): value is CommunityRpcErrorCode {
  return typeof value === 'string' && communityRpcErrorCodes.has(value);
}

export function isClientErrorCode(value: unknown): value is ClientErrorCode {
  return typeof value === 'string' && clientErrorCodes.has(value);
}
