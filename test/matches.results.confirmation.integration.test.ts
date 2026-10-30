import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMatchManagementFixtures,
  type ManagementActor
} from './helpers/match-management-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('authoritative result confirmation contract', { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;
  let submitter: ManagementActor;
  let outsider: ManagementActor;

  beforeAll(async () => {
    if (!environment.env) return;
    f = await createMatchManagementFixtures(environment.env);
    submitter = await f.member();
    outsider = await f.member();
    await fixtureSql(
      `update public.community_members set role = 'admin' where community_id = '${f.communityId}' and user_id = '${submitter.id}'`
    );
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  async function insertProposal(options: {
    eventId: string;
    proposalId?: string;
    players: ManagementActor[];
    group: 1 | 2;
    submittedBy: string;
    ageHours: number;
  }): Promise<string> {
    const proposalId = options.proposalId ?? crypto.randomUUID();
    const players = options.players.slice((options.group - 1) * 4, options.group * 4);
    if (players.length !== 4) throw new Error(`Fixture group ${options.group} needs four players`);
    await fixtureSql(`do $proposal$
      declare
        v_submitted_at timestamptz := clock_timestamp() - interval '${options.ageHours} hours';
        v_deadline timestamptz := v_submitted_at + interval '48 hours';
      begin
        insert into public.match_event_result_proposals(
          id, match_event_id, group_number, status, active_version, review_deadline_at,
          submitted_by, submitted_at
        ) values (
          '${proposalId}', '${options.eventId}', ${options.group}, 'pending', 1, v_deadline,
          '${options.submittedBy}', v_submitted_at
        );
        insert into public.match_event_result_proposal_versions(
          proposal_id, version, submitted_by, submitted_at, review_deadline_at,
          teams, sets, classification, played_at_utc, played_at_local,
          played_at_offset_seconds, court_label
        ) values (
          '${proposalId}', 1, '${options.submittedBy}', v_submitted_at, v_deadline,
          jsonb_build_object(
            'team_a', jsonb_build_array('${players[0]!.id}', '${players[1]!.id}'),
            'team_b', jsonb_build_array('${players[2]!.id}', '${players[3]!.id}')
          ),
          '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb,
          'team_a', '2020-01-01 12:00:00+00'::timestamptz,
          '2020-01-01 12:00:00'::timestamp, 0, 'Court 1'
        );
      end $proposal$;`);
    return proposalId;
  }

  async function insertReview(
    proposalId: string,
    reviewerId: string,
    decision: 'approve' | 'reject',
    reasonCode: string | null = null
  ): Promise<void> {
    await fixtureSql(`insert into public.match_event_result_reviews(
      proposal_id, proposal_version, reviewer_user_id, decision, reason_code, request_id
    ) values (
      '${proposalId}', 1, '${reviewerId}', '${decision}',
      ${reasonCode === null ? 'null' : `'${reasonCode}'`}, '${crypto.randomUUID()}'
    );`);
  }

  async function finalize(
    proposalId: string,
    source: 'MANUAL' | 'AUTO_48H',
    actorId: string | null
  ): Promise<string | null> {
    const actor = actorId === null ? 'null' : `'${actorId}'::uuid`;
    const rows = await sqlRows(
      `select public.finalize_match_event_result_locked('${proposalId}', 1, '${source}', ${actor})::text as id`
    );
    return typeof rows[0]?.['id'] === 'string' ? rows[0]['id'] : null;
  }

  async function insertConfirmation(
    proposalId: string,
    source: 'MANUAL' | 'AUTO_48H',
    actorId: string | null
  ): Promise<void> {
    const actor = actorId === null ? 'null' : `'${actorId}'::uuid`;
    await fixtureSql(`
      insert into public.match_event_result_confirmations(
        proposal_id, proposal_version, match_event_id, group_number, source,
        confirmed_at, effective_at, actor_id, event_type, ratable_eligible
      )
      select p.id, p.active_version, p.match_event_id, p.group_number, '${source}',
        stamp.confirmed_at,
        case when '${source}' = 'AUTO_48H' then p.review_deadline_at else stamp.confirmed_at end,
        ${actor}, e.event_type,
        e.event_type = 'competitive' and v.classification <> 'incomplete'
      from public.match_event_result_proposals p
      join public.match_events e on e.id = p.match_event_id
      join public.match_event_result_proposal_versions v
        on v.proposal_id = p.id and v.version = p.active_version
      cross join (select clock_timestamp() as confirmed_at) stamp
      where p.id = '${proposalId}';
    `);
  }

  async function officialResults(actor: ManagementActor, eventId: string) {
    return f.rpc(actor, 'get_match_event_official_results', { p_match_event_id: eventId });
  }

  it.skipIf(!environment.env)(
    'finalizes only eligible evidence, preserves confirmation identity, and exposes confirmed versions only',
    async () => {
      const manualEvent = await f.protectedEightPlayerEvent();
      const autoEvent = await f.protectedEightPlayerEvent();
      const outsiderSubmitter = await insertProposal({
        eventId: manualEvent.id,
        players: manualEvent.players,
        group: 1,
        submittedBy: submitter.id,
        ageHours: 0
      });
      const autoZeroVotes = await insertProposal({
        eventId: manualEvent.id,
        players: manualEvent.players,
        group: 2,
        submittedBy: submitter.id,
        ageHours: 50
      });
      const autoPartialVotes = await insertProposal({
        eventId: autoEvent.id,
        players: autoEvent.players,
        group: 1,
        submittedBy: submitter.id,
        ageHours: 50
      });
      const disputed = await insertProposal({
        eventId: autoEvent.id,
        players: autoEvent.players,
        group: 2,
        submittedBy: submitter.id,
        ageHours: 50
      });

      // Empty coverage and one-sided coverage cannot manually finalize a
      // non-playing submitter's proposal; caller identity must itself approve.
      expect((await officialResults(f.creator, manualEvent.id)).data).toEqual([]);
      expect(await finalize(outsiderSubmitter, 'MANUAL', manualEvent.players[0]!.id)).toBeNull();
      expect(await finalize(outsiderSubmitter, 'AUTO_48H', null)).toBeNull();
      await expect(
        insertConfirmation(outsiderSubmitter, 'MANUAL', manualEvent.players[0]!.id)
      ).rejects.toThrow(/23514/);
      await expect(insertConfirmation(outsiderSubmitter, 'AUTO_48H', null)).rejects.toThrow(
        /23514/
      );
      await insertReview(outsiderSubmitter, submitter.id, 'approve');
      await insertReview(outsiderSubmitter, outsider.id, 'approve');
      await insertReview(outsiderSubmitter, manualEvent.players[0]!.id, 'approve');
      expect(await finalize(outsiderSubmitter, 'MANUAL', manualEvent.players[0]!.id)).toBeNull();
      expect(await finalize(outsiderSubmitter, 'AUTO_48H', null)).toBeNull();

      await insertReview(outsiderSubmitter, manualEvent.players[2]!.id, 'approve');

      // An audit failure aborts confirmation, pointer transition and all other
      // transactional effects. No notification/outbox is part of this unit.
      await fixtureSql(`
        create function public.paf118_fail_result_confirmation_audit()
        returns trigger language plpgsql as $$
        begin
          if new.action = 'result_confirmed' then
            raise exception 'PAF118_AUDIT_PROBE' using errcode = '23514';
          end if;
          return new;
        end $$;
        create trigger paf118_fail_result_confirmation_audit
          before insert on public.match_event_audit_log
          for each row execute function public.paf118_fail_result_confirmation_audit();
        do $rollback_probe$
        declare
          v_status text;
          v_confirmations integer;
          v_confirmation_audits integer;
          v_notifications_before integer;
          v_notifications_after integer;
        begin
          select count(*)::integer into v_notifications_before from public.notifications
           where target_type = 'match_event' and target_id = '${manualEvent.id}';
          begin
            perform public.finalize_match_event_result_locked(
              '${outsiderSubmitter}', 1, 'MANUAL', '${manualEvent.players[2]!.id}'
            );
            raise exception 'Expected audit failure to abort finalization' using errcode = 'P0001';
          exception when check_violation then
            null;
          end;
          select status into v_status from public.match_event_result_proposals where id = '${outsiderSubmitter}';
          select count(*)::integer into v_confirmations from public.match_event_result_confirmations where proposal_id = '${outsiderSubmitter}';
          select count(*)::integer into v_confirmation_audits from public.match_event_audit_log where confirmation_id in (
            select id from public.match_event_result_confirmations where proposal_id = '${outsiderSubmitter}'
          );
          select count(*)::integer into v_notifications_after from public.notifications
           where target_type = 'match_event' and target_id = '${manualEvent.id}';
          if v_status <> 'pending' or v_confirmations <> 0 or v_confirmation_audits <> 0
            or v_notifications_after <> v_notifications_before then
            raise exception 'Audit failure left partial result finalization state';
          end if;
        end $rollback_probe$;
        drop trigger paf118_fail_result_confirmation_audit on public.match_event_audit_log;
        drop function public.paf118_fail_result_confirmation_audit();
      `);

      const manualConfirmation = await finalize(
        outsiderSubmitter,
        'MANUAL',
        manualEvent.players[2]!.id
      );
      expect(manualConfirmation).toMatch(/^[0-9a-f-]{36}$/);
      expect(await finalize(outsiderSubmitter, 'MANUAL', manualEvent.players[2]!.id)).toBe(
        manualConfirmation
      );
      expect(await finalize(outsiderSubmitter, 'AUTO_48H', null)).toBe(manualConfirmation);

      const automaticZeroVoteConfirmation = await finalize(autoZeroVotes, 'AUTO_48H', null);
      expect(automaticZeroVoteConfirmation).toMatch(/^[0-9a-f-]{36}$/);

      // A due proposal with partial approvals still auto-confirms; a rejected
      // version is first Disputed and never enters official-result reads.
      await insertReview(autoPartialVotes, autoEvent.players[0]!.id, 'approve');
      expect(await finalize(autoPartialVotes, 'MANUAL', autoEvent.players[0]!.id)).toBeNull();
      const automaticPartialVoteConfirmation = await finalize(autoPartialVotes, 'AUTO_48H', null);
      expect(automaticPartialVoteConfirmation).toMatch(/^[0-9a-f-]{36}$/);
      await insertReview(disputed, autoEvent.players[1]!.id, 'reject', 'SCORE_MISMATCH');
      await fixtureSql(
        `update public.match_event_result_proposals set status = 'disputed' where id = '${disputed}'`
      );
      expect(await finalize(disputed, 'AUTO_48H', null)).toBeNull();

      const manualRows = await sqlRows(`
        select p.status, c.id::text as confirmation_id, c.source, c.actor_id::text as actor_id,
          c.confirmed_at = c.effective_at as manual_effective_at,
          c.event_type::text as event_type, c.ratable_eligible,
          c.proposal_version::int as version,
          a.confirmation_id::text as audit_confirmation_id,
          count(*) over ()::int as confirmation_count
        from public.match_event_result_proposals p
        join public.match_event_result_confirmations c on c.proposal_id = p.id
        join public.match_event_audit_log a on a.confirmation_id = c.id
        where p.id = '${outsiderSubmitter}'
      `);
      expect(manualRows).toEqual([
        {
          status: 'confirmed',
          confirmation_id: manualConfirmation,
          source: 'MANUAL',
          actor_id: manualEvent.players[2]!.id,
          manual_effective_at: true,
          event_type: 'friendly',
          ratable_eligible: false,
          version: 1,
          audit_confirmation_id: manualConfirmation,
          confirmation_count: 1
        }
      ]);

      const autoRows = await sqlRows(`
        select c.id::text as confirmation_id, c.source, c.actor_id::text as actor_id,
          c.effective_at = p.review_deadline_at as deadline_effective_at,
          c.confirmed_at >= p.review_deadline_at as confirmed_after_deadline,
          p.status
        from public.match_event_result_confirmations c
        join public.match_event_result_proposals p on p.id = c.proposal_id
        where c.proposal_id in ('${autoZeroVotes}', '${autoPartialVotes}')
        order by c.match_event_id, c.group_number
      `);
      expect(autoRows).toHaveLength(2);
      expect(autoRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            source: 'AUTO_48H',
            actor_id: null,
            deadline_effective_at: true,
            confirmed_after_deadline: true,
            status: 'confirmed'
          })
        ])
      );

      const manualOfficial = await officialResults(f.creator, manualEvent.id);
      expect(manualOfficial.error).toBeNull();
      expect(manualOfficial.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            confirmation_id: manualConfirmation,
            proposal_id: outsiderSubmitter,
            version: 1,
            source: 'MANUAL',
            teams: {
              team_a: [manualEvent.players[0]!.id, manualEvent.players[1]!.id],
              team_b: [manualEvent.players[2]!.id, manualEvent.players[3]!.id]
            }
          }),
          expect.objectContaining({
            confirmation_id: automaticZeroVoteConfirmation,
            proposal_id: autoZeroVotes,
            version: 1,
            source: 'AUTO_48H'
          })
        ])
      );
      const automaticOfficial = await officialResults(f.creator, autoEvent.id);
      expect(automaticOfficial.error).toBeNull();
      expect(automaticOfficial.data).toEqual([
        expect.objectContaining({
          confirmation_id: automaticPartialVoteConfirmation,
          proposal_id: autoPartialVotes,
          version: 1,
          source: 'AUTO_48H'
        })
      ]);

      const manualReader = await f.creator.client
        .from('match_event_result_reviews')
        .select('id')
        .eq('proposal_id', outsiderSubmitter);
      expect(manualReader.error).toBeNull();
      expect(manualReader.data).toHaveLength(4);
      const participantReader = await manualEvent.players[0]!.client.from(
        'match_event_result_reviews'
      )
        .select('id')
        .eq('proposal_id', outsiderSubmitter);
      expect(participantReader.error).toBeNull();
      expect(participantReader.data).toHaveLength(4);
      const adminReader = await submitter.client
        .from('match_event_result_reviews')
        .select('id')
        .eq('proposal_id', outsiderSubmitter);
      expect(adminReader.error).toBeNull();
      expect(adminReader.data).toHaveLength(4);
      const unrelatedReader = await outsider.client
        .from('match_event_result_reviews')
        .select('id')
        .eq('proposal_id', outsiderSubmitter);
      expect(unrelatedReader.error).toBeNull();
      expect(unrelatedReader.data).toEqual([]);

      for (const actor of [f.creator, manualEvent.players[0]!, submitter]) {
        const confirmations = await actor.client
          .from('match_event_result_confirmations')
          .select('id')
          .eq('proposal_id', outsiderSubmitter);
        expect(confirmations.error).toBeNull();
        expect(confirmations.data).toEqual([{ id: manualConfirmation }]);
      }
      const unauthorizedReader = await outsider.client
        .from('match_event_result_confirmations')
        .select('id')
        .eq('match_event_id', manualEvent.id);
      expect(unauthorizedReader.error).toBeNull();
      expect(unauthorizedReader.data).toEqual([]);
      const unauthorizedOfficialReader = await officialResults(outsider, manualEvent.id);
      expect(unauthorizedOfficialReader.error?.message).toBe('MATCH_RESULT_FORBIDDEN');

      // Protected identity and lifecycle boundaries reject direct mutation,
      // version skipping, unfounded status changes, and deletion.
      await expect(
        fixtureSql(
          `update public.match_event_result_proposals set group_number = 3 where id = '${outsiderSubmitter}'`
        )
      ).rejects.toThrow(/23514/);
      await expect(
        fixtureSql(
          `update public.match_event_result_proposals set status = 'pending' where id = '${outsiderSubmitter}'`
        )
      ).rejects.toThrow(/23514/);
      await expect(
        fixtureSql(
          `update public.match_event_result_proposals set active_version = 3 where id = '${disputed}'`
        )
      ).rejects.toThrow(/23514/);
      await expect(
        fixtureSql(`delete from public.match_event_result_proposals where id = '${disputed}'`)
      ).rejects.toThrow(/23514/);
      await expect(
        fixtureSql(
          `update public.match_event_result_confirmations set effective_at = now() where id = '${manualConfirmation}'`
        )
      ).rejects.toThrow(/23514/);
      await expect(
        fixtureSql(
          `delete from public.match_event_result_confirmations where id = '${manualConfirmation}'`
        )
      ).rejects.toThrow(/23514/);

      const disputedOfficial = await officialResults(f.creator, autoEvent.id);
      expect(disputedOfficial.data).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ proposal_id: disputed })])
      );
      const deniedInternalCall = await f.rpc(f.creator, 'finalize_match_event_result_locked', {
        p_proposal_id: disputed,
        p_expected_version: 1,
        p_source: 'AUTO_48H',
        p_actor_id: null
      });
      expect(deniedInternalCall.error).not.toBeNull();
    },
    120_000
  );
});
