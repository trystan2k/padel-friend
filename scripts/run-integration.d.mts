export const PHASES: readonly ['parallel', 'serial'];
export function phaseArgs(args: string[], phase: string): string[];
export function runIntegration(options?: {
  args?: string[];
  env?: Record<string, string | undefined>;
  run?: (
    command: string,
    args: string[],
    options: { stdio: 'inherit'; env: Record<string, string | undefined> }
  ) => { status: number | null };
}): number;
