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
  on?: (event: string, listener: (error: Error) => void) => unknown;
};

export type LiveProbeResult = {
  browser: { requestHosts: string[]; loginSucceeded: boolean };
  ssr: { tokenAccepted: boolean; sessionCookieSet: boolean };
};
export function assertPreviewPortAvailable(
  port: number,
  createServerImpl?: (...args: any[]) => any
): Promise<void>;
export function previewListenerOwned(
  port: number,
  childPid: number | undefined,
  exec?: (command: string, args: string[], options: object) => string
): boolean;
export function defaultLiveProbe(options: {
  checkOwner?: (port: number, childPid: number | undefined) => boolean | Promise<boolean>;
  checkPort?: (port: number) => Promise<void>;
  login: { email: string; password: string };
  inviteHash: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: (...args: any[]) => any;
  loadPlaywright?: () => Promise<{ chromium: { launch(options: object): Promise<any> } }>;
  port?: number;
}): Promise<LiveProbeResult>;

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
  connectDb?: (url: string, onError?: (error: Error) => void) => Promise<ProofDb>;
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
  liveProbe?: (options: {
    login: { email: string; password: string };
    inviteHash: string;
  }) => Promise<LiveProbeResult>;
  sleep?: (ms: number) => Promise<void>;
  heartbeatMs?: number;
  proofId?: string;
  log?: (line: string) => void;
}): Promise<{ report: ProofReport; exitCode: number }>;
