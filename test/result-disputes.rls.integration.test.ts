import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';

const COMMANDS = [
  'public.resolve_result_dispute(uuid, bigint, text, text, uuid, uuid)',
  'public.get_result_dispute_resolutions(uuid)',
  'public.get_result_repair_jobs(uuid)',
  'public.get_result_repair_attempts(uuid)',
  // RLS policies call these as the invoker.
  'public.result_dispute_event_reader(uuid)',
  'public.result_repair_diagnostics_reader(uuid)'
];
const INTERNAL = [
  'public.queue_result_repair_job_locked(uuid, text, uuid, uuid, text, uuid, timestamptz)',
  'public.finalize_match_event_result_override_locked(uuid, bigint, uuid, uuid, text, uuid)',
  'public.record_result_dispute_audit(public.result_dispute_resolutions, timestamptz)',
  'public.result_repair_job_dto(public.result_repair_jobs)',
  'public.result_dispute_resolution_dto(public.result_dispute_resolutions)',
  'public.result_dispute_receipt(public.result_dispute_resolutions, uuid, boolean)',
  'public.guard_result_repair_job()',
  'public.guard_result_repair_attempt()'
];
const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const TABLES = ['result_dispute_resolutions', 'result_repair_jobs', 'result_repair_attempts'];

describe('result dispute and repair access control', { timeout: 240000 }, () => {
  let f: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  let foreign: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  let group: Awaited<ReturnType<typeof f.confirmedGroup>>;
  let jobId: string;
  let resolutionId: string;
  const operator = { id: '' };

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv();
    if (!env) throw new Error(reason);
    f = await createResultAmendmentFixtures(env);
    foreign = await createResultAmendmentFixtures(env);
    group = await f.confirmedGroup({ competitive: true });
    const { version } = await f.disputedCandidate(group);
    const done = await f.resolve(f.admin, group.proposalId, version, 'replace', {
      p_expected_base_confirmation_id: group.confirmationId
    });
    if (done.error) throw new Error(String(done.error.message));
    const receipt = asRecord(done.data);
    jobId = String(asRecord(receipt['repair'])['job_id']);
    resolutionId = String(asRecord(receipt['resolution'])['resolution_id']);
    // The foreign community's admin doubles as the Platform Admin operator for read checks.
    operator.id = foreign.admin.id;
    await fixtureSql(
      "insert into public.platform_admins(user_id) values ('" +
        operator.id +
        "') on conflict do nothing"
    );
  });
  afterAll(async () => {
    if (operator.id)
      await fixtureSql("delete from public.platform_admins where user_id='" + operator.id + "'");
    if (f) await f.cleanup();
    if (foreign) await foreign.cleanup();
  });

  async function executable(role: string, fn: string): Promise<boolean> {
    const rows = await sqlRows(
      "select has_function_privilege('" + role + "', '" + fn + "', 'execute') as allowed"
    );
    return rows[0]?.['allowed'] === true;
  }
  async function tablePrivilege(table: string, privilege: string): Promise<boolean> {
    const rows = await sqlRows(
      "select has_table_privilege('authenticated', 'public." +
        table +
        "', '" +
        privilege +
        "') as allowed"
    );
    return rows[0]?.['allowed'] === true;
  }

  it('grants only the guarded command and readers; schedulers and internals stay private', async () => {
    for (const role of ['anon', 'public', 'authenticated'])
      for (const fn of [...COMMANDS, ...INTERNAL])
        expect({ role, fn, allowed: await executable(role, fn) }).toEqual({
          role,
          fn,
          allowed: role === 'authenticated' && COMMANDS.includes(fn)
        });
    const secdef = await sqlRows(
      "select p.proname, p.prosecdef, p.proconfig @> array['search_path=\"\"'] as pinned from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '%result_dispute%' or p.proname like '%result_repair%' or p.proname = 'finalize_match_event_result_override_locked')"
    );
    expect(secdef.length).toBeGreaterThanOrEqual(12);
    const invokerHelpers = new Set([
      'result_repair_failure_code',
      'result_repair_retryable',
      'result_repair_backoff'
    ]);
    for (const row of secdef) {
      expect(row['pinned']).toBe(true);
      expect(row['prosecdef']).toBe(!invokerHelpers.has(String(row['proname'])));
    }
    expect(secdef.filter((row) => invokerHelpers.has(String(row['proname'])))).toHaveLength(3);
  });

  it('enables RLS with the provisional restriction and no browser DML on every new table', async () => {
    for (const table of TABLES) {
      const policy = await sqlRows(
        "select c.relrowsecurity, (select count(*)::int from pg_policy p where p.polrelid = c.oid and p.polname = 'provisional actor restricted' and not p.polpermissive) as restricted from pg_class c where c.oid = 'public." +
          table +
          "'::regclass"
      );
      expect(policy).toEqual([{ relrowsecurity: true, restricted: 1 }]);
      for (const privilege of ['insert', 'update', 'delete', 'truncate'])
        expect({ table, privilege, allowed: await tablePrivilege(table, privilege) }).toEqual({
          table,
          privilege,
          allowed: false
        });
    }
    for (const [table, column] of [
      ['result_dispute_resolutions', 'command_id'],
      ['result_dispute_resolutions', 'fingerprint'],
      ['result_repair_jobs', 'lease_token'],
      ['result_repair_jobs', 'command_fingerprint'],
      ['result_repair_attempts', 'fence_token']
    ] as const) {
      const rows = await sqlRows(
        "select has_column_privilege('authenticated', 'public." +
          table +
          "', '" +
          column +
          "', 'select') as allowed"
      );
      expect({ table, column, rows }).toEqual({ table, column, rows: [{ allowed: false }] });
    }
    const tamper = await f.admin.client
      .from('result_repair_jobs')
      .update({ status: 'succeeded' })
      .eq('id', jobId);
    expect(tamper.error?.code).toBe('42501');
    const forge = await f.admin.client.from('result_dispute_resolutions').insert({
      match_event_id: group.eventId,
      proposal_id: group.proposalId,
      group_number: 1,
      resolution_kind: 'first_confirmation',
      candidate_version: 1,
      decision: 'void',
      actor_id: f.admin.id,
      justification: 'forged',
      command_id: crypto.randomUUID(),
      fingerprint: 'forged'
    });
    expect(forge.error?.code).toBe('42501');
    const secret = await f.admin.client.from('result_repair_jobs').select('lease_token');
    expect(secret.error?.code).toBe('42501');
  });

  it('shows resolutions to event readers and hides them from other communities', async () => {
    for (const reader of [f.p0, f.p1, f.p2, f.p3, f.admin]) {
      const rows = await reader.client
        .from('result_dispute_resolutions')
        .select('id, decision')
        .eq('id', resolutionId);
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual([{ id: resolutionId, decision: 'replace' }]);
      const list = await f.rpc(reader, 'get_result_dispute_resolutions', {
        p_match_event_id: group.eventId
      });
      expect(list.error).toBeNull();
      expect(list.data).toHaveLength(1);
    }
    for (const outsider of [foreign.admin, foreign.p0, f.outsider]) {
      const rows = await outsider.client
        .from('result_dispute_resolutions')
        .select('id')
        .eq('id', resolutionId);
      expect(rows.data).toEqual([]);
      const list = await f.rpc(outsider, 'get_result_dispute_resolutions', {
        p_match_event_id: group.eventId
      });
      expect(list.error?.message).toBe('RESULT_AMENDMENT_NOT_FOUND');
      const jobs = await f.rpc(outsider, 'get_result_repair_jobs', {
        p_match_event_id: group.eventId
      });
      expect(jobs.error?.message).toBe('RESULT_AMENDMENT_NOT_FOUND');
    }
  });

  it('limits repair job rows to the own-community admin and Platform Admins', async () => {
    const own = await f.admin.client
      .from('result_repair_jobs')
      .select('id, status, failure_code')
      .eq('id', jobId);
    expect(own.data).toEqual([{ id: jobId, status: 'queued', failure_code: null }]);
    // The fixture creator (p0) holds the community admin role, so only the other players are plain.
    for (const player of [f.p1, f.p2, f.p3]) {
      const rows = await player.client.from('result_repair_jobs').select('id').eq('id', jobId);
      expect(rows.data).toEqual([]);
    }
    expect((await foreign.p0.client.from('result_repair_jobs').select('id')).data).toEqual([]);
    // Players still get the sanitized status through the reader RPC.
    const sanitized = await f.rpc(f.p1, 'get_result_repair_jobs', {
      p_match_event_id: group.eventId
    });
    expect(sanitized.data).toHaveLength(1);
    expect(asRecord(rowsOf(sanitized.data)[0])).toMatchObject({
      job_id: jobId,
      status: 'queued',
      publication: 'pending',
      projections_complete: false
    });

    const all = await foreign.admin.client.from('result_repair_jobs').select('id').eq('id', jobId);
    expect(all.data).toEqual([{ id: jobId }]);
  });

  it('keeps detailed attempts Platform-Admin only and attempt rows immutable', async () => {
    // Trusted claim stand-in: unit 3 owns the real claim; here only the storage contract is proven.
    const fence = crypto.randomUUID();
    await fixtureSql(
      "update public.result_repair_jobs set status='running', lease_token='" +
        fence +
        "', lease_expires_at=now()+interval '5 minutes', started_at=now(), attempt_count=1 where id='" +
        jobId +
        "'; insert into public.result_repair_attempts(job_id, attempt_number, fence_token, base_revision) values ('" +
        jobId +
        "', 1, '" +
        fence +
        "', 3)"
    );
    // One running global repair claim.
    const other = await f.confirmedGroup({ competitive: true });
    const second = await f.disputedCandidate(other);
    expect(
      (
        await f.resolve(f.admin, other.proposalId, second.version, 'void', {
          p_expected_base_confirmation_id: other.confirmationId
        })
      ).error
    ).toBeNull();
    await expect(
      fixtureSql(
        "update public.result_repair_jobs set status='running', lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', started_at=now(), attempt_count=1 where proposal_id='" +
          other.proposalId +
          "'"
      )
    ).rejects.toThrow(/result_repair_one_running/);

    expect((await f.admin.client.from('result_repair_attempts').select('id')).data).toEqual([]);
    expect(
      (await f.rpc(f.admin, 'get_result_repair_attempts', { p_job_id: jobId })).error?.code
    ).toBe('42501');
    const asOperator = await foreign.admin.client
      .from('result_repair_attempts')
      .select('id, status, fence_token');
    expect(asOperator.error?.code).toBe('42501');
    const visible = await foreign.admin.client
      .from('result_repair_attempts')
      .select('id, status, attempt_number')
      .eq('job_id', jobId);
    expect(visible.data).toEqual([
      expect.objectContaining({ status: 'running', attempt_number: 1 })
    ]);
    const detail = await f.rpc(foreign.admin, 'get_result_repair_attempts', { p_job_id: jobId });
    expect(detail.error).toBeNull();
    expect(asRecord(rowsOf(detail.data)[0])).toMatchObject({
      attempt_number: 1,
      status: 'running',
      base_revision: 3,
      result_revision: null
    });

    // Terminal evidence is immutable and failure codes are an allowlist (no raw SQL or stacks).
    await expect(
      fixtureSql(
        "update public.result_repair_attempts set status='failed', finished_at=now(), failure_code='ERROR: relation \"x\" does not exist' where job_id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/failure_code_check/);
    await fixtureSql(
      "update public.result_repair_attempts set status='failed', finished_at=now(), failure_code='REPLAY_FAILED' where job_id='" +
        jobId +
        "'"
    );
    await expect(
      fixtureSql(
        "update public.result_repair_attempts set failure_code='INTERNAL' where job_id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/Terminal result repair attempts are immutable/);
    await expect(
      fixtureSql("delete from public.result_repair_attempts where job_id='" + jobId + "'")
    ).rejects.toThrow(/never deleted/);
  });

  it('enforces job lifecycle: no silent success, failures keep a sanitized code, no deletes', async () => {
    const before = await f.officialState(group.proposalId);
    // Failed requires a code; the job can be retried back to queued, never straight to success.
    await expect(
      fixtureSql(
        "update public.result_repair_jobs set status='failed', lease_token=null, lease_expires_at=null, finished_at=now() where id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/status_shape/);
    await fixtureSql(
      "update public.result_repair_jobs set status='failed', lease_token=null, lease_expires_at=null, finished_at=now(), failure_code='REPLAY_FAILED', next_attempt_at=now()+interval '1 minute' where id='" +
        jobId +
        "'"
    );
    const failed = await f.rpc(f.p1, 'get_result_repair_jobs', { p_match_event_id: group.eventId });
    expect(asRecord(rowsOf(failed.data)[0])).toMatchObject({
      status: 'failed',
      publication: 'failed',
      failure_code: 'REPLAY_FAILED',
      projections_complete: false
    });
    // A failed repair is still a pending application: the old fact stays official.
    expect(await f.officialState(group.proposalId)).toEqual(before);
    const amendments = await f.rpc(f.p1, 'get_result_amendments', {
      p_match_event_id: group.eventId
    });
    expect(
      rowsOf(amendments.data)
        .map((item) => asRecord(item))
        .find((item) => item['repair_job_id'] === jobId)
    ).toMatchObject({ pending_application: true, repair: { status: 'failed' } });

    await expect(
      fixtureSql(
        "update public.result_repair_jobs set status='succeeded', finished_at=now(), failure_code=null where id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/Invalid result repair job transition|status_shape/);
    await fixtureSql(
      "update public.result_repair_jobs set status='running', lease_token=gen_random_uuid(), lease_expires_at=now()+interval '5 minutes', started_at=now(), finished_at=null, attempt_count=2 where id='" +
        jobId +
        "'"
    );
    // A running job cannot claim success without a committed revision.
    await expect(
      fixtureSql(
        "update public.result_repair_jobs set status='succeeded', lease_token=null, lease_expires_at=null, finished_at=now() where id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/status_shape/);
    await fixtureSql(
      "update public.result_repair_jobs set status='failed', lease_token=null, lease_expires_at=null, finished_at=now(), failure_code='LEASE_EXPIRED' where id='" +
        jobId +
        "'"
    );
    await expect(
      fixtureSql("update public.result_repair_jobs set kind='void' where id='" + jobId + "'")
    ).rejects.toThrow(/identity is immutable/);
    await expect(
      fixtureSql("delete from public.result_repair_jobs where id='" + jobId + "'")
    ).rejects.toThrow(/never deleted/);
    await expect(
      fixtureSql(
        "update public.result_repair_jobs set failure_code='stack trace at line 4' where id='" +
          jobId +
          "'"
      )
    ).rejects.toThrow(/failure_code_check/);
    // Retry resumes the same logical job.
    await fixtureSql(
      "update public.result_repair_jobs set status='queued', finished_at=null, next_attempt_at=now() where id='" +
        jobId +
        "'"
    );
    expect(
      await sqlRows(
        "select count(*)::int as n from public.result_repair_jobs where proposal_id='" +
          group.proposalId +
          "'"
      )
    ).toEqual([{ n: 1 }]);
  });

  it('keeps resolutions insert-only evidence', async () => {
    await expect(
      fixtureSql(
        "update public.result_dispute_resolutions set justification='edited' where id='" +
          resolutionId +
          "'"
      )
    ).rejects.toThrow(/insert-only/);
    await expect(
      fixtureSql("delete from public.result_dispute_resolutions where id='" + resolutionId + "'")
    ).rejects.toThrow(/insert-only/);
    // An override confirmation cannot be forged without the audited resolution + admin identity.
    const eventId = await f.disputedOriginal();
    await expect(
      fixtureSql(
        "insert into public.match_event_result_confirmations(proposal_id, proposal_version, match_event_id, group_number, source, confirmed_at, effective_at, actor_id, event_type, ratable_eligible) values ('" +
          eventId.proposalId +
          "', 1, '" +
          eventId.eventId +
          "', 1, 'ADMIN_OVERRIDE', now(), now(), '" +
          f.admin.id +
          "', 'friendly', false)"
      )
    ).rejects.toThrow(/audited resolution|official result pointer/);
  });
});
