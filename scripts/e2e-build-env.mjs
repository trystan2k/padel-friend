import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { TestStackEnvError, resolveTestStackEnv } from './test-stack-env.mjs';

// Single source of truth for builds and Worker bindings used by E2E. Wrangler loads a root
// .dev.vars before considering process.env, even with CLOUDFLARE_INCLUDE_PROCESS_ENV set.
// Replace the generated .dev.vars after an E2E build so preview uses only the test bindings.

/**
 * Resolves the test tuple from the pinned test workdir's live status and installs it into env,
 * replacing any inherited dev/stale VITE_*, DATABASE_URL, handoff or service key (an inherited value
 * is trusted only by being identical to the status-derived one). Never throws: on failure the reason is
 * returned so callers that must not go keyless can report it.
 */
export function resolveTestBuildEnv(env = process.env, exec = execFileSync) {
  try {
    const tuple = resolveTestStackEnv(exec);
    Object.assign(env, tuple);
    return { tuple };
  } catch (error) {
    return { reason: error instanceof TestStackEnvError ? error.message : 'status failed' };
  }
}

/** The tuple, or an Error that says why none could be resolved and how to provide one. */
export function requireTestBuildEnv(env = process.env, exec = execFileSync) {
  const { tuple, reason } = resolveTestBuildEnv(env, exec);
  if (tuple) return tuple;
  throw new Error(
    `The e2e build requires the test Supabase stack (public tuple and service-role key), but it could not be resolved (${reason}). Start it with pnpm test:stack:up; the dev stack and root .env files are never used.`
  );
}

// Throwaway PUBLIC VAPID key (its private half was discarded) that lets the enrollment config read
// report Web Push as available in e2e. No private key or subject is configured, so nothing can send.
export const E2E_WEB_PUSH_ENV = {
  WEB_PUSH_ENABLED: 'true',
  WEB_PUSH_VAPID_PUBLIC_KEY:
    'BD7OaBbljzNT-T8qXAyjFDuSUf2_-pfv05bxZB1_OrzgHgV80uBt_sSLXNrA6H8f30I7GDmv0_9SYBSQsCeZjEw',
  WEB_PUSH_VAPID_KEY_ID: 'e2e-test'
};

// Trusted email-link origin of the e2e preview (src/lib/app-origin.server.ts rejects add-player
// writes without it). Must equal the Playwright baseURL/webServer origin.
export const E2E_APP_ORIGIN = 'http://127.0.0.1:4173';

/**
 * Env additions for a build (or preview) that e2e specs exercise; empty without a tuple. Vite
 * gives the process env priority over .env files for the client bundle's public pair. The DB
 * connection strings are blanked so Wrangler's dotenv fallback cannot bake the password.
 */
export function e2eBuildEnv(tuple) {
  return tuple
    ? {
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        APP_ORIGIN: E2E_APP_ORIGIN,
        VITE_SUPABASE_URL: tuple.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: tuple.VITE_SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: tuple.SUPABASE_SERVICE_ROLE_KEY,
        DATABASE_URL: '',
        INTEGRATION_SUPABASE_DB_URL: '',
        ...E2E_WEB_PUSH_ENV
      }
    : {};
}

/** Only bindings needed by the preview Worker; never copy the whole build environment. */
export function devVarsContent(tuple) {
  const bindings = {
    SUPABASE_SERVICE_ROLE_KEY: tuple.SUPABASE_SERVICE_ROLE_KEY,
    APP_ORIGIN: E2E_APP_ORIGIN,
    ...E2E_WEB_PUSH_ENV
  };
  return Object.entries(bindings)
    .map(([key, value]) => key + '=' + value + '\n')
    .join('');
}

export function writeE2ePreviewVars(env = process.env, write = writeFileSync) {
  if (env.CLOUDFLARE_INCLUDE_PROCESS_ENV !== 'true' || env.APP_ORIGIN !== E2E_APP_ORIGIN) return;
  if (!env.SUPABASE_SERVICE_ROLE_KEY)
    throw new Error('The E2E preview build requires a test service-role key.');
  write('dist/server/.dev.vars', devVarsContent(env));
}

if (import.meta.main) writeE2ePreviewVars();
