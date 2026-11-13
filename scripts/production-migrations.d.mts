export interface MigrationFile {
  name: string;
  version: string;
  hash: string;
}

export interface MigrationFS {
  type(file: string): Promise<'file' | 'directory' | 'symlink' | 'other'>;
  exists(file: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;
  read(file: string): Promise<Uint8Array>;
  write(file: string, bytes: Uint8Array | string): Promise<void>;
  mkdir(dir: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  remove(dir: string): Promise<void>;
}

export interface MigrationProcessOptions {
  cwd: string;
  env: Record<string, string>;
  timeout: number;
  maxBuffer: number;
  encoding: 'utf8';
  stdio: ['ignore', 'pipe', 'pipe'];
}

export type MigrationExec = (
  file: string,
  args: string[],
  options: MigrationProcessOptions
) => { status: number | null; stdout: string; stderr: string };

export interface MigrationOptions {
  env: Record<string, string | undefined>;
  checkout: string;
  runnerTemp: string;
  fs: MigrationFS;
  exec: MigrationExec;
  fetch: (
    url: string,
    options: {
      headers: Record<string, string>;
      signal: AbortSignal;
      redirect: 'error';
    }
  ) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
  out: { write(text: string): unknown };
}

export function runMigrations(
  options: MigrationOptions
): Promise<{ applied: number; total: number }>;
export function main(argv: string[], options: MigrationOptions): Promise<void>;
