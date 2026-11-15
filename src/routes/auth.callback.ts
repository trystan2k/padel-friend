import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { createFileRoute } from '@tanstack/react-router';
import { confirmInvite, stageInvite } from '../features/auth/invite-confirmation.server';
import { normalizeReturnPath } from '../features/auth/return-path';
import { authCookieOptions } from '../lib/supabase/cookie-options';
import type { Database } from '../lib/supabase/database.types';

export const Route = createFileRoute('/auth/callback')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const headers = new Headers({
          'Cache-Control': 'private, no-store',
          'Referrer-Policy': 'no-referrer'
        });
        const code = url.searchParams.get('code');
        const next = normalizeReturnPath(url.searchParams.get('next'));

        const tokenHash = url.searchParams.get('token_hash');
        const invite = tokenHash && url.searchParams.get('type') === 'invite' ? tokenHash : null;
        if (!code && invite && invite.length <= 1024 && !url.searchParams.has('error')) {
          return stageInvite(request, invite, next);
        }

        if (code && !url.searchParams.has('error')) {
          const client = createServerClient<Database>(
            import.meta.env.VITE_SUPABASE_URL,
            import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            {
              cookieOptions: authCookieOptions(url.protocol),
              cookies: {
                getAll() {
                  return parseCookieHeader(request.headers.get('cookie') ?? '').filter(
                    (cookie): cookie is { name: string; value: string } =>
                      cookie.value !== undefined
                  );
                },
                setAll(cookies) {
                  for (const { name, value, options } of cookies) {
                    headers.append('Set-Cookie', serializeCookieHeader(name, value, options));
                  }
                }
              }
            }
          );
          const { error } = await client.auth.exchangeCodeForSession(code);
          if (!error) {
            headers.set('Location', new URL(next, url).toString());
            return new Response(null, { status: 303, headers });
          }
        }

        const failure = new URL('/login', url);
        failure.searchParams.set('authError', '1');
        if (next !== '/dashboard') failure.searchParams.set('next', next);
        headers.set('Location', failure.toString());
        return new Response(null, { status: 303, headers });
      },
      POST: ({ request }) => confirmInvite(request)
    }
  }
});
