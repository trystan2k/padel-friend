import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows, proveEventLockBarrier } from './helpers/match-registration-sql';

describe('match cancellation integration', () => {
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
  it('notifies terminal, requesting and invited identities once while retaining departure history', async () => {
    const departed = await f.member();
    const requester = await f.actor();
    const invitee = await f.member();
    const e = await f.event({ accepted: [departed], invites: [departed, invitee] });
    expect(
      (
        await f.rpc(departed, 'withdraw_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: await f.latestAttemptId(e.id, departed.id),
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      (await f.rpc(requester, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    await fixtureSql(`delete from public.notifications where target_id='${e.id}'`);
    // Force the deferred final-state checks before this trusted transaction ends.
    await fixtureSql(`do $$ begin perform set_config('request.jwt.claim.sub','${f.creator.id}',true);
      perform public.cancel_match_event('${e.id}','Weather',1,'${crypto.randomUUID()}'); set constraints all immediate; end $$;`);
    expect(
      await sqlRows(
        `select recipient_user_id from public.notifications where target_id='${e.id}' and kind='match_event_cancelled' order by recipient_user_id`
      )
    ).toEqual(
      [f.creator.id, departed.id, requester.id, invitee.id]
        .sort()
        .map((recipient_user_id) => ({ recipient_user_id }))
    );
    expect(
      await sqlRows(
        `select lifecycle,accepted_order from public.match_event_registrations where match_event_id='${e.id}' and user_id='${departed.id}'`
      )
    ).toEqual([{ lifecycle: 'withdrawn', accepted_order: 2 }]);
  });
  it('cancellation preserves history, distinct fanout, reason audit and safe tombstone with no duplicate replay', async () => {
    const player = await f.member();
    const invited = await f.member();
    const outsider = await f.actor();
    const e = await f.event({ accepted: [player], invites: [player, invited] });
    const command = {
      p_match_event_id: e.id,
      p_reason: 'Court closed',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    };
    const revisionBefore = await sqlRows(
      `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
    );
    await fixtureSql(`delete from public.notifications where target_id='${e.id}'`);
    expect((await f.rpc(f.creator, 'cancel_match_event', command)).error).toBeNull();
    expect((await f.rpc(f.creator, 'cancel_match_event', command)).data).toMatchObject({
      replayed: true,
      changed: false,
      version: 2
    });
    expect(
      await sqlRows(
        `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
      )
    ).toEqual([{ transition_revision: Number(revisionBefore[0]?.transition_revision) + 1 }]);
    expect(
      await sqlRows(
        `select kind,recipient_user_id from public.notifications where target_id='${e.id}' order by recipient_user_id`
      )
    ).toEqual(
      [f.creator.id, player.id, invited.id]
        .sort()
        .map((recipient_user_id) => ({ kind: 'match_event_cancelled', recipient_user_id }))
    );
    expect(
      await sqlRows(
        `select lifecycle,participation_status,cancelled_at is not null cancelled from public.match_event_registrations where match_event_id='${e.id}'`
      )
    ).toEqual(
      Array.from({ length: 2 }, () => ({
        lifecycle: 'accepted',
        participation_status: null,
        cancelled: true
      }))
    );
    expect(
      await sqlRows(
        `select end_kind from public.match_event_registration_attempts where match_event_id='${e.id}'`
      )
    ).toEqual([{ end_kind: 'cancelled' }, { end_kind: 'cancelled' }]);
    expect((await f.rpc(player, 'get_match_event', { p_event_id: e.id })).data).toMatchObject({
      status: 'cancelled',
      registration_open: false,
      accepted_count: 0
    });
    expect((await f.rpc(outsider, 'get_match_event', { p_event_id: e.id })).data).toBeNull();
    const notification = (
      await sqlRows(
        `select id from public.notifications where target_id='${e.id}' and recipient_user_id='${invited.id}'`
      )
    )[0];
    expect(
      (
        await f.rpc(invited, 'get_my_notification_target_v2', {
          p_notification_id: notification?.id
        })
      ).data
    ).toEqual([expect.objectContaining({ match_event_id: e.id, match_available: true })]);
    expect(
      await sqlRows(
        `select reason,event_version from public.match_event_audit_log where match_event_id='${e.id}'`
      )
    ).toEqual([{ reason: 'Court closed', event_version: 2 }]);
    for (const [actor, name, args] of [
      [player, 'submit_match_registration', { p_match_event_id: e.id }],
      [
        player,
        'withdraw_match_registration',
        {
          p_match_event_id: e.id,
          p_attempt_id: await f.latestAttemptId(e.id, player.id),
          p_request_id: crypto.randomUUID()
        }
      ],
      [
        f.creator,
        'transfer_match_event_ownership',
        {
          p_match_event_id: e.id,
          p_target_user_id: player.id,
          p_expected_version: 2,
          p_request_id: crypto.randomUUID()
        }
      ]
    ] as const)
      expect((await f.rpc(actor, name, args)).error?.message).toBe('MATCH_MANAGEMENT_CANCELLED');
  });
  it('same-community admin may cancel after cutoff; participant cannot', async () => {
    const player = await f.member();
    const admin = await f.member();
    await fixtureSql(
      `do $$ begin alter table public.community_members disable trigger community_member_guard; update public.community_members set role='admin' where community_id='${f.communityId}' and user_id='${admin.id}'; alter table public.community_members enable trigger community_member_guard; end $$;`
    );
    const e = await f.event({ accepted: [player] });
    const command = {
      p_match_event_id: e.id,
      p_reason: 'Weather',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    };
    expect((await f.rpc(player, 'cancel_match_event', command)).error?.code).toBe('42501');
    await f.setCutoff(e.id, "now()-interval '1 minute'");
    expect((await f.rpc(admin, 'cancel_match_event', command)).error).toBeNull();
  });
  it('expires pending requests and cancels pending invites without expiry notification cascades', async () => {
    const requester = await f.actor();
    const invitee = await f.member();
    const e = await f.event({ invites: [invitee] });
    expect(
      (await f.rpc(requester, 'submit_match_registration', { p_match_event_id: e.id })).error
    ).toBeNull();
    await fixtureSql(`delete from public.notifications where target_id='${e.id}'`);
    expect(
      (
        await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: e.id,
          p_reason: 'Closed',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    expect(
      await sqlRows(
        `select lifecycle,cancelled_at is not null cancelled from public.match_event_registrations where match_event_id='${e.id}' and user_id='${requester.id}'`
      )
    ).toEqual([{ lifecycle: 'expired', cancelled: true }]);
    expect(
      await sqlRows(
        `select status,responded_by from public.match_event_invites where match_event_id='${e.id}'`
      )
    ).toEqual([{ status: 'cancelled', responded_by: f.creator.id }]);
    expect(
      await sqlRows(`select distinct kind from public.notifications where target_id='${e.id}'`)
    ).toEqual([{ kind: 'match_event_cancelled' }]);
    expect(
      (
        await f.rpc(f.creator, 'decide_match_registration', {
          p_match_event_id: e.id,
          p_attempt_id: await f.latestAttemptId(e.id, requester.id),
          p_decision: 'approve'
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_CANCELLED');
    expect(
      (
        await f.rpc(invitee, 'respond_match_event_invitation', {
          p_match_event_id: e.id,
          p_invitation_id: e.invites.get(invitee.id),
          p_response: 'decline'
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_CANCELLED');
    const available = await f.rpc(requester, 'list_match_events', { p_entry: 'available' });
    expect(JSON.stringify(available.data)).not.toContain(e.id);
    expect(
      JSON.stringify((await f.rpc(requester, 'list_match_events', { p_entry: 'my' })).data)
    ).toContain(e.id);
  });
  it('cancel at start rejected, including identical-command replay; anonymous denied', async () => {
    const e = await f.event();
    const command = {
      p_match_event_id: e.id,
      p_reason: 'Closed',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    };
    expect((await f.rpc({ token: '' }, 'cancel_match_event', command)).error).not.toBeNull();
    await fixtureSql(
      `do $$ begin alter table public.match_events disable trigger match_event_immutable; update public.match_events set starts_at=clock_timestamp()-interval '1 second',registration_cutoff_at=clock_timestamp()-interval '1 hour' where id='${e.id}'; alter table public.match_events enable trigger match_event_immutable; end $$;`
    );
    expect((await f.rpc(f.creator, 'cancel_match_event', command)).error?.message).toBe(
      'MATCH_MANAGEMENT_STARTED'
    );
  });
  it('cancel versus transfer has one consistent lock/version winner', async () => {
    const player = await f.member();
    const e = await f.event({ accepted: [player] });
    const results = await proveEventLockBarrier({
      communityId: f.communityId,
      eventId: e.id,
      rpcToken: 'match_event',
      fire: () => [
        f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: e.id,
          p_reason: 'Weather',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        }),
        f.rpc(f.creator, 'transfer_match_event_ownership', {
          p_match_event_id: e.id,
          p_target_user_id: player.id,
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ]
    });
    // Creator remains community admin after transfer: stale cancel must conflict.
    expect(results.filter((r) => r.error === null)).toHaveLength(1);
    expect(['MATCH_MANAGEMENT_VERSION_CONFLICT', 'MATCH_MANAGEMENT_CANCELLED']).toContain(
      results.find((r) => r.error)?.error?.message
    );
    expect(await sqlRows(`select version from public.match_events where id='${e.id}'`)).toEqual([
      { version: 2 }
    ]);
  });
  it('notification failure rolls back status, version, history, revision, audit and command', async () => {
    const e = await f.event();
    const before = await sqlRows(
      `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
    );
    await fixtureSql(
      `do $$ begin execute $ddl$ create function public.paf99_block_cancel() returns trigger language plpgsql as $fn$ begin if new.target_id='${e.id}' and new.kind='match_event_cancelled' then raise exception 'injected cancellation failure'; end if; return new; end $fn$ $ddl$; create trigger paf99_block_cancel before insert on public.notifications for each row execute function public.paf99_block_cancel(); end $$;`
    );
    try {
      expect(
        (
          await f.rpc(f.creator, 'cancel_match_event', {
            p_match_event_id: e.id,
            p_reason: 'Weather',
            p_expected_version: 1,
            p_request_id: crypto.randomUUID()
          })
        ).error
      ).not.toBeNull();
      expect(
        await sqlRows(`select status,version from public.match_events where id='${e.id}'`)
      ).toEqual([{ status: 'open', version: 1 }]);
      expect(
        await sqlRows(
          `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
        )
      ).toEqual(before);
      expect(
        await sqlRows(
          `select count(*)::int n from public.match_event_audit_log where match_event_id='${e.id}'`
        )
      ).toEqual([{ n: 0 }]);
      expect(
        await sqlRows(
          `select count(*)::int n from public.match_event_management_commands where match_event_id='${e.id}'`
        )
      ).toEqual([{ n: 0 }]);
      expect(
        await sqlRows(
          `select ended_at from public.match_event_registration_attempts where match_event_id='${e.id}'`
        )
      ).toEqual([{ ended_at: null }]);
    } finally {
      await fixtureSql(
        'do $$ begin drop trigger paf99_block_cancel on public.notifications; drop function public.paf99_block_cancel(); end $$;'
      );
    }
  });
  it('other-community admin cannot cancel; result protection and cancellation exclude each other', async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    const other = await createMatchManagementFixtures(env);
    const e = await f.event();
    const command = {
      p_match_event_id: e.id,
      p_reason: 'Weather',
      p_expected_version: 1,
      p_request_id: crypto.randomUUID()
    };
    try {
      expect((await f.rpc(other.creator, 'cancel_match_event', command)).error?.code).toBe('42501');
    } finally {
      await other.cleanup();
    }
    await fixtureSql(`do $$ begin perform public.protect_match_event_results('${e.id}'); end $$;`);
    expect((await f.rpc(f.creator, 'cancel_match_event', command)).error?.message).toBe(
      'MATCH_MANAGEMENT_RESULT_PROTECTED'
    );
    const cancelled = await f.event();
    expect(
      (await f.rpc(f.creator, 'cancel_match_event', { ...command, p_match_event_id: cancelled.id }))
        .error
    ).toBeNull();
    await expect(
      fixtureSql(
        `do $$ begin perform public.protect_match_event_results('${cancelled.id}'); end $$;`
      )
    ).rejects.toThrow('MATCH_MANAGEMENT_CANCELLED');
    await fixtureSql(
      `do $$ begin alter table public.match_events disable trigger match_event_immutable; update public.match_events set starts_at=clock_timestamp()-interval '1 second',registration_cutoff_at=clock_timestamp()-interval '1 hour' where id='${cancelled.id}'; alter table public.match_events enable trigger match_event_immutable; end $$;`
    );
    expect(
      (await f.rpc(f.creator, 'cancel_match_event', { ...command, p_match_event_id: cancelled.id }))
        .error?.message
    ).toBe('MATCH_MANAGEMENT_STARTED');
  });
});
