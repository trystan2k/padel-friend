export const PHASES: readonly ['parallel', 'serial'];
export function fileFilters(args: string[]): string[];
export function excludeArgs(args: string[]): string[];
export function phaseArgs(args: string[], phase: string): string[];
export function countMatchingFiles(
  phaseEnv: Record<string, string | undefined>,
  selection: string[],
  run?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; env: Record<string, string | undefined> }
  ) => { status: number | null; stdout?: string }
): number | undefined;
export function runIntegration(options?: {
  args?: string[];
  env?: Record<string, string | undefined>;
  run?: (
    command: string,
    args: string[],
    options: { stdio: 'inherit'; env: Record<string, string | undefined> }
  ) => { status: number | null };
  countFiles?: (
    phaseEnv: Record<string, string | undefined>,
    filters: string[]
  ) => number | undefined;
}): number;
