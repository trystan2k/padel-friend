export const TEST_REPO_ROOT: string;
export const TEST_API_PORT: string;
export const TEST_DB_PORT: string;
export const TEST_MAIL_PORT: string;
export const TEST_DB_NAME: string;
export const TEST_DB_CONTAINER: string;
export const TEST_ENV_MAP: Record<string, string[]>;
export const TEST_ENV_NAMES: string[];
export const TEST_CLI_OPTIONS: { cwd: string };

export type TestStackEnv = {
  VITE_SUPABASE_URL: string;
  VITE_SUPABASE_PUBLISHABLE_KEY: string;
  DATABASE_URL: string;
  INTEGRATION_SUPABASE_DB_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MAILPIT_URL: string;
};
export type StatusExec = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    encoding: 'utf8';
    timeout: number;
    maxBuffer: number;
    stdio: ['ignore', 'pipe', 'pipe'];
  }
) => string;

export class TestStackEnvError extends Error {}

export function validateTestEnv(env: Record<string, string | undefined>): TestStackEnv;
export function testEnvFromStatus(stdout: string): TestStackEnv;
export function testCliArgs(...command: string[]): string[];
export function testQueryArgs(sql: string): string[];
export function resolveTestStackEnv(exec?: StatusExec): TestStackEnv;
export function ensureTestStackEnv(
  env?: Record<string, string | undefined>,
  exec?: StatusExec
): TestStackEnv;
export function requireTestEnv(env?: Record<string, string | undefined>): TestStackEnv;
