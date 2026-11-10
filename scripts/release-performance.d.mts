export const PERFORMANCE_TEST: string;
export const TARGETS: { readP95Ms: number; writeP95Ms: number };
export type Sample = { ok: boolean; ms: number };
export type Summary = {
  samples: number;
  errors: number;
  errorRate: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};
export function percentile(samples: number[], fraction: number): number | null;
export function summarize(samples: Sample[]): Summary;
export function parseArgs(argv: string[]): { report: string };
export function buildHash(): string;
