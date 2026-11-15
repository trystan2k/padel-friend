import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { requireTestEnv } from '../../scripts/test-stack-env.mjs';

/**
 * Service-role client for trusted fixture state only. Community memberships, invitations, venues and
 * settings are writable by authenticated users solely through RPCs, so fixtures that need rows an
 * RPC would refuse (or that skip the invite flow) seed them here. It has no auth.uid(): pass
 * created_by / issued_by explicitly.
 */
export function trustedClient(): SupabaseClient {
  const tuple = requireTestEnv();
  return createClient(tuple.VITE_SUPABASE_URL, tuple.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
