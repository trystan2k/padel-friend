import type { Docker } from './release-rehearsal-lib.mjs';
export type RestoreRun = {
  destination: string;
  dumpSha256: string;
  dumpBytes: number;
  restoreMs: number;
  tablesCompared: number;
  mismatchedTables: string[];
  schemaDiff: string[];
  authorizedReads: { users: number; match: boolean };
  dispatchDisabled: { pushJobsRetired: number; cronAbsent: boolean };
  pass: boolean;
};
export type RestoreReport = {
  startedAt: string;
  source: string;
  dumpMs: number;
  runs: RestoreRun[];
  representative: Record<string, number>;
  sparseTables: string[];
  sourceStable: boolean;
  pass: boolean;
};
export function parseArgs(argv: string[]): {
  runs: number;
  requireRepresentative: boolean;
  container: string;
  source: string;
  confirm: string;
};
export function runRestoreRehearsal(options: {
  docker?: Docker;
  source?: string;
  base: string;
  confirm?: string;
  runs?: number;
  requireRepresentative?: boolean;
  now?: () => number;
  log?: (line: string) => void;
}): RestoreReport;
