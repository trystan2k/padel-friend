import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { emitDiagnostic } from '../../lib/diagnostics.server';
import { getServerClient } from '../../lib/supabase/server';

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
  } catch {
    // getClaims() is the auth-lookup boundary: every failure it throws (malformed token decode,
    // unsupported alg, unreachable auth server) is a recoverable lookup failure, so the public
    // page renders guest. Raw detail never serializes; the safe server-side diagnostic keeps the
    // failure diagnosable. Client/configuration errors still surface because getServerClient()
    // runs outside this try (repo convention, see requireAuthenticatedClient).
    emitDiagnostic('request.failure', 'failure', {
      code: 'OPERATION_FAILED',
      source: 'server-function'
    });
    return false;
  }
});
