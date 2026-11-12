import type { StatusExec, TestStackEnv } from './test-stack-env.mjs';

export function runWithTestStack(options: {
  argv: string[];
  env?: Record<string, string | undefined>;
  resolveEnv?: (exec?: StatusExec) => TestStackEnv;
  run?: (
    command: string,
    args: string[],
    options: { stdio: 'inherit'; env: Record<string, string | undefined> }
  ) => { status: number | null; signal?: NodeJS.Signals | null; error?: Error };
}): number;
