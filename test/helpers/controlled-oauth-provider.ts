import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createClient, type Session } from '@supabase/supabase-js';
import type { LocalSupabaseEnv } from './local-supabase-env';

/**
 * Controlled stand-in for Google: a tiny OAuth2 provider the test process serves on the
 * port supabase/config.toml points the local `keycloak` provider at. Auth runs its real
 * authorize -> callback -> token -> userinfo -> identity-linking code against it, so the
 * tests prove how this stack links a provider identity to an existing Auth user. It
 * does NOT prove anything about Google itself (no external Google client is used).
 */
export const CONTROLLED_PROVIDER_PORT = 55399;
const REALM = '/realms/controlled/protocol/openid-connect';

export type ProviderIdentity = { sub: string; email: string; emailVerified: boolean };

export type ControlledProvider = {
  /** Drives a full PKCE sign-in as `identity` and returns the Auth session it yields. */
  signIn(
    env: LocalSupabaseEnv,
    identity: ProviderIdentity
  ): Promise<{ session: Session | null; error: string | null }>;
  close(): Promise<void>;
};

function bearer(request: IncomingMessage): string {
  return (request.headers.authorization ?? '').replace(/^Bearer /i, '');
}

export async function startControlledProvider(): Promise<ControlledProvider> {
  const codes = new Map<string, ProviderIdentity>();
  const tokens = new Map<string, ProviderIdentity>();
  let pending: ProviderIdentity | null = null;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${CONTROLLED_PROVIDER_PORT}`);
    if (request.method === 'GET' && url.pathname === `${REALM}/auth` && pending) {
      const code = crypto.randomUUID();
      codes.set(code, pending);
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      response.writeHead(302, { location: back.toString() }).end();
    } else if (request.method === 'POST' && url.pathname === `${REALM}/token`) {
      request.resume();
      request.on('end', () => {
        const code = [...codes.keys()].at(-1);
        const identity = code ? codes.get(code) : undefined;
        if (!code || !identity) {
          response.writeHead(400).end('{"error":"invalid_grant"}');
          return;
        }
        codes.delete(code);
        const accessToken = crypto.randomUUID();
        tokens.set(accessToken, identity);
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end(
            JSON.stringify({ access_token: accessToken, token_type: 'Bearer', expires_in: 300 })
          );
      });
    } else if (request.method === 'GET' && url.pathname === `${REALM}/userinfo`) {
      const identity = tokens.get(bearer(request));
      if (!identity) {
        response.writeHead(401).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          sub: identity.sub,
          email: identity.email,
          email_verified: identity.emailVerified,
          name: 'Controlled Provider User'
        })
      );
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(CONTROLLED_PROVIDER_PORT, '0.0.0.0', resolve);
  });

  return {
    async signIn(env, identity) {
      pending = identity;
      const store = new Map<string, string>();
      const client = createClient(env.url, env.key, {
        auth: {
          flowType: 'pkce',
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storage: {
            getItem: (key) => store.get(key) ?? null,
            setItem: (key, value) => void store.set(key, value),
            removeItem: (key) => void store.delete(key)
          }
        }
      });
      const started = await client.auth.signInWithOAuth({
        provider: 'keycloak',
        options: {
          redirectTo: 'http://127.0.0.1:3000/auth/callback?next=/onboarding',
          skipBrowserRedirect: true
        }
      });
      if (!started.data.url) return { session: null, error: 'no authorize url' };
      // Follow the browser's redirects by hand: Auth -> provider -> Auth callback -> app.
      let location = started.data.url;
      for (let hop = 0; hop < 4; hop += 1) {
        // Auth is configured with the container-side name; the test process reaches the same stub locally.
        const step = await fetch(location.replace('host.docker.internal', '127.0.0.1'), {
          redirect: 'manual'
        });
        location = step.headers.get('location') ?? '';
        if (!location || location.startsWith('http://127.0.0.1:3000/')) break;
      }
      const landed = new URL(location || 'http://invalid.local/');
      const code = landed.searchParams.get('code');
      if (!code) {
        return {
          session: null,
          error: landed.searchParams.get('error_description') ?? landed.search
        };
      }
      const exchanged = await client.auth.exchangeCodeForSession(code);
      return { session: exchanged.data.session, error: exchanged.error?.message ?? null };
    },
    close: () => new Promise<void>((resolve) => void server.close(() => resolve()))
  };
}
