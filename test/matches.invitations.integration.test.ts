import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import {
  createMatchManagementFixtures,
  type ManagementActor
} from './helpers/match-management-fixtures';
import {
  asRecord,
  fixtureSql,
  proveEventLockBarrier,
  sqlRows
} from './helpers/match-registration-sql';

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('match invitations integration', () => {
  let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  let invitee: ManagementActor;
  let members: ManagementActor[];
  beforeAll(async () => {
    if (!environment.env) throw new Error('LOCAL_SUPABASE_REQUIRED');
    f = await createMatchManagementFixtures(environment.env);
    invitee = await f.member();
    members = [];
    for (let i = 0; i < 5; i++) members.push(await f.member());
  });
  afterAll(async () => {
    if (f) await f.cleanup();
  });
  const respond = (event: { id: string; invites: Map<string, string> }, response = 'accept') =>
    f.rpc(invitee, 'respond_match_event_invitation', {
      p_match_event_id: event.id,
      p_invitation_id: event.invites.get(invitee.id),
      p_response: response
    });
  const state = async (id: string) =>
    (
      await sqlRows(`select next_accepted_ordinal::int, transition_revision::int,
    (select count(*)::int from public.match_event_registration_attempts where match_event_id='${id}') attempts
    from public.match_event_registration_state where match_event_id='${id}'`)
    )[0];
  const alerts = (id: string, kind: string) =>
    sqlRows(
      `select recipient_user_id::text, event_key, id::text from public.notifications where target_id='${id}' and kind='${kind}' order by recipient_user_id`
    );

  it('pending invitation consumes no capacity or accepted ordinal', async () => {
    const e = await f.event({ accepted: members, capacity: 6, invites: [invitee] });
    expect(await state(e.id)).toMatchObject({ next_accepted_ordinal: 7, attempts: 5 });
    const rows = await sqlRows(
      `select count(*)::int accepted from public.match_event_registrations where match_event_id='${e.id}' and lifecycle='accepted'`
    );
    expect(rows[0]?.accepted).toBe(6);
  });
  it('six accepted players plus invited acceptance yields seventh Reserve', async () => {
    const e = await f.event({ accepted: members, invites: [invitee] });
    const r = await respond(e);
    expect(r.error).toBeNull();
    expect(asRecord(r.data)).toMatchObject({
      status: 'accepted',
      replayed: false,
      registration: { lifecycle: 'accepted', accepted_order: 7, participation: 'reserve' }
    });
    expect(await alerts(e.id, 'match_invitation_accepted')).toHaveLength(1);
  });
  it('full capacity leaves invitation pending without ordinal or attempt', async () => {
    const e = await f.event({ accepted: members, capacity: 6, invites: [invitee] });
    const before = await state(e.id);
    expect((await respond(e)).error?.message).toBe('MATCH_REGISTRATION_FULL');
    expect(await state(e.id)).toEqual(before);
    expect(
      (
        await sqlRows(
          `select status from public.match_event_invites where match_event_id='${e.id}'`
        )
      )[0]?.status
    ).toBe('pending');
  });
  it('out-of-range acceptance creates ordinary pending request', async () => {
    const e = await f.event({ restricted: true, invites: [invitee] });
    const r = await respond(e);
    expect(r.error).toBeNull();
    expect(r.data).toMatchObject({
      status: 'accepted',
      registration: { lifecycle: 'pending', accepted_order: null }
    });
    expect(await state(e.id)).toMatchObject({ next_accepted_ordinal: 2, attempts: 1 });
  });
  it('replays original pending submission snapshot even after organizer approval', async () => {
    const e = await f.event({ restricted: true, invites: [invitee] });
    const first = await respond(e);
    expect(first.data).toMatchObject({
      status: 'accepted',
      registration: { lifecycle: 'pending' }
    });
    const attemptId = await f.latestAttemptId(e.id, invitee.id);
    expect(attemptId).not.toBeNull();
    expect(
      (
        await f.rpc(f.creator, 'decide_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: attemptId,
          p_decision: 'approve'
        })
      ).error
    ).toBeNull();
    expect((await respond(e)).data).toEqual({ ...asRecord(first.data), replayed: true });
    expect(await state(e.id)).toMatchObject({ next_accepted_ordinal: 3, attempts: 1 });
  });
  it('private outsider invite cannot bypass membership', async () => {
    const outsider = await f.actor();
    const e = await f.event({ invites: [outsider] });
    await fixtureSql(
      `update public.communities set visibility='private' where id='${f.communityId}'`
    );
    try {
      const r = await f.rpc(outsider, 'respond_match_event_invitation', {
        p_match_event_id: e.id,
        p_invitation_id: e.invites.get(outsider.id),
        p_response: 'accept'
      });
      expect(r.error?.message).toBe('MATCH_REGISTRATION_DENIED');
      expect(
        (
          await sqlRows(
            `select status from public.match_event_invites where match_event_id='${e.id}'`
          )
        )[0]?.status
      ).toBe('pending');
    } finally {
      await fixtureSql(
        `update public.communities set visibility='public' where id='${f.communityId}'`
      );
    }
  });
  it('decline persists once and notifies creator once', async () => {
    const e = await f.event({ invites: [invitee] });
    expect((await respond(e, 'decline')).data).toMatchObject({
      status: 'declined',
      replayed: false
    });
    expect((await respond(e, 'decline')).data).toMatchObject({
      status: 'declined',
      replayed: true
    });
    const rows = await alerts(e.id, 'match_invitation_declined');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      recipient_user_id: f.creator.id,
      event_key: `match.invitation_declined:${e.invites.get(invitee.id)}`
    });
  });
  it('expiry persists once and notifies creator and invitee once', async () => {
    const e = await f.event({ invites: [invitee] });
    await f.setCutoff(e.id, "clock_timestamp()-interval '1 second'");
    await fixtureSql(
      `do $$ begin perform public.process_match_event_registration_cutoff('${e.id}'); perform public.process_match_event_registration_cutoff('${e.id}'); end $$;`
    );
    const rows = await alerts(e.id, 'match_invitation_expired');
    expect(rows.map((r) => String(r.recipient_user_id)).sort((a, b) => a.localeCompare(b))).toEqual(
      [f.creator.id, invitee.id].sort((a, b) => a.localeCompare(b))
    );
    expect((await respond(e)).data).toMatchObject({ status: 'expired', registration: null });
    expect(await alerts(e.id, 'match_invitation_expired')).toHaveLength(2);
  });
  it('double accept versus decline has one winner', async () => {
    for (let i = 0; i < 3; i++) {
      const e = await f.event({ invites: [invitee] });
      const results = await proveEventLockBarrier({
        communityId: f.communityId,
        eventId: e.id,
        rpcToken: 'respond_match_event_invitation',
        fire: () => [respond(e), respond(e, 'decline')]
      });
      expect(results.filter((r) => r.error === null)).toHaveLength(1);
      expect(results.find((r) => r.error)?.error?.message).toBe(
        'MATCH_INVITATION_ALREADY_RESOLVED'
      );
      const rows = await sqlRows(
        `select count(*)::int n from public.notifications where target_id='${e.id}' and kind in ('match_invitation_accepted','match_invitation_declined')`
      );
      expect(rows[0]?.n).toBe(1);
    }
  });
  it('accept waiting across cutoff returns expired without registration', async () => {
    const e = await f.event({ invites: [invitee] });
    await f.setCutoff(e.id, "clock_timestamp()+interval '4 seconds'");
    // Community lock is retained beyond cutoff; contender is proven waiting
    // before release using the shared PostgreSQL lock-chain barrier.
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'respond_match_event_invitation',
      releaseAtCutoff: true,
      fire: () => [respond(e), respond(e)]
    });
    expect(results.every((r) => asRecord(r.data).status === 'expired')).toBe(true);
    expect(await state(e.id)).toMatchObject({ next_accepted_ordinal: 2, attempts: 0 });
  });
  it('scheduler downtime still makes invitation effectively expired', async () => {
    const e = await f.event({ invites: [invitee] });
    // Keep the due cutoff uncommitted until after GET assertions. Live cron
    // cannot observe it, deterministically modeling scheduler downtime without
    // disabling the job or exposing a production clock override.
    await expect(
      fixtureSql(`do $$ declare result jsonb; begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set registration_cutoff_at=clock_timestamp()-interval '1 second' where id='${e.id}';
      perform set_config('request.jwt.claim.sub','${invitee.id}',true);
      result := public.get_my_match_invitation('${e.id}');
       if result->>'status' is distinct from 'pending' or result->>'effective_status' is distinct from 'expired' then raise exception 'Effective expiry missing'; end if;
      if exists(select 1 from public.match_event_invites where match_event_id='${e.id}' and status <> 'pending') then raise exception 'GET mutated invitation'; end if;
      if exists(select 1 from public.notifications where target_id='${e.id}' and kind='match_invitation_expired') then raise exception 'GET notified'; end if;
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`)
    ).resolves.toBeUndefined();
  });
  it('two cutoff processors emit one expiry set', async () => {
    const e = await f.event({ invites: [invitee] });
    // Queue both processors before due so the live cron cannot get ahead of
    // them on the shared community lock. Release only at the DB deadline.
    await f.setCutoff(e.id, "clock_timestamp()+interval '4 seconds'");
    const run = async () => ({
      data: (
        await sqlRows(`select public.process_match_event_registration_cutoff('${e.id}') result`)
      )[0]?.result,
      error: null
    });
    const pending: Promise<unknown>[] = [];
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'process_match_event_registration_cutoff',
      releaseAtCutoff: true,
      fire: () => {
        const pair: [ReturnType<typeof run>, ReturnType<typeof run>] = [run(), run()];
        pending.push(...pair);
        return pair;
      }
    }).catch(async (error: unknown) => {
      throw new Error(
        `${String(error)}; contenders: ${JSON.stringify(await Promise.allSettled(pending))}`
      );
    });
    expect(results.filter((r) => asRecord(r.data).processed === true)).toHaveLength(1);
    expect(await alerts(e.id, 'match_invitation_expired')).toHaveLength(2);
  });
  it('crafted noninvitee submit is denied for invite-only event', async () => {
    const e = await f.event({ inviteOnly: true });
    expect(
      (await f.rpc(invitee, 'submit_match_registration', { p_match_event_id: e.id })).error?.message
    ).toBe('MATCH_REGISTRATION_INVITE_ONLY');
  });
  it('accepted invitation replay does not register twice', async () => {
    const e = await f.event({ invites: [invitee], inviteOnly: true });
    const first = await respond(e);
    const before = await state(e.id);
    const second = await respond(e);
    expect(second.data).toEqual({ ...asRecord(first.data), replayed: true });
    expect(await state(e.id)).toEqual(before);
    expect((await respond(e, 'decline')).error?.message).toBe('MATCH_INVITATION_ALREADY_RESOLVED');
  });
  it('ordinary join accepts pending invite and every invitation kind resolves both notification readers', async () => {
    const e = await f.event({ invites: [invitee] });
    expect(
      (await f.rpc(invitee, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    expect((await respond(e)).data).toMatchObject({ status: 'accepted', replayed: true });
    for (const kind of [
      'match_invitation_accepted',
      'match_invitation_declined',
      'match_invitation_expired'
    ]) {
      const rows = await sqlRows(
        `select id::text from public.notifications where recipient_user_id='${f.creator.id}' and kind='${kind}' and community_id='${f.communityId}' limit 1`
      );
      expect(rows).toHaveLength(1);
      const id = rows[0]!.id;
      expect(
        (await f.rpc(f.creator, 'get_my_notification_target_v2', { p_notification_id: id })).data
      ).toMatchObject([{ target_status: 'match_available' }]);
      expect(
        (await f.rpc(f.creator, 'get_my_match_notification_contexts', { p_notification_ids: [id] }))
          .data
      ).toMatchObject([{ notification_id: id }]);
    }
  });
  it('keeps own invitations private and exposes creator-only status projection', async () => {
    const e = await f.event({ invites: [invitee] });
    expect(
      (await f.rpc(members[0]!, 'get_my_match_invitation', { p_match_event_id: e.id })).data
    ).toBeNull();
    expect(
      (await f.rpc(members[0]!, 'list_match_event_invitations', { p_match_event_id: e.id })).data
    ).toEqual([]);
    expect(
      (await f.rpc(f.creator, 'list_match_event_invitations', { p_match_event_id: e.id })).data
    ).toMatchObject([{ invitation_id: e.invites.get(invitee.id), status: 'pending' }]);
    expect(
      (
        await f.rpc(f.creator, 'respond_match_event_invitation', {
          p_match_event_id: e.id,
          p_invitation_id: e.invites.get(invitee.id),
          p_response: 'accept'
        })
      ).error?.message
    ).toBe('MATCH_INVITATION_NOT_FOUND');
    const rows = await sqlRows(`select
      has_function_privilege('authenticated','public.submit_match_registration_locked(uuid,uuid)','execute') entry,
      has_function_privilege('authenticated','public.expire_match_event_invitations_locked(uuid,timestamptz)','execute') expiry,
      has_function_privilege('anon','public.respond_match_event_invitation(uuid,uuid,text)','execute') anonymous,
      has_table_privilege('authenticated','public.match_event_invites','update') raw_update`);
    expect(rows[0]).toEqual({ entry: false, expiry: false, anonymous: false, raw_update: false });
    const roster = await f.rpc(invitee, 'list_match_event_registrations', {
      p_match_event_id: e.id
    });
    expect(roster.error).toBeNull();
    expect(Array.isArray(roster.data)).toBe(true);
    for (const row of Array.isArray(roster.data) ? roster.data : []) {
      for (const key of ['user_id', 'registration_id', 'attempt_id', 'invitee_user_id'])
        expect(row).not.toHaveProperty(key);
    }
  });
  it('rejects invalid resolution shape and terminal or identity rewrites', async () => {
    const e = await f.event({ invites: [invitee] });
    const invitationId = e.invites.get(invitee.id);
    await fixtureSql(`do $$ begin
      begin update public.match_event_invites set status='declined',responded_at=now() where id='${invitationId}';
        raise exception 'Null responder was permitted'; exception when check_violation then null; end;
      begin update public.match_event_invites set invited_by='${invitee.id}' where id='${invitationId}';
        raise exception 'Identity rewrite was permitted'; exception when check_violation then null; end;
    end $$;`);
    expect((await respond(e, 'decline')).error).toBeNull();
    await fixtureSql(`do $$ begin
      begin update public.match_event_invites set status='pending',responded_at=null,responded_by=null where id='${invitationId}';
        raise exception 'Terminal rewrite was permitted'; exception when check_violation then null; end;
    end $$;`);
  });
  it('notification failure rolls back invitation acceptance and ordinary registration', async () => {
    const e = await f.event({ invites: [invitee] });
    const before = await state(e.id);
    const name = `invitation_failure_${e.id.replaceAll('-', '')}`;
    await fixtureSql(`do $$ begin
      execute 'create function public.${name}() returns trigger language plpgsql as $body$ begin if new.target_id = ''${e.id}''::uuid and new.kind = ''match_invitation_accepted'' then raise exception ''injected invitation notification failure''; end if; return new; end $body$';
      execute 'create trigger ${name} before insert on public.notifications for each row execute function public.${name}()';
    end $$;`);
    try {
      expect((await respond(e)).error?.message).toContain(
        'injected invitation notification failure'
      );
      expect(await state(e.id)).toEqual(before);
      expect(
        (
          await sqlRows(
            `select status from public.match_event_invites where match_event_id='${e.id}'`
          )
        )[0]?.status
      ).toBe('pending');
      expect(await alerts(e.id, 'match_registration_reserve')).toHaveLength(0);
    } finally {
      await fixtureSql(
        `do $$ begin execute 'drop trigger ${name} on public.notifications'; execute 'drop function public.${name}()'; end $$;`
      );
    }
  });
});
