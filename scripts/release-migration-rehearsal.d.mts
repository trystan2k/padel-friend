import type { Docker } from './release-rehearsal-lib.mjs';
export const PREDECESSOR: string;
export type MigrationReport = {
  destination: string;
  predecessor: string;
  migrations: number;
  steps: { name: string; [key: string]: unknown }[];
  pass: boolean;
  liveSchemaDrift?: string[];
  error?: string;
  elapsedMs: number;
};
export function parseArgs(argv: string[]): {
  container: string;
  source: string;
  confirm: string;
  checkTypes: boolean;
};
export function migrationFiles(dir?: string): { version: string; file: string }[];
export function runMigrationRehearsal(options: {
  docker?: Docker;
  source?: string;
  destination: string;
  confirm?: string;
  checkTypes?: boolean;
  now?: () => number;
  log?: (line: string) => void;
}): MigrationReport;
