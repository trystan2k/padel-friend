export interface AuditResult {
  status: number | null;
  stdout?: string;
  stderr?: string;
  error?: { code?: string };
}

export interface AuditOptions {
  run?: (
    command: string,
    args: string[],
    options: { encoding: 'utf8'; timeout: number }
  ) => AuditResult;
  out?: { write(text: string): unknown };
  err?: { write(text: string): unknown };
}

export function runProductionAudit(options?: AuditOptions): number;
