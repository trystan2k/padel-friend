const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FORMER = /^former-[0-9a-f]{16}$/;

/**
 * Participant identifier in retained-history payloads. A live participant is its real user id. A
 * departed one is a scope-local key ("former-<16 hex>") minted by the database per reader scope: it is
 * stable inside one game group, league or match, never across scopes, and unrelated to any user id.
 */
export function isParticipantRef(value: unknown): value is string {
  return typeof value === 'string' && (UUID.test(value) || FORMER.test(value));
}
