export type ChangeMode = 'code' | 'release' | 'docs';

export type Classification = {
  /**
   * `code`: full CI (build, unit, integration, E2E). `release`: static lane only, for a release-please
   * PR that changes only the version files. `docs`: format lane only.
   */
  mode: ChangeMode;
  codeFiles: string[];
  docFiles: string[];
};

export type PullRequestContext = {
  headRef?: string;
  headRepo?: string;
  baseRepo?: string;
};

export const DOC_ONLY_PATTERNS: readonly string[];
export const ALWAYS_CODE_PATTERNS: readonly string[];
export const RELEASE_PR_BRANCH_PREFIX: string;
export const RELEASE_PR_FILES: readonly string[];

export function matchesPattern(file: string, pattern: string): boolean;
export function normalizePath(raw: string): string;
export function splitChangedPaths(text: string): string[];
export function isCodePath(file: string): boolean;
export function isReleasePr(context?: PullRequestContext): boolean;
export function classify(paths: readonly string[], context?: PullRequestContext): Classification;
export function main(
  argv?: readonly string[],
  io?: {
    stdin?: string;
    env?: Record<string, string | undefined>;
    out?: { write(text: string): unknown };
    err?: { write(text: string): unknown };
  }
): Classification;
