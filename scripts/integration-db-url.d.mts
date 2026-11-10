export const INTEGRATION_DB_URL_ENV: 'INTEGRATION_SUPABASE_DB_URL';
export const LOCAL_DB_PORT: string;
export const LOCAL_DB_NAME: string;
export function assertHandoffDatabaseUrl(value: string): string;
export function handoffDatabaseUrl(env?: Record<string, string | undefined>): string | undefined;
export function resolveLocalDatabaseUrl(
  exec?: (
    command: string,
    args: string[],
    options: {
      encoding: 'utf8';
      timeout: number;
      maxBuffer: number;
      stdio: ['ignore', 'pipe', 'pipe'];
    }
  ) => string
): string | undefined;
