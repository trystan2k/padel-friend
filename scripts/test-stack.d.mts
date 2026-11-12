export interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

export class TestStackError extends Error {
  exitCode: number;
  constructor(message: string, exitCode?: number);
}

export const TEST_WORKDIR: string;
export const TEST_PROJECT_ID: string;
export const TEST_API_URL: string;
export const TEST_CONFIG: Record<string, string | number | boolean>;
export const VERBS: string[];

export function parseSimpleToml(text: string): Record<string, string | number | boolean | string[]>;
export function readTestConfig(
  workdir?: string
): Promise<Record<string, string | number | boolean | string[]>>;
export function assertTestConfig(config: Record<string, unknown>): void;
export function sanitize(text: string): string;
export function cliArgs(...command: string[]): string[];
export function parseArgs(argv: string[], env?: Record<string, string | undefined>): string;
export function assertHealthyStatus(stdout: string): void;
export function runTestStack(
  argv: string[],
  options?: {
    env?: Record<string, string | undefined>;
    runProcess?: (
      command: string,
      args: string[],
      options: { cwd: string }
    ) => Promise<ProcessResult>;
    log?: (message: string) => void;
    readConfig?: () => Promise<Record<string, unknown>>;
  }
): Promise<void>;
