import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const AUDIT_ARGS = ['audit', '--prod', '--audit-level=high', '--json'];
const TRANSIENT =
  /\b(?:ETIMEDOUT|ESOCKETTIMEDOUT|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|UND_ERR_CONNECT_TIMEOUT)\b|\b(?:HTTP|status(?:Code)?)\s*[:=]?\s*(?:429|50[0234])\b/i;

// Only transport failures get another attempt. A completed advisory report never does.
export function runProductionAudit({
  run = spawnSync,
  out = process.stdout,
  err = process.stderr
} = {}) {
  const commands = [
    ['pnpm', AUDIT_ARGS],
    ['pnpm', AUDIT_ARGS],
    ['corepack', ['pnpm', ...AUDIT_ARGS]]
  ];
  for (const [index, [command, args]] of commands.entries()) {
    const result = run(command, args, { encoding: 'utf8', timeout: 120_000 });
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? '';
    out.write(stdout);
    err.write(stderr);
    let report;
    try {
      report = JSON.parse(stdout);
    } catch {
      // pnpm can fail before returning JSON (DNS/registry transport failure).
    }
    if (report?.metadata?.vulnerabilities) {
      const { high = 0, critical = 0 } = report.metadata.vulnerabilities;
      return high > 0 || critical > 0 ? 1 : (result.status ?? 1);
    }
    const failure = `${report?.error?.code ?? ''} ${report?.error?.message ?? ''} ${stderr} ${result.error?.code ?? ''}`;
    // Plain-text network diagnostics sometimes go to stdout, but never match advisory JSON.
    const transient = TRANSIENT.test(failure) || (!report && TRANSIENT.test(stdout));
    if (!transient || index === commands.length - 1) return result.status || 1;
    err.write('Transient audit registry failure; retrying with bounded fallback.\n');
  }
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runProductionAudit();
}
