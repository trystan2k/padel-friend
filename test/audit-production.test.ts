import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { AuditOptions, AuditResult } from '../scripts/audit-production.mjs';
import { runProductionAudit } from '../scripts/audit-production.mjs';

const clean = {
  status: 0,
  stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0 } } }),
  stderr: ''
};
const network = {
  status: 1,
  stdout: JSON.stringify({
    error: { code: 'ERR_PNPM_AUDIT_BAD_RESPONSE', message: 'request failed: ETIMEDOUT' }
  }),
  stderr: ''
};
const args = ['audit', '--prod', '--audit-level=high', '--json'];

function runner(results: AuditResult[]) {
  const run = vi.fn<NonNullable<AuditOptions['run']>>();
  for (const result of results) run.mockReturnValueOnce(result);
  const out = { write: vi.fn<(text: string) => void>() };
  const err = { write: vi.fn<(text: string) => void>() };
  return { run, out, err };
}

describe('production dependency audit', () => {
  it('is wired into the service-free static job', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    const staticJob = workflow.split('\n  static:')[1]?.split('\n  unit:')[0];
    expect(staticJob).toContain('run: node scripts/audit-production.mjs');
  });

  it('runs the production high audit once on success', () => {
    const deps = runner([clean]);
    expect(runProductionAudit(deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledExactlyOnceWith('pnpm', args, {
      encoding: 'utf8',
      timeout: 120_000
    });
  });

  it.each(['high', 'critical'])(
    'fails immediately on %s findings, even alongside a network-looking diagnostic',
    (severity) => {
      const deps = runner([
        {
          status: 1,
          stdout: JSON.stringify({ metadata: { vulnerabilities: { [severity]: 1 } } }),
          stderr: 'ETIMEDOUT'
        },
        clean
      ]);
      expect(runProductionAudit(deps)).toBe(1);
      expect(deps.run).toHaveBeenCalledTimes(1);
    }
  );

  it('retries once, then falls back to corepack for transient failures', () => {
    const deps = runner([network, network, clean]);
    expect(runProductionAudit(deps)).toBe(0);
    expect(deps.run.mock.calls.map(([command, commandArgs]) => [command, commandArgs])).toEqual([
      ['pnpm', args],
      ['pnpm', args],
      ['corepack', ['pnpm', ...args]]
    ]);
  });

  it('stops after a successful retry', () => {
    const deps = runner([network, clean]);
    expect(runProductionAudit(deps)).toBe(0);
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it('does not retry an advisory returned after a transport failure', () => {
    const deps = runner([
      network,
      {
        ...clean,
        status: 1,
        stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 1 } } })
      }
    ]);
    expect(runProductionAudit(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(2);
  });

  it('bounds persistent registry failure to three attempts', () => {
    const deps = runner([network, network, network]);
    expect(runProductionAudit(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 1, stdout: 'unknown error', stderr: '' },
    { status: 0, stdout: '{}', stderr: '' },
    { status: null, error: { code: 'ENOENT' } },
    { status: 1, stdout: JSON.stringify({ error: { message: 'Forbidden (403)' } }), stderr: '' }
  ])('fails closed without retrying non-transient/malformed results: %j', (result) => {
    const deps = runner([result]);
    expect(runProductionAudit(deps)).toBe(1);
    expect(deps.run).toHaveBeenCalledTimes(1);
  });

  it.each(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'HTTP 503', 'statusCode: 429'])(
    'recognizes transient transport diagnostic %s',
    (stderr) => {
      const deps = runner([{ status: 1, stdout: '', stderr }, clean]);
      expect(runProductionAudit(deps)).toBe(0);
      expect(deps.run).toHaveBeenCalledTimes(2);
    }
  );
});
