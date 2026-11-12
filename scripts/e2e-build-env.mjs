import { execFileSync } from 'node:child_process';
import { TestStackEnvError, resolveTestStackEnv } from './test-stack-env.mjs';

// Single source of truth for the env an e2e-capable build needs. The add-player server functions read
// the server-only service-role key from the preview worker's environment
// (src/lib/supabase/admin.server.ts), and @cloudflare/vite-plugin only bakes process env into
// dist/server/.dev.vars at BUILD time when CLOUDFLARE_INCLUDE_PROCESS_ENV is set. Every build that e2e
// may preview (Playwright's webServer, the complete-check build stage) must therefore get these.
// The whole TEST tuple (public URL/key baked into the client bundle AND the server binding) comes from
// one status read of the test stack, so build, preview and test processes can never mix tuples. The
// service key never reaches a tracked file: it lands only in git-ignored dist/.

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

/**
 * Env additions for a build (or preview) that e2e specs exercise; empty without a tuple. Explicit
 * process env wins over root .env*, so the public pair is pinned here too. The DB connection strings
 * are blanked: Cloudflare would otherwise bake the password into the server bundle's vars.
 */
export function e2eBuildEnv(tuple) {
  return tuple
    ? {
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        VITE_SUPABASE_URL: tuple.VITE_SUPABASE_URL,
        VITE_SUPABASE_PUBLISHABLE_KEY: tuple.VITE_SUPABASE_PUBLISHABLE_KEY,
        SUPABASE_SERVICE_ROLE_KEY: tuple.SUPABASE_SERVICE_ROLE_KEY,
        DATABASE_URL: '',
        INTEGRATION_SUPABASE_DB_URL: '',
        ...E2E_WEB_PUSH_ENV
      }
    : {};
}
