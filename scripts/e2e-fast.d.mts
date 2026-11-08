export function fastArgs(args: string[]): string[];
export function runFast(options?: {
  args?: string[];
  env?: Record<string, string | undefined>;
  run?: (
    command: string,
    args: string[],
    options: { stdio: 'inherit'; env: Record<string, string | undefined> }
  ) => { status: number | null };
}): number;
