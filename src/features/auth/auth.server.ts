import { setResponseHeader } from '@tanstack/react-start/server';
import { emitDiagnostic } from '../../lib/diagnostics.server';
import { getServerClient } from '../../lib/supabase/server';

export async function requireAuthenticatedClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const client = getServerClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) {
    emitDiagnostic('auth.failure', 'rejected', { code: 'UNAUTHENTICATED' });
    throw new Error('UNAUTHENTICATED');
  }
  return { client, userId: data.claims.sub };
}
