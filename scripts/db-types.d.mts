import type { readFile, rename, rm, writeFile, mkdtemp } from 'node:fs/promises';

interface ProcessResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
}

interface FileSystem {
  mkdtemp: typeof mkdtemp;
  readFile: typeof readFile;
  rename: typeof rename;
  rm: typeof rm;
  writeFile: typeof writeFile;
}

export function generateTypes(options?: {
  check?: boolean;
  fs?: FileSystem;
  runProcess?: (
    command: string,
    args: string[],
    options?: { cwd: string; stdio: string[] }
  ) => Promise<ProcessResult>;
  rootDir?: string;
  destinationPath?: string;
}): Promise<void>;
