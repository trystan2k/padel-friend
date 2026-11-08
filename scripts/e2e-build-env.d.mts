export function resolveServiceRoleKey(
  env?: Record<string, string | undefined>,
  exec?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe'] }
  ) => string
): { key?: string; reason?: string };
export function requireServiceRoleKey(
  env?: Record<string, string | undefined>,
  exec?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe'] }
  ) => string
): string;
export function localServiceRoleKey(
  env?: Record<string, string | undefined>,
  exec?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; stdio: ['ignore', 'pipe', 'pipe'] }
  ) => string
): string | undefined;
export const E2E_WEB_PUSH_ENV: {
  WEB_PUSH_ENABLED: string;
  WEB_PUSH_VAPID_PUBLIC_KEY: string;
  WEB_PUSH_VAPID_KEY_ID: string;
};
export function e2eBuildEnv(serviceRoleKey: string | undefined): Record<string, string>;
