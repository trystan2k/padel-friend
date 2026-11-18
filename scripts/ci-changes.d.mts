export type Classification = {
  /** True when the change set needs full CI (build, unit, integration, E2E). */
  code: boolean;
  codeFiles: string[];
  docFiles: string[];
};

export const DOC_ONLY_PATTERNS: readonly string[];
export const ALWAYS_CODE_PATTERNS: readonly string[];

export function matchesPattern(file: string, pattern: string): boolean;
export function normalizePath(raw: string): string;
export function splitChangedPaths(text: string): string[];
export function isCodePath(file: string): boolean;
export function classify(paths: readonly string[]): Classification;
export function main(
  argv?: readonly string[],
  io?: {
    stdin?: string;
    out?: { write(text: string): unknown };
    err?: { write(text: string): unknown };
  }
): Classification;
