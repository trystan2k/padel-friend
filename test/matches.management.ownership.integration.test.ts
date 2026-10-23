import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';

describe('match ownership integration', () => {
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
  it('keeps event DML and internal guards private; anonymous transfer and cancellation remain denied', async () => {
    expect(
      await sqlRows(`select
      has_table_privilege('authenticated','public.match_events','UPDATE') as raw_update,
      has_function_privilege('anon','public.transfer_match_event_ownership(uuid,uuid,bigint,uuid)','EXECUTE') as anon_transfer,
      has_function_privilege('anon','public.cancel_match_event(uuid,text,bigint,uuid)','EXECUTE') as anon_cancel,
      has_function_privilege('authenticated','public.assert_match_event_active_locked(uuid)','EXECUTE') as browser_guard,
      has_function_privilege('authenticated','public.get_match_event_management(uuid)','EXECUTE') as authenticated_read`)
    ).toEqual([
      {
        raw_update: false,
        anon_transfer: false,
        anon_cancel: false,
        browser_guard: false,
        authenticated_read: true
      }
    ]);
  });
  it('rejects transfer to Reserve Not Playing after cutoff', async () => {
    const target = await f.member();
    const e = await f.event({ accepted: [target] });
    await f.setCutoff(e.id, "clock_timestamp()-interval '1 minute'");
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: target.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_CLOSED');
  });
  it('returns management not-found for missing transfer/cancel events', async () => {
    const command = {
      p_match_event_id: crypto.randomUUID(),
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    };
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          ...command,
          p_target_user_id: f.creator.id
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_NOT_FOUND');
    expect(
      (await f.rpc(f.creator, 'cancel_match_event', { ...command, p_reason: 'Weather' })).error
        ?.message
    ).toBe('MATCH_MANAGEMENT_NOT_FOUND');
  });
  it('creator leaves roster but retains management ownership', async () => {
    const e = await f.event();
    expect(
      (
        await f.rpc(f.creator, 'withdraw_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: await f.latestAttemptId(e.id, f.creator.id),
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      (await f.rpc(f.creator, 'get_match_event_management', { p_match_event_id: e.id })).data
    ).toMatchObject({
      is_organizer: true,
      is_participant: false,
      owner_id: f.creator.id,
      version: 1
    });
  });
  it('transfer to accepted Reserve preserves every ordinal, publisher and photo; former creator loses controls', async () => {
    const target = await f.member();
    const e = await f.event({ accepted: [target] });
    const before = await sqlRows(
      `select user_id,accepted_order from public.match_event_registrations where match_event_id='${e.id}' order by accepted_order`
    );
    const photo = await sqlRows(`select photo_path from public.match_events where id='${e.id}'`);
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: target.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      await sqlRows(
        `select user_id,accepted_order from public.match_event_registrations where match_event_id='${e.id}' order by accepted_order`
      )
    ).toEqual(before);
    expect(
      await sqlRows(
        `select created_by,published_by,photo_path,version from public.match_events where id='${e.id}'`
      )
    ).toEqual([
      {
        created_by: target.id,
        published_by: f.creator.id,
        photo_path: photo[0]?.photo_path,
        version: 2
      }
    ]);
    expect(
      (await f.rpc(f.creator, 'get_match_event_management', { p_match_event_id: e.id })).data
    ).toMatchObject({
      is_organizer: false,
      actions: { remove: { allowed: false }, transfer: { allowed: false } }
    });
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: target.id,
          p_expected_version: 2,
          p_request_id: crypto.randomUUID()
        })
      ).error?.code
    ).toBe('42501');
    expect(
      (
        await f.rpc(f.creator, 'remove_match_registration', {
          p_match_event_id: e.id,
          p_target_user_id: target.id,
          p_attempt_id: await f.latestAttemptId(e.id, target.id),
          p_reason: 'No longer organizer',
          p_request_id: crypto.randomUUID()
        })
      ).error?.code
    ).toBe('42501');
    expect(
      await sqlRows(
        `select before_data,after_data from public.match_event_audit_log where match_event_id='${e.id}'`
      )
    ).toEqual([{ before_data: { owner_id: f.creator.id }, after_data: { owner_id: target.id } }]);
    expect(
      await sqlRows(
        `select recipient_user_id from public.notifications where target_id='${e.id}' and kind='match_event_ownership_transferred' order by recipient_user_id`
      )
    ).toEqual([f.creator.id, target.id].sort().map((recipient_user_id) => ({ recipient_user_id })));
  });
  it('pending departed and other-event targets are rejected; stale version returns only current version', async () => {
    const target = await f.member();
    const e = await f.event();
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: target.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED');
    const conflict = await f.creator.client.rpc('transfer_match_event_ownership', {
      p_match_event_id: e.id,
      p_target_user_id: target.id,
      p_expected_version: 2,
      p_request_id: crypto.randomUUID()
    });
    expect(conflict.error?.message).toBe('MATCH_MANAGEMENT_VERSION_CONFLICT');
    expect(JSON.parse(conflict.error?.details ?? '{}')).toEqual({ current_version: 1 });
    const pending = await f.actor();
    await f.rpc(pending, 'submit_match_registration', { p_match_event_id: e.id });
    const departed = await f.member();
    await f.rpc(departed, 'submit_match_registration', { p_match_event_id: e.id });
    await f.rpc(departed, 'withdraw_match_registration', {
      p_match_event_id: e.id,
      p_attempt_id: await f.latestAttemptId(e.id, departed.id),
      p_request_id: crypto.randomUUID()
    });
    await f.event({ accepted: [target] });
    for (const actor of [pending, departed, target])
      expect(
        (
          await f.rpc(f.creator, 'transfer_match_event_ownership', {
            p_match_event_id: e.id,
            p_target_user_id: actor.id,
            p_expected_version: 1,
            p_request_id: crypto.randomUUID()
          })
        ).error?.message
      ).toBe('MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED');
  });
  it('publish replay after transfer cannot recreate organizer registration or rewrite original photo owner', async () => {
    const target = await f.member();
    const id = crypto.randomUUID();
    f.events.push(id);
    const photo = matchPhotoFixture(f.communityId, id, f.creator.id);
    await fixtureSql(`do $$ begin ${photo.sql} end $$;`);
    const input = {
      community_id: f.communityId,
      date: '2099-12-01',
      start_time: '18:00',
      event_type: 'friendly',
      visibility: 'community_open',
      team_assignment_mode: 'POST_MATCH_TEAMS',
      venue_name: 'Replay court',
      maps_url: 'https://maps.google.com/maps/place/replay',
      photo_path: photo.path
    };
    const publish = { p_event_id: id, p_input: input, p_invitee_ids: [] };
    expect((await f.rpc(f.creator, 'publish_match_event', publish)).error).toBeNull();
    await f.rpc(target, 'submit_match_registration', { p_match_event_id: id });
    expect(
      (
        await f.rpc(f.creator, 'withdraw_match_registration', {
          p_match_event_id: id,
          p_attempt_id: await f.latestAttemptId(id, f.creator.id),
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      (
        await f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: id,
          p_target_user_id: target.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    const before = await sqlRows(
      `select user_id,lifecycle,accepted_order from public.match_event_registrations where match_event_id='${id}' order by accepted_order`
    );
    expect((await f.rpc(f.creator, 'publish_match_event', publish)).data).toBe(id);
    expect((await f.rpc(target, 'publish_match_event', publish)).error?.code).toBe('42501');
    expect(
      await sqlRows(
        `select user_id,lifecycle,accepted_order from public.match_event_registrations where match_event_id='${id}' order by accepted_order`
      )
    ).toEqual(before);
    expect(
      await sqlRows(
        `select owner_id from storage.objects where bucket_id='match-event-photos' and name='${photo.path}'`
      )
    ).toEqual([{ owner_id: f.creator.id }]);
  });
});
