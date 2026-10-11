import { readFileSync } from 'node:fs';

export type LocalSupabaseEnv = {
  url: string;
  key: string;
  source: 'environment' | '.env file';
};
type Reader = (path: string) => string;
type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

function usableLocalEnv(
  rawUrl: string | undefined,
  key: string | undefined,
  source: LocalSupabaseEnv['source']
): LocalSupabaseEnv | null {
  if (!rawUrl || !key || /^(replace-with|your[-_])/i.test(key)) return null;
  const url = rawUrl.replace(/^['"]|['"]$/g, '');
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname))
      return null;
  } catch {
    return null;
  }
  return { url, key, source };
}

function parseEnvFile(contents: string): Map<string, string> {
  return new Map(
    contents
      .split(/\r?\n/)
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
      })
  );
}

export function localSupabaseEnv(options: { env?: Env; filePath: string; readFile?: Reader }): {
  env: LocalSupabaseEnv | null;
  reason: string;
} {
  const environment = options.env ?? process.env;
  const url = environment.VITE_SUPABASE_URL;
  const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && key && !/^(replace-with|your[-_])/i.test(key)) {
    const localEnv = usableLocalEnv(url, key, 'environment');
    return {
      env: localEnv,
      reason: localEnv ? '' : 'Supplied Supabase environment is not a valid loopback pair'
    };
  }
  try {
    const vars = parseEnvFile(
      (options.readFile ?? ((path) => readFileSync(path, 'utf8')))(options.filePath)
    );
    const fileEnv = usableLocalEnv(
      vars.get('VITE_SUPABASE_URL'),
      vars.get('VITE_SUPABASE_PUBLISHABLE_KEY'),
      '.env file'
    );
    return {
      env: fileEnv,
      reason: fileEnv ? '' : 'Missing or invalid loopback Supabase credentials in .env'
    };
  } catch {
    return { env: null, reason: 'Missing loopback Supabase environment and .env' };
  }
}

export function assertLocalSupabaseEnvInCi(env: LocalSupabaseEnv | null, ci?: string): void {
  if (ci && !env) throw new Error('Local Supabase credentials are required in CI');
}
