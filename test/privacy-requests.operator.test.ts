import { describe, expect, it } from 'vitest';
import {
  HELP,
  challengeDigest,
  deriveExpectedSubjects,
  generateChallenge,
  parseArgs,
  projectRefOf,
  reconcileRestoredSubject,
  resolveSource,
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

describe('privacy operator: restore gate', () => {
  const subjectA = '11111111-2222-4333-8444-555555555555';
  const subjectB = '66666666-7777-4888-9999-000000000000';
  const withIds = (ids: string[], extra: Record<string, unknown> = {}): OperatorClient => ({
    rpc: (name, args) => {
      calls.push({ name, args });
      return Promise.resolve({
        data: name === 'privacy_op_live_identity_ids' ? ids : (extra[name] ?? { status: 'ok' }),
        error: null
      });
    }
  });

  it('derives the expected subjects from the restored copy against the source project', () => {
    expect(
      deriveExpectedSubjects({ restored: [subjectB, subjectA, 'c', subjectA], live: ['c', 'd'] })
    ).toEqual([subjectA, subjectB]);
    expect(deriveExpectedSubjects({ restored: ['c'], live: ['c'] })).toEqual([]);
  });

  it('begins the gate with the derived set bound to the restore project, and clears it with evidence only', async () => {
    calls.length = 0;
    const restored = withIds([subjectA, subjectB, 'kept']);
    const source = withIds(['kept'], { privacy_op_erasures_since: { count: 2 } });
    const begun = await runCommand(
      restored,
      parse('restore-gate', 'begin', '--snapshot-at', '2026-11-20T10:00:00Z'),
      target,
      source
    );
    expect(calls.find((call) => call.name === 'privacy_op_restore_gate')?.args).toEqual({
      p_action: 'begin',
      p_evidence: null,
      p_snapshot_at: '2026-11-20T10:00:00.000Z',
      p_expected_subjects: [subjectA, subjectB],
      p_confirm_empty: false,
      p_restore_project_ref: 'local'
    });
    expect(begun).toMatchObject({ erasures_recorded_since_snapshot: 2 });
    calls.length = 0;
    await runCommand(client(), parse('restore-gate', 'clear', '--evidence', 'ticket-123'), target);
    expect(calls).toEqual([
      { name: 'privacy_op_restore_gate', args: { p_action: 'clear', p_evidence: 'ticket-123' } }
    ]);
    await expect(runCommand(client(), parse('restore-gate', 'open'), target)).rejects.toThrow(
      'RESTORE_GATE_ACTION_INVALID'
    );
    await expect(
      runCommand(client(), parse('restore-gate', 'begin', '--snapshot-at', 'x'), target, source)
    ).rejects.toThrow('SNAPSHOT_AT_REQUIRED');
    await expect(
      runCommand(client(), parse('restore-gate', 'begin', '--snapshot-at', '2026-11-20'), target)
    ).rejects.toThrow('OPERATOR_SOURCE_MISSING');
    expect(HELP).toContain('restore-gate');
  });

  it('passes --confirm-empty only when asked for', async () => {
    calls.length = 0;
    await runCommand(
      withIds(['kept']),
      parse('restore-gate', 'begin', '--snapshot-at', '2026-11-20', '--confirm-empty'),
      target,
      withIds(['kept'], { privacy_op_erasures_since: { count: 0 } })
    );
    expect(calls.find((call) => call.name === 'privacy_op_restore_gate')?.args).toMatchObject({
      p_expected_subjects: [],
      p_confirm_empty: true
    });
  });

  it('refuses production for every restore command, before any override is considered (F22)', async () => {
    const hosted = {
      SUPABASE_URL: 'https://abcdefgh.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      PRIVACY_OPERATOR_ALLOWED_PROJECTS: 'abcdefgh',
      PRIVACY_OPERATOR_PRODUCTION_EVIDENCE: 'ticket'
    };
    for (const command of ['restore-gate', 'restore-reconcile']) {
      expect(() => resolveTarget(hosted, { 'allow-production': true }, command)).toThrow(
        'OPERATOR_RESTORE_PRODUCTION_REFUSED'
      );
    }
    // The same project stays reachable for the ordinary commands, with the usual override.
    expect(resolveTarget(hosted, { 'allow-production': true }, 'list')).toMatchObject({
      environment: 'production'
    });
    // And a production-shaped target handed to the runner is refused as well.
    const production = { projectRef: 'abcdefgh', environment: 'production' };
    calls.length = 0;
    await expect(
      runCommand(client(), parse('restore-reconcile', subjectA), production)
    ).rejects.toThrow('OPERATOR_RESTORE_PRODUCTION_REFUSED');
    await expect(
      runCommand(client(), parse('restore-gate', 'clear', '--evidence', 'x'), production)
    ).rejects.toThrow('OPERATOR_RESTORE_PRODUCTION_REFUSED');
    expect(calls).toEqual([]);
  });

  it('resolves the source project read-only and only through the allowlist', () => {
    const env = {
      PRIVACY_SOURCE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      PRIVACY_SOURCE_SERVICE_ROLE_KEY: 'k',
      PRIVACY_OPERATOR_ALLOWED_PROJECTS: 'local,abcdefgh'
    };
    expect(() => resolveSource({}, {})).toThrow('OPERATOR_SOURCE_MISSING');
    expect(() => resolveSource(env, {})).toThrow('OPERATOR_PRODUCTION_FLAG_REQUIRED');
    expect(() => resolveSource(env, { 'allow-production': true })).toThrow(
      'OPERATOR_PRODUCTION_EVIDENCE_MISSING'
    );
    expect(
      resolveSource(
        { ...env, PRIVACY_OPERATOR_PRODUCTION_EVIDENCE: 'ticket' },
        { 'allow-production': true }
      )
    ).toMatchObject({ projectRef: 'abcdefgh' });
    expect(() => resolveSource({ ...env, PRIVACY_OPERATOR_ALLOWED_PROJECTS: 'local' }, {})).toThrow(
      'OPERATOR_PROJECT_NOT_ALLOWED'
    );
  });

  it('removes the subject objects through the Storage API, proves absence, then reconciles (F27)', async () => {
    calls.length = 0;
    const removed: string[] = [];
    let listed = 0;
    const storage: NonNullable<OperatorClient['storage']> = {
      from: (bucket) => ({
        remove: (names) => {
          removed.push(...names.map((name) => bucket + '/' + name));
          return Promise.resolve({ error: null });
        },
        list: () => {
          listed++;
          return Promise.resolve({ data: [], error: null });
        }
      })
    };
    const reply = (name: string) =>
      name === 'privacy_op_restore_storage_set'
        ? { status: 'ok', objects: [{ bucket: 'player-avatars', name: subjectA + '/a.png' }] }
        : { status: 'ok', restore_gate: 'pending' };
    const result = await reconcileRestoredSubject(
      {
        rpc: (name, args) => {
          calls.push({ name, args });
          return Promise.resolve({ data: reply(name), error: null });
        },
        storage
      },
      subjectA,
      'local'
    );
    expect(removed).toEqual(['player-avatars/' + subjectA + '/a.png']);
    expect(listed).toBe(1);
    expect(calls.map((call) => call.name)).toEqual([
      'privacy_op_restore_storage_set',
      'privacy_op_restore_reconcile'
    ]);
    expect(calls[1]?.args).toEqual({
      p_subject: subjectA,
      p_project_ref: 'local',
      p_storage_verified: true
    });
    expect(JSON.stringify(result)).not.toContain(subjectA);
    await expect(runCommand(client(), parse('restore-reconcile'), target)).rejects.toThrow(
      'REFERENCE_REQUIRED'
    );
    expect(HELP).toContain('restore-reconcile');
  });

  it('stops before any deletion when the database refuses the subject, and rejects foreign buckets', async () => {
    calls.length = 0;
    const refused = await reconcileRestoredSubject(
      client({ status: 'rejected', code: 'RESTORE_SUBJECT_NOT_EXPECTED' }),
      subjectA,
      'local'
    );
    expect(refused).toEqual({ status: 'rejected', code: 'RESTORE_SUBJECT_NOT_EXPECTED' });
    expect(calls.map((call) => call.name)).toEqual(['privacy_op_restore_storage_set']);
    await expect(
      reconcileRestoredSubject(
        client({ status: 'ok', objects: [{ bucket: 'secrets', name: 'x' }] }),
        subjectA,
        'local'
      )
    ).rejects.toThrow('RESTORE_STORAGE_BUCKET_REJECTED');
  });

  it('asks for the external follow-up acknowledgment before recording the response (F23)', async () => {
    calls.length = 0;
    const pending = await runCommand(
      client({ status: 'rejected', code: 'EXTERNAL_FOLLOWUP_ACK_REQUIRED' }),
      parse('record-response', 'PR-AAAAAAAAAAAA'),
      target
    );
    expect(pending).toMatchObject({ code: 'EXTERNAL_FOLLOWUP_ACK_REQUIRED' });
    expect(JSON.stringify(pending)).toContain('--ack-external-followup');
    await runCommand(
      client(),
      parse('record-response', 'PR-AAAAAAAAAAAA', '--ack-external-followup'),
      target
    );
    expect(calls.map((call) => call.args['p_external_followup_ack'])).toEqual([false, true]);
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
