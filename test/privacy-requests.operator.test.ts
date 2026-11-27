import { describe, expect, it } from 'vitest';
import {
  HELP,
  challengeDigest,
  generateChallenge,
  parseArgs,
  projectRefOf,
  resolveTarget,
  runCommand,
  type OperatorClient
} from '../scripts/privacy-operator.mjs';

const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
const client = (reply: unknown = { status: 'ok' }): OperatorClient => ({
  rpc: (name, args) => {
    calls.push({ name, args });
    return Promise.resolve({ data: reply, error: null });
  }
});
const target = { projectRef: 'local', environment: 'local' };
const parse = (...argv: string[]) => parseArgs(argv);

describe('privacy operator challenge', () => {
  it('generates distinct short codes and binds the digest to the case', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateChallenge()));
    expect(codes.size).toBe(50);
    for (const code of codes) expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    const digest = challengeDigest('PR-AAAAAAAAAAAA', 'ABCDEFGHJK');
    expect(digest).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(challengeDigest('PR-AAAAAAAAAAAA', ' abcdefghjk ')).toBe(digest);
    expect(challengeDigest('PR-BBBBBBBBBBBB', 'ABCDEFGHJK')).not.toBe(digest);
    expect(digest).not.toContain('ABCDEFGHJK');
  });

  it('sends only the digest to the database and shows the code to the console once', async () => {
    calls.length = 0;
    const result = await runCommand(
      client({ status: 'ok', reference: 'PR-AAAAAAAAAAAA', address: 'a@b.test', expires_at: 'x' }),
      parse('start-verification', 'PR-AAAAAAAAAAAA'),
      target
    );
    const sent = JSON.stringify(calls[0]);
    const code = String(Object.fromEntries(Object.entries(Object(result)))['code']);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{10}$/);
    expect(sent).not.toContain(code);
    expect(calls[0]?.args['p_digest']).toBe(challengeDigest('PR-AAAAAAAAAAAA', code));
  });

  it('never invents a code when the database rejects the verification', async () => {
    const result = await runCommand(
      client({ status: 'rejected', code: 'STATE_NOT_VERIFIABLE' }),
      parse('start-verification', 'PR-AAAAAAAAAAAA'),
      target
    );
    expect(result).toEqual({ status: 'rejected', code: 'STATE_NOT_VERIFIABLE' });
  });

  it('requires an explicit confirmation and the code for the proof', async () => {
    calls.length = 0;
    await runCommand(
      client(),
      parse('confirm-proof', 'PR-AAAAAAAAAAAA', '--code', 'ABCDEFGHJK'),
      target
    );
    expect(calls[0]?.args['p_operator_confirmed']).toBe(false);
    await runCommand(
      client(),
      parse('confirm-proof', 'PR-AAAAAAAAAAAA', '--code', 'ABCDEFGHJK', '--confirm'),
      target
    );
    expect(calls[1]?.args['p_operator_confirmed']).toBe(true);
    await expect(
      runCommand(client(), parse('confirm-proof', 'PR-AAAAAAAAAAAA'), target)
    ).rejects.toThrow('CODE_REQUIRED');
  });
});

describe('privacy operator environment guard', () => {
  const env = { SUPABASE_URL: 'http://127.0.0.1:54421', SUPABASE_SERVICE_ROLE_KEY: 'k' };
  it('resolves project refs', () => {
    expect(projectRefOf('http://127.0.0.1:54421')).toBe('local');
    expect(projectRefOf('https://abcdefgh.supabase.co')).toBe('abcdefgh');
    expect(projectRefOf('nope')).toBeNull();
  });

  it('fails closed on missing configuration', () => {
    expect(() => resolveTarget({})).toThrow('OPERATOR_CONFIG_MISSING');
    expect(() => resolveTarget({ SUPABASE_URL: env.SUPABASE_URL })).toThrow(
      'OPERATOR_CONFIG_MISSING'
    );
    expect(() =>
      resolveTarget({ SUPABASE_URL: 'garbage', SUPABASE_SERVICE_ROLE_KEY: 'k' })
    ).toThrow('OPERATOR_PROJECT_UNKNOWN');
  });

  it('defaults to the local project and refuses everything else without evidence', () => {
    expect(resolveTarget(env)).toMatchObject({ projectRef: 'local', environment: 'local' });
    const hosted = { SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    expect(() => resolveTarget(hosted)).toThrow('OPERATOR_PROJECT_NOT_ALLOWED');
    const allowed = { ...hosted, PRIVACY_OPERATOR_ALLOWED_PROJECTS: 'abcdefgh' };
    expect(() => resolveTarget(allowed)).toThrow('OPERATOR_PRODUCTION_FLAG_REQUIRED');
    expect(() => resolveTarget(allowed, { 'allow-production': true })).toThrow(
      'OPERATOR_PRODUCTION_EVIDENCE_MISSING'
    );
    expect(
      resolveTarget(
        { ...allowed, PRIVACY_OPERATOR_PRODUCTION_EVIDENCE: 'ticket' },
        { 'allow-production': true }
      )
    ).toMatchObject({
      projectRef: 'abcdefgh',
      environment: 'production'
    });
  });

  it('documents MFA and the no-mail rule in its help text', () => {
    expect(HELP).toContain('MFA');
    expect(HELP).toContain('ONCE');
  });
});

describe('privacy operator: unclaimed erasure and local codes', () => {
  it('is a dry run unless --confirm is given, and never forwards the address anywhere else', async () => {
    calls.length = 0;
    const result = await runCommand(
      client({ status: 'ok', applied: false, operations: 1 }),
      parse('erase-unclaimed', 'someone@example.test'),
      target
    );
    expect(calls).toEqual([
      {
        name: 'privacy_op_erase_unclaimed',
        args: { p_email: 'someone@example.test', p_confirm: false, p_all_matches: false }
      }
    ]);
    // The console result is exactly what the database returned: the address is not echoed.
    expect(JSON.stringify(result)).not.toContain('someone@example.test');
    await runCommand(
      client(),
      parse('erase-unclaimed', 'someone@example.test', '--confirm', '--all-matches'),
      target
    );
    expect(calls[1]?.args).toEqual({
      p_email: 'someone@example.test',
      p_confirm: true,
      p_all_matches: true
    });
  });

  it('requires the address and produces a local one-time code without any database call', async () => {
    await expect(runCommand(client(), parse('erase-unclaimed'), target)).rejects.toThrow(
      'EMAIL_REQUIRED'
    );
    calls.length = 0;
    const generated = await runCommand(client(), parse('generate-code'), target);
    expect(calls).toEqual([]);
    expect(Object.fromEntries(Object.entries(Object(generated)))['code']).toMatch(
      /^[A-HJKMNP-Z2-9]{10}$/
    );
    expect(HELP).toContain('erase-unclaimed');
  });
});

describe('privacy operator commands', () => {
  it('binds the approval to the project and the dry-run plan', async () => {
    calls.length = 0;
    const plan = { revision: 1, fingerprint: 'f', impact: {}, successors: {} };
    await runCommand(
      client(),
      parse('arm', 'PR-AAAAAAAAAAAA', '--plan', JSON.stringify({ status: 'ok', plan })),
      { projectRef: 'local', environment: 'local' }
    );
    expect(calls[0]).toEqual({
      name: 'privacy_op_arm',
      args: {
        p_reference: 'PR-AAAAAAAAAAAA',
        p_expected: plan,
        p_project_ref: 'local',
        p_environment: 'local'
      }
    });
    await expect(runCommand(client(), parse('arm', 'PR-AAAAAAAAAAAA'), target)).rejects.toThrow(
      'PLAN_REQUIRED'
    );
    await expect(
      runCommand(client(), parse('arm', 'PR-AAAAAAAAAAAA', '--plan', '{bad'), target)
    ).rejects.toThrow('PLAN_INVALID');
  });

  it('validates references, switches and commands', async () => {
    await expect(runCommand(client(), parse('retry'), target)).rejects.toThrow(
      'REFERENCE_REQUIRED'
    );
    await expect(runCommand(client(), parse('switch', 'intake', 'maybe'), target)).rejects.toThrow(
      'SWITCH_INVALID'
    );
    expect(() => parseArgs(['delete-everything'])).toThrow('UNKNOWN_COMMAND');
    calls.length = 0;
    await runCommand(client(), parse('switch', 'executor', 'off'), target);
    expect(calls[0]?.args).toEqual({ p_key: 'executor_enabled', p_value: false });
  });
});
