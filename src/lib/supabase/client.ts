import { createBrowserClient } from '@supabase/ssr';
import { authCookieOptions } from './cookie-options';
import type { Database } from './database.types';

export function getBrowserClient() {
  return createBrowserClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    { cookieOptions: authCookieOptions(window.location.protocol) }
  );
}
