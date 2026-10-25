import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMatchManagementFixtures,
  type ManagementActor
} from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import {
  fixtureSql,
  sqlRows,
  proveEventLockBarrier,
  asRecord
} from './helpers/match-registration-sql';

describe('match participant reconfirmation integration', () => {
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
  const edit = (
    id: string,
    patch: Record<string, unknown> = { event_type: 'competitive' },
    version = 1
  ) =>
    f.rpc(f.creator, 'edit_match_event', {
      p_match_event_id: id,
      p_patch: patch,
      p_expected_version: version,
      p_request_id: crypto.randomUUID()
    });
  const confirm = async (
    id: string,
    actor: ManagementActor,
    generation = 1,
    attempt?: string,
    request = crypto.randomUUID()
  ) =>
    f.rpc(actor, 'reconfirm_match_registration', {
      p_match_event_id: id,
      p_attempt_id: attempt ?? (await f.latestAttemptId(id, actor.id)),
      p_generation: generation,
      p_request_id: request
    });
  const rows = (id: string) =>
    sqlRows(
      `select user_id,lifecycle,participation_status,accepted_order,accepted_at,current_attempt_id,required_generation,confirmed_generation,reconfirmed_at from public.match_event_registrations where match_event_id='${id}' order by accepted_order`
    );
  const counts = (id: string) => sqlRows(`select * from public.match_registration_counts('${id}')`);

  it('Competitive Friendly change requires every accepted player including creator to reconfirm', async () => {
    const player = await f.member();
    const pending = await f.actor();
    const invited = await f.member();
    const e = await f.event({ accepted: [player], invites: [pending, invited] });
    expect(
      (await f.rpc(pending, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    expect(await edit(e.id)).toMatchObject({
      error: null,
      data: { change_kind: 'major', reconfirmation_generation: 1, version: 2 }
    });
    expect(
      (await rows(e.id))
        .filter((r) => r.lifecycle === 'accepted')
        .every(
          (r) =>
            r.required_generation === 1 &&
            r.confirmed_generation === 0 &&
            r.participation_status === null
        )
    ).toBe(true);
    const notices = await sqlRows(
      `select recipient_user_id,kind,event_key,id from public.notifications where target_id='${e.id}' and kind in ('match_reconfirmation_required','match_event_updated') order by recipient_user_id`
    );
    expect(
      notices
        .filter((n) => n.kind === 'match_reconfirmation_required')
        .map((n) => String(n.recipient_user_id))
        .sort((a, b) => a.localeCompare(b))
    ).toEqual([f.creator.id, player.id].sort((a, b) => a.localeCompare(b)));
    expect(
      notices
        .filter((n) => n.kind === 'match_event_updated')
        .map((n) => String(n.recipient_user_id))
        .sort((a, b) => a.localeCompare(b))
    ).toEqual([pending.id, invited.id].sort((a, b) => a.localeCompare(b)));
    for (const actor of [f.creator, player]) {
      const n = notices.find((notice) => notice.recipient_user_id === actor.id)!;
      expect(n.event_key).toBe(`match.reconfirmation_required:${e.id}:1`);
      expect(
        (await f.rpc(actor, 'get_my_notification_target_v2', { p_notification_id: n.id })).data
      ).toEqual(
        expect.arrayContaining([expect.objectContaining({ target_status: 'match_available' })])
      );
      expect(
        (await f.rpc(actor, 'get_my_match_notification_contexts', { p_notification_ids: [n.id] }))
          .data
      ).toEqual(expect.arrayContaining([expect.objectContaining({ playing_count: 0 })]));
      expect(
        (await f.rpc(actor, 'get_my_match_registration', { p_match_event_id: e.id })).data
      ).toMatchObject({
        lifecycle: 'accepted',
        participation: null,
        required_generation: 1,
        confirmed_generation: 0
      });
    }
  });
  it('one-minute and one-second start changes are major and equivalent offset is not', async () => {
    const e = await f.event();
    await fixtureSql(
      `do $$ begin alter table public.match_events disable trigger match_event_immutable;update public.match_events set starts_at=date_trunc('second',starts_at) where id='${e.id}';alter table public.match_events enable trigger match_event_immutable;end $$;`
    );
    const start = String(
      (await sqlRows(`select starts_at from public.match_events where id='${e.id}'`))[0]?.starts_at
    );
    const date = new Date(start);
    const offset = date.toISOString().replace('Z', '+00:00');
    expect((await edit(e.id, { starts_at: offset })).data).toMatchObject({
      changed: false,
      change_kind: 'none',
      version: 1
    });
    date.setUTCMinutes(date.getUTCMinutes() + 1);
    expect((await edit(e.id, { starts_at: date.toISOString() })).data).toMatchObject({
      change_kind: 'major',
      reconfirmation_generation: 1
    });
    date.setUTCSeconds(date.getUTCSeconds() + 1);
    expect((await edit(e.id, { starts_at: date.toISOString() }, 2)).data).toMatchObject({
      change_kind: 'major',
      reconfirmation_generation: 2
    });
  });
  it('major edit immediately removes unreconfirmed players from Playing quartets but retains capacity and ordinals', async () => {
    const players = await Promise.all(Array.from({ length: 4 }, () => f.member()));
    const e = await f.event({ accepted: players, capacity: 5 });
    const before = await rows(e.id);
    expect((await counts(e.id))[0]).toMatchObject({
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 1
    });
    expect((await edit(e.id)).error).toBeNull();
    expect((await counts(e.id))[0]).toMatchObject({
      accepted_count: 5,
      playing_count: 0,
      reserve_count: 0,
      reconfirmation_required_count: 5
    });
    expect((await rows(e.id)).map((r) => [r.user_id, r.accepted_order, r.accepted_at])).toEqual(
      before.map((r) => [r.user_id, r.accepted_order, r.accepted_at])
    );
    const newcomer = await f.member();
    expect(
      (await f.rpc(newcomer, 'submit_match_registration', { p_match_event_id: e.id })).error
        ?.message
    ).toBe('MATCH_REGISTRATION_FULL');
    expect(
      (await f.rpc(f.creator, 'list_match_event_registrations', { p_match_event_id: e.id })).data
    ).toEqual([]);
    expect((await f.rpc(f.creator, 'get_match_event', { p_event_id: e.id })).data).toMatchObject({
      accepted_count: 5,
      playing_count: 0,
      group_count: 0,
      more_needed: 4,
      reconfirmation_required_count: 5
    });
    expect(
      await sqlRows(
        `select to_jsonb(a)=to_jsonb(b) equal from public.match_registration_counts('${e.id}') a cross join public.match_registration_counts('${e.id}',now()) b`
      )
    ).toEqual([{ equal: true }]);
    expect(
      await sqlRows(
        `select (select coalesce(jsonb_agg(q),'[]') from public.match_registration_roster('${e.id}') q)=(select coalesce(jsonb_agg(q),'[]') from public.match_registration_roster('${e.id}',now()) q) equal`
      )
    ).toEqual([{ equal: true }]);
  });
  it('reconfirm preserves original FIFO and is self-only idempotent', async () => {
    const players = await Promise.all(Array.from({ length: 3 }, () => f.member()));
    const e = await f.event({ accepted: players });
    await edit(e.id);
    const before = await rows(e.id);
    const first = players[0]!;
    const attempt = await f.latestAttemptId(e.id, first.id);
    expect((await confirm(e.id, players[1]!, 1, attempt!)).error?.message).toBe(
      'MATCH_MANAGEMENT_STALE_ATTEMPT'
    );
    const request = crypto.randomUUID();
    expect((await confirm(e.id, first, 1, attempt!, request)).error).toBeNull();
    const state = await sqlRows(
      `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
    );
    expect((await confirm(e.id, first, 1, attempt!, request)).data).toMatchObject({
      replayed: true,
      changed: false
    });
    expect((await confirm(e.id, first)).data).toMatchObject({ replayed: true, changed: false });
    expect(
      await sqlRows(
        `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
      )
    ).toEqual(state);
    for (const actor of [f.creator, ...players.slice(1)])
      expect((await confirm(e.id, actor)).error).toBeNull();
    expect((await rows(e.id)).map((r) => [r.user_id, r.accepted_order, r.accepted_at])).toEqual(
      before.map((r) => [r.user_id, r.accepted_order, r.accepted_at])
    );
    expect((await counts(e.id))[0]).toMatchObject({
      accepted_count: 4,
      playing_count: 4,
      reconfirmation_required_count: 0
    });
    expect(
      await sqlRows(
        `select count(*) n from public.match_event_audit_log where match_event_id='${e.id}' and action='reconfirm'`
      )
    ).toEqual([{ n: 4 }]);
  }, 30000);
  it('second major edit invalidates old-generation confirmation and minor price edit never resets consent', async () => {
    const e = await f.event();
    await edit(e.id);
    expect((await confirm(e.id, f.creator)).error).toBeNull();
    expect((await edit(e.id, { event_type: 'friendly' }, 2)).data).toMatchObject({
      reconfirmation_generation: 2
    });
    expect((await confirm(e.id, f.creator)).error?.message).toBe(
      'MATCH_MANAGEMENT_STALE_GENERATION'
    );
    expect((await edit(e.id, { price_minor: 100, currency: 'EUR' }, 3)).data).toMatchObject({
      change_kind: 'minor',
      reconfirmation_generation: 2
    });
    expect((await rows(e.id))[0]).toMatchObject({
      required_generation: 2,
      confirmed_generation: 1,
      participation_status: null
    });
  });
  it('new join and approved request accept current generation', async () => {
    const e = await f.event();
    await edit(e.id);
    const member = await f.member();
    const guest = await f.actor();
    expect(
      (await f.rpc(member, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    expect(
      (await f.rpc(guest, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    expect(
      (
        await f.rpc(f.creator, 'decide_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: await f.latestAttemptId(e.id, guest.id),
          p_decision: 'approve'
        })
      ).error
    ).toBeNull();
    expect(
      (await rows(e.id))
        .filter((r) => r.user_id !== f.creator.id)
        .every((r) => r.required_generation === 1 && r.confirmed_generation === 1)
    ).toBe(true);
    const attempt = await f.latestAttemptId(e.id, member.id);
    expect(
      (
        await f.rpc(member, 'withdraw_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: attempt,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      (await f.rpc(member, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    expect((await confirm(e.id, member, 1, attempt!)).error?.message).toBe(
      'MATCH_MANAGEMENT_STALE_ATTEMPT'
    );
  });
  it('unreconfirmed accepted rows expire at cutoff and complete quartets recalculate; cutoff downtime cannot show unreconfirmed as Playing', async () => {
    const players = await Promise.all(Array.from({ length: 4 }, () => f.member()));
    const e = await f.event({ accepted: players });
    await edit(e.id);
    for (const actor of players) expect((await confirm(e.id, actor)).error).toBeNull();
    await f.setCutoff(e.id, "now()-interval '1 second'");
    expect((await counts(e.id))[0]).toMatchObject({
      accepted_count: 5,
      playing_count: 4,
      reconfirmation_required_count: 1
    });
    const result = await sqlRows(
      `select public.process_match_event_registration_cutoff('${e.id}') result`
    );
    expect(result[0]?.result).toMatchObject({
      processed: true,
      reconfirmation_expired_count: 1,
      accepted_count: 4,
      playing_count: 4
    });
    expect((await rows(e.id))[0]).toMatchObject({
      lifecycle: 'expired',
      accepted_order: 1,
      participation_status: null
    });
    expect(
      await sqlRows(
        `select end_kind,outcome from public.match_event_registration_attempts where match_event_id='${e.id}' and user_id='${f.creator.id}'`
      )
    ).toEqual([{ end_kind: 'reconfirmation_expired', outcome: 'accepted' }]);
    const notices = await sqlRows(
      `select id from public.notifications where target_id='${e.id}' and kind='match_reconfirmation_expired'`
    );
    expect(notices).toHaveLength(1);
    expect(
      (await sqlRows(`select public.process_match_event_registration_cutoff('${e.id}') result`))[0]
        ?.result
    ).toMatchObject({ processed: false, reason: 'already_processed' });
    expect(
      await sqlRows(
        `select id from public.notifications where target_id='${e.id}' and kind='match_reconfirmation_expired'`
      )
    ).toEqual(notices);
    expect(
      await sqlRows(
        `select count(*) n from public.match_event_audit_log where match_event_id='${e.id}' and action='reconfirmation_excluded'`
      )
    ).toEqual([{ n: 1 }]);
  }, 60_000);
  it('late reconfirm and lock-wait crossing cutoff reject', async () => {
    const e = await f.event();
    await edit(e.id);
    await f.setCutoff(e.id, "now()-interval '1 second'");
    expect((await confirm(e.id, f.creator)).error?.message).toBe('MATCH_MANAGEMENT_CLOSED');
    const waiting = await f.event();
    await edit(waiting.id);
    const attempt = await f.latestAttemptId(waiting.id, f.creator.id);
    await f.setCutoff(waiting.id, "now()+interval '3 seconds'");
    const result = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: waiting.id,
      rpcToken: 'reconfirm_match_registration',
      releaseAtCutoff: true,
      fire: () => [
        confirm(waiting.id, f.creator, 1, attempt!),
        confirm(waiting.id, f.creator, 1, attempt!)
      ]
    });
    expect(result[0]?.error?.message).toBe('MATCH_MANAGEMENT_CLOSED');
  }, 30000);
  it('reconfirm versus cancellation or edit serializes', async () => {
    for (const action of ['cancel', 'edit']) {
      const e = await f.event();
      await edit(e.id);
      const attempt = await f.latestAttemptId(e.id, f.creator.id);
      const result = await proveEventLockBarrier({
        communityId: f.communityId,
        eventId: e.id,
        rpcToken: 'match_',
        fire: () => [
          confirm(e.id, f.creator, 1, attempt!),
          action === 'cancel'
            ? f.rpc(f.creator, 'cancel_match_event', {
                p_match_event_id: e.id,
                p_expected_version: 2,
                p_reason: 'Weather',
                p_request_id: crypto.randomUUID()
              })
            : edit(e.id, { event_type: 'friendly' }, 2)
        ]
      });
      expect(result[1]?.error).toBeNull();
      const failure = result[0]?.error?.message;
      expect(
        failure === undefined ||
          failure ===
            (action === 'cancel'
              ? 'MATCH_MANAGEMENT_CANCELLED'
              : 'MATCH_MANAGEMENT_STALE_GENERATION')
      ).toBe(true);
      expect((await rows(e.id))[0]?.participation_status).toBeNull();
    }
  }, 30000);
  it('notification failure rolls back major edit and reconfirmation entirely', async () => {
    const e = await f.event();
    await fixtureSql(
      `do $fixture$ begin create function public.paf101_fail_notice() returns trigger language plpgsql as $$ begin if new.target_id='${e.id}' and new.kind in ('match_reconfirmation_required','match_registration_reconfirmed') then raise exception 'forced consent notification failure';end if;return new;end $$;create trigger paf101_fail_notice before insert on public.notifications for each row execute function public.paf101_fail_notice();end $fixture$;`
    );
    try {
      expect((await edit(e.id)).error?.message).toBe('forced consent notification failure');
    } finally {
      await fixtureSql(
        'do $$ begin drop trigger paf101_fail_notice on public.notifications;drop function public.paf101_fail_notice();end $$;'
      );
    }
    expect((await rows(e.id))[0]).toMatchObject({
      required_generation: 0,
      confirmed_generation: 0
    });
    expect(
      asRecord(
        (await f.rpc(f.creator, 'get_match_event_management', { p_match_event_id: e.id })).data
      ).version
    ).toBe(1);
  });
});
