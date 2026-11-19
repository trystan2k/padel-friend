import type { StatusExec, TestStackEnv } from './test-stack-env.mjs';

export function resolveTestBuildEnv(
  env?: Record<string, string | undefined>,
  exec?: StatusExec
): { tuple?: TestStackEnv; reason?: string };
export function requireTestBuildEnv(
  env?: Record<string, string | undefined>,
  exec?: StatusExec
): TestStackEnv;
export const E2E_WEB_PUSH_ENV: {
  WEB_PUSH_ENABLED: string;
  WEB_PUSH_VAPID_PUBLIC_KEY: string;
  WEB_PUSH_VAPID_KEY_ID: string;
};
export function e2eBuildEnv(tuple: TestStackEnv | undefined): Record<string, string>;
export function devVarsContent(tuple: Pick<TestStackEnv, 'SUPABASE_SERVICE_ROLE_KEY'>): string;
export function writeE2ePreviewVars(
  env?: Record<string, string | undefined>,
  write?: (path: string, content: string) => void
): void;
