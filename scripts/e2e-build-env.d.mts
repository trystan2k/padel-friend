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
export function e2eBuildEnv(serviceRoleKey: string | undefined): Record<string, string>;
