import { execFileSync } from 'node:child_process';

// Single source of truth for the env an e2e-capable build needs. The add-player server functions read
// the server-only service-role key from the preview worker's environment
// (src/lib/supabase/admin.server.ts), and @cloudflare/vite-plugin only bakes process env into
// dist/server/.dev.vars at BUILD time when CLOUDFLARE_INCLUDE_PROCESS_ENV is set. Every build that e2e
// may preview (Playwright's webServer, the complete-check build stage) must therefore get these.
// The key never reaches a tracked file: it is resolved from the shell or the local Supabase stack and
// lands only in git-ignored dist/.

// Resolves the service-role key from the caller's env or the local Supabase stack (workers inherit
// process.env, so a key found via the stack is exported there too). Never throws: on failure the
// reason is returned so callers that must not go keyless can report it.
export function resolveServiceRoleKey(env = process.env, exec = execFileSync) {
  if (env.SUPABASE_SERVICE_ROLE_KEY) return { key: env.SUPABASE_SERVICE_ROLE_KEY };
  try {
    const output = exec('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const key = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(output)?.[1];
    if (!key) return { reason: '`supabase status -o env` printed no SERVICE_ROLE_KEY' };
    env.SUPABASE_SERVICE_ROLE_KEY = key;
    return { key };
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr.trim() : '';
    const detail = stderr || (error instanceof Error ? error.message : String(error));
    return { reason: `\`supabase status -o env\` failed: ${detail}` };
  }
}

/** The key, or undefined when neither the env nor the local stack provides one. */
export function localServiceRoleKey(env = process.env, exec = execFileSync) {
  return resolveServiceRoleKey(env, exec).key;
}

/** The key, or an Error that says why none could be resolved and how to provide one. */
export function requireServiceRoleKey(env = process.env, exec = execFileSync) {
  const { key, reason } = resolveServiceRoleKey(env, exec);
  if (key) return key;
  throw new Error(
    `The e2e preview requires the Supabase service-role key in dist/server/.dev.vars, but none could be resolved (${reason}). Export SUPABASE_SERVICE_ROLE_KEY or start the local stack (pnpm db:start).`
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

/** Env additions for a build (or preview) that e2e specs exercise; empty without a key. */
export function e2eBuildEnv(serviceRoleKey) {
  return serviceRoleKey
    ? {
        CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
        SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
        ...E2E_WEB_PUSH_ENV
      }
    : {};
}
