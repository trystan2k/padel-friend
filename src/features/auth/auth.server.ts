import { setResponseHeader } from '@tanstack/react-start/server';
import { emitDiagnostic } from '../../lib/diagnostics.server';
import { toClientError } from '../../lib/client-error.server';
import { getServerClient } from '../../lib/supabase/server';

/**
 * Live-existence gate for the protected boundary. getClaims only proves the JWT signature, so the cookie of
 * an erased (no live participant identity) or frozen (deletion executing) account still decodes. One
 * indexed database lookup decides; no Auth roundtrip. false = treat the browser as signed out.
 */
export async function resolveLiveSubject(
  client: ReturnType<typeof getServerClient>
): Promise<boolean> {
  const { data, error } = await client.rpc('is_actor_live');
  if (error) throw toClientError(error);
  return data;
}

export async function requireAuthenticatedClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  const { data, error } = await client.auth.getClaims();
  // Anonymous sign-ins are off (config + hosted checklist); reject them here regardless of that setting.
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true) {
    emitDiagnostic('auth.failure', 'rejected', { code: 'UNAUTHENTICATED' });
    throw new Error('UNAUTHENTICATED');
  }
  return { client, userId: data.claims.sub };
}
