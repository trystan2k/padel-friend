import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';

const COMMANDS = [
  'public.get_result_amendments(uuid)',
  'public.request_result_amendment(uuid, uuid, text, uuid)',
  'public.submit_result_amendment_candidate(uuid, uuid, jsonb, jsonb, jsonb, uuid, bigint, text)',
  'public.review_result_amendment(uuid, uuid, bigint, text, uuid, text, text)',
  'public.cancel_result_amendment(uuid, uuid)'
];
const INTERNAL = [
  'public.process_due_result_amendments(integer)',
  'public.try_auto_accept_result_amendment(uuid, bigint)',
  'public.accept_result_amendment_locked(uuid, bigint, text, uuid, uuid)',
  'public.record_result_amendment_event(public.result_amendment_requests, text, text, text, uuid, bigint, text, jsonb, uuid, timestamptz)',
  'public.result_amendment_dto(public.result_amendment_requests, uuid)',
  'public.result_amendment_receipt(public.result_amendment_requests, uuid, boolean)',
  'public.result_amendment_actor()',
  'public.match_event_official_confirmations()'
];

describe('result amendment access control', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  let foreign: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  let group: Awaited<ReturnType<typeof f.confirmedGroup>>;
  let amendmentId: string;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createResultAmendmentFixtures(env);
    foreign = await createResultAmendmentFixtures(env);
    group = await f.confirmedGroup();
    amendmentId = (await f.openCandidate(group, f.admin)).amendmentId;
  });
  afterAll(async () => {
    if (f) await f.cleanup();
    if (foreign) await foreign.cleanup();
  });

  async function executable(role: string, fn: string): Promise<boolean> {
    const rows = await sqlRows(
      "select has_function_privilege('" + role + "', '" + fn + "', 'execute') as allowed"
    );
    return rows[0]?.['allowed'] === true;
  }

  it('grants commands to signed-in users only and keeps schedulers and internals private', async () => {
    const granted: Record<string, boolean> = {};
    for (const role of ['anon', 'public', 'authenticated'])
      for (const fn of [...COMMANDS, ...INTERNAL])
        granted[role + ' ' + fn] = await executable(role, fn);
    const expected: Record<string, boolean> = {};
    for (const role of ['anon', 'public', 'authenticated'])
      for (const fn of [...COMMANDS, ...INTERNAL])
        expected[role + ' ' + fn] = role === 'authenticated' && COMMANDS.includes(fn);
    expect(granted).toEqual(expected);
    const secdef = await sqlRows(
      "select p.proname, p.prosecdef, p.proconfig @> array['search_path=\"\"'] as pinned from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like '%result_amendment%' or p.proname = 'match_event_official_confirmations')"
    );
    expect(secdef.length).toBeGreaterThan(10);
    expect(secdef.filter((row) => row['prosecdef'] !== true || row['pinned'] !== true)).toEqual([]);
  });

  it('denies unauthenticated and anonymous-session command callers', async () => {
    const anon = { ...f.p0, token: f.anonymousToken };
    const read = await f.rpc(anon, 'get_result_amendments', { p_match_event_id: group.eventId });
    expect(read.error?.code).toBe('42501');
    const write = await f.request(anon, group);
    expect(write.error?.code).toBe('42501');
    const trusted = await f.rpc(f.p0, 'process_due_result_amendments', { p_limit: 1 });
    expect(trusted.error?.code).toBe('42501');
  });

  it('denies direct DML on every new table and hides the official pointer and internal columns', async () => {
    for (const table of [
      'result_amendment_requests',
      'result_amendment_candidates',
      'result_amendment_events',
      'match_event_result_official_state'
    ]) {
      for (const privilege of ['insert', 'update', 'delete', 'truncate']) {
        const rows = await sqlRows(
          "select has_table_privilege('authenticated', 'public." +
            table +
            "', '" +
            privilege +
            "') as allowed"
        );
        expect(rows).toEqual([{ allowed: false }]);
      }
    }
    expect(
      await sqlRows(
        "select has_table_privilege('authenticated', 'public.match_event_result_official_state', 'select') as allowed"
      )
    ).toEqual([{ allowed: false }]);
    for (const column of ['command_id', 'fingerprint']) {
      expect(
        await sqlRows(
          "select has_column_privilege('authenticated', 'public.result_amendment_requests', '" +
            column +
            "', 'select') as allowed"
        )
      ).toEqual([{ allowed: false }]);
    }
    const update = await f.admin.client
      .from('result_amendment_requests')
      .update({ reason: 'tamper' })
      .eq('id', amendmentId);
    expect(update.error?.code).toBe('42501');
    const insert = await f.p0.client.from('result_amendment_events').insert({
      amendment_id: amendmentId,
      event_type: 'canceled',
      to_lifecycle: 'canceled'
    });
    expect(insert.error?.code).toBe('42501');
    const pointer = await f.admin.client.from('match_event_result_official_state').select('*');
    expect(pointer.error?.code).toBe('42501');
    const secret = await f.admin.client.from('result_amendment_requests').select('fingerprint');
    expect(secret.error?.code).toBe('42501');
  });

  it('shows amendment rows to event readers and original participants only', async () => {
    for (const reader of [f.p0, f.p1, f.p2, f.p3, f.admin]) {
      const rows = await reader.client
        .from('result_amendment_requests')
        .select('id, lifecycle, candidate_version')
        .eq('id', amendmentId);
      expect(rows.error).toBeNull();
      expect(rows.data).toEqual([
        { id: amendmentId, lifecycle: 'proposal_pending', candidate_version: 2 }
      ]);
      const events = await reader.client
        .from('result_amendment_events')
        .select('event_type')
        .eq('amendment_id', amendmentId);
      expect(events.data).toHaveLength(2);
      const candidates = await reader.client
        .from('result_amendment_candidates')
        .select('version')
        .eq('proposal_id', group.proposalId);
      expect(candidates.data).toEqual([{ version: 2 }]);
    }
    for (const outsider of [f.outsider, foreign.admin, foreign.p0]) {
      const rows = await outsider.client.from('result_amendment_requests').select('id');
      expect(rows.data).toEqual([]);
      const events = await outsider.client.from('result_amendment_events').select('id');
      expect(events.data).toEqual([]);
      const candidates = await outsider.client
        .from('result_amendment_candidates')
        .select('proposal_id');
      expect(candidates.data).toEqual([]);
    }
  });

  it('applies the provisional-actor restriction explicitly to every new table', async () => {
    const policies = await sqlRows(
      "select c.relname as table_name, p.polpermissive as permissive from pg_policy p join pg_class c on c.oid = p.polrelid where p.polname = 'provisional actor restricted' and c.relname in ('result_amendment_requests','result_amendment_candidates','result_amendment_events','match_event_result_official_state') order by 1"
    );
    expect(policies).toEqual([
      { table_name: 'match_event_result_official_state', permissive: false },
      { table_name: 'result_amendment_candidates', permissive: false },
      { table_name: 'result_amendment_events', permissive: false },
      { table_name: 'result_amendment_requests', permissive: false }
    ]);
    const rls = await sqlRows(
      "select relname, relrowsecurity from pg_class where relname in ('result_amendment_requests','result_amendment_candidates','result_amendment_events','match_event_result_official_state') order by 1"
    );
    expect(rls.every((row) => row['relrowsecurity'] === true)).toBe(true);
  });

  it('unauthorized writes leave the original and amendment state untouched', async () => {
    const before = await f.originalEvidence(group.eventId);
    const row = await f.amendmentRow(amendmentId);
    for (const intruder of [f.outsider, foreign.admin, foreign.p0, f.reserve]) {
      expect((await f.review(intruder, group, amendmentId, 2)).error?.code).toBe('42501');
      expect((await f.cancel(intruder, amendmentId)).error?.code).toBe('42501');
      expect((await f.candidate(intruder, group, amendmentId)).error?.code).toBe('42501');
    }
    expect(await f.originalEvidence(group.eventId)).toBe(before);
    expect(asRecord(await f.amendmentRow(amendmentId))['updated_at']).toEqual(row['updated_at']);
    expect(
      await sqlRows(
        "select count(*)::int as n from public.result_amendment_events where amendment_id = '" +
          amendmentId +
          "'"
      )
    ).toEqual([{ n: 2 }]);
  });

  it('schedules automatic acceptance as a singleton cron job when pg_cron is installed', async () => {
    const extension = await sqlRows("select 1 as ok from pg_extension where extname = 'pg_cron'");
    if (extension.length === 0) return;
    const jobs = await sqlRows(
      "select command from cron.job where jobname = 'padel-friend-result-amendment-auto-accept'"
    );
    expect(jobs).toEqual([{ command: 'select public.process_due_result_amendments(25)' }]);
  });
});
