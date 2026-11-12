export const BUILD_ENV_FILES: string[];
export function sourceFingerprint(options?: {
  tuple?: { VITE_SUPABASE_URL?: string; VITE_SUPABASE_PUBLISHABLE_KEY?: string };
  cwd?: string;
  git?: (args: string[], cwd: string) => string;
  hashObjects?: (input: string, cwd: string) => string;
}): string | undefined;
