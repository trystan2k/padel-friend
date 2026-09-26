import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import { getRequestHeader, setCookie, setResponseHeader } from '@tanstack/react-start/server';
import type { Database } from './database.types';

export function getServerClient() {
  return createServerClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return parseCookieHeader(getRequestHeader('cookie') ?? '').filter(
            (cookie): cookie is { name: string; value: string } => cookie.value !== undefined
          );
        },
        setAll(cookies) {
          for (const { name, value, options } of cookies) setCookie(name, value, options);
          setResponseHeader('Cache-Control', 'private, no-store');
        }
      }
    }
  );
}
