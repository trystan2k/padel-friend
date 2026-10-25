import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { localSupabaseEnv, dotEnvPathFromImportMetaUrl } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  proveEventLockBarrier,
  sqlRows,
  startSql
} from './helpers/match-registration-sql';

describe('management result protection contract (no results API)', { timeout: 30000 }, () => {
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

  async function setup() {
    const player = await f.member();
    const invitee = await f.member();
    const e = await f.event({ accepted: [player], invites: [invitee] });
    const attempt = await f.latestAttemptId(e.id, player.id);
    const request = crypto.randomUUID();
    const common = { p_match_event_id: e.id, p_request_id: request };
    const commands = [
      [player, 'submit_match_registration', { p_match_event_id: e.id }],
      [
        f.creator,
        'decide_match_registration',
        { p_match_event_id: e.id, p_attempt_id: attempt, p_decision: 'approve' }
      ],
      [
        f.creator,
        'decide_match_registration',
        { p_match_event_id: e.id, p_attempt_id: attempt, p_decision: 'reject' }
      ],
      [
        invitee,
        'respond_match_event_invitation',
        { p_match_event_id: e.id, p_invitation_id: e.invites.get(invitee.id), p_response: 'accept' }
      ],
      [
        invitee,
        'respond_match_event_invitation',
        {
          p_match_event_id: e.id,
          p_invitation_id: e.invites.get(invitee.id),
          p_response: 'decline'
        }
      ],
      [player, 'withdraw_match_registration', { ...common, p_attempt_id: attempt }],
      [
        f.creator,
        'remove_match_registration',
        { ...common, p_target_user_id: player.id, p_attempt_id: attempt, p_reason: 'Unavailable' }
      ],
      [
        f.creator,
        'transfer_match_event_ownership',
        { ...common, p_target_user_id: player.id, p_expected_version: 1 }
      ],
      [
        f.creator,
        'cancel_match_event',
        { ...common, p_reason: 'Unavailable', p_expected_version: 1 }
      ],
      [
        f.creator,
        'edit_match_event',
        { ...common, p_expected_version: 1, p_patch: { notes: 'Unavailable' } }
      ],
      [
        player,
        'reconfirm_match_registration',
        { ...common, p_attempt_id: attempt, p_generation: 1 }
      ]
    ] as const;
    return { e, player, invitee, commands };
  }
  async function facts(id: string) {
    return sqlRows(`select to_jsonb(e) event,to_jsonb(s) state,
      (select jsonb_agg(to_jsonb(r) order by id) from public.match_event_registrations r where match_event_id=e.id) registrations,
      (select jsonb_agg(to_jsonb(a) order by id) from public.match_event_registration_attempts a where match_event_id=e.id) attempts,
      (select count(*) from public.notifications where target_id=e.id) notifications,
      (select count(*) from public.match_event_audit_log where match_event_id=e.id) audits,
      (select count(*) from public.match_event_management_commands where match_event_id=e.id) commands
      from public.match_events e join public.match_event_registration_state s on s.match_event_id=e.id where e.id='${id}'`);
  }
  // Both proposed PAF-7 result states use the same conservative event marker.
  it.each(['active', 'confirmed'])(
    '%s result protection rejects every public mutation and replay without changing roster',
    async () => {
      const { e, commands } = await setup();
      await f.protectResults(e.id);
      const before = await facts(e.id);
      for (const [actor, name, args] of commands) {
        for (let replay = 0; replay < 2; replay++)
          expect({ name, message: (await f.rpc(actor, name, args)).error?.message }).toEqual({
            name,
            message: 'MATCH_MANAGEMENT_RESULT_PROTECTED'
          });
      }
      expect(await facts(e.id)).toEqual(before);
      // Protection outranks start, even for stale ordinary registration clients.
      await f.setStarted(e.id);
      for (const [actor, name, args] of commands)
        expect({ name, message: (await f.rpc(actor, name, args)).error?.message }).toEqual({
          name,
          message: 'MATCH_MANAGEMENT_RESULT_PROTECTED'
        });
    }
  );
  it.each(['started', 'cancelled'])(
    'every management RPC and old submit/decision rejects %s with stale UI',
    async (state) => {
      const { e, commands } = await setup();
      if (state === 'started') await f.setStarted(e.id);
      else {
        const result = await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: e.id,
          p_reason: 'Weather',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        });
        if (result.error) throw new Error(result.error.message ?? 'Cancellation failed');
      }
      const before = await facts(e.id);
      for (const [actor, name, args] of commands)
        expect({ name, message: (await f.rpc(actor, name, args)).error?.message }).toEqual({
          name,
          message: `MATCH_MANAGEMENT_${state.toUpperCase()}`
        });
      expect(await facts(e.id)).toEqual(before);
    }
  );
  it('successful command and natural invitation replays cannot bypass later protection', async () => {
    const { e, player, invitee } = await setup();
    const edit = {
      p_match_event_id: e.id,
      p_expected_version: 1,
      p_patch: { notes: 'Original intent' },
      p_request_id: crypto.randomUUID()
    };
    const decline = {
      p_match_event_id: e.id,
      p_invitation_id: e.invites.get(invitee.id),
      p_response: 'decline'
    };
    const withdraw = {
      p_match_event_id: e.id,
      p_attempt_id: await f.latestAttemptId(e.id, player.id),
      p_request_id: crypto.randomUUID()
    };
    const replays = [
      [f.creator, 'edit_match_event', edit],
      [invitee, 'respond_match_event_invitation', decline],
      [player, 'withdraw_match_registration', withdraw]
    ] as const;
    for (const [actor, name, args] of replays) {
      expect((await f.rpc(actor, name, args)).error).toBeNull();
      expect((await f.rpc(actor, name, args)).data).toMatchObject({ replayed: true });
    }
    await f.protectResults(e.id);
    const before = await facts(e.id);
    for (const [actor, name, args] of replays)
      expect((await f.rpc(actor, name, args)).error?.message).toBe(
        'MATCH_MANAGEMENT_RESULT_PROTECTED'
      );
    expect(await facts(e.id)).toEqual(before);
  });
  it('capabilities match role deadline and result precedence', async () => {
    const { e, player } = await setup();
    const read = async (actor = f.creator) =>
      asRecord((await f.rpc(actor, 'get_match_event_management', { p_match_event_id: e.id })).data);
    expect(asRecord((await read(player)).actions).edit).toEqual({
      allowed: false,
      reason: 'forbidden'
    });
    await f.setCutoff(e.id, "now()-interval '1 minute'");
    expect(asRecord((await read()).actions)).toMatchObject({
      edit: { allowed: false, reason: 'closed' },
      cancel: { allowed: true, reason: null }
    });
    expect(asRecord((await read(player)).actions).edit).toEqual({
      allowed: false,
      reason: 'closed'
    });
    await f.protectResults(e.id);
    await f.setStarted(e.id);
    for (const actor of [f.creator, player]) {
      const value = await read(actor);
      expect(value).toMatchObject({
        results_protected: true,
        correction:
          actor.id === f.creator.id
            ? { available: true, target: 'record_result', event_id: e.id }
            : { available: false, reason: 'forbidden' }
      });
      for (const capability of Object.values(asRecord(value.actions)))
        expect(capability).toEqual({ allowed: false, reason: 'result_protected' });
    }
  });
  it('protection finalizes overdue cutoff before freezing roster; cron after protection never changes quartet members', async () => {
    const players = await Promise.all(Array.from({ length: 4 }, () => f.member()));
    const e = await f.event({ accepted: players });
    expect(
      (
        await f.rpc(f.creator, 'edit_match_event', {
          p_match_event_id: e.id,
          p_expected_version: 1,
          p_patch: { event_type: 'competitive' },
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    for (const actor of [f.creator, ...players.slice(0, 3)])
      expect(
        (
          await f.rpc(actor, 'reconfirm_match_registration', {
            p_match_event_id: e.id,
            p_attempt_id: await f.latestAttemptId(e.id, actor.id),
            p_generation: 1,
            p_request_id: crypto.randomUUID()
          })
        ).error
      ).toBeNull();
    await f.setCutoff(e.id, "now()-interval '1 minute'");
    await f.protectResults(e.id);
    expect(
      await sqlRows(
        `select lifecycle,participation_status from public.match_event_registrations where match_event_id='${e.id}' and user_id='${players[3]!.id}'`
      )
    ).toEqual([{ lifecycle: 'expired', participation_status: null }]);
    expect(
      await sqlRows(
        `select count(*) members from public.match_event_registrations where match_event_id='${e.id}' and participation_status='playing'`
      )
    ).toEqual([{ members: 4 }]);
    const before = await facts(e.id);
    for (let i = 0; i < 2; i++) {
      expect(
        await sqlRows(
          `select public.process_match_event_registration_cutoff('${e.id}',false) result`
        )
      ).toEqual([{ result: { event_id: e.id, processed: false, reason: 'already_frozen' } }]);
      await f.protectResults(e.id);
    }
    expect(await facts(e.id)).toEqual(before);
  });
  it('protection versus cancellation has exactly one winner', async () => {
    for (let round = 0; round < 3; round++) {
      const e = await f.event();
      const results = await proveEventLockBarrier({
        communityId: f.communityId,
        eventId: e.id,
        rpcToken: 'match_event',
        fire: () => [
          (async () => {
            const handle = startSql(`select public.protect_match_event_results('${e.id}');`);
            try {
              const result = await handle.done;
              return { data: null, error: result.code === 0 ? null : { message: result.stderr } };
            } finally {
              await handle.stop();
            }
          })(),
          (async () => {
            const handle = startSql(
              `do $$ begin perform set_config('request.jwt.claim.sub','${f.creator.id}',true); perform public.cancel_match_event('${e.id}','Race',1,'${crypto.randomUUID()}'); end $$;`
            );
            try {
              const result = await handle.done;
              return { data: null, error: result.code === 0 ? null : { message: result.stderr } };
            } finally {
              await handle.stop();
            }
          })()
        ]
      });
      expect(results.filter((r) => !r.error)).toHaveLength(1);
      const [row] = await sqlRows(
        `select e.status,s.results_protected_at is not null protected from public.match_events e join public.match_event_registration_state s on s.match_event_id=e.id where e.id='${e.id}'`
      );
      expect(row?.status === 'cancelled').toBe(!row?.protected);
    }
  }, 60000);
  it('scheduled batch after early protection never changes quartet members', async () => {
    const players = await Promise.all(Array.from({ length: 3 }, () => f.member()));
    const e = await f.event({ accepted: players });
    await f.protectResults(e.id);
    await f.setStarted(e.id);
    const roster = () =>
      sqlRows(
        `select id,user_id,accepted_order,participation_status from public.match_event_registrations where match_event_id='${e.id}' order by accepted_order`
      );
    const before = await roster();
    expect(before.map((row) => row.participation_status)).toEqual([
      'playing',
      'playing',
      'playing',
      'playing'
    ]);
    for (let round = 0; round < 2; round++)
      await fixtureSql('select public.process_due_match_event_registration_cutoffs(100);');
    expect(await roster()).toEqual(before);
    expect(
      await sqlRows(
        `select transition_revision from public.match_event_registration_state where match_event_id='${e.id}'`
      )
    ).toEqual([{ transition_revision: 3 }]);
  });
  it('protection-first rejects cancellation and cancellation-first rejects protection', async () => {
    const protectedEvent = await f.event();
    await f.protectResults(protectedEvent.id);
    expect(
      (
        await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: protectedEvent.id,
          p_reason: 'Race',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_MANAGEMENT_RESULT_PROTECTED');
    const cancelledEvent = await f.event();
    expect(
      (
        await f.rpc(f.creator, 'cancel_match_event', {
          p_match_event_id: cancelledEvent.id,
          p_reason: 'Race',
          p_expected_version: 1,
          p_request_id: crypto.randomUUID()
        })
      ).error
    ).toBeNull();
    await expect(f.protectResults(cancelledEvent.id)).rejects.toThrow('MATCH_MANAGEMENT_CANCELLED');
    expect(
      await sqlRows(
        `select results_protected_at from public.match_event_registration_state where match_event_id='${cancelledEvent.id}'`
      )
    ).toEqual([{ results_protected_at: null }]);
  });
  it('cutoff notification failure rolls back protection and every roster effect', async () => {
    const { e } = await setup();
    await f.setCutoff(e.id, "now()-interval '1 minute'");
    const before = await facts(e.id);
    await fixtureSql(`do $fixture$ begin create function public.paf102_fail_protection_effect() returns trigger language plpgsql as $$ begin
      if new.target_id='${e.id}' then raise exception 'PAF102_NOTIFICATION_FAILURE'; end if; return new; end $$;
      create trigger paf102_fail_protection_effect before insert on public.notifications for each row execute function public.paf102_fail_protection_effect(); end $fixture$;`);
    try {
      await expect(f.protectResults(e.id)).rejects.toThrow('PAF102_NOTIFICATION_FAILURE');
      expect(await facts(e.id)).toEqual(before);
    } finally {
      await fixtureSql(
        'do $$ begin drop trigger if exists paf102_fail_protection_effect on public.notifications; drop function if exists public.paf102_fail_protection_effect(); end $$;'
      );
    }
    await f.protectResults(e.id);
    expect(
      await sqlRows(
        `select results_protected_at is not null protected,cutoff_processed_at is not null processed from public.match_event_registration_state where match_event_id='${e.id}'`
      )
    ).toEqual([{ protected: true, processed: true }]);
  });
  it('browser cannot invoke protection hook clear marker or alter protected facts', async () => {
    const { e, player } = await setup();
    await f.protectResults(e.id);
    expect(
      (await f.rpc(player, 'protect_match_event_results', { p_event_id: e.id })).error
    ).not.toBeNull();
    expect(
      (
        await f.rpc(player, 'assert_match_management_action_locked', {
          p_event_id: e.id,
          p_action: 'cancel'
        })
      ).error
    ).not.toBeNull();
    const before = await facts(e.id);
    expect(
      (
        await player.client
          .from('match_event_registration_state')
          .update({ results_protected_at: null })
          .eq('match_event_id', e.id)
      ).error
    ).not.toBeNull();
    expect(
      (await player.client.from('match_events').update({ notes: 'Bypass' }).eq('id', e.id)).error
    ).not.toBeNull();
    expect(
      (
        await player.client
          .from('match_event_registrations')
          .update({ participation_status: 'playing' })
          .eq('match_event_id', e.id)
      ).error
    ).not.toBeNull();
    await expect(
      fixtureSql(
        `update public.match_event_registration_state set results_protected_at=null where match_event_id='${e.id}'`
      )
    ).rejects.toThrow('Trusted fixture SQL failed');
    expect(await facts(e.id)).toEqual(before);
  }, 30000);
});
