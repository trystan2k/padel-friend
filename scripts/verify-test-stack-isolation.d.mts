export const DEV_PROJECT_ID: string;
export const DEV_PORTS: { api: string; db: string; mail: string };
export const DUE_EVENT_COUNT: number;
export class IsolationProofError extends Error {}

export type ProofCheck = { name: string; ok: boolean; evidence: Record<string, unknown> };
export type ProofReport = {
  commandExit: number | null;
  isolationOk: boolean;
  targets: { testApi: string; testDatabase: string; testMailpit: string };
  checks: ProofCheck[];
};
export type ProofDb = {
  query(sql: string, params?: unknown[]): Promise<{ rows: Array<Record<string, any>> }>;
  end(): Promise<void>;
};

export function devEnvFromStatus(stdout: string): {
  apiUrl: string;
  dbUrl: string;
  mailUrl: string;
  serviceKey: string;
};
export function assertProjectIdentities(
  devConfig: Record<string, unknown>,
  testConfig: Record<string, unknown>
): void;
export function runIsolationProof(options: {
  argv: string[];
  env?: Record<string, string | undefined>;
  exec?: (command: string, args: string[], options: Record<string, unknown>) => string;
  fetchImpl?: typeof fetch;
  connectDb?: (url: string) => Promise<ProofDb>;
  spawnCommand?: (
    argv: string[],
    env: Record<string, string | undefined>
  ) => Promise<{ code: number | null; signal: string | null }>;
  readConfigs?: () => { dev: Record<string, unknown>; test: Record<string, unknown> };
  artifacts?: (options: {
    testApiUrl: string;
    devApiUrl: string;
    testKey: string;
  }) => Record<string, unknown>;
  sleep?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
  proofId?: string;
  log?: (line: string) => void;
}): Promise<{ report: ProofReport; exitCode: number }>;
