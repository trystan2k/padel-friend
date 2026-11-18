import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { toClientError } from '../../lib/client-error.server';
import { getServerClient } from '../../lib/supabase/server';

// Token verification failures thrown by auth-js (getAlgorithm / getClaims). Anything else is a
// configuration or programming error and must surface.
const INVALID_CLAIMS_MESSAGE = /^invalid (alg|jwt|jwk)\b|\binvalid .*claim/i;

function isInvalidClaimsError(error: unknown) {
  return error instanceof Error && INVALID_CLAIMS_MESSAGE.test(error.message);
}

/**
 * Public homepage variant: only whether verified claims exist, never who they belong to.
 * Missing, invalid, expired or unreachable-auth claims all read as guest, so the page never
 * redirects or fails. The CTA target (/dashboard) re-authorizes through the protected gates.
 */
export const getPublicHomepageAuthenticated = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  try {
    const { data, error } = await client.auth.getClaims();
    return Boolean(!error && data?.claims?.sub);
  } catch (error) {
    // auth-js can throw (not return) while verifying a malformed token, e.g. an unsupported alg.
    if (isInvalidClaimsError(error)) return false;
    // Unrelated errors leave the boolean contract through the sanctioned client-error boundary:
    // raw detail never serializes, and a safe server-side diagnostic keeps them diagnosable.
    throw toClientError(error);
  }
});
