export const PREDECESSOR: string;
export function databaseHost(status: string): string;
export function runHarness(options?: {
  env?: NodeJS.ProcessEnv;
  run?: (
    command: string,
    args: string[],
    options?: Record<string, unknown>
  ) => {
    status: number | null;
    stdout?: string;
    stderr?: string;
    error?: Error;
  };
  log?: Pick<Console, 'log'>;
}): void;
