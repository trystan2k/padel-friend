import type { StatusExec, TestStackEnv } from './test-stack-env.mjs';

export type PublicBuild = { supabaseUrl: string; publishableKey: string };

export const PUBLIC_BUILD_FILE: string;
export function parsePublicBuild(text: string, label?: string): PublicBuild;
export function readPublicBuild(file?: string): PublicBuild;
export function buildEnvLines(build: PublicBuild): string;
export function manifestJson(run: { sha: string; runId: string }, build: PublicBuild): string;
export function assertTupleMatchesBuild(tuple: TestStackEnv, build: PublicBuild): void;
export function devVarsContent(tuple: TestStackEnv): string;
export function provisionE2e(options: {
  manifestFile: string;
  devVarsFile: string;
  descriptorFile?: string;
  exec?: StatusExec;
  write?: (file: string, data: string) => void;
  out?: { write(text: string): unknown };
}): void;
export function main(
  argv: string[],
  io?: {
    out?: { write(text: string): unknown };
    exec?: StatusExec;
    write?: (file: string, data: string) => void;
  }
): void;
