export interface ReleaseCandidate {
  event: unknown;
  repository: unknown;
  created: unknown;
  tag: unknown;
  releaseSha: unknown;
}

export interface ReleaseIdentity {
  tag: string;
  releaseSha: string;
}

export type GuardExec = (
  file: string,
  args: string[],
  options: {
    encoding: 'utf8';
    stdio: ['ignore', 'pipe', 'pipe'];
    timeout: number;
    maxBuffer: number;
  }
) => string;

export interface GuardIO {
  env?: Record<string, string | undefined>;
  exec?: GuardExec;
  read?: (file: string | undefined, encoding: 'utf8') => string;
  append?: (file: string, text: string) => void;
  out?: { write(text: string): unknown };
}

export function validateCandidate(candidate: ReleaseCandidate): ReleaseIdentity;
export function guardRelease(candidate: ReleaseCandidate, exec?: GuardExec): ReleaseIdentity;
export function assertCredentials(env: Record<string, string | undefined>): void;
export function main(argv: string[], io?: GuardIO): void;
