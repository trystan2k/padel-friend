import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

export function getBrowserClient() {
  return createBrowserClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  );
}
