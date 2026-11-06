export function fastArgs(args: string[]): string[];
export function runFast(options?: {
  args?: string[];
  run?: (
    command: string,
    args: string[],
    options: { stdio: 'inherit' }
  ) => { status: number | null };
}): number;
