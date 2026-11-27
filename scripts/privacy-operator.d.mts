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
  options?: Record<string, string | boolean | undefined>,
  command?: string
): { url: string; key: string; projectRef: string; environment: 'local' | 'production' };
export function resolveSource(
  env: Record<string, string | undefined>,
  options?: Record<string, string | boolean | undefined>
): { url: string; key: string; projectRef: string };
export function deriveExpectedSubjects(sets: { restored: string[]; live: string[] }): string[];
export type OperatorClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
  storage?: {
    from: (bucket: string) => {
      remove: (names: string[]) => PromiseLike<{ error: unknown }>;
      list: (
        prefix: string,
        options: { search: string }
      ) => PromiseLike<{ data: Array<{ name: string }> | null; error: unknown }>;
    };
  };
};
export function reconcileRestoredSubject(
  client: OperatorClient,
  subject: string,
  projectRef: string
): Promise<unknown>;
export function runCommand(
  client: OperatorClient,
  parsed: ReturnType<typeof parseArgs>,
  target: { projectRef: string; environment: string },
  source?: OperatorClient
): Promise<unknown>;
export function main(argv: string[], env: Record<string, string | undefined>): Promise<number>;
