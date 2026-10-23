import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  sqlRows,
  proveEventLockBarrier
} from './helpers/match-registration-sql';

describe('match management departures integration', () => {
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
  it('promotes prior ninth player and notifies exactly surviving changed memberships', async () => {
    const members = await Promise.all(Array.from({ length: 8 }, () => f.member()));
    const event = await f.event({ accepted: members });
    const target = members[0]!;
    await fixtureSql(`delete from public.notifications where target_id='${event.id}';`);
    const result = await f.rpc(f.creator, 'remove_match_registration', {
      p_match_event_id: event.id,
      p_target_user_id: target.id,
      p_attempt_id: await f.latestAttemptId(event.id, target.id),
      p_reason: 'Schedule',
      p_request_id: crypto.randomUUID()
    });
    expect(result.error).toBeNull();
    const rows = await sqlRows(
      `select user_id,accepted_order,participation_status from public.match_event_registrations where match_event_id='${event.id}' and lifecycle='accepted' order by accepted_order`
    );
    expect(rows.map((row) => row.accepted_order)).toEqual([1, 3, 4, 5, 6, 7, 8, 9]);
    expect(rows.every((row) => row.participation_status === 'playing')).toBe(true);
    const effects = await sqlRows(
      `select kind,recipient_user_id from public.notifications where target_id='${event.id}' order by recipient_user_id`
    );
    expect(
      effects
        .filter((row) => row.kind === 'match_registration_promoted')
        .map((row) => row.recipient_user_id)
    ).toEqual([members[7]!.id]);
    expect(
      effects
        .filter((row) => row.kind === 'match_registration_group_changed')
        .map((row) => String(row.recipient_user_id))
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(
      [f.creator.id, ...members.slice(1, 7).map((member) => member.id)].sort((a, b) =>
        a.localeCompare(b)
      )
    );
    expect(
      effects.filter((row) => row.kind === 'match_registration_quartet_complete')
    ).toHaveLength(0);
    const notification = await sqlRows(
      `select id from public.notifications where target_id='${event.id}' and recipient_user_id='${members[3]!.id}' and kind='match_registration_group_changed'`
    );
    const contexts = await f.rpc(members[3]!, 'get_my_match_notification_contexts', {
      p_notification_ids: [notification[0]?.id]
    });
    expect(contexts.error).toBeNull();
    expect(contexts.data).toEqual([
      expect.objectContaining({ caller_accepted_order: 5, caller_roster_position: 4 })
    ]);
  });
  it('serializes simultaneous withdraw and remove into one command and one ending', async () => {
    const player = await f.member();
    const event = await f.event({ accepted: [player] });
    const attempt = await f.latestAttemptId(event.id, player.id);
    const command = {
      p_match_event_id: event.id,
      p_attempt_id: attempt,
      p_request_id: crypto.randomUUID()
    };
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: event.id,
      rpcToken: 'match_registration',
      fire: () => [
        f.rpc(player, 'withdraw_match_registration', command),
        f.rpc(f.creator, 'remove_match_registration', {
          ...command,
          p_request_id: crypto.randomUUID(),
          p_target_user_id: player.id,
          p_reason: 'Schedule'
        })
      ]
    });
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.message).toBe(
      'MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED'
    );
    expect(
      (
        await sqlRows(
          `select count(*)::int n from public.match_event_audit_log where match_event_id='${event.id}'`
        )
      )[0]?.n
    ).toBe(1);
  });
  it('rolls back attempt, lifecycle, revision, audit and command when notification insertion fails', async () => {
    const player = await f.member();
    const event = await f.event({ accepted: [player] });
    const attempt = await f.latestAttemptId(event.id, player.id);
    const before = await sqlRows(
      `select transition_revision from public.match_event_registration_state where match_event_id='${event.id}'`
    );
    await fixtureSql(
      `do $$ begin execute $ddl$ create function public.paf98_block_departure() returns trigger language plpgsql as $fn$ begin if new.target_id='${event.id}' and new.kind='match_registration_withdrawn' then raise exception 'injected departure effect failure'; end if; return new; end $fn$ $ddl$; create trigger paf98_block_departure before insert on public.notifications for each row execute function public.paf98_block_departure(); end $$;`
    );
    const command = {
      p_match_event_id: event.id,
      p_attempt_id: attempt,
      p_request_id: crypto.randomUUID()
    };
    try {
      expect((await f.rpc(player, 'withdraw_match_registration', command)).error?.message).toBe(
        'injected departure effect failure'
      );
      expect(
        await sqlRows(
          `select transition_revision from public.match_event_registration_state where match_event_id='${event.id}'`
        )
      ).toEqual(before);
      expect(
        (
          await sqlRows(
            `select lifecycle,ended_at from public.match_event_registrations r join public.match_event_registration_attempts a on a.id=r.current_attempt_id where r.match_event_id='${event.id}' and r.user_id='${player.id}'`
          )
        )[0]
      ).toMatchObject({ lifecycle: 'accepted', ended_at: null });
      expect(
        (
          await sqlRows(
            `select count(*)::int n from public.match_event_management_commands where match_event_id='${event.id}'`
          )
        )[0]?.n
      ).toBe(0);
      expect(
        (
          await sqlRows(
            `select count(*)::int n from public.match_event_audit_log where match_event_id='${event.id}'`
          )
        )[0]?.n
      ).toBe(0);
    } finally {
      await fixtureSql(
        'do $$ begin drop trigger paf98_block_departure on public.notifications; drop function public.paf98_block_departure(); end $$;'
      );
    }
    expect((await f.rpc(player, 'withdraw_match_registration', command)).error).toBeNull();
  });
  it('enforces deferred final state, closed history immutability, and monotonic protection', async () => {
    const player = await f.member();
    const event = await f.event({ accepted: [player] });
    const attempt = await f.latestAttemptId(event.id, player.id);
    await fixtureSql(`do $$ begin
      begin update public.match_event_registrations set lifecycle='withdrawn',left_at=clock_timestamp() where match_event_id='${event.id}' and user_id='${player.id}'; set constraints all immediate; raise exception 'invalid final state committed'; exception when check_violation then null; end;
      perform public.protect_match_event_results('${event.id}');
      perform public.protect_match_event_results('${event.id}');
      begin update public.match_event_registration_state set results_protected_at=null where match_event_id='${event.id}'; raise exception 'protection cleared'; exception when check_violation then null; end;
      begin update public.match_event_registration_attempts set accepted_order=999 where id='${attempt}'; raise exception 'history changed'; exception when check_violation then null; end;
      set constraints all immediate;
    end $$;`);
    expect(
      (
        await sqlRows(
          `select lifecycle from public.match_event_registrations where match_event_id='${event.id}' and user_id='${player.id}'`
        )
      )[0]?.lifecycle
    ).toBe('accepted');
  });
  it('withdraws once, preserves history, re-enters at tail and rejects stale removal', async () => {
    const player = await f.member();
    const event = await f.event({ accepted: [player] });
    const attempt = await f.latestAttemptId(event.id, player.id);
    const command = {
      p_match_event_id: event.id,
      p_attempt_id: attempt,
      p_request_id: crypto.randomUUID()
    };
    const first = await f.rpc(player, 'withdraw_match_registration', command);
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ changed: true, replayed: false });
    expect((await f.rpc(player, 'withdraw_match_registration', command)).data).toEqual({
      ...asRecord(first.data),
      replayed: true
    });
    expect(
      (
        await sqlRows(
          `select lifecycle,participation_status,accepted_order from public.match_event_registrations where match_event_id='${event.id}' and user_id='${player.id}'`
        )
      )[0]
    ).toMatchObject({ lifecycle: 'withdrawn', participation_status: null, accepted_order: 2 });
    expect(
      (
        await sqlRows(
          `select count(*)::int n from public.match_event_audit_log where match_event_id='${event.id}'`
        )
      )[0]?.n
    ).toBe(1);
    const joined = await f.rpc(player, 'submit_match_registration', { p_match_event_id: event.id });
    expect(joined.error).toBeNull();
    expect(joined.data).toMatchObject({ lifecycle: 'accepted', accepted_order: 3 });
    expect(await f.latestAttemptId(event.id, player.id)).not.toBe(attempt);
    expect(
      (
        await sqlRows(
          `select outcome,accepted_order,end_kind from public.match_event_registration_attempts where id='${attempt}'`
        )
      )[0]
    ).toMatchObject({ outcome: 'accepted', accepted_order: 2, end_kind: 'withdrawn' });
    expect(
      (
        await f.rpc(f.creator, 'remove_match_registration', {
          ...command,
          p_request_id: crypto.randomUUID(),
          p_target_user_id: player.id,
          p_reason: 'Scheduling conflict'
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_STALE_ATTEMPT');
    expect((await f.rpc(player, 'withdraw_match_registration', command)).data).toEqual({
      ...asRecord(first.data),
      replayed: true
    });
  });
  it('removes one of eight into four Playing and three Reserve, preserving ordinals and exact effects', async () => {
    const members = await Promise.all(Array.from({ length: 7 }, () => f.member()));
    const event = await f.event({ accepted: members });
    const target = members[0]!;
    const attempt = await f.latestAttemptId(event.id, target.id);
    await fixtureSql(`delete from public.notifications where target_id='${event.id}';`);
    const request = {
      p_match_event_id: event.id,
      p_target_user_id: target.id,
      p_attempt_id: attempt,
      p_reason: '  Cannot attend  ',
      p_request_id: crypto.randomUUID()
    };
    const result = await f.rpc(f.creator, 'remove_match_registration', request);
    expect(result.error).toBeNull();
    const rows = await sqlRows(
      `select lifecycle,accepted_order,participation_status,removal_reason from public.match_event_registrations where match_event_id='${event.id}' order by accepted_order`
    );
    expect(rows.filter((r) => r.participation_status === 'playing')).toHaveLength(4);
    expect(rows.filter((r) => r.participation_status === 'reserve')).toHaveLength(3);
    expect(rows.map((r) => r.accepted_order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(rows[1]).toMatchObject({
      lifecycle: 'removed_by_creator',
      participation_status: null,
      removal_reason: 'Cannot attend'
    });
    const alerts = await sqlRows(
      `select kind,recipient_user_id as recipient_id from public.notifications where target_id='${event.id}'`
    );
    expect(
      alerts
        .filter((a) => a.kind === 'match_registration_removed')
        .map((a) => String(a.recipient_id))
        .sort((a, b) => a.localeCompare(b))
    ).toEqual([target.id, f.creator.id].sort((a, b) => a.localeCompare(b)));
    expect(alerts.filter((a) => a.kind === 'match_registration_group_changed')).toHaveLength(7);
    expect(alerts.filter((a) => a.kind === 'match_registration_quartet_complete')).toHaveLength(0);
    expect(
      (await f.rpc(f.creator, 'remove_match_registration', { ...request, p_reason: 'different' }))
        .error?.message
    ).toBe('MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT');
    // Seven real auth users plus local SQL subprocesses dominate this test, not the RPC.
  }, 60_000);
  it('rejects wrong actor, blank reason, post-cutoff actions and protected results atomically', async () => {
    const player = await f.member();
    const outsider = await f.member();
    const event = await f.event({ accepted: [player] });
    const attempt = await f.latestAttemptId(event.id, player.id);
    const request = {
      p_match_event_id: event.id,
      p_target_user_id: player.id,
      p_attempt_id: attempt,
      p_reason: 'Reason',
      p_request_id: crypto.randomUUID()
    };
    expect((await f.rpc(outsider, 'remove_match_registration', request)).error?.code).toBe('42501');
    expect(
      (await f.rpc(f.creator, 'remove_match_registration', { ...request, p_reason: ' ' })).error
        ?.code
    ).toBe('22023');
    await fixtureSql(`select public.protect_match_event_results('${event.id}');`);
    expect((await f.rpc(f.creator, 'remove_match_registration', request)).error?.message).toBe(
      'MATCH_MANAGEMENT_RESULT_PROTECTED'
    );
    const closed = await f.event({ accepted: [player] });
    await f.setCutoff(closed.id, "clock_timestamp()-interval '1 second'");
    expect(
      (
        await f.rpc(player, 'withdraw_match_registration', {
          p_match_event_id: closed.id,
          p_attempt_id: await f.latestAttemptId(closed.id, player.id),
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_CLOSED');
    expect(
      (
        await sqlRows(
          `select count(*)::int n from public.match_event_audit_log where match_event_id in ('${event.id}','${closed.id}')`
        )
      )[0]?.n
    ).toBe(0);
  });
});
