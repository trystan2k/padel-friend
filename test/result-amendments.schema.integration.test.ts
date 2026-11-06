import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';

describe('result amendment schema contract', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createResultAmendmentFixtures(env);
  });
  afterAll(async () => {
    if (f) await f.cleanup();
  });

  async function constraintDefs(table: string) {
    return sqlRows(
      "select conname, contype::text as type, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public." +
        table +
        "'::regclass order by conname"
    );
  }

  it('relaxes confirmation cardinality to one per proposal version and keeps dependent composite keys', async () => {
    const defs = (await constraintDefs('match_event_result_confirmations')).map((row) =>
      String(row['def'])
    );
    expect(defs).toContain('UNIQUE (proposal_id, proposal_version)');
    expect(defs).toContain('UNIQUE (id, proposal_id, proposal_version)');
    expect(defs).not.toContain('UNIQUE (proposal_id)');
    expect(defs).not.toContain('UNIQUE (match_event_id, group_number)');
    expect(defs.find((def) => def.includes("'ADMIN_OVERRIDE'"))).toBeDefined();

    // Rating events, notification links and audit rows still key on the retained composites.
    const dependents = await sqlRows(
      "select conrelid::regclass::text as t from pg_constraint where confrelid = 'public.match_event_result_confirmations'::regclass and contype = 'f' order by 1"
    );
    expect(dependents.map((row) => row['t'])).toEqual(
      expect.arrayContaining([
        'player_rating_events',
        'notification_result_links',
        'match_event_audit_log',
        'result_amendment_requests',
        'match_event_result_official_state'
      ])
    );
  });

  it('writes the official pointer atomically with the first confirmation and backfills every existing one', async () => {
    const group = await f.confirmedGroup();
    expect(await f.officialState(group.proposalId)).toMatchObject({
      match_event_id: group.eventId,
      group_number: 1,
      current_confirmation_id: group.confirmationId,
      current_version: 1,
      official_revision: 1,
      is_void: false,
      void_decision_id: null
    });
    const orphan = await sqlRows(
      'select count(*)::int as n from public.match_event_result_confirmations c where not exists (select 1 from public.match_event_result_official_state s where s.proposal_id = c.proposal_id)'
    );
    expect(orphan).toEqual([{ n: 0 }]);
    const canonical = await sqlRows(
      "select id::text as id from public.match_event_official_confirmations() where proposal_id = '" +
        group.proposalId +
        "'"
    );
    expect(canonical).toEqual([{ id: group.confirmationId }]);
    const pointer = await sqlRows(
      "select tgdeferrable, tginitdeferred from pg_trigger where tgname = 'match_result_confirmation_official_pointer'"
    );
    expect(pointer).toEqual([{ tgdeferrable: true, tginitdeferred: true }]);
  });

  it('keeps pointer shape and revision rules in the database', async () => {
    const group = await f.confirmedGroup();
    const update = (set: string) =>
      fixtureSql(
        'update public.match_event_result_official_state set ' +
          set +
          " where proposal_id = '" +
          group.proposalId +
          "'"
      );
    await expect(update('official_revision = 3')).rejects.toThrow(/advance by exactly one/);
    await expect(update('is_void = true, official_revision = 2')).rejects.toThrow(
      /official_state_pointer_shape/
    );
    await expect(
      update('current_confirmation_id = null, current_version = null, official_revision = 2')
    ).rejects.toThrow(/official_state_pointer_shape/);
    await expect(
      update('match_event_id = gen_random_uuid(), official_revision = 2')
    ).rejects.toThrow(/identity is immutable/);
    expect(await f.officialState(group.proposalId)).toMatchObject({ official_revision: 1 });
  });

  it('protects amendment evidence: insert-only candidates and events, no deletes, guarded lifecycle', async () => {
    const group = await f.confirmedGroup();
    const { amendmentId, version } = await f.openCandidate(group, f.admin);
    const key = "proposal_id = '" + group.proposalId + "' and version = " + version;
    await expect(
      fixtureSql('update public.result_amendment_candidates set created_at = now() where ' + key)
    ).rejects.toThrow(/insert-only/);
    await expect(
      fixtureSql('delete from public.result_amendment_candidates where ' + key)
    ).rejects.toThrow(/insert-only/);
    await expect(
      fixtureSql(
        "update public.result_amendment_events set data = '{}' where amendment_id = '" +
          amendmentId +
          "'"
      )
    ).rejects.toThrow(/insert-only/);
    await expect(
      fixtureSql(
        "delete from public.result_amendment_events where amendment_id = '" + amendmentId + "'"
      )
    ).rejects.toThrow(/insert-only/);
    await expect(
      fixtureSql("delete from public.result_amendment_requests where id = '" + amendmentId + "'")
    ).rejects.toThrow(/never deleted/);
    const request = (set: string) =>
      fixtureSql(
        'update public.result_amendment_requests set ' + set + " where id = '" + amendmentId + "'"
      );
    await expect(request("reason = 'rewritten'")).rejects.toThrow(/identity is immutable/);
    await expect(
      request(
        "lifecycle = 'applied', closed_at = now(), decision_source = 'MANUAL', decided_at = now(), decision_actor_id = '" +
          f.p0.id +
          "'"
      )
    ).rejects.toThrow(/Invalid result amendment lifecycle transition/);
    await expect(request('candidate_version = 1')).rejects.toThrow(/candidates only advance/);
    await expect(request("lifecycle = 'canceled'")).rejects.toThrow(
      /result_amendment_closed_check/
    );
    // Prior proposal versions stay immutable.
    await expect(
      fixtureSql(
        "update public.match_event_result_proposal_versions set court_label = 'X' where proposal_id = '" +
          group.proposalId +
          "' and version = 1"
      )
    ).rejects.toThrow(/immutable/);
  });

  it('enforces the request shape: candidate after base, reason bounds, one live amendment', async () => {
    const group = await f.confirmedGroup();
    const requested = await f.request(f.p0, group);
    expect(requested.error).toBeNull();
    const defs = (await constraintDefs('result_amendment_requests')).map((row) =>
      String(row['def'])
    );
    expect(defs.some((def) => def.includes('candidate_version > base_version'))).toBe(true);
    const indexes = await sqlRows(
      "select indexdef from pg_indexes where indexname = 'result_amendment_one_live_per_group'"
    );
    expect(String(indexes[0]?.['indexdef'])).toContain('UNIQUE');
    await expect(
      fixtureSql(
        "insert into public.result_amendment_requests(match_event_id, proposal_id, group_number, base_confirmation_id, base_version, requester_id, reason, command_id, fingerprint) values ('" +
          group.eventId +
          "', '" +
          group.proposalId +
          "', 1, '" +
          group.confirmationId +
          "', 1, '" +
          f.p1.id +
          "', 'second live', gen_random_uuid(), 'x')"
      )
    ).rejects.toThrow(/result_amendment_one_live_per_group/);
    await expect(
      fixtureSql(
        "insert into public.result_amendment_requests(match_event_id, proposal_id, group_number, base_confirmation_id, base_version, requester_id, reason, command_id, fingerprint, lifecycle, closed_at) values ('" +
          group.eventId +
          "', '" +
          group.proposalId +
          "', 1, '" +
          group.confirmationId +
          "', 1, '" +
          f.p1.id +
          "', '', gen_random_uuid(), 'x', 'canceled', now())"
      )
    ).rejects.toThrow(/result_amendment_reason_check/);
    // A request cannot point at another group's confirmation.
    const other = await f.confirmedGroup();
    await expect(
      fixtureSql(
        "insert into public.result_amendment_requests(match_event_id, proposal_id, group_number, base_confirmation_id, base_version, requester_id, reason, command_id, fingerprint, lifecycle, closed_at) values ('" +
          group.eventId +
          "', '" +
          group.proposalId +
          "', 1, '" +
          other.confirmationId +
          "', 1, '" +
          f.p1.id +
          "', 'cross group', gen_random_uuid(), 'x', 'canceled', now())"
      )
    ).rejects.toThrow(/result_amendment_base_fk/);
  });

  it('keeps the audit vocabulary and the automatic-acceptance actor shape in the database', async () => {
    const audit = (await constraintDefs('match_event_audit_log')).map((row) => String(row['def']));
    expect(
      audit.find((def) => def.includes('result_amendment_accepted') && def.includes('AUTO_48H'))
    ).toBeDefined();
    const group = await f.confirmedGroup();
    await expect(
      fixtureSql(
        "insert into public.match_event_audit_log(match_event_id, community_id, actor_id, action, transition_revision) select e.id, e.community_id, null, 'result_amendment_requested', 1 from public.match_events e where e.id = '" +
          group.eventId +
          "'"
      )
    ).rejects.toThrow(/match_event_audit_log_actor_result_check/);
  });
});
