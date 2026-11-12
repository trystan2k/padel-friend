export const INTEGRATION_DB_URL_ENV: 'INTEGRATION_SUPABASE_DB_URL';
export const LOCAL_DB_PORT: string;
export const LOCAL_DB_NAME: string;
export function assertHandoffDatabaseUrl(value: string): string;
export function handoffDatabaseUrl(env?: Record<string, string | undefined>): string | undefined;
export function discoverTestDatabaseUrl(
  env?: Record<string, string | undefined>,
  exec?: Parameters<typeof import('./test-stack-env.mjs').resolveTestStackEnv>[0]
): string;
export function resolveLocalDatabaseUrl(
  exec?: Parameters<typeof import('./test-stack-env.mjs').resolveTestStackEnv>[0]
): string;
