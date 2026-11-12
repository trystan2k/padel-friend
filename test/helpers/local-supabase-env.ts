import { TestStackEnvError, validateTestEnv } from '../../scripts/test-stack-env.mjs';

export type LocalSupabaseEnv = {
  url: string;
  key: string;
  source: 'environment';
};
type Env = Record<string, string | undefined>;

/**
 * The shared validated TEST Supabase environment. Strictly the test tuple: loopback host, exact test
 * API/DB/Mailpit ports, no parameters, non-empty keys. A dev tuple, a remote URL or an incomplete set
 * is rejected (env null + reason-only text), never replaced by a root `.env` or dev fallback.
 */
export function localSupabaseEnv(options: { env?: Env } = {}): {
  env: LocalSupabaseEnv | null;
  reason: string;
} {
  try {
    const tuple = validateTestEnv(options.env ?? process.env);
    return {
      env: {
        url: tuple.VITE_SUPABASE_URL,
        key: tuple.VITE_SUPABASE_PUBLISHABLE_KEY,
        source: 'environment'
      },
      reason: ''
    };
  } catch (error) {
    return {
      env: null,
      reason:
        error instanceof TestStackEnvError
          ? `Test Supabase environment unavailable: ${error.message}`
          : 'Test Supabase environment unavailable'
    };
  }
}

export function assertLocalSupabaseEnvInCi(env: LocalSupabaseEnv | null, ci?: string): void {
  if (ci && !env) throw new Error('Local Supabase credentials are required in CI');
}
