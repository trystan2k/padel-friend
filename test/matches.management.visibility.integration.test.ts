import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';

describe('match management visibility integration', () => {
  let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchManagementFixtures(env);
  });
  afterAll(async () => {
    if (f) await f.cleanup();
  });
  it('resolves all departure kinds through both notification allowlists without leaking reasons', async () => {
    const player = await f.member();
    const event = await f.event({ accepted: [player] });
    for (const kind of [
      'match_registration_withdrawn',
      'match_registration_removed',
      'match_registration_group_changed'
    ]) {
      const rows = await sqlRows(
        `select public.persist_notification('${player.id}','test.${kind}:${event.id}','${kind}','matches','match_event','${event.id}','${f.communityId}')::text id`
      );
      const notificationId = String(rows[0]?.id);
      const target = await f.rpc(player, 'get_my_notification_target_v2', {
        p_notification_id: notificationId
      });
      expect(target.error).toBeNull();
      expect(target.data).toEqual([expect.objectContaining({ target_status: 'match_available' })]);
      const contexts = await f.rpc(player, 'get_my_match_notification_contexts', {
        p_notification_ids: [notificationId]
      });
      expect(contexts.error).toBeNull();
      expect(contexts.data).toEqual([expect.objectContaining({ match_event_id: event.id })]);
      expect(JSON.stringify(contexts.data)).not.toContain('removal_reason');
    }
  });
  it('exposes targets only to creator and removal reason only to own state or audit managers', async () => {
    const player = await f.member();
    const reader = await f.member();
    const event = await f.event({ accepted: [player, reader] });
    const creatorList = await f.rpc(f.creator, 'list_match_event_management_participants', {
      p_match_event_id: event.id
    });
    expect(creatorList.error).toBeNull();
    expect(creatorList.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user_id: player.id,
          attempt_id: expect.any(String),
          registration_id: expect.any(String)
        })
      ])
    );
    expect(
      (
        await f.rpc(player, 'list_match_event_management_participants', {
          p_match_event_id: event.id
        })
      ).data
    ).toEqual([]);
    const removed = await f.rpc(f.creator, 'remove_match_registration', {
      p_match_event_id: event.id,
      p_target_user_id: player.id,
      p_attempt_id: await f.latestAttemptId(event.id, player.id),
      p_reason: 'Private scheduling reason',
      p_request_id: crypto.randomUUID()
    });
    expect(removed.error).toBeNull();
    const own = await f.rpc(player, 'get_my_match_registration', { p_match_event_id: event.id });
    expect(own.data).toMatchObject({
      lifecycle: 'removed_by_creator',
      removal_reason: 'Private scheduling reason'
    });
    const publicRoster = await f.rpc(reader, 'list_match_event_registrations', {
      p_match_event_id: event.id
    });
    expect(publicRoster.error).toBeNull();
    expect(Array.isArray(publicRoster.data)).toBe(true);
    if (!Array.isArray(publicRoster.data)) throw new Error('Expected roster array');
    for (const row of publicRoster.data) {
      expect(row).not.toHaveProperty('user_id');
      expect(row).not.toHaveProperty('attempt_id');
      expect(row).not.toHaveProperty('removal_reason');
    }
    expect(
      (await f.rpc(player, 'list_match_event_audit', { p_match_event_id: event.id })).error?.code
    ).toBe('42501');
    expect((await player.client.from('match_event_audit_log').select('*')).data).toEqual([]);
    const audit = await f.rpc(f.creator, 'list_match_event_audit', { p_match_event_id: event.id });
    expect(audit.data).toEqual([
      expect.objectContaining({ action: 'remove', reason: 'Private scheduling reason' })
    ]);
    expect(
      (await player.client.from('match_event_management_commands').select('*')).error
    ).not.toBeNull();
    expect(
      (
        await player.client.from('match_event_audit_log').insert({
          match_event_id: event.id,
          community_id: f.communityId,
          action: 'withdraw',
          transition_revision: 1
        })
      ).error
    ).not.toBeNull();
  });
  it('authorizes same-community admin audit but not target list and enforces cursor pairs and cap', async () => {
    const admin = await f.actor();
    const outsider = await f.actor();
    await fixtureSql(
      `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values('${f.communityId}','${admin.id}','admin','active',now()-interval '1 minute',now()-interval '1 minute');`
    );
    const event = await f.event();
    await fixtureSql(`insert into public.match_event_audit_log(match_event_id,community_id,actor_id,action,transition_revision,occurred_at)
      select '${event.id}','${f.communityId}','${f.creator.id}','withdraw',n,'2026-10-01T00:00:00Z' from generate_series(1,55)n;`);
    const page = await f.rpc(admin, 'list_match_event_audit', {
      p_match_event_id: event.id,
      p_limit: 100
    });
    expect(page.error).toBeNull();
    expect(page.data).toHaveLength(50);
    if (!Array.isArray(page.data)) throw new Error('Expected audit array');
    const last = asRecord(page.data.at(-1));
    const next = await f.rpc(admin, 'list_match_event_audit', {
      p_match_event_id: event.id,
      p_before_at: last.occurred_at,
      p_before_id: last.id,
      p_limit: 50
    });
    expect(next.data).toHaveLength(5);
    expect(
      (
        await f.rpc(admin, 'list_match_event_management_participants', {
          p_match_event_id: event.id
        })
      ).data
    ).toEqual([]);
    expect(
      (await f.rpc(outsider, 'list_match_event_audit', { p_match_event_id: event.id })).error?.code
    ).toBe('42501');
    expect(
      (
        await f.rpc(admin, 'list_match_event_audit', {
          p_match_event_id: event.id,
          p_before_at: last.occurred_at
        })
      ).error?.code
    ).toBe('22023');
    expect(
      (
        await sqlRows(
          `select count(*)::int n from public.match_event_audit_log where match_event_id='${event.id}'`
        )
      )[0]?.n
    ).toBe(55);
  });
});
