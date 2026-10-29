import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  reviewResultSets
} from './helpers/match-result-review-fixtures';
import {
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const sortIds = (values: readonly string[]) =>
  [...values].sort((left, right) => left.localeCompare(right));

describe.skipIf(!environment.env)('transactional result notifications', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;

  beforeAll(async () => {
    if (!environment.env) throw new Error(environment.reason);
    f = await createMatchResultReviewFixtures(environment.env);
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  async function resultAlerts(eventId: string) {
    return sqlRows(`
      select n.id::text as id, n.recipient_user_id::text as recipient_user_id,
             n.event_key, n.kind, n.category, n.target_type,
             n.target_id::text as target_id, n.community_id::text as community_id
        from public.notifications n
       where n.category = 'results' and n.target_id = '${eventId}'
       order by n.event_key, n.recipient_user_id
    `);
  }

  async function links(eventId: string) {
    return sqlRows(`
      select n.event_key, link.proposal_id::text as proposal_id,
             link.proposal_version::int as proposal_version,
             link.confirmation_id::text as confirmation_id,
             n.recipient_user_id::text as recipient_user_id
        from public.notification_result_links link
        join public.notifications n on n.id = link.notification_id
       where link.match_event_id = '${eventId}'
       order by n.event_key, n.recipient_user_id
    `);
  }

  async function correct(proposalId: string, groupNumber: number, version: number) {
    return f.rpc(f.admin, 'correct_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: version,
      p_teams: f.teamsForGroup(groupNumber),
      p_sets: reviewResultSets,
      p_played_local: reviewResultPlayedAt,
      p_court_label: 'Court 4',
      p_request_id: crypto.randomUUID()
    });
  }

  async function review(
    actorIndex: number,
    proposalId: string,
    version: number,
    decision: 'approve' | 'reject'
  ) {
    return f.rpc(f.players[actorIndex]!, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: version,
      p_decision: decision,
      p_reason_code: decision === 'reject' ? 'SCORE_INCORRECT' : null,
      p_reason_note: null,
      p_request_id: crypto.randomUUID()
    });
  }

  async function setPushDisabled(userId: string) {
    await fixtureSql(`
      insert into public.notification_preferences(
        user_id, push_enabled, push_community, push_matches, push_results, push_rankings, push_leagues
      ) values ('${userId}', false, false, false, false, false, false)
      on conflict (user_id) do update set
        push_enabled = false, push_community = false, push_matches = false,
        push_results = false, push_rankings = false, push_leagues = false
    `);
  }

  async function installAlertFailure(eventId: string, eventKeyPrefix: string) {
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const functionName = `paf_result_alert_failure_${suffix}`;
    const triggerName = `paf_result_alert_failure_trigger_${suffix}`;
    await fixtureSql(`
      create function public.${functionName}()
      returns trigger language plpgsql set search_path = '' as $$
      begin
        raise exception using errcode = 'P0001', message = 'FIXTURE_RESULT_ALERT_FAILURE';
      end $$;
      create trigger ${triggerName}
        before insert on public.notifications
        for each row when (
          new.target_id = '${eventId}'::uuid
          and new.event_key like '${eventKeyPrefix}%'
        ) execute function public.${functionName}();
    `);
    return async () => {
      await fixtureSql(`
        drop trigger if exists ${triggerName} on public.notifications;
        drop function if exists public.${functionName}();
      `);
    };
  }

  it('fans out exact versioned recipients through correction, dispute and manual confirmation', async () => {
    const eventId = await f.protectedEvent({ reserve: true });
    const submitter = f.admin;
    const groupNumber = 2;
    const quartet = f.players.slice(4, 8);
    const creator = f.creator;
    const outsider = f.outsider;
    const reserve = f.reserve;
    const pushDisabled = quartet[0]!;
    await setPushDisabled(pushDisabled.id);

    const submitted = await f.submit(eventId, { submitter, groupNumber });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data).proposal_id);
    const v1Key = `result.submitted:${proposalId}:v1`;
    const firstSet = (await resultAlerts(eventId)).filter((row) => row['event_key'] === v1Key);
    expect(firstSet).toHaveLength(5);
    expect(sortIds(firstSet.map((row) => String(row['recipient_user_id'])))).toEqual(
      sortIds([...quartet.map((player) => player.id), creator.id])
    );
    expect(firstSet.filter((row) => row['kind'] === 'result_review_needed')).toHaveLength(4);
    expect(firstSet.filter((row) => row['kind'] === 'result_added')).toHaveLength(1);
    for (const row of firstSet)
      expect(row).toMatchObject({
        category: 'results',
        target_type: 'result_available',
        target_id: eventId,
        community_id: f.communityId
      });
    expect(firstSet.some((row) => row['recipient_user_id'] === reserve.id)).toBe(false);
    expect(firstSet.some((row) => row['recipient_user_id'] === outsider.id)).toBe(false);
    expect(
      (await pushDisabled.client.from('notifications').select('id').eq('event_key', v1Key)).data
    ).toHaveLength(1);
    const firstLinks = (await links(eventId)).filter((row) => row['event_key'] === v1Key);
    expect(firstLinks).toHaveLength(firstSet.length);
    expect(sortIds(firstLinks.map((row) => String(row['recipient_user_id'])))).toEqual(
      sortIds(firstSet.map((row) => String(row['recipient_user_id'])))
    );
    for (const link of firstLinks)
      expect(link).toMatchObject({
        event_key: v1Key,
        proposal_id: proposalId,
        proposal_version: 1,
        confirmation_id: null
      });

    const recipientV1 = firstSet.find((row) => row['recipient_user_id'] === quartet[0]!.id)!;
    const v1Context = await quartet[0]!.client.rpc('get_my_result_notification_contexts', {
      p_notification_ids: [String(recipientV1['id'])]
    });
    expect(v1Context.error).toBeNull();
    expect(v1Context.data).toHaveLength(1);
    expect(v1Context.data?.[0]).toMatchObject({
      notification_id: recipientV1['id'],
      match_event_id: eventId,
      proposal_id: proposalId,
      proposal_version: 1,
      group_number: 2,
      proposal_status: 'pending',
      current_version: 1,
      current_status: 'pending',
      is_current: true,
      score: '6–4'
    });
    expect(
      (
        await outsider.client.rpc('get_my_notification_target_v3', {
          p_notification_id: String(recipientV1['id'])
        })
      ).error?.code
    ).toBe('42501');

    const correctionV2 = await correct(proposalId, groupNumber, 1);
    expect(correctionV2.error).toBeNull();
    expect(asRecord(correctionV2.data)).toMatchObject({ version: 2, status: 'pending' });
    const v2Key = `result.submitted:${proposalId}:v2`;
    const v2Set = (await resultAlerts(eventId)).filter((row) => row['event_key'] === v2Key);
    expect(v2Set).toHaveLength(5);
    expect(sortIds(v2Set.map((row) => String(row['recipient_user_id'])))).toEqual(
      sortIds([...quartet.map((player) => player.id), creator.id])
    );
    expect(v2Set.filter((row) => row['kind'] === 'result_review_needed')).toHaveLength(4);
    expect(v2Set.filter((row) => row['kind'] === 'result_corrected')).toHaveLength(1);

    const historical = await quartet[0]!.client.rpc('get_my_result_notification_contexts', {
      p_notification_ids: [String(recipientV1['id'])]
    });
    expect(historical.data?.[0]).toMatchObject({
      proposal_version: 1,
      proposal_status: 'superseded',
      current_version: 2,
      current_status: 'pending',
      is_current: false
    });
    const target = await quartet[0]!.client
      .rpc('get_my_notification_target_v3', { p_notification_id: String(recipientV1['id']) })
      .single();
    expect(target.error).toBeNull();
    expect(target.data).toMatchObject({
      target_status: 'result_available',
      match_event_id: eventId,
      result_context: { proposal_version: 1, current_version: 2, is_current: false }
    });
    expect(await links(eventId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event_key: v1Key, proposal_version: 1 }),
        expect.objectContaining({ event_key: v2Key, proposal_version: 2 })
      ])
    );

    const disputed = await review(5, proposalId, 2, 'reject');
    expect(disputed.error).toBeNull();
    expect(asRecord(disputed.data)).toMatchObject({ status: 'disputed', version: 2 });
    const disputeKey = `result.disputed:${proposalId}:v2`;
    const disputeSet = (await resultAlerts(eventId)).filter(
      (row) => row['event_key'] === disputeKey
    );
    expect(disputeSet).toHaveLength(5);
    expect(sortIds(disputeSet.map((row) => String(row['recipient_user_id'])))).toEqual(
      sortIds([...quartet.map((player) => player.id), creator.id])
    );
    expect(disputeSet.every((row) => row['kind'] === 'result_disputed')).toBe(true);

    const correctionV3 = await correct(proposalId, groupNumber, 2);
    expect(correctionV3.error).toBeNull();
    expect(asRecord(correctionV3.data)).toMatchObject({ version: 3, status: 'pending' });
    const approvalA = await review(4, proposalId, 3, 'approve');
    expect(asRecord(approvalA.data)).toMatchObject({ status: 'pending' });
    const approvalB = await review(6, proposalId, 3, 'approve');
    expect(approvalB.error).toBeNull();
    expect(asRecord(approvalB.data)).toMatchObject({ status: 'confirmed', version: 3 });
    const [confirmation] = await sqlRows(`
      select id::text as id from public.match_event_result_confirmations
       where proposal_id = '${proposalId}' and proposal_version = 3
    `);
    const confirmationId = String(confirmation?.['id']);
    const confirmedKey = `result.confirmed:${confirmationId}`;
    const confirmedSet = (await resultAlerts(eventId)).filter(
      (row) => row['event_key'] === confirmedKey
    );
    const expectedConfirmationRecipients = sortIds([
      ...new Set([...quartet.map((player) => player.id), creator.id])
    ]);
    expect(confirmedSet).toHaveLength(expectedConfirmationRecipients.length);
    expect(sortIds(confirmedSet.map((row) => String(row['recipient_user_id'])))).toEqual(
      expectedConfirmationRecipients
    );
    expect(confirmedSet.every((row) => row['kind'] === 'result_confirmed')).toBe(true);
    const confirmationLinks = (await links(eventId)).filter(
      (row) => row['event_key'] === confirmedKey
    );
    expect(confirmationLinks).toHaveLength(confirmedSet.length);
    for (const link of confirmationLinks)
      expect(link).toMatchObject({
        event_key: confirmedKey,
        proposal_id: proposalId,
        proposal_version: 3,
        confirmation_id: confirmationId
      });
    expect((await resultAlerts(eventId)).filter((row) => row['event_key'] === v1Key)).toHaveLength(
      5
    );
    expect((await resultAlerts(eventId)).filter((row) => row['event_key'] === v2Key)).toHaveLength(
      5
    );
    expect(
      (await resultAlerts(eventId)).filter((row) => row['event_key'] === disputeKey)
    ).toHaveLength(5);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_audit_log
        where match_event_id = '${eventId}' and action = 'result_confirmed'`)
    ).toEqual([{ count: 1 }]);
  });

  it('rolls submission and confirmation back with failed fanout, then retries to one notification set', async () => {
    const eventId = await f.protectedEvent();
    const removeSubmissionFailure = await installAlertFailure(eventId, 'result.submitted:');
    try {
      const failed = await f.submit(eventId, { submitter: f.creator });
      expect(failed.error?.message).toContain('FIXTURE_RESULT_ALERT_FAILURE');
    } finally {
      await removeSubmissionFailure();
    }
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_proposals
        where match_event_id = '${eventId}'`)
    ).toEqual([{ count: 0 }]);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_audit_log
        where match_event_id = '${eventId}' and action = 'result_confirmed'`)
    ).toEqual([{ count: 0 }]);
    expect(await resultAlerts(eventId)).toEqual([]);

    const submitted = await f.submit(eventId, { submitter: f.creator });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data).proposal_id);
    const removeConfirmationFailure = await installAlertFailure(eventId, 'result.confirmed:');
    const requestId = crypto.randomUUID();
    const retryArgs = {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_reason_code: null,
      p_reason_note: null,
      p_request_id: requestId
    };
    try {
      const failed = await f.rpc(f.players[2]!, 'review_match_event_result', retryArgs);
      expect(failed.error?.message).toContain('FIXTURE_RESULT_ALERT_FAILURE');
    } finally {
      await removeConfirmationFailure();
    }
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_reviews
        where proposal_id = '${proposalId}'`)
    ).toEqual([{ count: 0 }]);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_confirmations
        where proposal_id = '${proposalId}'`)
    ).toEqual([{ count: 0 }]);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_audit_log
        where match_event_id = '${eventId}' and action = 'result_confirmed'`)
    ).toEqual([{ count: 0 }]);
    expect(
      (await resultAlerts(eventId)).some((row) =>
        String(row['event_key']).startsWith('result.confirmed:')
      )
    ).toBe(false);

    const retry = await f.rpc(f.players[2]!, 'review_match_event_result', retryArgs);
    expect(retry.error).toBeNull();
    expect(asRecord(retry.data)).toMatchObject({ status: 'confirmed', version: 1 });
    const [confirmed] = await sqlRows(`select id::text as id
      from public.match_event_result_confirmations where proposal_id = '${proposalId}'`);
    const confirmedKey = `result.confirmed:${String(confirmed?.['id'])}`;
    const expectedRecipients = sortIds([
      ...new Set([...f.players.slice(0, 4).map((player) => player.id), f.creator.id])
    ]);
    const confirmationAlerts = (await resultAlerts(eventId)).filter(
      (row) => row['event_key'] === confirmedKey
    );
    expect(confirmationAlerts).toHaveLength(expectedRecipients.length);
    expect(sortIds(confirmationAlerts.map((row) => String(row['recipient_user_id'])))).toEqual(
      expectedRecipients
    );
    expect(confirmationAlerts.every((row) => row['kind'] === 'result_confirmed')).toBe(true);
    const confirmationLinks = (await links(eventId)).filter(
      (row) => row['event_key'] === confirmedKey
    );
    expect(confirmationLinks).toHaveLength(expectedRecipients.length);
    for (const link of confirmationLinks)
      expect(link).toMatchObject({
        event_key: confirmedKey,
        proposal_id: proposalId,
        proposal_version: 1,
        confirmation_id: confirmed?.['id']
      });
    const submittedAlerts = (await resultAlerts(eventId)).filter((row) =>
      String(row['event_key']).startsWith(`result.submitted:${proposalId}:v1`)
    );
    expect(submittedAlerts).toHaveLength(expectedRecipients.length);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_audit_log
        where match_event_id = '${eventId}' and action = 'result_confirmed'`)
    ).toEqual([{ count: 1 }]);
  });

  it('sends once-per-version reminders and current-creator entry-ready alerts using database time', async () => {
    const eventId = await f.protectedEvent();
    await setPushDisabled(f.creator.id);
    const submitted = await f.submit(eventId, { submitter: f.admin });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data).proposal_id);
    await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60);

    const firstRun = await processDueMatchEventResults();
    expect(firstRun).toMatchObject({
      attempted: 0,
      confirmed: 0,
      alerts: { reminders: 4, entry_ready: 0, failed: 0 }
    });
    const deadlineKey = `result.deadline:${proposalId}:v1`;
    const reminderSet = (await resultAlerts(eventId)).filter(
      (row) => row['event_key'] === deadlineKey
    );
    expect(reminderSet).toHaveLength(4);
    expect(sortIds(reminderSet.map((row) => String(row['recipient_user_id'])))).toEqual(
      sortIds(f.players.slice(0, 4).map((player) => player.id))
    );
    expect(reminderSet.every((row) => row['kind'] === 'result_deadline_reminder')).toBe(true);
    expect(reminderSet.every((row) => row['target_type'] === 'result_available')).toBe(true);
    expect(
      (await f.creator.client.from('notifications').select('id').eq('event_key', deadlineKey)).data
    ).toHaveLength(1);
    const retryRun = await processDueMatchEventResults();
    expect(retryRun).toMatchObject({ alerts: { reminders: 0, failed: 0 } });
    expect(
      (await resultAlerts(eventId)).filter((row) => row['event_key'] === deadlineKey)
    ).toHaveLength(4);

    await fixtureSql(`do $$
      declare v_start timestamptz := pg_catalog.clock_timestamp() - interval '2 hours';
    begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events
         set starts_at = v_start,
             duration_minutes = 60,
             registration_cutoff_at = v_start - interval '1 hour'
       where id = '${eventId}';
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    const readyRun = await processDueMatchEventResults();
    expect(readyRun).toMatchObject({ alerts: { reminders: 0, entry_ready: 1, failed: 0 } });
    const readyKey = `result.entry_ready:${eventId}`;
    const ready = (await resultAlerts(eventId)).filter((row) => row['event_key'] === readyKey);
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({
      recipient_user_id: f.creator.id,
      kind: 'result_entry_ready',
      target_type: 'match_event',
      target_id: eventId,
      community_id: f.communityId
    });
    expect((await processDueMatchEventResults()).alerts).toMatchObject({ entry_ready: 0 });
    expect(
      (await resultAlerts(eventId)).filter((row) => row['event_key'] === readyKey)
    ).toHaveLength(1);

    const readyContext = await f.creator.client.rpc('get_my_result_notification_contexts', {
      p_notification_ids: [String(ready[0]?.['id'])]
    });
    expect(readyContext.error).toBeNull();
    expect(readyContext.data?.[0]).toMatchObject({
      notification_kind: 'result_entry_ready',
      match_event_id: eventId,
      proposal_id: null,
      entry_ready: true
    });
    const readyTarget = await f.creator.client
      .rpc('get_my_notification_target_v3', { p_notification_id: String(ready[0]?.['id']) })
      .single();
    expect(readyTarget.error).toBeNull();
    expect(readyTarget.data).toMatchObject({
      target_status: 'result_available',
      match_event_id: eventId,
      result_context: { entry_ready: true, match_event_id: eventId }
    });
  });

  it('notifies creator for finished frozen playable roster without a proposal, once only', async () => {
    const finishedEvent = await f.protectedEvent();
    await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set starts_at = pg_catalog.clock_timestamp() - interval '2 hours',
        duration_minutes = 60, registration_cutoff_at = pg_catalog.clock_timestamp() - interval '3 hours'
       where id = '${finishedEvent}';
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_proposals
      where match_event_id = '${finishedEvent}'`)
    ).toEqual([{ count: 0 }]);
    const finishedRun = await processDueMatchEventResults();
    expect(finishedRun.alerts).toMatchObject({ entry_ready: 1, failed: 0 });
    const finishedKey = `result.entry_ready:${finishedEvent}`;
    expect(
      (await resultAlerts(finishedEvent)).filter((row) => row['event_key'] === finishedKey)
    ).toMatchObject([
      {
        recipient_user_id: f.creator.id,
        kind: 'result_entry_ready',
        target_id: finishedEvent
      }
    ]);
    expect((await processDueMatchEventResults()).alerts).toMatchObject({ entry_ready: 0 });
    expect(
      (await resultAlerts(finishedEvent)).filter((row) => row['event_key'] === finishedKey)
    ).toHaveLength(1);

    const upcomingEvent = await f.protectedEvent();
    expect((await processDueMatchEventResults()).alerts).toMatchObject({ entry_ready: 0 });
    expect(
      (await resultAlerts(upcomingEvent)).filter(
        (row) => row['event_key'] === `result.entry_ready:${upcomingEvent}`
      )
    ).toHaveLength(0);

    const incomplete = await f.event({ accepted: f.players.slice(1, 3) });
    await f.setCutoff(incomplete.id, "now()-interval '1 minute'");
    await f.protectResults(incomplete.id);
    await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set starts_at = pg_catalog.clock_timestamp() - interval '2 hours',
        duration_minutes = 60, registration_cutoff_at = pg_catalog.clock_timestamp() - interval '3 hours'
       where id = '${incomplete.id}';
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set status = 'cancelled', cancelled_at = pg_catalog.clock_timestamp(),
        cancelled_by = '${f.creator.id}', cancel_reason = 'fixture cancellation'
       where id = '${upcomingEvent}';
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    expect((await processDueMatchEventResults()).alerts).toMatchObject({ entry_ready: 0 });
    expect(
      (await resultAlerts(incomplete.id)).filter(
        (row) => row['event_key'] === `result.entry_ready:${incomplete.id}`
      )
    ).toHaveLength(0);
    expect(
      (await resultAlerts(upcomingEvent)).filter(
        (row) => row['event_key'] === `result.entry_ready:${upcomingEvent}`
      )
    ).toHaveLength(0);
  });

  it('backs off poison reminder rows and lets later bounded-batch candidates progress', async () => {
    const candidates: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < 3; index += 1) {
      const eventId = await f.protectedEvent();
      const submission = await f.submit(eventId, { submitter: f.admin });
      expect(submission.error).toBeNull();
      const proposalId = String(asRecord(submission.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60);
      candidates.push({ eventId, proposalId });
    }
    const poison = candidates[0]!;
    const removeFailure = await installAlertFailure(poison.eventId, 'result.deadline:');
    try {
      const [firstRow] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(2, 1) as result'
      );
      expect(asRecord(firstRow?.['result'])).toMatchObject({ reminders: 4, failed: 1 });
      const [firstState] = await sqlRows(`select attempt_count, failure_count,
        last_failure_message, next_attempt_at > pg_catalog.clock_timestamp() as backed_off
        from public.match_result_alert_processing_state
        where alert_kind = 'deadline' and candidate_id = '${poison.proposalId}'
          and candidate_version = 1`);
      expect(firstState).toMatchObject({
        attempt_count: 1,
        failure_count: 1,
        last_failure_message: 'Lifecycle alert failed; retry is scheduled.',
        backed_off: true
      });
      expect(
        (await resultAlerts(candidates[1]!.eventId)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(4);

      const [backoffRow] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(2, 1) as result'
      );
      expect(asRecord(backoffRow?.['result'])).toMatchObject({ reminders: 4, failed: 0 });
      expect(
        (await resultAlerts(candidates[2]!.eventId)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(4);
      const [stillBackedOff] =
        await sqlRows(`select attempt_count from public.match_result_alert_processing_state
        where alert_kind = 'deadline' and candidate_id = '${poison.proposalId}'
          and candidate_version = 1`);
      expect(stillBackedOff?.['attempt_count']).toBe(1);
    } finally {
      await removeFailure();
    }

    await fixtureSql(`update public.match_result_alert_processing_state
      set next_attempt_at = pg_catalog.clock_timestamp() - interval '1 second'
      where alert_kind = 'deadline' and candidate_id = '${poison.proposalId}'
        and candidate_version = 1`);
    const [retryRow] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(2, 1) as result'
    );
    expect(asRecord(retryRow?.['result'])).toMatchObject({ reminders: 4, failed: 0 });
    const [retriedState] = await sqlRows(`select attempt_count, failure_count,
      last_failure_message, next_attempt_at from public.match_result_alert_processing_state
      where alert_kind = 'deadline' and candidate_id = '${poison.proposalId}'
        and candidate_version = 1`);
    expect(retriedState).toMatchObject({ attempt_count: 2, failure_count: 0 });
    expect(retriedState?.['last_failure_message']).toBeNull();
    expect(retriedState?.['next_attempt_at']).toBeNull();
    expect(
      (await resultAlerts(poison.eventId)).filter((row) =>
        String(row['event_key']).startsWith('result.deadline:')
      )
    ).toHaveLength(4);
  });
});
