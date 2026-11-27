export const HELP: string;
export function projectRefOf(url: unknown): string | null;
export function generateChallenge(): string;
export function challengeDigest(reference: string, code: string): string;
export function parseArgs(argv: string[]): {
  command: string;
  positional: string[];
  options: Record<string, string | boolean | undefined>;
};
export function resolveTarget(
  env: Record<string, string | undefined>,
  options?: Record<string, string | boolean | undefined>
): { url: string; key: string; projectRef: string; environment: 'local' | 'production' };
export type OperatorClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};
export function runCommand(
  client: OperatorClient,
  parsed: ReturnType<typeof parseArgs>,
  target: { projectRef: string; environment: string }
): Promise<unknown>;
export function main(argv: string[], env: Record<string, string | undefined>): Promise<number>;
