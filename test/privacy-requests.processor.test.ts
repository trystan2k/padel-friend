import { describe, expect, it, vi } from 'vitest';
import {
  parseClaim,
  processPrivacyCase,
  projectRefOf,
  sweepPrivacyRequestsOnSchedule,
  type PrivacyClaim
} from '../src/features/privacy-requests/privacy-processor.server';
import type { AdminClient } from '../src/lib/supabase/admin.server';

type Call = { name: string; args: Record<string, unknown> };
const claim = (overrides: Partial<PrivacyClaim> = {}): PrivacyClaim => ({
  case_id: 'case',
  fence: 1,
  lease_token: 'lease',
  state: 'executing',
  last_phase: null,
  subject_id: 'subject',
  ...overrides
});

/** A scripted admin client: every RPC succeeds unless the script says otherwise. */
function fakeAdmin(options: {
  rpc?: (
    name: string,
    args: Record<string, unknown>
  ) => { data?: unknown; error?: { message: string } } | undefined;
  getUser?: Array<{ error: { status?: number } | null }>;
  removeError?: boolean;
  unbanError?: boolean;
  storage?: Array<Array<{ bucket: string; name: string }>>;
}) {
  const calls: Call[] = [];
  const removed: string[] = [];
  const storage = [...(options.storage ?? [])];
  const users = [...(options.getUser ?? [{ error: null }, { error: { status: 404 } }])];
  const admin = {
    rpc: (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const scripted = options.rpc?.(name, args);
      if (scripted)
        return Promise.resolve({ data: scripted.data ?? null, error: scripted.error ?? null });
      if (name === 'privacy_proc_ban_check')
        return Promise.resolve({ data: { ok: true }, error: null });
      if (name === 'privacy_proc_storage_set')
        return Promise.resolve({ data: storage.shift() ?? [], error: null });
      return Promise.resolve({ data: { status: 'done' }, error: null });
    },
    storage: {
      from: (bucket: string) => ({
        remove: (names: string[]) => {
          removed.push(...names.map((name) => bucket + '/' + name));
          return Promise.resolve({ error: options.removeError ? { message: 'boom' } : null });
        }
      })
    },
    auth: {
      admin: {
        updateUserById: vi.fn<
          (id: string, attributes: unknown) => Promise<{ error: { status?: number } | null }>
        >((_id, attributes) =>
          Promise.resolve({
            error:
              options.unbanError &&
              typeof attributes === 'object' &&
              attributes !== null &&
              Reflect.get(attributes, 'ban_duration') === 'none'
                ? { status: 500 }
                : null
          })
        ),
        getUserById: vi.fn<(id: string) => Promise<{ error: { status?: number } | null }>>(() =>
          Promise.resolve(users.shift() ?? { error: { status: 404 } })
        ),
        deleteUser: vi.fn<(id: string, soft: boolean) => Promise<{ error: null }>>(() =>
          Promise.resolve({ error: null })
        )
      }
    }
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow double: only the calls the processor makes
  return { admin: admin as unknown as AdminClient, raw: admin, calls, removed };
}
const names = (calls: Call[]) => calls.map((call) => call.name.replace('privacy_proc_', ''));

describe('privacy processor phases', () => {
  it('runs the four phases in order and closes the case', async () => {
    const { admin, calls, raw } = fakeAdmin({});
    const result = await processPrivacyCase(admin, claim());
    expect(result).toEqual({
      status: 'closed',
      steps: ['freeze', 'relational', 'storage', 'auth', 'finish']
    });
    expect(names(calls)).toEqual([
      'freeze',
      'ban_mark',
      'ban_check',
      'freeze',
      'erase_relational',
      'storage_set',
      'complete_phase',
      'complete_phase',
      'finish'
    ]);
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledWith('subject', {
      ban_duration: '876000h'
    });
    expect(raw.auth.admin.deleteUser).toHaveBeenCalledWith('subject', false);
    expect(
      calls
        .filter((call) => call.name !== 'privacy_proc_ban_check')
        .every((call) => call.args['p_fence'] === 1 && call.args['p_token'] === 'lease')
    ).toBe(true);
  });

  it('resumes from the last committed phase and never repeats a completed one', async () => {
    const { admin, calls, raw } = fakeAdmin({});
    const result = await processPrivacyCase(
      admin,
      claim({ state: 'app_data_erased', last_phase: 'storage' })
    );
    expect(result).toEqual({ status: 'closed', steps: ['auth', 'finish'] });
    expect(names(calls)).toEqual(['complete_phase', 'finish']);
    expect(raw.auth.admin.updateUserById).not.toHaveBeenCalled();
  });

  it('removes storage in bounded batches and re-lists until the set is empty', async () => {
    const many = Array.from({ length: 150 }, (_, index) => ({
      bucket: 'match-event-photos',
      name: 'c/e/u/' + index
    }));
    const { admin, removed, calls } = fakeAdmin({
      storage: [many, [{ bucket: 'player-avatars', name: 'u/a.png' }], []]
    });
    await processPrivacyCase(admin, claim({ state: 'app_data_erased', last_phase: 'relational' }));
    expect(removed).toHaveLength(151);
    expect(calls.filter((call) => call.name === 'privacy_proc_storage_set')).toHaveLength(3);
    const complete = calls.find((call) => call.name === 'privacy_proc_complete_phase');
    expect(complete?.args['p_removed']).toBe(151);
  });

  it('refuses a bucket outside the allowlist and records a retryable failure', async () => {
    const { admin, calls, removed } = fakeAdmin({ storage: [[{ bucket: 'secrets', name: 'x' }]] });
    const result = await processPrivacyCase(
      admin,
      claim({ state: 'app_data_erased', last_phase: 'relational' })
    );
    expect(result.status).toBe('retry');
    expect(removed).toEqual([]);
    const fail = calls.find((call) => call.name === 'privacy_proc_fail');
    expect(fail?.args).toMatchObject({ p_code: 'STORAGE_FAILED', p_retryable: true });
  });

  it('treats an ambiguous Auth answer as a retry, never as success', async () => {
    const { admin, calls } = fakeAdmin({ getUser: [{ error: null }, { error: null }] });
    const result = await processPrivacyCase(
      admin,
      claim({ state: 'app_data_erased', last_phase: 'storage' })
    );
    expect(result.status).toBe('retry');
    expect(names(calls)).not.toContain('complete_phase');
    expect(calls.find((call) => call.name === 'privacy_proc_fail')?.args['p_code']).toBe(
      'AUTH_UNVERIFIED'
    );
    const { admin: timeout, calls: timeoutCalls } = fakeAdmin({
      getUser: [{ error: { status: 500 } }]
    });
    await processPrivacyCase(timeout, claim({ state: 'app_data_erased', last_phase: 'storage' }));
    expect(timeoutCalls.find((call) => call.name === 'privacy_proc_fail')?.args['p_code']).toBe(
      'AUTH_UNVERIFIED'
    );
  });

  it('stops on a blocked relational phase without any later side effect', async () => {
    const { admin, calls, raw } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_erase_relational'
          ? { data: { status: 'blocked', code: 'PLATFORM_ADMIN_GRANT' } }
          : undefined
    });
    const result = await processPrivacyCase(admin, claim({ last_phase: 'freeze' }));
    expect(result).toEqual({ status: 'blocked', code: 'PLATFORM_ADMIN_GRANT', steps: [] });
    expect(names(calls)).toEqual(['erase_relational']);
    expect(raw.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it('waits for in-flight work without recording a failure', async () => {
    const { admin, calls } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_erase_relational'
          ? { data: { status: 'wait', phase: 'relational' } }
          : undefined
    });
    const result = await processPrivacyCase(admin, claim({ last_phase: 'freeze' }));
    expect(result).toEqual({ status: 'retry', steps: [] });
    expect(names(calls)).toEqual(['erase_relational']);
  });

  it('is fenced out silently when the lease was lost', async () => {
    const { admin, calls } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_freeze' ? { error: { message: 'PRIVACY_LEASE_LOST' } } : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({ status: 'fenced', steps: [] });
    expect(names(calls)).toEqual(['freeze']);
  });

  it('simulates a crash through a hook without writing a failure record', async () => {
    const { admin, calls } = fakeAdmin({});
    const crash = new Error('CRASH');
    await expect(
      processPrivacyCase(admin, claim(), {
        beforeStep: (step) => {
          if (step === 'relational') throw crash;
        }
      })
    ).rejects.toBe(crash);
    // Address pre-check, the ban recorded on the case before the external call, then the freeze commit.
    expect(names(calls)).toEqual(['freeze', 'ban_mark', 'ban_check', 'freeze']);
  });

  it('blocks on a stale verified address BEFORE the ban (F25)', async () => {
    const { admin, calls, raw } = fakeAdmin({
      rpc: (name, args) =>
        name === 'privacy_proc_freeze' && args['p_check_only'] === true
          ? { data: { status: 'blocked', code: 'VERIFICATION_STALE' } }
          : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({
      status: 'blocked',
      code: 'VERIFICATION_STALE',
      steps: []
    });
    expect(raw.auth.admin.updateUserById).not.toHaveBeenCalled();
    expect(names(calls)).toEqual(['freeze']);
  });

  it('lifts the ban of an interrupted earlier attempt when the reclaimed pre-check finds the proof stale (F37)', async () => {
    const { admin, calls, raw } = fakeAdmin({
      rpc: (name, args) =>
        name === 'privacy_proc_freeze' && args['p_check_only'] === true
          ? { data: { status: 'blocked', code: 'VERIFICATION_STALE', unban_required: true } }
          : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({
      status: 'blocked',
      code: 'VERIFICATION_STALE',
      steps: []
    });
    // No new ban; the old one is lifted and the lift is durably recorded (restartable only afterwards).
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith('subject', {
      ban_duration: 'none'
    });
    expect(names(calls)).toEqual(['freeze', 'unban_done']);
  });

  it('undoes a late ban and aborts when this worker no longer owns the case (F40)', async () => {
    const { admin, calls, raw } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_ban_check' ? { data: { ok: false, unban: true } } : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({ status: 'fenced', steps: [] });
    expect(raw.auth.admin.updateUserById).toHaveBeenNthCalledWith(1, 'subject', {
      ban_duration: '876000h'
    });
    expect(raw.auth.admin.updateUserById).toHaveBeenNthCalledWith(2, 'subject', {
      ban_duration: 'none'
    });
    // No freeze phase work follows.
    expect(names(calls)).toEqual(['freeze', 'ban_mark', 'ban_check']);
  });

  it('keeps the ban of an irreversible case and aborts with a safe code (F43)', async () => {
    const { admin, raw } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_ban_check'
          ? { data: { ok: false, unban: false, code: 'BAN_KEPT_FOR_IRREVERSIBLE' } }
          : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({ status: 'fenced', steps: [] });
    // Only the ban itself: the protection of the in-flight erasure is never lifted.
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith('subject', {
      ban_duration: '876000h'
    });
  });

  it('carries a failed undo as BAN_LIFT_FAILED on a recoverable case, as a cleanup obligation otherwise (F44)', async () => {
    for (const [recoverable, expected] of [
      [true, 'privacy_proc_ban_lift_failed'],
      [false, 'privacy_proc_ban_cleanup_pending']
    ] as const) {
      const { admin, calls } = fakeAdmin({
        unbanError: true,
        rpc: (name) =>
          name === 'privacy_proc_ban_check'
            ? { data: { ok: false, unban: true, recoverable } }
            : undefined
      });
      expect(await processPrivacyCase(admin, claim())).toEqual({ status: 'fenced', steps: [] });
      expect(calls.at(-1)?.name).toBe(expected);
    }
  });

  it('aborts without undoing the ban when a newer worker owns it on an executing case (F40)', async () => {
    const { admin, raw } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_ban_check' ? { data: { ok: false, unban: false } } : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({ status: 'fenced', steps: [] });
    expect(raw.auth.admin.updateUserById).toHaveBeenCalledExactlyOnceWith('subject', {
      ban_duration: '876000h'
    });
  });

  it('blocks the case as BAN_LIFT_FAILED when the temporary ban cannot be lifted (F33)', async () => {
    const { admin, calls } = fakeAdmin({
      unbanError: true,
      rpc: (name, args) =>
        name === 'privacy_proc_freeze' && args['p_check_only'] !== true
          ? { data: { status: 'blocked', code: 'VERIFICATION_STALE' } }
          : undefined
    });
    expect(await processPrivacyCase(admin, claim())).toEqual({
      status: 'blocked',
      code: 'BAN_LIFT_FAILED',
      steps: []
    });
    expect(calls.at(-1)).toEqual({
      name: 'privacy_proc_ban_lift_failed',
      args: { p_case: 'case' }
    });
  });

  it('blocks at the auth boundary until the operator acknowledged outstanding sends (F31)', async () => {
    const { admin } = fakeAdmin({
      rpc: (name, args) =>
        name === 'privacy_proc_complete_phase' && args['p_phase'] === 'auth'
          ? { data: { status: 'blocked', code: 'EXTERNAL_FOLLOWUP_ACK_REQUIRED' } }
          : undefined
    });
    expect(
      await processPrivacyCase(admin, claim({ state: 'app_data_erased', last_phase: 'storage' }))
    ).toEqual({ status: 'blocked', code: 'EXTERNAL_FOLLOWUP_ACK_REQUIRED', steps: [] });
  });

  it('lifts the ban when the freeze itself refuses a stale address (F25, F33)', async () => {
    const { admin, raw, calls } = fakeAdmin({
      rpc: (name, args) =>
        name === 'privacy_proc_freeze' && args['p_check_only'] !== true
          ? { data: { status: 'blocked', code: 'VERIFICATION_STALE' } }
          : undefined
    });
    expect((await processPrivacyCase(admin, claim())).status).toBe('blocked');
    expect(raw.auth.admin.updateUserById).toHaveBeenNthCalledWith(1, 'subject', {
      ban_duration: '876000h'
    });
    expect(raw.auth.admin.updateUserById).toHaveBeenNthCalledWith(2, 'subject', {
      ban_duration: 'none'
    });
    // The recorded unban moves PENDING_UNBAN to the restartable blocker.
    expect(calls.at(-1)).toEqual({ name: 'privacy_proc_unban_done', args: { p_case: 'case' } });
  });
});

describe('privacy processor claims and sweep', () => {
  it('parses only a well-formed claim', () => {
    const row = {
      status: 'claimed',
      case_id: 'c',
      fence: 2,
      lease_token: 't',
      state: 'executing',
      last_phase: 'freeze',
      subject_id: 's'
    };
    expect(parseClaim(row)).toEqual({
      case_id: 'c',
      fence: 2,
      lease_token: 't',
      state: 'executing',
      last_phase: 'freeze',
      subject_id: 's'
    });
    expect(parseClaim({ ...row, state: 'ready' })).toBeNull();
    expect(parseClaim({ ...row, fence: '2' })).toBeNull();
    expect(parseClaim({ status: 'blocked', code: 'ENVIRONMENT_MISMATCH' })).toEqual({
      status: 'blocked'
    });
    expect(parseClaim(null)).toBeNull();
    expect(projectRefOf('http://127.0.0.1:1')).toBe('local');
  });

  it('does nothing when the executor is disabled by environment', async () => {
    const { admin, calls } = fakeAdmin({});
    expect(
      await sweepPrivacyRequestsOnSchedule({
        client: admin,
        env: { PRIVACY_EXECUTOR_DISABLED: '1' },
        projectRef: 'local'
      })
    ).toEqual({ disabled: true, processed: 0 });
    expect(calls).toEqual([]);
  });

  it('claims with its own project ref, skips blocked claims and purges afterwards', async () => {
    const { admin, calls } = fakeAdmin({
      rpc: (name) =>
        name === 'privacy_proc_claim'
          ? { data: { status: 'blocked', code: 'ENVIRONMENT_MISMATCH' } }
          : undefined
    });
    const result = await sweepPrivacyRequestsOnSchedule({
      client: admin,
      env: {},
      projectRef: 'local',
      maxCases: 1
    });
    expect(result).toEqual({ disabled: false, processed: 0 });
    expect(calls[0]).toEqual({
      name: 'privacy_proc_claim',
      args: { p_lease_seconds: 120, p_project_ref: 'local' }
    });
    expect(calls.at(-1)?.name).toBe('privacy_op_purge_expired');
  });
});
