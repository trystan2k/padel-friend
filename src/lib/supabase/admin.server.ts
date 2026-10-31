import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

// Server-only service-role client. The key comes from a Workers secret binding
// (`SUPABASE_SERVICE_ROLE_KEY`, never a `VITE_` variable), so it is never
// inlined into a client bundle; scripts/check-client-secrets.mjs enforces it.
export function getAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SERVICE_ROLE_UNAVAILABLE');
  return createClient<Database>(import.meta.env.VITE_SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

export type AdminClient = ReturnType<typeof getAdminClient>;
