import { createHash } from 'node:crypto';
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
  sweepRemnants,
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

  it('begins the gate with the derived set and the source tombstone count (F29), clears with parity (F29)', async () => {
    calls.length = 0;
    const restored = withIds([subjectA, subjectB, 'kept']);
    const source = withIds(['kept'], { privacy_op_erasure_count_since: { count: 2 } });
    await runCommand(
      restored,
      parse(
        'restore-gate',
        'begin',
        '--snapshot-at',
        '2026-11-20T10:00:00Z',
        '--cutoff-xid',
        '4242',
        '--cutoff-snapshot',
        '100:110:101,105'
      ),
      target,
      source
    );
    // Parity uses the union cutoff (xid AND time) captured at dump start.
    expect(calls.find((call) => call.name === 'privacy_op_erasure_count_since')?.args).toEqual({
      p_cutoff_xid: 4242,
      p_cutoff_time: '2026-11-20T10:00:00.000Z',
      p_cutoff_snapshot: '100:110:101,105'
    });
    expect(calls.find((call) => call.name === 'privacy_op_restore_gate')?.args).toEqual({
      p_action: 'begin',
      p_evidence: null,
      p_snapshot_at: '2026-11-20T10:00:00.000Z',
      p_expected_subjects: [subjectA, subjectB],
      p_restore_project_ref: 'local',
      p_tombstone_count: 2,
      p_cutoff_xid: 4242,
      p_cutoff_snapshot: '100:110:101,105'
    });
    await expect(
      runCommand(
        client(),
        parse('restore-gate', 'begin', '--snapshot-at', '2026-11-20T10:00:00Z'),
        target,
        source
      )
    ).rejects.toThrow('CUTOFF_XID_REQUIRED');
    await expect(
      runCommand(
        client(),
        parse(
          'restore-gate',
          'begin',
          '--snapshot-at',
          '2026-11-20T10:00:00Z',
          '--cutoff-xid',
          '4242'
        ),
        target,
        source
      )
    ).rejects.toThrow('CUTOFF_SNAPSHOT_REQUIRED');
    calls.length = 0;
    const gate = withIds([], {
      privacy_op_restore_gate_status: {
        snapshot_at: '2026-11-20T10:00:00+00:00',
        cutoff_xid: 4242,
        cutoff_snapshot: '100:110:101,105'
      }
    });
    await runCommand(
      gate,
      parse('restore-gate', 'clear', '--evidence', 'ticket-123'),
      target,
      withIds([], { privacy_op_erasure_count_since: { count: 2 } })
    );
    expect(calls.find((call) => call.name === 'privacy_op_restore_gate')?.args).toEqual({
      p_action: 'clear',
      p_evidence: 'ticket-123',
      p_tombstone_count: 2
    });
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

  it('tells the operator to re-derive when the clear parity fails', async () => {
    const result = await runCommand(
      withIds([], {
        privacy_op_restore_gate_status: { snapshot_at: '2026-11-20T10:00:00+00:00' },
        privacy_op_restore_gate: { status: 'rejected', code: 'COUNT_MISMATCH' }
      }),
      parse('restore-gate', 'clear', '--evidence', 'x'),
      target,
      withIds([], { privacy_op_erasure_count_since: { count: 3 } })
    );
    expect(result).toMatchObject({ code: 'COUNT_MISMATCH' });
    expect(JSON.stringify(result)).toContain('restore-gate begin');
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
    expect(resolveTarget(hosted, { 'allow-production': true }, 'list')).toMatchObject({
      environment: 'production'
    });
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

  /** Storage double: a set of existing 'bucket/name' paths; list serves folders and searches. */
  const storageOf = (existing: Set<string>, behaviour: { keepOnRemove?: boolean } = {}) => {
    const removed: string[] = [];
    const storage: NonNullable<OperatorClient['storage']> = {
      from: (bucket) => ({
        remove: (names) => {
          for (const name of names) {
            removed.push(bucket + '/' + name);
            if (!behaviour.keepOnRemove) existing.delete(bucket + '/' + name);
          }
          return Promise.resolve({ error: null });
        },
        list: (prefix, options) =>
          Promise.resolve({
            data: [...existing]
              .filter((path) => path.startsWith(bucket + '/' + prefix + (prefix ? '/' : '')))
              .map((path) => path.slice((bucket + '/' + prefix + (prefix ? '/' : '')).length))
              .filter((name) => !name.includes('/') && (!options.search || name === options.search))
              .map((name) => ({ name })),
            error: null
          })
      })
    };
    return { storage, removed };
  };
  const planReply = (plan: string[]) => (name: string) =>
    name === 'privacy_op_restore_storage_set'
      ? { status: 'ok', plan }
      : name === 'privacy_op_restore_storage_confirm'
        ? { status: 'ok', storage_verified: true }
        : { status: 'ok', restore_gate: 'pending' };

  it('plans from the prefix listing, deletes exactly the plan, re-lists, confirms, then reconciles (F30)', async () => {
    calls.length = 0;
    const orphan = 'player-avatars/' + subjectA + '/orphan.png';
    const pointer = 'player-avatars/' + subjectA + '/pointer.png';
    const { storage, removed } = storageOf(new Set([orphan, pointer]));
    const reply = planReply([orphan, pointer]);
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
    expect(calls.map((call) => call.name)).toEqual([
      'privacy_op_restore_storage_set',
      'privacy_op_restore_storage_confirm',
      'privacy_op_restore_reconcile'
    ]);
    // The prefix listing (orphans included) travels with the plan request.
    expect(
      [
        ...(Array.isArray(calls[0]?.args['p_prefix_paths']) ? calls[0].args['p_prefix_paths'] : [])
      ].sort((a, b) => a.localeCompare(b))
    ).toEqual([orphan, pointer].sort((a, b) => a.localeCompare(b)));
    expect(removed.sort((a, b) => a.localeCompare(b))).toEqual(
      [orphan, pointer].sort((a, b) => a.localeCompare(b))
    );
    expect(calls[1]?.args).toMatchObject({ p_subject: subjectA, p_relisted_paths: [] });
    expect(JSON.stringify(calls[1]?.args['p_deleted_paths'])).toContain('orphan.png');
    expect(calls[2]?.args).toEqual({ p_subject: subjectA, p_project_ref: 'local' });
    expect(JSON.stringify(result)).not.toContain(subjectA);
    await expect(runCommand(client(), parse('restore-reconcile'), target)).rejects.toThrow(
      'REFERENCE_REQUIRED'
    );
    expect(HELP).toContain('restore-reconcile');
  });

  it('reports what is still listed after the deletion so the database can refuse the lie (F30)', async () => {
    calls.length = 0;
    const path = 'player-avatars/' + subjectA + '/stuck.png';
    const { storage } = storageOf(new Set([path]), { keepOnRemove: true });
    const reply = (name: string) =>
      name === 'privacy_op_restore_storage_set'
        ? { status: 'ok', plan: [path] }
        : { status: 'rejected', code: 'STORAGE_LIE' };
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
    expect(result).toEqual({ status: 'rejected', code: 'STORAGE_LIE' });
    expect(calls[1]?.args['p_relisted_paths']).toEqual([path]);
    // The database refused the confirmation: the erasure replay never ran.
    expect(calls.map((call) => call.name)).not.toContain('privacy_op_restore_reconcile');
  });

  it('stops before any deletion when the database refuses the subject, and rejects foreign buckets', async () => {
    calls.length = 0;
    const { storage, removed } = storageOf(new Set());
    const refused = await reconcileRestoredSubject(
      {
        ...client({ status: 'rejected', code: 'RESTORE_SUBJECT_NOT_EXPECTED' }),
        storage
      },
      subjectA,
      'local'
    );
    expect(refused).toEqual({ status: 'rejected', code: 'RESTORE_SUBJECT_NOT_EXPECTED' });
    expect(calls.map((call) => call.name)).toEqual(['privacy_op_restore_storage_set']);
    expect(removed).toEqual([]);
    await expect(
      reconcileRestoredSubject(
        { ...client({ status: 'ok', plan: ['secrets/x'] }), storage },
        subjectA,
        'local'
      )
    ).rejects.toThrow('RESTORE_STORAGE_BUCKET_REJECTED');
  });

  it('lists open cleanup obligations by reference only and retries the unban through the Auth admin API (F44)', async () => {
    calls.length = 0;
    const lifted: string[] = [];
    const admin = (error: { status?: number } | null): OperatorClient => ({
      rpc: (name, args) => {
        calls.push({ name, args });
        const data =
          name === 'privacy_op_cleanup_target'
            ? { status: 'ok', subject_id: subjectA }
            : name === 'privacy_op_list_cleanup_obligations'
              ? [{ case_ref: 'PR-AAAAAAAAAAAA', code: 'BAN_CLEANUP_PENDING' }]
              : { status: 'ok' };
        return Promise.resolve({ data, error: null });
      },
      auth: {
        admin: {
          updateUserById: (id, attributes) => {
            lifted.push(id + ':' + String(attributes['ban_duration']));
            return Promise.resolve({ error });
          },
          listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
          deleteUser: () => Promise.resolve({ error: null })
        }
      }
    });
    const listed = await runCommand(admin(null), parse('list-cleanup-obligations'), target);
    expect(JSON.stringify(listed)).toContain('PR-AAAAAAAAAAAA');
    expect(JSON.stringify(listed)).not.toContain(subjectA);
    calls.length = 0;
    // A failing unban leaves the obligation open.
    expect(
      await runCommand(
        admin({ status: 500 }),
        parse('retry-cleanup-unban', 'PR-AAAAAAAAAAAA'),
        target
      )
    ).toEqual({ status: 'rejected', code: 'BAN_CLEANUP_PENDING' });
    expect(calls.map((call) => call.name)).toEqual(['privacy_op_cleanup_target']);
    calls.length = 0;
    await runCommand(admin(null), parse('retry-cleanup-unban', 'PR-AAAAAAAAAAAA'), target);
    expect(calls.map((call) => call.name)).toEqual([
      'privacy_op_cleanup_target',
      'privacy_op_cleanup_resolved'
    ]);
    expect(lifted).toEqual([subjectA + ':none', subjectA + ':none']);
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

  it('acknowledges outstanding external sends through the database (F31)', async () => {
    calls.length = 0;
    await runCommand(client(), parse('ack-external-followup', 'PR-AAAAAAAAAAAA'), target);
    expect(calls).toEqual([
      { name: 'privacy_op_ack_external_followup', args: { p_reference: 'PR-AAAAAAAAAAAA' } }
    ]);
  });

  it('retries a failed ban lift through the Auth admin API before the case is restartable (F33)', async () => {
    calls.length = 0;
    const lifted: string[] = [];
    const admin = (error: { status?: number } | null): OperatorClient => ({
      rpc: (name, args) => {
        calls.push({ name, args });
        return Promise.resolve({
          data:
            name === 'privacy_op_retry'
              ? { status: 'ban_lift_required', subject_id: subjectA }
              : { status: 'ok' },
          error: null
        });
      },
      auth: {
        admin: {
          updateUserById: (id, attributes) => {
            lifted.push(id + ':' + String(attributes['ban_duration']));
            return Promise.resolve({ error });
          },
          listUsers: () => Promise.resolve({ data: { users: [] }, error: null }),
          deleteUser: () => Promise.resolve({ error: null })
        }
      }
    });
    expect(
      await runCommand(admin({ status: 500 }), parse('retry', 'PR-AAAAAAAAAAAA'), target)
    ).toEqual({ status: 'rejected', code: 'BAN_LIFT_FAILED' });
    expect(calls.map((call) => call.name)).toEqual(['privacy_op_retry']);
    calls.length = 0;
    await runCommand(admin(null), parse('retry', 'PR-AAAAAAAAAAAA'), target);
    expect(calls.map((call) => call.name)).toEqual([
      'privacy_op_retry',
      'privacy_op_ban_lift_done'
    ]);
    expect(lifted).toEqual([subjectA + ':none', subjectA + ':none']);
  });

  /** Admin double over a mutable user list: deleteUser removes the user, listUsers pages by offset. */
  const sweeperOver = (
    users: Array<{ id: string; email: string; created_at: string }>,
    options: { shells: string[]; swept?: string[] }
  ) => {
    const digest = (email: string) =>
      createHash('sha256').update(email.toLowerCase()).digest('hex');
    const deleted: string[] = [];
    const checked: string[] = [];
    const admin: OperatorClient = {
      rpc: (name, args) => {
        if (name === 'privacy_op_remnants_swept') options.swept?.push(String(args['p_reference']));
        if (name === 'privacy_op_remnant_is_shell') checked.push(String(args['p_user']));
        const data =
          name === 'privacy_op_remnant_context'
            ? {
                status: 'ok',
                since: '2026-11-20T10:00:00.000Z',
                digest: digest('erased@example.test')
              }
            : name === 'privacy_op_remnant_is_shell'
              ? { shell: options.shells.includes(String(args['p_user'])) }
              : { status: 'ok' };
        return Promise.resolve({ data, error: null });
      },
      auth: {
        admin: {
          updateUserById: () => Promise.resolve({ error: null }),
          listUsers: ({ page, perPage }) =>
            Promise.resolve({
              data: { users: users.slice((page - 1) * perPage, page * perPage) },
              error: null
            }),
          deleteUser: (id) => {
            deleted.push(id);
            users.splice(
              users.findIndex((user) => user.id === id),
              1
            );
            return Promise.resolve({ error: null });
          }
        }
      }
    };
    return { client: admin, deleted, checked };
  };
  const stamp = '2026-11-20T10:05:00.000Z';

  it('sweeps only invite shells created after the freeze for the erased address, then records the clean pass (F31, F36)', async () => {
    const swept: string[] = [];
    const {
      client: sweeper,
      deleted,
      checked
    } = sweeperOver(
      [
        { id: 'shell', email: 'Erased@Example.test', created_at: stamp },
        { id: 'older', email: 'erased@example.test', created_at: '2026-11-20T09:00:00.000Z' },
        { id: 'benign', email: 'other@example.test', created_at: stamp },
        { id: 'real', email: 'erased@example.test', created_at: stamp }
      ],
      { shells: ['shell'], swept }
    );
    const result = await runCommand(sweeper, parse('sweep-remnants', 'PR-AAAAAAAAAAAA'), target);
    // The shell is removed, but a REAL account (profile or sign-in) holds the erased address: never ignored silently,
    // never deleted, and the sweep is not recorded until the operator resolves it (F41).
    expect(result).toMatchObject({
      status: 'matched_non_shell',
      code: 'MATCHED_NON_SHELL',
      matchedNonShell: 1
    });
    expect(checked).toEqual(['shell', 'real', 'real']);
    expect(deleted).toEqual(['shell']);
    expect(swept).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('example.test');
    // The explicit override accepts the unresolved match and records the sweep.
    const resolved = await runCommand(
      sweeper,
      parse('sweep-remnants', 'PR-AAAAAAAAAAAA', '--resolve-non-shell'),
      target
    );
    expect(resolved).toEqual({
      status: 'ok',
      code: 'NO_REMNANTS',
      scanned: 3,
      matched: 1,
      removed: 0
    });
    expect(swept).toEqual(['PR-AAAAAAAAAAAA']);
  });

  it('re-scans from the start when a deletion shifts later users onto already scanned offsets (F36)', async () => {
    const swept: string[] = [];
    const users = [
      { id: 'x1', email: 'a@example.test', created_at: stamp },
      { id: 'x2', email: 'b@example.test', created_at: stamp },
      { id: 'shellA', email: 'erased@example.test', created_at: stamp },
      { id: 'x4', email: 'c@example.test', created_at: stamp },
      { id: 'shellB', email: 'erased@example.test', created_at: stamp }
    ];
    const { client: sweeper, deleted } = sweeperOver(users, {
      shells: ['shellA', 'shellB'],
      swept
    });
    // Page size 2: deleting shellA on page 2 shifts shellB to an offset page 2 already passed.
    const result = await sweepRemnants(sweeper, 'PR-AAAAAAAAAAAA', { perPage: 2 });
    expect(deleted).toEqual(['shellA', 'shellB']);
    expect(result).toMatchObject({ status: 'ok', removed: 2 });
    expect(swept).toEqual(['PR-AAAAAAAAAAAA']);
  });

  it('fails closed when the page cap is hit on a full page: nothing is recorded (F36)', async () => {
    const swept: string[] = [];
    const users = Array.from({ length: 10 }, (_, index) => ({
      id: 'u' + index,
      email: 'u' + index + '@example.test',
      created_at: stamp
    }));
    const { client: sweeper } = sweeperOver(users, { shells: [], swept });
    const result = await sweepRemnants(sweeper, 'PR-AAAAAAAAAAAA', { perPage: 2, maxPages: 3 });
    expect(result).toEqual({ status: 'incomplete', code: 'SWEEP_INCOMPLETE', scanned: 6 });
    expect(swept).toEqual([]);
    // Exactly at the boundary the last page is full as well: still not complete.
    const exact = sweeperOver(users.slice(0, 6), { shells: [], swept });
    expect(
      await sweepRemnants(exact.client, 'PR-AAAAAAAAAAAA', { perPage: 2, maxPages: 3 })
    ).toMatchObject({
      status: 'incomplete'
    });
    expect(swept).toEqual([]);
    // A shorter last page proves the end.
    const done = sweeperOver(users.slice(0, 5), { shells: [], swept });
    expect(
      await sweepRemnants(done.client, 'PR-AAAAAAAAAAAA', { perPage: 2, maxPages: 3 })
    ).toMatchObject({
      status: 'ok',
      code: 'NO_REMNANTS'
    });
    expect(swept).toEqual(['PR-AAAAAAAAAAAA']);
  });

  it('refuses reconciliation when the avatar prefix listing overflows its bound (F35)', async () => {
    calls.length = 0;
    let listings = 0;
    const storage: NonNullable<OperatorClient['storage']> = {
      from: () => ({
        remove: () => Promise.resolve({ error: null }),
        // Every page is full: the bound is reached and completeness cannot be claimed.
        list: () => {
          listings++;
          return Promise.resolve({
            data: Array.from({ length: 1000 }, (_, index) => ({ name: 'f' + index })),
            error: null
          });
        }
      })
    };
    const result = await reconcileRestoredSubject(
      {
        rpc: (name, args) => {
          calls.push({ name, args });
          return Promise.resolve({ data: { status: 'ok' }, error: null });
        },
        storage
      },
      subjectA,
      'local'
    );
    expect(result).toEqual({ status: 'rejected', code: 'LIST_OVERFLOW' });
    expect(listings).toBe(10);
    // No plan was requested, nothing was deleted.
    expect(calls).toEqual([]);
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
