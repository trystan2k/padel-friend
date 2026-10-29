import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  sleep,
  sqlRows,
  startSql,
  waitForRows
} from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  reviewResultSets
} from './helpers/match-result-review-fixtures';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import {
  advanceTrustedResultSchedulerClock,
  makeMatchResultAlertRetriesDue,
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const sortIds = (values: readonly string[]) =>
  [...values].sort((left, right) => left.localeCompare(right));

describe.skipIf(!environment.env)('transactional result notifications', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;
  let restoreAlertSchedule: (() => Promise<void>) | null = null;
  const syntheticAuthPrefixes: string[] = [];

  beforeAll(async () => {
    if (!environment.env) throw new Error(environment.reason);
    f = await createMatchResultReviewFixtures(environment.env);
    const [job] = await sqlRows(`select jobid::integer as jobid, active, schedule, command
      from cron.job where jobname = 'padel-friend-match-result-auto-confirm'`);
    if (job?.['active'] === true) {
      await fixtureSql(`select cron.unschedule(${Number(job['jobid'])})`);
      const schedule = String(job['schedule']).replaceAll("'", "''");
      const command = String(job['command']).replaceAll("'", "''");
      restoreAlertSchedule = async () => {
        await fixtureSql(`select cron.schedule(
          'padel-friend-match-result-auto-confirm', '${schedule}', '${command}'
        )`);
        restoreAlertSchedule = null;
      };
    }
  });

  beforeEach(async () => {
    await fixtureSql(`update public.match_result_alert_scan_state
      set resume_effective_key = null, resume_candidate_id = null,
          resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
  });

  afterAll(async () => {
    try {
      if (f) await f.cleanup();
      for (const prefix of syntheticAuthPrefixes)
        await fixtureSql(`delete from auth.users where email like '${prefix}-%@test.local'`);
    } finally {
      try {
        await fixtureSql(`update public.match_result_alert_scan_state
          set resume_effective_key = null, resume_candidate_id = null,
              resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
      } finally {
        if (restoreAlertSchedule) await restoreAlertSchedule();
      }
    }
  }, 120_000);

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

  async function finishedEntryEvent(startsOffsetHours: number, includeReserve = false) {
    const event = await f.protectedEvent({ reserve: includeReserve });
    await fixtureSql(`do $$ declare v_start timestamptz := pg_catalog.clock_timestamp() - interval '${startsOffsetHours} hours';
      begin
        alter table public.match_events disable trigger match_event_immutable;
        update public.match_events set starts_at = v_start, duration_minutes = 60,
          registration_cutoff_at = v_start - interval '1 hour' where id = '${event}';
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    return event;
  }

  async function finishedFourPlayerEntryEvent(startsOffsetHours: number) {
    const event = await f.event({ accepted: f.players.slice(1, 4) });
    await fixtureSql(`do $$ declare v_start timestamptz := pg_catalog.clock_timestamp() - interval '${startsOffsetHours} hours';
      begin
        alter table public.match_events disable trigger match_event_immutable;
        update public.match_events set starts_at = v_start, duration_minutes = 60,
          registration_cutoff_at = v_start - interval '1 hour' where id = '${event.id}';
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    return event.id;
  }

  async function entryReadyDueBase(excludedEventIds: readonly string[]): Promise<string> {
    const excluded = excludedEventIds.map((eventId) => `'${eventId}'`).join(', ');
    const [row] = await sqlRows(`select (
        coalesce(min(queue.due_at), pg_catalog.clock_timestamp()) - interval '1 day'
      )::text as due_at
      from public.match_result_alert_entry_ready_queue queue
      where queue.active and queue.due_at <= pg_catalog.clock_timestamp()
        and queue.match_event_id <> all(array[${excluded}]::uuid[])`);
    return String(row?.['due_at']);
  }

  async function setEntryReadyQueueTime(
    eventId: string,
    dueBase: string,
    offsetSeconds: number,
    ageHours = 0
  ) {
    if (!Number.isSafeInteger(offsetSeconds) || !Number.isSafeInteger(ageHours))
      throw new Error('Invalid entry-ready queue timing fixture');
    await fixtureSql(`update public.match_result_alert_entry_ready_queue
      set due_at = '${dueBase}'::timestamptz
            + pg_catalog.make_interval(secs => ${offsetSeconds}),
          enqueued_at = pg_catalog.clock_timestamp()
            - pg_catalog.make_interval(hours => ${ageHours})
      where match_event_id = '${eventId}'`);
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

  async function acquireVerifiedRowLock(
    marker: string,
    lockSql: string,
    probeSql: string,
    timeoutMs = 30_000
  ) {
    const holder = startSql(`/* ${marker} */ ${lockSql}`, { timeoutMs });
    try {
      const holderPid = await holder.backendPid;
      await waitForRows(
        `select pid from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and pid = ${holderPid} and state = 'active'`,
        (rows) => rows.length === 1,
        `${marker} row-lock holder`
      );
      const probeMarker = `${marker}-probe`;
      const probe = startSql(`/* ${probeMarker} */ ${probeSql}`);
      try {
        await waitForRows(
          `select pid from pg_catalog.pg_stat_activity a
            where a.query like '%${probeMarker}%'
              and a.wait_event_type = 'Lock'
              and ${holderPid} = any(pg_catalog.pg_blocking_pids(a.pid))`,
          (rows) => rows.length === 1,
          `${marker} row-lock probe`
        );
      } finally {
        await probe.stop();
      }
      return holder;
    } catch (error) {
      await holder.stop();
      throw error;
    }
  }

  async function acquireVerifiedEventLocks(
    eventIds: readonly string[],
    markerPrefix: string,
    timeoutMs = 30_000
  ): Promise<Array<ReturnType<typeof startSql>>> {
    const holders: Array<ReturnType<typeof startSql>> = [];
    try {
      for (const [index, eventId] of eventIds.entries()) {
        const marker = `${markerPrefix}-${index}-${crypto.randomUUID().replaceAll('-', '')}`;
        holders.push(
          await acquireVerifiedRowLock(
            marker,
            `select pg_catalog.pg_sleep(900)
              from (select id from public.match_events where id = '${eventId}' for update) locked;`,
            `select id from public.match_events where id = '${eventId}' for update;`,
            timeoutMs
          )
        );
      }
      return holders;
    } catch (error) {
      await Promise.all(holders.map((holder) => holder.stop()));
      throw error;
    }
  }

  async function runPoisonBacklog(kind: 'deadline' | 'entry_ready', poisonCount: 1 | 4) {
    const healthyCount = poisonCount * 2;
    const poisonEvents: string[] = [];
    const poisonProposalIds: string[] = [];
    const healthyEvents: string[] = [];

    if (kind === 'deadline') {
      for (let index = 0; index < poisonCount; index += 1) {
        const eventId = await f.protectedEvent();
        const submitted = await f.submit(eventId, { submitter: f.admin });
        if (submitted.error) throw new Error('Poison reminder fixture submission failed');
        const proposalId = String(asRecord(submitted.data).proposal_id);
        await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + index);
        poisonEvents.push(eventId);
        poisonProposalIds.push(proposalId);
      }
      for (let index = 0; index < healthyCount; index += 1) {
        const eventId = await f.protectedEvent();
        const submitted = await f.submit(eventId, { submitter: f.admin });
        if (submitted.error) throw new Error('Healthy reminder fixture submission failed');
        const proposalId = String(asRecord(submitted.data).proposal_id);
        await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + 120 + index);
        healthyEvents.push(eventId);
      }
    } else {
      for (let index = 0; index < poisonCount; index += 1)
        poisonEvents.push(await finishedEntryEvent(40_020_000 - index, index === 0));
      for (let index = 0; index < healthyCount; index += 1)
        healthyEvents.push(await finishedEntryEvent(40_019_900 - index));
      const dueBase = await entryReadyDueBase([...poisonEvents, ...healthyEvents]);
      for (const [index, eventId] of poisonEvents.entries())
        await setEntryReadyQueueTime(eventId, dueBase, index, 23);
      for (const [index, eventId] of healthyEvents.entries())
        await setEntryReadyQueueTime(eventId, dueBase, 120 + index, 23);
    }

    const poisonIds = kind === 'deadline' ? poisonProposalIds : poisonEvents;
    const poisonIdSql = poisonIds.map((id) => `'${id}'`).join(',');
    const version = kind === 'deadline' ? 1 : 0;
    const resetScanCursor = async () => {
      await fixtureSql(`update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()
        where alert_kind = '${kind}'`);
    };
    const removeFailures = await Promise.all(
      poisonEvents.map((eventId) =>
        installAlertFailure(
          eventId,
          kind === 'deadline' ? 'result.deadline:' : 'result.entry_ready:'
        )
      )
    );
    const retryState = async (expectedAttempts: number, expectedFailure: number, delay: number) => {
      const rows = await sqlRows(`select attempt_count, failure_count, terminal_outcome,
          next_attempt_at, extract(epoch from (next_attempt_at - pg_catalog.clock_timestamp()))::int
            as retry_seconds, last_failure_code, last_failure_message
        from public.match_result_alert_processing_state
        where alert_kind = '${kind}'
          and candidate_id = any(array[${poisonIdSql}]::uuid[])
          and candidate_version = ${version}
        order by candidate_id`);
      expect(rows).toHaveLength(poisonCount);
      for (const row of rows) {
        expect(row).toMatchObject({
          attempt_count: expectedAttempts,
          failure_count: expectedFailure,
          terminal_outcome: expectedFailure >= 10 ? 'quarantined' : null,
          last_failure_code: 'P0001',
          last_failure_message: 'Lifecycle alert failed; recovery policy applied.'
        });
        expect(Number(row['retry_seconds'])).toBeGreaterThanOrEqual(delay - 10);
        expect(Number(row['retry_seconds'])).toBeLessThanOrEqual(delay);
      }
    };
    const queueState = async (active: boolean) => {
      const rows =
        kind === 'deadline'
          ? await sqlRows(`select count(*)::int as count, bool_and(active) as active
            from public.match_result_alert_deadline_queue
            where proposal_id = any(array[${poisonIdSql}]::uuid[]) and proposal_version = 1`)
          : await sqlRows(`select count(*)::int as count, bool_and(active) as active
            from public.match_result_alert_entry_ready_queue
            where match_event_id = any(array[${poisonIdSql}]::uuid[])`);
      expect(rows).toEqual([{ count: poisonCount, active }]);
    };

    try {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        if (attempt > 1) await makeMatchResultAlertRetriesDue(kind, poisonIds, version);
        await resetScanCursor();
        const [row] = await sqlRows(
          `select public.process_match_result_lifecycle_alerts(${poisonCount}, ${poisonCount}) as result`
        );
        expect(asRecord(row?.['result'])).toMatchObject({
          failed: poisonCount,
          ...(kind === 'deadline' ? { reminders: 0 } : { entry_ready: 0 })
        });
      }

      await retryState(10, 10, 60 * 60);
      await queueState(true);
      for (const eventId of poisonEvents) {
        const poisonNotifications = (await resultAlerts(eventId)).filter((item) =>
          String(item['event_key']).startsWith(
            kind === 'deadline' ? 'result.deadline:' : 'result.entry_ready:'
          )
        );
        expect(poisonNotifications).toHaveLength(0);
      }

      // First quarantined retry fails after 1h; next retry backs off for 2h.
      await makeMatchResultAlertRetriesDue(kind, poisonIds, version);
      await resetScanCursor();
      const [quarantineRetry] = await sqlRows(
        `select public.process_match_result_lifecycle_alerts(${poisonCount}, ${poisonCount}) as result`
      );
      expect(asRecord(quarantineRetry?.['result'])).toMatchObject({ failed: poisonCount });
      await retryState(11, 11, 2 * 60 * 60);
      await queueState(true);

      // Due tails progress on every tick while quarantine retry is not due.
      for (let tick = 0; tick < 2; tick += 1) {
        const [healthyTick] = await sqlRows(
          `select public.process_match_result_lifecycle_alerts(${poisonCount}, ${poisonCount}) as result`
        );
        expect(asRecord(healthyTick?.['result'])).toMatchObject({
          failed: 0,
          ...(kind === 'deadline' ? { reminders: poisonCount * 4 } : { entry_ready: poisonCount })
        });
        for (const eventId of healthyEvents.slice(tick * poisonCount, (tick + 1) * poisonCount)) {
          const notifications = (await resultAlerts(eventId)).filter((item) =>
            kind === 'deadline'
              ? String(item['event_key']).startsWith('result.deadline:')
              : item['event_key'] === `result.entry_ready:${eventId}`
          );
          expect(notifications).toHaveLength(kind === 'deadline' ? 4 : 1);
        }
      }

      // Fault clears; same proposal/event identity succeeds on its scheduled retry.
      await Promise.all(removeFailures.map((removeFailure) => removeFailure()));
      await makeMatchResultAlertRetriesDue(kind, poisonIds, version);
      await resetScanCursor();
      const [recovered] = await sqlRows(
        `select public.process_match_result_lifecycle_alerts(${poisonCount}, ${poisonCount}) as result`
      );
      expect(asRecord(recovered?.['result'])).toMatchObject({
        failed: 0,
        ...(kind === 'deadline' ? { reminders: poisonCount * 4 } : { entry_ready: poisonCount })
      });
      for (const eventId of poisonEvents) {
        const notifications = (await resultAlerts(eventId)).filter((item) =>
          String(item['event_key']).startsWith(
            kind === 'deadline' ? 'result.deadline:' : 'result.entry_ready:'
          )
        );
        expect(notifications).toHaveLength(kind === 'deadline' ? 4 : 1);
      }
      const recoveredState = await sqlRows(`select attempt_count, failure_count,
          terminal_outcome, next_attempt_at, last_failure_code, last_failure_message,
          roster_fingerprint
        from public.match_result_alert_processing_state
        where alert_kind = '${kind}'
          and candidate_id = any(array[${poisonIdSql}]::uuid[])
          and candidate_version = ${version}`);
      expect(recoveredState).toHaveLength(poisonCount);
      for (const row of recoveredState)
        expect(row).toMatchObject({
          attempt_count: 12,
          failure_count: 0,
          terminal_outcome: null,
          next_attempt_at: null,
          last_failure_code: null,
          last_failure_message: null,
          roster_fingerprint: null
        });
      await queueState(false);
    } finally {
      await Promise.all(removeFailures.map((removeFailure) => removeFailure()));
    }

    return { poisonEvents, poisonProposalIds, healthyEvents };
  }

  it('installs aged indexed queues with per-producer resume state and no retry deque', async () => {
    const indexes = await sqlRows(`select indexname, indexdef from pg_catalog.pg_indexes
      where schemaname = 'public'
        and indexname in (
          'match_result_alert_deadline_effective_scan_idx',
          'match_result_alert_entry_ready_effective_scan_idx',
          'match_event_registrations_entry_ready_playing_idx'
        )
      order by indexname`);
    expect(indexes.map((row) => String(row['indexname']))).toEqual([
      'match_event_registrations_entry_ready_playing_idx',
      'match_result_alert_deadline_effective_scan_idx',
      'match_result_alert_entry_ready_effective_scan_idx'
    ]);
    expect(
      String(
        indexes.find(
          (row) => row['indexname'] === 'match_result_alert_entry_ready_effective_scan_idx'
        )?.['indexdef']
      )
    ).toContain('WHERE active');
    expect(
      String(
        indexes.find(
          (row) => row['indexname'] === 'match_result_alert_deadline_effective_scan_idx'
        )?.['indexdef']
      )
    ).toContain('WHERE active');

    const [legacyTables] = await sqlRows(`select
        to_regclass('public.match_result_alert_retry_queue')::text as retry_queue,
        exists (
          select 1 from information_schema.columns
           where table_schema = 'public'
             and table_name = 'match_result_alert_processing_state'
             and column_name like 'cursor_%'
        ) as has_processing_cursor_columns,
        to_regclass('public.match_result_alert_scan_state')::text as scan_state,
        (select count(*)::int from public.match_result_alert_scan_state) as producer_states,
        (select relrowsecurity from pg_catalog.pg_class
          where oid = 'public.match_result_alert_scan_state'::regclass) as scan_state_rls,
        pg_catalog.has_table_privilege('authenticated',
          'public.match_result_alert_scan_state', 'select') as authenticated_can_read_scan_state,
        (select count(*)::int from information_schema.columns
          where table_schema = 'public'
            and table_name in ('match_result_alert_deadline_queue',
                               'match_result_alert_entry_ready_queue')
            and column_name = 'next_attempt_at') as queue_lock_defer_columns,
        extract(epoch from public.match_result_alert_aging_horizon())::int
          as aging_horizon_seconds`);
    expect(legacyTables).toEqual({
      retry_queue: null,
      has_processing_cursor_columns: false,
      scan_state: 'match_result_alert_scan_state',
      producer_states: 2,
      scan_state_rls: true,
      authenticated_can_read_scan_state: false,
      queue_lock_defer_columns: 2,
      aging_horizon_seconds: 86400
    });

    const [lockDefer] = await sqlRows(`select
        public.match_result_alert_lock_defer_interval(
          '00000000-0000-0000-0000-000000000001'
        ) = public.match_result_alert_lock_defer_interval(
          '00000000-0000-0000-0000-000000000001'
        ) as deterministic,
        extract(epoch from public.match_result_alert_lock_defer_interval(
          '00000000-0000-0000-0000-000000000001'
        ))::int as seconds`);
    expect(lockDefer?.['deterministic']).toBe(true);
    expect(Number(lockDefer?.['seconds'])).toBeGreaterThanOrEqual(120);
    expect(Number(lockDefer?.['seconds'])).toBeLessThanOrEqual(180);

    const [queueAccess] = await sqlRows(`select relation.relrowsecurity as rls_enabled,
        pg_catalog.has_table_privilege('anon', relation.oid, 'select') as anon_can_select,
        pg_catalog.has_table_privilege('authenticated', relation.oid, 'select') as authenticated_can_select
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace schema on schema.oid = relation.relnamespace
      where schema.nspname = 'public' and relation.relname = 'match_result_alert_entry_ready_queue'`);
    expect(queueAccess).toEqual({
      rls_enabled: true,
      anon_can_select: false,
      authenticated_can_select: false
    });

    const [definition] = await sqlRows(`select pg_catalog.pg_get_functiondef(
        'public.process_match_result_lifecycle_alerts(integer,integer,integer)'::regprocedure
      ) as definition,
      pg_catalog.obj_description(
        'public.process_match_result_lifecycle_alerts(integer,integer,integer)'::regprocedure,
        'pg_proc'
      ) as sla`);
    const source = String(definition?.['definition']);
    const sla = String(definition?.['sla']);
    expect(source).toContain('effective_key');
    expect(source).toContain('for update of queue skip locked');
    expect(source).toContain('public.match_result_alert_entry_ready_queue queue');
    expect(source).not.toContain('refcursor');
    expect(source).not.toContain('retry_queue');
    expect(source).toContain('p_max_examined integer DEFAULT 1000');
    expect(source).toContain('least(greatest(coalesce(p_max_examined, 1000), 1), 10000)');
    expect(source).toContain('resume_effective_key');
    expect(source).toContain('resume_candidate_id');
    expect(source).toContain('v_max_examined integer');
    expect(source).toContain('10000');
    expect(source).toContain('v_resume_exam_budget integer');
    expect(source).toContain('v_head_exam_budget integer');
    expect(source).toContain('if v_max_examined >= v_reminder_limit then');
    expect(source).toContain('if v_max_examined >= v_entry_ready_limit then');
    expect(source).toContain('v_resume_exam_budget := v_max_examined - v_head_budget');
    expect(source).toContain('v_head_exam_budget := v_head_budget');
    expect(source).toContain('v_resume_exam_budget := v_max_examined');
    expect(source).toContain('v_head_exam_budget := 0');
    expect(source).toContain('for update');
    expect(sla).toContain('T + ceil(D/C)*interval + defer_max');
    expect(sla).toContain('resumeBudget=ceil(L/2)');
    expect(sla).toContain('headBudget=floor(L/2)');
    expect(sla).toContain('ceil(dueHeadCount/headBudget)+1 runs');
    expect(sla).toContain(
      'Examination capacity is hard-reserved when p_max_examined >= claim limit'
    );
    expect(sla).toContain('resume examines at most p_max_examined-headBudget rows');
    expect(sla).toContain('head owns headBudget rows');
    expect(sla).toContain('zero suffix candidates examined');
    expect(sla).toContain('skipped by FOR UPDATE SKIP LOCKED');
    expect(sla).toContain('transaction-scoped and');
    expect(sla).toContain(
      'head receives its full reserved slots even when suffix rows are skipped by FOR UPDATE SKIP LOCKED'
    );
    expect(sla).toContain(
      'When p_max_examined < claim limit, insufficient capacity prevents the full reservation'
    );
    expect(sla).toContain(
      'At or above claim limit, examination cap is partitioned between both phases'
    );
    expect(sla).toContain('interval=60s');
    expect(sla).toContain('defer_max=180s');
    expect(sla).toContain('D_max=3,000');
    expect(sla).toContain('Quarantined retries count in D when due');
    expect(sla).toContain('canonical event locks acquired promptly');
    expect(sla).toContain('notification processing succeeds on claim');
    expect(sla).toContain('Candidates remain due and process as locks clear');
    expect(source).toContain('public.match_result_alert_lock_defer_interval');
    expect(source).toContain('queue.next_attempt_at');
    expect(
      source.match(
        /limit case when v_scan_phase = 0\s+then v_resume_exam_budget else v_head_exam_budget end/gi
      ) ?? []
    ).toHaveLength(2);
    expect(source).not.toContain('v_scan_examined');
  });

  it('M1 preserves producer cursors when every eligible suffix queue row is locked', async () => {
    const deadlineCandidates: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < 3; index += 1) {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + index * 60);
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set due_at = pg_catalog.clock_timestamp() - interval '50000000 hours'
              + pg_catalog.make_interval(secs => ${index * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where proposal_id = '${proposalId}' and proposal_version = 1`);
      deadlineCandidates.push({ eventId, proposalId });
    }

    const entryCandidates: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const eventId = await finishedEntryEvent(40_030_000 - index);
      await fixtureSql(`update public.match_result_alert_entry_ready_queue
        set due_at = pg_catalog.clock_timestamp() - interval '50000000 hours'
              + pg_catalog.make_interval(secs => ${index * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where match_event_id = '${eventId}'`);
      entryCandidates.push(eventId);
    }

    const deadlineAnchor = deadlineCandidates[0]!;
    const entryAnchor = entryCandidates[0]!;
    const deadlineSuffix = deadlineCandidates.slice(1).map(({ proposalId }) => `'${proposalId}'`);
    const entrySuffix = entryCandidates.slice(1).map((eventId) => `'${eventId}'`);
    await fixtureSql(`update public.match_result_alert_deadline_queue
      set active = false where proposal_id = '${deadlineAnchor.proposalId}' and proposal_version = 1;
      update public.match_result_alert_entry_ready_queue
      set active = false where match_event_id = '${entryAnchor}';
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.proposal_id,
             resume_candidate_version = queue.proposal_version,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_deadline_queue queue
       where state.alert_kind = 'deadline'
         and queue.proposal_id = '${deadlineAnchor.proposalId}' and queue.proposal_version = 1;
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.match_event_id,
             resume_candidate_version = 0,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_entry_ready_queue queue
       where state.alert_kind = 'entry_ready'
         and queue.match_event_id = '${entryAnchor}'`);

    const deadlineMarker = `paf8-m1-deadline-${crypto.randomUUID().replaceAll('-', '')}`;
    const entryMarker = `paf8-m1-entry-${crypto.randomUUID().replaceAll('-', '')}`;
    const holders: Array<ReturnType<typeof startSql>> = [];
    try {
      holders.push(
        await acquireVerifiedRowLock(
          deadlineMarker,
          `with locked_rows as materialized (
             select proposal_id from public.match_result_alert_deadline_queue
              where proposal_id = any(array[${deadlineSuffix.join(',')}]::uuid[])
                and proposal_version = 1 for update
           ) select pg_catalog.pg_sleep(900) from (select count(*) from locked_rows) acquired;`,
          `select proposal_id from public.match_result_alert_deadline_queue
            where proposal_id = '${deadlineCandidates[1]!.proposalId}' and proposal_version = 1
            for update;`
        )
      );
      holders.push(
        await acquireVerifiedRowLock(
          entryMarker,
          `with locked_rows as materialized (
             select match_event_id from public.match_result_alert_entry_ready_queue
              where match_event_id = any(array[${entrySuffix.join(',')}]::uuid[]) for update
           ) select pg_catalog.pg_sleep(900) from (select count(*) from locked_rows) acquired;`,
          `select match_event_id from public.match_result_alert_entry_ready_queue
            where match_event_id = '${entryCandidates[1]}' for update;`
        )
      );

      const eligibleSuffix = await sqlRows(`select
          (select count(*)::int from public.match_result_alert_deadline_queue queue
            join public.match_result_alert_deadline_queue anchor
              on anchor.proposal_id = '${deadlineAnchor.proposalId}'
             and anchor.proposal_version = 1
            where queue.proposal_id = any(array[${deadlineSuffix.join(',')}]::uuid[])
              and queue.proposal_version = 1 and queue.active
              and queue.due_at <= pg_catalog.clock_timestamp()
              and (queue.effective_key, queue.proposal_id, queue.proposal_version) >
                  (anchor.effective_key, anchor.proposal_id, anchor.proposal_version))
            as deadline_suffix,
          (select count(*)::int from public.match_result_alert_entry_ready_queue queue
            join public.match_result_alert_entry_ready_queue anchor
              on anchor.match_event_id = '${entryAnchor}'
            where queue.match_event_id = any(array[${entrySuffix.join(',')}]::uuid[])
              and queue.active and queue.due_at <= pg_catalog.clock_timestamp()
              and (queue.effective_key, queue.match_event_id) >
                  (anchor.effective_key, anchor.match_event_id)) as entry_suffix`);
      expect(eligibleSuffix).toEqual([{ deadline_suffix: 2, entry_suffix: 2 }]);
      const before =
        await sqlRows(`select alert_kind, resume_effective_key::text as resume_effective_key,
          resume_candidate_id::text as resume_candidate_id, resume_candidate_version::int as version
        from public.match_result_alert_scan_state order by alert_kind`);

      const [run] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(4, 4, 1000) as result'
      );
      expect(asRecord(run?.['result']).failed).toBe(0);
      const after =
        await sqlRows(`select alert_kind, resume_effective_key::text as resume_effective_key,
          resume_candidate_id::text as resume_candidate_id, resume_candidate_version::int as version
        from public.match_result_alert_scan_state order by alert_kind`);
      expect(after).toEqual(before);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false where proposal_id = any(array[${deadlineCandidates
          .map(({ proposalId }) => `'${proposalId}'`)
          .join(',')}]::uuid[]) and proposal_version = 1;
        update public.match_result_alert_entry_ready_queue
        set active = false where match_event_id = any(array[${entryCandidates
          .map((eventId) => `'${eventId}'`)
          .join(',')}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  });

  it('M2 revisits deferred heads within the head-budget bound during sustained arrivals', async () => {
    const claimLimit = 4;
    const resumeBudget = Math.ceil(claimLimit / 2);
    const headBudget = claimLimit - resumeBudget;
    const dueHeadCount = 5;
    const arrivalsPerTick = resumeBudget + 1;
    const maxRuns = Math.ceil(dueHeadCount / headBudget) + 1;
    const ancientDueBase = "pg_catalog.clock_timestamp() - interval '50000000 hours'";

    const makeDeadline = async (order: number) => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60);
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where proposal_id = '${proposalId}' and proposal_version = 1`);
      return { eventId, proposalId };
    };
    const makeEntryReady = async (order: number) => {
      const eventId = await finishedEntryEvent(40_030_000 - order);
      await fixtureSql(`update public.match_result_alert_entry_ready_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where match_event_id = '${eventId}'`);
      return eventId;
    };

    const deadlineHeads: Array<{ eventId: string; proposalId: string }> = [];
    const entryHeads: string[] = [];
    for (let index = 0; index < dueHeadCount; index += 1) {
      deadlineHeads.push(await makeDeadline(index));
      entryHeads.push(await makeEntryReady(index));
    }
    const deadlineCursor = await makeDeadline(dueHeadCount);
    const entryCursor = await makeEntryReady(dueHeadCount);
    const deadlineTarget = deadlineHeads[dueHeadCount - 1]!;
    const entryTarget = entryHeads[dueHeadCount - 1]!;
    const deadlineIds = [
      deadlineCursor.proposalId,
      ...deadlineHeads.map(({ proposalId }) => proposalId)
    ];
    const entryIds = [entryCursor, ...entryHeads];

    await fixtureSql(`update public.match_result_alert_deadline_queue
      set active = false where proposal_id = '${deadlineCursor.proposalId}' and proposal_version = 1;
      update public.match_result_alert_entry_ready_queue
      set active = false where match_event_id = '${entryCursor}';
      update public.match_result_alert_deadline_queue
      set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
      where proposal_id = '${deadlineTarget.proposalId}' and proposal_version = 1;
      update public.match_result_alert_entry_ready_queue
      set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
      where match_event_id = '${entryTarget}';
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.proposal_id,
             resume_candidate_version = queue.proposal_version,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_deadline_queue queue
       where state.alert_kind = 'deadline'
         and queue.proposal_id = '${deadlineCursor.proposalId}' and queue.proposal_version = 1;
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.match_event_id,
             resume_candidate_version = 0,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_entry_ready_queue queue
       where state.alert_kind = 'entry_ready' and queue.match_event_id = '${entryCursor}'`);

    const deadlineArrivals: Array<{ eventId: string; proposalId: string }> = [];
    const entryArrivals: string[] = [];
    let order = dueHeadCount + 1;
    let dispatchRun: number | null = null;
    try {
      for (let runIndex = 0; runIndex < maxRuns; runIndex += 1) {
        if (runIndex > 0) await advanceTrustedResultSchedulerClock(60);
        for (let arrival = 0; arrival < arrivalsPerTick; arrival += 1) {
          deadlineArrivals.push(await makeDeadline(order));
          entryArrivals.push(await makeEntryReady(order));
          order += 1;
        }

        const [row] = await sqlRows(`select public.process_match_result_lifecycle_alerts(
          ${claimLimit}, ${claimLimit}, 1000) as result`);
        expect(asRecord(row?.['result'])).toMatchObject({
          reminder_claims: claimLimit,
          entry_ready_claims: claimLimit,
          failed: 0
        });
        const [cursorRows] = await sqlRows(`select
            (select state.resume_effective_key > queue.effective_key
               from public.match_result_alert_scan_state state
               join public.match_result_alert_deadline_queue queue
                 on queue.proposal_id = '${deadlineCursor.proposalId}'
                and queue.proposal_version = 1
              where state.alert_kind = 'deadline') as deadline_past_anchor,
            (select state.resume_effective_key > queue.effective_key
               from public.match_result_alert_scan_state state
               join public.match_result_alert_entry_ready_queue queue
                 on queue.match_event_id = '${entryCursor}'
              where state.alert_kind = 'entry_ready') as entry_past_anchor`);
        expect(cursorRows).toEqual({ deadline_past_anchor: true, entry_past_anchor: true });

        const deadlineAlerts = await resultAlerts(deadlineTarget.eventId);
        const entryAlerts = await resultAlerts(entryTarget);
        const deadlineDispatched = deadlineAlerts.some((alert) =>
          String(alert['event_key']).startsWith(`result.deadline:${deadlineTarget.proposalId}:v1`)
        );
        const entryDispatched = entryAlerts.some(
          (alert) => alert['event_key'] === `result.entry_ready:${entryTarget}`
        );
        if (deadlineDispatched && entryDispatched) {
          dispatchRun = runIndex + 1;
          break;
        }
      }

      expect(dispatchRun).not.toBeNull();
      expect(dispatchRun).toBeLessThanOrEqual(maxRuns);
      expect(dispatchRun).toBeLessThanOrEqual(Math.ceil(dueHeadCount / headBudget) + 1);
    } finally {
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false, next_attempt_at = null
        where proposal_id = any(array[${[
          ...deadlineIds,
          ...deadlineArrivals.map(({ proposalId }) => proposalId)
        ]
          .map((id) => `'${id}'`)
          .join(',')}]::uuid[]) and proposal_version = 1;
        update public.match_result_alert_entry_ready_queue
        set active = false, next_attempt_at = null
        where match_event_id = any(array[${[...entryIds, ...entryArrivals]
          .map((id) => `'${id}'`)
          .join(',')}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  }, 300_000);

  it('M3 reserves head examination slot when cap equals claim limit for quarantined retries', async () => {
    const claimLimit = 2;
    const maxRuns = 2;
    const ancientDueBase = "pg_catalog.clock_timestamp() - interval '50000000 hours'";
    const makeDeadline = async (order: number) => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60);
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where proposal_id = '${proposalId}' and proposal_version = 1`);
      return { eventId, proposalId };
    };
    const makeEntryReady = async (order: number) => {
      const eventId = await finishedEntryEvent(40_030_000 - order);
      await fixtureSql(`update public.match_result_alert_entry_ready_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where match_event_id = '${eventId}'`);
      return eventId;
    };

    const deadlineRetry = await makeDeadline(0);
    const deadlineCursor = await makeDeadline(1);
    const deadlineSuffix = [await makeDeadline(2), await makeDeadline(3)];
    const entryRetry = await makeEntryReady(0);
    const entryCursor = await makeEntryReady(1);
    const entrySuffix = [await makeEntryReady(2), await makeEntryReady(3)];
    const deadlineArrivals: Array<{ eventId: string; proposalId: string }> = [];
    const entryArrivals: string[] = [];
    const deadlineOwned = [deadlineRetry, deadlineCursor, ...deadlineSuffix];
    const entryOwned = [entryRetry, entryCursor, ...entrySuffix];

    await fixtureSql(`update public.match_result_alert_deadline_queue
      set active = false where proposal_id = '${deadlineCursor.proposalId}' and proposal_version = 1;
      update public.match_result_alert_entry_ready_queue
      set active = false where match_event_id = '${entryCursor}';
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.proposal_id,
             resume_candidate_version = queue.proposal_version,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_deadline_queue queue
       where state.alert_kind = 'deadline'
         and queue.proposal_id = '${deadlineCursor.proposalId}' and queue.proposal_version = 1;
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.match_event_id,
             resume_candidate_version = 0,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_entry_ready_queue queue
       where state.alert_kind = 'entry_ready' and queue.match_event_id = '${entryCursor}'`);

    let order = 4;
    let dispatchRun: number | null = null;
    try {
      for (let runIndex = 0; runIndex < maxRuns; runIndex += 1) {
        if (runIndex > 0) await advanceTrustedResultSchedulerClock(60);
        deadlineArrivals.push(await makeDeadline(order));
        entryArrivals.push(await makeEntryReady(order));
        order += 1;

        if (runIndex === 0) {
          await fixtureSql(`insert into public.match_result_alert_processing_state(
            alert_kind, candidate_id, candidate_version, attempt_count, failure_count,
            attempted_at, next_attempt_at, last_failure_code, last_failure_message,
            terminal_outcome, roster_fingerprint
          ) values
            ('deadline', '${deadlineRetry.proposalId}', 1, 10, 10,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '30 seconds',
             'P0001', 'Lifecycle alert failed; recovery policy applied.', 'quarantined', null),
            ('entry_ready', '${entryRetry}', 0, 10, 10,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '30 seconds',
             'P0001', 'Lifecycle alert failed; recovery policy applied.', 'quarantined',
             public.match_result_entry_roster_fingerprint('${entryRetry}'))`);
        }
        const retryState = await sqlRows(`select
            (select terminal_outcome = 'quarantined'
               from public.match_result_alert_processing_state
              where alert_kind = 'deadline' and candidate_id = '${deadlineRetry.proposalId}'
                and candidate_version = 1) as deadline_quarantined,
            (select next_attempt_at <= pg_catalog.clock_timestamp()
               from public.match_result_alert_processing_state
              where alert_kind = 'deadline' and candidate_id = '${deadlineRetry.proposalId}'
                and candidate_version = 1) as deadline_retry_due,
            (select terminal_outcome = 'quarantined'
               from public.match_result_alert_processing_state
              where alert_kind = 'entry_ready' and candidate_id = '${entryRetry}'
                and candidate_version = 0) as entry_quarantined,
            (select next_attempt_at <= pg_catalog.clock_timestamp()
               from public.match_result_alert_processing_state
              where alert_kind = 'entry_ready' and candidate_id = '${entryRetry}'
                and candidate_version = 0) as entry_retry_due`);
        expect(retryState).toEqual([
          {
            deadline_quarantined: true,
            deadline_retry_due: runIndex > 0,
            entry_quarantined: true,
            entry_retry_due: runIndex > 0
          }
        ]);

        const [row] = await sqlRows(`select public.process_match_result_lifecycle_alerts(
          ${claimLimit}, ${claimLimit}, ${claimLimit}) as result`);
        expect(asRecord(row?.['result'])).toMatchObject({ failed: 0 });

        const deadlineTargetAlerts = (await resultAlerts(deadlineRetry.eventId)).filter((alert) =>
          String(alert['event_key']).startsWith(`result.deadline:${deadlineRetry.proposalId}:v1`)
        );
        const entryTargetAlerts = (await resultAlerts(entryRetry)).filter(
          (alert) => alert['event_key'] === `result.entry_ready:${entryRetry}`
        );
        if (deadlineTargetAlerts.length === 4 && entryTargetAlerts.length === 1) {
          dispatchRun = runIndex + 1;
          break;
        }
        expect(deadlineTargetAlerts).toHaveLength(0);
        expect(entryTargetAlerts).toHaveLength(0);
      }

      expect(dispatchRun).not.toBeNull();
      expect(dispatchRun).toBeLessThanOrEqual(maxRuns);
      expect(
        await sqlRows(`select alert_kind, attempt_count, failure_count, terminal_outcome,
            next_attempt_at
          from public.match_result_alert_processing_state
          where (alert_kind = 'deadline' and candidate_id = '${deadlineRetry.proposalId}'
                   and candidate_version = 1)
             or (alert_kind = 'entry_ready' and candidate_id = '${entryRetry}'
                   and candidate_version = 0)
          order by alert_kind`)
      ).toEqual([
        {
          alert_kind: 'deadline',
          attempt_count: 11,
          failure_count: 0,
          terminal_outcome: null,
          next_attempt_at: null
        },
        {
          alert_kind: 'entry_ready',
          attempt_count: 11,
          failure_count: 0,
          terminal_outcome: null,
          next_attempt_at: null
        }
      ]);
    } finally {
      const deadlineIds = [...deadlineOwned, ...deadlineArrivals]
        .map(({ proposalId }) => `'${proposalId}'`)
        .join(',');
      const entryIds = [...entryOwned, ...entryArrivals].map((id) => `'${id}'`).join(',');
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false, next_attempt_at = null
        where proposal_id = any(array[${deadlineIds}]::uuid[]) and proposal_version = 1;
        update public.match_result_alert_entry_ready_queue
        set active = false, next_attempt_at = null
        where match_event_id = any(array[${entryIds}]::uuid[]);
        delete from public.match_result_alert_processing_state
        where candidate_id = any(array[${deadlineIds}]::uuid[])
          or candidate_id = any(array[${entryIds}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  }, 180_000);

  it('M4 preserves head examination slots while both resume suffixes stay locked', async () => {
    const claimLimit = 2;
    const maxRuns = 2;
    const ancientDueBase = "pg_catalog.clock_timestamp() - interval '50000000 hours'";
    const makeDeadline = async (order: number) => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60);
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where proposal_id = '${proposalId}' and proposal_version = 1`);
      return { eventId, proposalId };
    };
    const makeEntryReady = async (order: number) => {
      const eventId = await finishedEntryEvent(40_030_000 - order);
      await fixtureSql(`update public.match_result_alert_entry_ready_queue
        set due_at = ${ancientDueBase} + pg_catalog.make_interval(secs => ${order * 120}),
            enqueued_at = pg_catalog.clock_timestamp()
        where match_event_id = '${eventId}'`);
      return eventId;
    };
    const holdDeadlineRows = (marker: string, proposalIds: readonly string[]) => {
      const ids = proposalIds.map((id) => `'${id}'`).join(',');
      return acquireVerifiedRowLock(
        marker,
        `with locked_rows as materialized (
           select proposal_id from public.match_result_alert_deadline_queue
            where proposal_id = any(array[${ids}]::uuid[]) and proposal_version = 1
            for update
        ) select pg_catalog.pg_sleep(900) from (select count(*) from locked_rows) acquired;`,
        `select proposal_id from public.match_result_alert_deadline_queue
          where proposal_id = '${proposalIds[0]}' and proposal_version = 1 for update;`,
        180_000
      );
    };
    const holdEntryRows = (marker: string, eventIds: readonly string[]) => {
      const ids = eventIds.map((id) => `'${id}'`).join(',');
      return acquireVerifiedRowLock(
        marker,
        `with locked_rows as materialized (
           select match_event_id from public.match_result_alert_entry_ready_queue
            where match_event_id = any(array[${ids}]::uuid[]) for update
        ) select pg_catalog.pg_sleep(900) from (select count(*) from locked_rows) acquired;`,
        `select match_event_id from public.match_result_alert_entry_ready_queue
          where match_event_id = '${eventIds[0]}' for update;`,
        180_000
      );
    };

    const deadlineHead = await makeDeadline(0);
    const deadlineCursor = await makeDeadline(1);
    const deadlineSuffix = [await makeDeadline(2), await makeDeadline(3)];
    const entryHead = await makeEntryReady(0);
    const entryCursor = await makeEntryReady(1);
    const entrySuffix = [await makeEntryReady(2), await makeEntryReady(3)];
    await fixtureSql(`update public.match_result_alert_deadline_queue
      set active = false where proposal_id = '${deadlineCursor.proposalId}' and proposal_version = 1;
      update public.match_result_alert_entry_ready_queue
      set active = false where match_event_id = '${entryCursor}';
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.proposal_id,
             resume_candidate_version = queue.proposal_version,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_deadline_queue queue
       where state.alert_kind = 'deadline'
         and queue.proposal_id = '${deadlineCursor.proposalId}' and queue.proposal_version = 1;
      update public.match_result_alert_scan_state state
         set resume_effective_key = queue.effective_key,
             resume_candidate_id = queue.match_event_id,
             resume_candidate_version = 0,
             updated_at = pg_catalog.clock_timestamp()
        from public.match_result_alert_entry_ready_queue queue
       where state.alert_kind = 'entry_ready' and queue.match_event_id = '${entryCursor}'`);

    const deadlineOwned = [deadlineHead, deadlineCursor, ...deadlineSuffix];
    const entryOwned = [entryHead, entryCursor, ...entrySuffix];
    const deadlineEventBlocked: Array<{ eventId: string; proposalId: string }> = [];
    const entryEventBlocked: string[] = [];
    const deadlineQueueLocked: Array<{ eventId: string; proposalId: string }> = [];
    const entryQueueLocked: string[] = [];
    const holders: Array<Awaited<ReturnType<typeof acquireVerifiedRowLock>>> = [];
    let order = 4;
    let dispatchRun: number | null = null;
    try {
      const [deadlineHolder, entryHolder] = await Promise.all([
        holdDeadlineRows(
          `paf8-m4-deadline-initial-${crypto.randomUUID().replaceAll('-', '')}`,
          deadlineSuffix.map(({ proposalId }) => proposalId)
        ),
        holdEntryRows(
          `paf8-m4-entry-initial-${crypto.randomUUID().replaceAll('-', '')}`,
          entrySuffix
        )
      ]);
      holders.push(deadlineHolder, entryHolder);

      for (let runIndex = 0; runIndex < maxRuns; runIndex += 1) {
        if (runIndex > 0) await advanceTrustedResultSchedulerClock(60);
        const deadlineBlockedForRun: Array<{ eventId: string; proposalId: string }> = [];
        const entryBlockedForRun: string[] = [];
        const deadlineQueueRowsForRun: Array<{ eventId: string; proposalId: string }> = [];
        const entryQueueRowsForRun: string[] = [];
        for (let candidate = 0; candidate < 2; candidate += 1) {
          deadlineBlockedForRun.push(await makeDeadline(order));
          entryBlockedForRun.push(await makeEntryReady(order));
          order += 1;
        }
        deadlineEventBlocked.push(...deadlineBlockedForRun);
        entryEventBlocked.push(...entryBlockedForRun);
        holders.push(
          ...(await acquireVerifiedEventLocks(
            [...deadlineBlockedForRun.map(({ eventId }) => eventId), ...entryBlockedForRun],
            `paf8-m4-event-${runIndex}-${crypto.randomUUID().replaceAll('-', '')}`,
            180_000
          ))
        );

        for (let candidate = 0; candidate < 2; candidate += 1) {
          deadlineQueueRowsForRun.push(await makeDeadline(order));
          entryQueueRowsForRun.push(await makeEntryReady(order));
          order += 1;
        }
        deadlineQueueLocked.push(...deadlineQueueRowsForRun);
        entryQueueLocked.push(...entryQueueRowsForRun);
        const [deadlineHolderForRun, entryHolderForRun] = await Promise.all([
          holdDeadlineRows(
            `paf8-m4-deadline-${runIndex}-${crypto.randomUUID().replaceAll('-', '')}`,
            deadlineQueueRowsForRun.map(({ proposalId }) => proposalId)
          ),
          holdEntryRows(`paf8-m4-entry-${runIndex}-${crypto.randomUUID().replaceAll('-', '')}`, [
            ...entryQueueRowsForRun
          ])
        ]);
        holders.push(deadlineHolderForRun, entryHolderForRun);

        if (runIndex === 0) {
          await fixtureSql(`update public.match_result_alert_deadline_queue
            set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
            where proposal_id = '${deadlineHead.proposalId}' and proposal_version = 1;
            update public.match_result_alert_entry_ready_queue
            set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
            where match_event_id = '${entryHead}'`);
        }
        const retryEligibility = await sqlRows(`select
            (select next_attempt_at <= pg_catalog.clock_timestamp()
               from public.match_result_alert_deadline_queue
              where proposal_id = '${deadlineHead.proposalId}' and proposal_version = 1)
              as deadline_head_due,
            (select next_attempt_at <= pg_catalog.clock_timestamp()
               from public.match_result_alert_entry_ready_queue
              where match_event_id = '${entryHead}') as entry_head_due`);
        expect(retryEligibility).toEqual([
          {
            deadline_head_due: runIndex > 0,
            entry_head_due: runIndex > 0
          }
        ]);

        const [row] = await sqlRows(`select public.process_match_result_lifecycle_alerts(
          ${claimLimit}, ${claimLimit}, ${claimLimit}) as result`);
        expect(asRecord(row?.['result'])).toMatchObject({
          failed: 0,
          reminder_claims: runIndex === 0 ? 0 : 1,
          entry_ready_claims: runIndex === 0 ? 0 : 1
        });

        const deadlineTargetAlerts = (await resultAlerts(deadlineHead.eventId)).filter((alert) =>
          String(alert['event_key']).startsWith(`result.deadline:${deadlineHead.proposalId}:v1`)
        );
        const entryTargetAlerts = (await resultAlerts(entryHead)).filter(
          (alert) => alert['event_key'] === `result.entry_ready:${entryHead}`
        );
        if (deadlineTargetAlerts.length === 4 && entryTargetAlerts.length === 1) {
          dispatchRun = runIndex + 1;
          break;
        }
        expect(deadlineTargetAlerts).toHaveLength(0);
        expect(entryTargetAlerts).toHaveLength(0);
      }

      expect(dispatchRun).not.toBeNull();
      expect(dispatchRun).toBeLessThanOrEqual(maxRuns);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
      const deadlineIds = [...deadlineOwned, ...deadlineEventBlocked, ...deadlineQueueLocked]
        .map(({ proposalId }) => `'${proposalId}'`)
        .join(',');
      const entryIds = [...entryOwned, ...entryEventBlocked, ...entryQueueLocked]
        .map((id) => `'${id}'`)
        .join(',');
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false, next_attempt_at = null
        where proposal_id = any(array[${deadlineIds}]::uuid[]) and proposal_version = 1;
        update public.match_result_alert_entry_ready_queue
        set active = false, next_attempt_at = null
        where match_event_id = any(array[${entryIds}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  }, 240_000);

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

  it('removes dispatched entry-ready history from discovery before a fresh due event', async () => {
    const marker = `PAF8 H1A ${crypto.randomUUID().replaceAll('-', '')}`;
    const eventFixtures = Array.from({ length: 300 }, (_, index) => {
      const id = crypto.randomUUID();
      return { id, index: index + 1, photo: matchPhotoFixture(f.communityId, id, f.creator.id) };
    });
    await fixtureSql(`do $$
      declare
        v_event_id uuid;
        v_notification_id uuid;
      begin
        ${eventFixtures
          .map(
            ({ id, index, photo }) => `${photo.sql}
              insert into public.match_events(
                id, community_id, created_by, starts_at, timezone, event_type, visibility,
                team_assignment_mode, venue_name, maps_url, photo_path, duration_minutes,
                registration_cutoff_at
          ) values (
                '${id}', '${f.communityId}', '${f.creator.id}',
                pg_catalog.clock_timestamp() + interval '10 days', 'UTC', 'friendly',
                'community_open', 'POST_MATCH_TEAMS', '${marker} ${index}',
                'https://maps.google.com/maps/place/paf8', '${photo.path}', 60,
                pg_catalog.clock_timestamp() + interval '9 days'
              );`
          )
          .join('\n')}

        for v_event_id in
          select id from public.match_events where venue_name like '${marker} %'
        loop
          v_notification_id := public.persist_notification(
            '${f.creator.id}', 'result.entry_ready:' || v_event_id::text,
            'result_entry_ready', 'results', 'match_event', v_event_id, '${f.communityId}'
          );
          insert into public.match_event_result_entry_ready_dispatch(
            match_event_id, creator_user_id, notification_id
          ) values (v_event_id, '${f.creator.id}', v_notification_id);
        end loop;

        alter table public.match_events disable trigger match_event_immutable;
        update public.match_events
           set starts_at = pg_catalog.clock_timestamp() - interval '55001000 hours',
               duration_minutes = 60,
               registration_cutoff_at = pg_catalog.clock_timestamp() - interval '55002000 hours'
         where venue_name like '${marker} %';
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);

    const history = await sqlRows(`select count(*)::int as count,
        count(*) filter (where queue.active)::int as active
      from public.match_event_result_entry_ready_dispatch dispatched
      join public.match_events event on event.id = dispatched.match_event_id
      join public.match_result_alert_entry_ready_queue queue
        on queue.match_event_id = event.id
      where event.venue_name like '${marker} %'`);
    expect(history).toEqual([{ count: 300, active: 0 }]);

    const freshEvent = await finishedEntryEvent(55_000_000);
    await fixtureSql(`update public.match_result_alert_entry_ready_queue
      set due_at = pg_catalog.clock_timestamp() - interval '55002000 hours'
      where match_event_id = '${freshEvent}'`);
    expect(
      await sqlRows(`select
          (select bool_and(not active) from public.match_result_alert_entry_ready_queue
            where match_event_id in (
              select id from public.match_events where venue_name like '${marker} %'
            )) as history_inactive,
          fresh.effective_key < (
            select min(history.effective_key)
              from public.match_result_alert_entry_ready_queue history
             where history.match_event_id in (
               select id from public.match_events where venue_name like '${marker} %'
             )
          ) as fresh_orders_first
        from public.match_result_alert_entry_ready_queue fresh
        where fresh.match_event_id = '${freshEvent}'`)
    ).toEqual([{ history_inactive: true, fresh_orders_first: true }]);

    const [firstTick] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(firstTick?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(freshEvent)).filter(
        (row) => row['event_key'] === `result.entry_ready:${freshEvent}`
      )
    ).toHaveLength(1);
    expect(
      await sqlRows(`select count(*)::int as count
        from public.match_result_alert_processing_state state
        join public.match_events event on event.id = state.candidate_id
        where event.venue_name like '${marker} %'`)
    ).toEqual([{ count: 0 }]);

    const [secondTick] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(secondTick?.['result'])).toMatchObject({ entry_ready: 0, failed: 0 });
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_entry_ready_dispatch dispatched
        join public.match_events event on event.id = dispatched.match_event_id
        where event.venue_name like '${marker} %'`)
    ).toEqual([{ count: 300 }]);
  });

  it('K1′ dispatches a new candidate behind 50 due predecessors within the formula bound', async () => {
    const predecessorCount = 50;
    const claimsPerRun = 25;
    const headBudget = Math.floor(claimsPerRun / 2);
    const intervalSeconds = 60;
    const deferMaxSeconds = 180;
    const expectedBoundSeconds =
      Math.ceil((predecessorCount / headBudget) * intervalSeconds) + deferMaxSeconds;

    const deadlinePredecessors: string[] = [];
    for (let index = 0; index < predecessorCount; index += 1) {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 6 * 60 * 60 - 300 + index * 4);
      deadlinePredecessors.push(proposalId);
    }
    const deadlineTailEvent = await f.protectedEvent();
    const deadlineTailSubmission = await f.submit(deadlineTailEvent, { submitter: f.admin });
    expect(deadlineTailSubmission.error).toBeNull();
    const deadlineTailProposal = String(asRecord(deadlineTailSubmission.data).proposal_id);
    await setResultReviewDeadlineOffset(deadlineTailProposal, 1, 6 * 60 * 60 - 20);
    const [deadlineTarget] = await sqlRows(`select due_at::text as due_at
      from public.match_result_alert_deadline_queue
      where proposal_id = '${deadlineTailProposal}' and proposal_version = 1`);
    expect(deadlineTarget).toBeDefined();
    const [deadlinePredecessorCount] = await sqlRows(`select count(*)::int as count
      from public.match_result_alert_deadline_queue queue
      where queue.proposal_id = any(array[${deadlinePredecessors.map((id) => `'${id}'`).join(',')}]
        ::uuid[])
        and queue.active and queue.due_at <= '${String(deadlineTarget?.['due_at'])}'::timestamptz
        and queue.effective_key < (select effective_key
          from public.match_result_alert_deadline_queue
          where proposal_id = '${deadlineTailProposal}' and proposal_version = 1)`);
    expect(deadlinePredecessorCount?.['count']).toBe(predecessorCount);

    const entryBaseRow = (
      await sqlRows(`select
      (pg_catalog.clock_timestamp() - interval '5 minutes')::text as due_base`)
    )[0];
    const entryDueBase = String(entryBaseRow?.['due_base']);
    const entryPredecessors: string[] = [];
    for (let index = 0; index < predecessorCount; index += 1)
      entryPredecessors.push(await finishedEntryEvent(40_500_000 - index));
    const entryTail = await finishedEntryEvent(40_499_990);
    for (const [index, eventId] of entryPredecessors.entries())
      await setEntryReadyQueueTime(eventId, entryDueBase, index * 4, 23);
    await setEntryReadyQueueTime(entryTail, entryDueBase, 280, 23);
    const [entryTarget] = await sqlRows(`select due_at::text as due_at
      from public.match_result_alert_entry_ready_queue where match_event_id = '${entryTail}'`);
    const [entryPredecessorCount] = await sqlRows(`select count(*)::int as count
      from public.match_result_alert_entry_ready_queue queue
      where queue.match_event_id = any(array[${entryPredecessors.map((id) => `'${id}'`).join(',')}]
        ::uuid[])
        and queue.active and queue.due_at <= '${String(entryTarget?.['due_at'])}'::timestamptz
        and queue.effective_key < (select effective_key
          from public.match_result_alert_entry_ready_queue where match_event_id = '${entryTail}')`);
    expect(entryPredecessorCount?.['count']).toBe(predecessorCount);

    const maxTicks = Math.ceil((predecessorCount + 1) / claimsPerRun) + 1;
    for (let tick = 0; tick < maxTicks; tick += 1) {
      await sqlRows(`select public.process_match_result_lifecycle_alerts(
        ${claimsPerRun}, ${claimsPerRun}, 1000) as result`);
      const [deadlineTailAlerts, entryTailAlerts] = await Promise.all([
        resultAlerts(deadlineTailEvent),
        resultAlerts(entryTail)
      ]);
      const deadlineDispatched = deadlineTailAlerts.some((row) =>
        String(row['event_key']).startsWith(`result.deadline:${deadlineTailProposal}`)
      );
      const entryDispatched = entryTailAlerts.some(
        (row) => row['event_key'] === `result.entry_ready:${entryTail}`
      );
      if (deadlineDispatched && entryDispatched) break;
      if (tick + 1 < maxTicks) await advanceTrustedResultSchedulerClock(intervalSeconds);
    }

    const [deadlineDispatch] =
      await sqlRows(`select min(notification.created_at)::text as dispatched_at,
        queue.due_at::text as due_at
      from public.match_result_alert_deadline_queue queue
      join public.notifications notification on notification.event_key =
        'result.deadline:' || queue.proposal_id::text || ':v' || queue.proposal_version::text
      where queue.proposal_id = '${deadlineTailProposal}' and queue.proposal_version = 1
      group by queue.due_at`);
    expect(deadlineDispatch).toBeDefined();
    const deadlineDelayMs =
      Date.parse(String(deadlineDispatch?.['dispatched_at'])) -
      Date.parse(String(deadlineDispatch?.['due_at']));
    expect(deadlineDelayMs).toBeGreaterThanOrEqual(
      (predecessorCount / claimsPerRun) * intervalSeconds * 1000 - 1000
    );
    expect(deadlineDelayMs).toBeLessThanOrEqual(expectedBoundSeconds * 1000);

    const [entryDispatch] = await sqlRows(`select dispatch.dispatched_at::text as dispatched_at,
        queue.due_at::text as due_at
      from public.match_event_result_entry_ready_dispatch dispatch
      join public.match_result_alert_entry_ready_queue queue
        on queue.match_event_id = dispatch.match_event_id
      where dispatch.match_event_id = '${entryTail}'`);
    expect(entryDispatch).toBeDefined();
    const entryDelayMs =
      Date.parse(String(entryDispatch?.['dispatched_at'])) -
      Date.parse(String(entryDispatch?.['due_at']));
    expect(entryDelayMs).toBeGreaterThanOrEqual(
      (predecessorCount / claimsPerRun) * intervalSeconds * 1000 - 1000
    );
    expect(entryDelayMs).toBeLessThanOrEqual(expectedBoundSeconds * 1000);
  }, 240_000);

  it('reconciles delayed cutoff before readiness so only the post-cutoff quartet alerts', async () => {
    const makeDelayedRoster = async (missedReconfirmations: number) => {
      const event = await f.event({ accepted: f.players.slice(1, 5) });
      const edited = await f.rpc(f.creator, 'edit_match_event', {
        p_match_event_id: event.id,
        p_patch: { event_type: 'competitive' },
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(edited.error).toBeNull();
      const reconfirmPlayers = f.players.slice(0, 5 - missedReconfirmations);
      for (const actor of reconfirmPlayers) {
        const attempt = await f.latestAttemptId(event.id, actor.id);
        expect(
          (
            await f.rpc(actor, 'reconfirm_match_registration', {
              p_match_event_id: event.id,
              p_attempt_id: attempt,
              p_generation: 1,
              p_request_id: crypto.randomUUID()
            })
          ).error
        ).toBeNull();
      }
      await fixtureSql(`do $$ declare v_start timestamptz := pg_catalog.clock_timestamp() - interval '2 hours';
        begin
          alter table public.match_events disable trigger match_event_immutable;
          update public.match_events set starts_at = v_start, duration_minutes = 60,
            registration_cutoff_at = v_start - interval '1 hour' where id = '${event.id}';
          alter table public.match_events enable trigger match_event_immutable;
        end $$;`);
      return event.id;
    };

    const excludedQuartet = await makeDelayedRoster(2);
    const postCutoffQuartet = await makeDelayedRoster(1);
    const result = await processDueMatchEventResults();
    expect(result.alerts).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(excludedQuartet)).filter(
        (row) => row['event_key'] === `result.entry_ready:${excludedQuartet}`
      )
    ).toHaveLength(0);
    expect(
      (await resultAlerts(postCutoffQuartet)).filter(
        (row) => row['event_key'] === `result.entry_ready:${postCutoffQuartet}`
      )
    ).toMatchObject([{ recipient_user_id: f.creator.id, kind: 'result_entry_ready' }]);
    expect(
      await sqlRows(`select lifecycle, count(*)::int as count from public.match_event_registrations
        where match_event_id = '${excludedQuartet}' group by lifecycle order by lifecycle`)
    ).toContainEqual({ lifecycle: 'expired', count: 2 });
  });

  it('pre-filters an ineligible backlog before claims and reactivates changed rosters', async () => {
    const ineligibleEvents: string[] = [];
    for (let index = 0; index < 10; index += 1)
      ineligibleEvents.push(await finishedEntryEvent(40_700_000 - index));
    const reactivatedEvent = ineligibleEvents[0]!;
    const eligiblePeer = await finishedEntryEvent(40_699_980);

    for (const eventId of ineligibleEvents) {
      const registrations = await sqlRows(`select id from public.match_event_registrations
        where match_event_id='${eventId}' and accepted_order >= 4`);
      const registrationIds = registrations.map((row) => `'${String(row['id'])}'`).join(',');
      await fixtureSql(`alter table public.match_event_registrations disable trigger match_registration_final_state;
        update public.match_event_registrations set participation_status='reserve_not_playing'
          where id in (${registrationIds});
        alter table public.match_event_registrations enable trigger match_registration_final_state;
        select public.mark_match_result_alert_ineligible(
          '${eventId}', public.match_result_entry_roster_fingerprint('${eventId}')
        );`);
    }
    expect(
      await sqlRows(`select count(*)::int as count,
          count(*) filter (where not active)::int as inactive
        from public.match_result_alert_entry_ready_queue
        where match_event_id = any(array[${ineligibleEvents.map((id) => `'${id}'`).join(',')}]::uuid[])`)
    ).toEqual([{ count: 10, inactive: 10 }]);
    expect(
      await sqlRows(`select count(*)::int as count
        from public.match_result_alert_processing_state
        where alert_kind = 'entry_ready'
          and candidate_id = any(array[${ineligibleEvents.map((id) => `'${id}'`).join(',')}]::uuid[])
          and terminal_outcome = 'ineligible'`)
    ).toEqual([{ count: 10 }]);

    const [sameTick] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(sameTick?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(eligiblePeer)).filter(
        (row) => row['event_key'] === `result.entry_ready:${eligiblePeer}`
      )
    ).toHaveLength(1);
    expect(
      await sqlRows(`select count(*)::int as count
        from public.match_result_alert_processing_state
        where alert_kind = 'entry_ready'
          and candidate_id = any(array[${ineligibleEvents.map((id) => `'${id}'`).join(',')}]::uuid[])
          and attempt_count > 0`)
    ).toEqual([{ count: 0 }]);

    const [stored] = await sqlRows(`select roster_fingerprint
      from public.match_result_alert_processing_state
      where alert_kind = 'entry_ready'
        and candidate_id = '${reactivatedEvent}' and candidate_version = 0`);
    const ids = await sqlRows(`select id from public.match_event_registrations
      where match_event_id='${reactivatedEvent}' and accepted_order >= 4`);
    const registrationIds = ids.map((row) => `'${String(row['id'])}'`).join(',');
    await fixtureSql(`alter table public.match_event_registrations disable trigger match_registration_final_state;
      update public.match_event_registrations set participation_status='playing'
        where id in (${registrationIds});
      alter table public.match_event_registrations enable trigger match_registration_final_state;`);
    expect(
      await sqlRows(`select active from public.match_result_alert_entry_ready_queue
        where match_event_id = '${reactivatedEvent}'`)
    ).toEqual([{ active: true }]);
    expect(
      await sqlRows(
        `select public.match_result_entry_roster_fingerprint('${reactivatedEvent}') as fingerprint`
      )
    ).not.toEqual([{ fingerprint: stored?.['roster_fingerprint'] }]);

    const [reactivated] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(reactivated?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(reactivatedEvent)).filter(
        (row) => row['event_key'] === `result.entry_ready:${reactivatedEvent}`
      )
    ).toHaveLength(1);
  });

  it('benchmarks bounded roster fingerprinting against a 5,000-row ledger', async () => {
    const eventId = await finishedFourPlayerEntryEvent(40_800_000);
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const emailPrefix = `paf8-h3-${suffix}`;
    const ledgerTable = `paf8_registration_ledger_${suffix}`;
    syntheticAuthPrefixes.push(emailPrefix);

    await fixtureSql(`begin;
      insert into auth.users(
        id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
      )
      select gen_random_uuid(), 'authenticated', 'authenticated',
             '${emailPrefix}-' || ordinal::text || '@test.local', '',
             pg_catalog.clock_timestamp(), '{}'::jsonb, '{}'::jsonb,
             pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
         from generate_series(1, 4996) ordinal;

      create temporary table ${ledgerTable} on commit drop as
      select id as user_id, gen_random_uuid() as registration_id,
             gen_random_uuid() as attempt_id
        from auth.users
       where email like '${emailPrefix}-%@test.local';

      insert into public.match_event_registrations(
        id, match_event_id, user_id, lifecycle, participation_status,
        registration_source, requested_at, accepted_at, accepted_order
      )
      select ledger.registration_id, '${eventId}', ledger.user_id, 'expired', null,
             'member', pg_catalog.clock_timestamp(), null, null
        from ${ledgerTable} ledger;

      insert into public.match_event_registration_attempts(
        id, match_event_id, user_id, requested_at, outcome,
        registration_id, registration_source
      )
      select ledger.attempt_id, '${eventId}', ledger.user_id,
             pg_catalog.clock_timestamp(), 'expired', ledger.registration_id, 'member'
        from ${ledgerTable} ledger;

      update public.match_event_registrations registration
         set current_attempt_id = ledger.attempt_id
        from ${ledgerTable} ledger
       where registration.id = ledger.registration_id;
      commit;`);

    await fixtureSql(`select public.process_match_event_registration_cutoff('${eventId}', false)`);
    const [ledgerSize] = await sqlRows(`select count(*)::int as registrations,
        count(*) filter (where lifecycle = 'accepted'
          and participation_status = 'playing')::int as playing
      from public.match_event_registrations where match_event_id = '${eventId}'`);
    expect(ledgerSize).toEqual({ registrations: 5000, playing: 4 });

    const fullLedgerExplain = `explain (analyze, timing off, summary on, format json)
      select pg_catalog.md5(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          registration.id, registration.user_id, registration.lifecycle,
          registration.participation_status, registration.confirmed_generation,
          registration.required_generation, attempt.id, attempt.outcome,
          attempt.registration_source
        ) order by registration.id
      )::text) as ledger_fingerprint
      from public.match_event_registrations registration
      left join public.match_event_registration_attempts attempt
        on attempt.registration_id = registration.id
      where registration.match_event_id = '${eventId}'`;
    const boundedFingerprintExplain = `explain (analyze, timing off, summary on, format json)
      select public.match_result_entry_roster_fingerprint('${eventId}') as fingerprint`;
    const executionTimeMs = async (query: string): Promise<number> => {
      const [row] = await sqlRows(query, { timeoutMs: 30_000 });
      const planValue = row?.['QUERY PLAN'];
      const plan = Array.isArray(planValue) ? asRecord(planValue[0]) : asRecord(planValue);
      const duration = Number(plan['Execution Time']);
      expect(Number.isFinite(duration)).toBe(true);
      return duration;
    };
    await executionTimeMs(fullLedgerExplain);
    await executionTimeMs(boundedFingerprintExplain);
    const fullLedgerSamples: number[] = [];
    const boundedSamples: number[] = [];
    for (let sample = 0; sample < 3; sample += 1) {
      fullLedgerSamples.push(await executionTimeMs(fullLedgerExplain));
      boundedSamples.push(await executionTimeMs(boundedFingerprintExplain));
    }
    const median = (samples: readonly number[]) =>
      [...samples].sort((left, right) => left - right)[Math.floor(samples.length / 2)] ?? 0;
    const fullLedgerMs = median(fullLedgerSamples);
    const boundedFingerprintMs = median(boundedSamples);
    const speedup = fullLedgerMs / Math.max(boundedFingerprintMs, 0.001);
    console.info(
      `H3 5,000-row fingerprint benchmark: full-ledger=${fullLedgerMs.toFixed(2)}ms, ` +
        `bounded=${boundedFingerprintMs.toFixed(2)}ms, speedup=${speedup.toFixed(1)}x ` +
        '(required ≥10x; statement_timeout=30,000ms)'
    );
    expect(speedup).toBeGreaterThanOrEqual(10);

    const [quartetMember] = await sqlRows(`select id::text from public.match_event_registrations
      where match_event_id = '${eventId}' and lifecycle = 'accepted'
        and participation_status = 'playing' order by accepted_order limit 1`);
    const quartetRegistrationId = String(quartetMember?.['id']);
    await fixtureSql(`alter table public.match_event_registrations disable trigger match_registration_final_state;
      update public.match_event_registrations set participation_status = 'reserve_not_playing'
        where id = '${quartetRegistrationId}';
      alter table public.match_event_registrations enable trigger match_registration_final_state;`);

    const [ineligible] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result',
      { timeoutMs: 10_000 }
    );
    expect(asRecord(ineligible?.['result'])).toMatchObject({ entry_ready: 0, failed: 0 });
    const [stored] = await sqlRows(`select roster_fingerprint, terminal_outcome
      from public.match_result_alert_processing_state
      where alert_kind = 'entry_ready'
        and candidate_id = '${eventId}' and candidate_version = 0`);
    expect(stored).toMatchObject({
      terminal_outcome: 'ineligible',
      roster_fingerprint: expect.any(String)
    });

    await fixtureSql(`alter table public.match_event_registrations disable trigger match_registration_final_state;
      update public.match_event_registrations set participation_status = 'playing'
        where id = '${quartetRegistrationId}';
      alter table public.match_event_registrations enable trigger match_registration_final_state;`);
    const [reactivatedState] = await sqlRows(`select queue.active,
        public.match_result_entry_roster_fingerprint('${eventId}') as fingerprint
      from public.match_result_alert_entry_ready_queue queue
      where queue.match_event_id = '${eventId}'`);
    expect(reactivatedState?.['active']).toBe(true);
    expect(reactivatedState?.['fingerprint']).not.toBe(stored?.['roster_fingerprint']);

    const [eligible] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result',
      { timeoutMs: 10_000 }
    );
    expect(asRecord(eligible?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(eventId)).filter(
        (row) => row['event_key'] === `result.entry_ready:${eventId}`
      )
    ).toHaveLength(1);
  });

  it('scans past an event-locked entry candidate and retries it after unlock', async () => {
    const blockedEvent = await finishedEntryEvent(40_002_000);
    const peerEvent = await finishedEntryEvent(40_001_999);
    const marker = `paf8-alert-event-lock-${crypto.randomUUID().replaceAll('-', '')}`;
    const holder = startSql(`/* ${marker} */ select pg_catalog.pg_sleep(900)
      from (select id from public.match_events where id = '${blockedEvent}' for update) locked;`);
    try {
      const holderPid = await holder.backendPid;
      await waitForRows(
        `select pid from pg_catalog.pg_stat_activity where query like '%${marker}%' and state='active'
          and pid <> pg_catalog.pg_backend_pid()`,
        (rows) => rows.length === 1,
        'entry-ready event lock holder'
      );
      const probeMarker = `paf8-event-lock-probe-${crypto.randomUUID().replaceAll('-', '')}`;
      const probe = startSql(
        `/* ${probeMarker} */ select id from public.match_events where id = '${blockedEvent}' for update;`
      );
      try {
        await waitForRows(
          `select pid from pg_catalog.pg_stat_activity a where a.query like '%${probeMarker}%'
            and a.wait_event_type='Lock' and ${holderPid}=any(pg_catalog.pg_blocking_pids(a.pid))`,
          (rows) => rows.length === 1,
          'entry-ready probe blocked by held event row'
        );
      } finally {
        await probe.stop();
      }
      const [blockedRow] = await sqlRows(
        `select public.process_match_result_lifecycle_alerts(1, 1) as result`
      );
      expect(asRecord(blockedRow?.['result'])).toMatchObject({
        entry_ready: 1,
        entry_ready_claims: 1,
        failed: 0
      });
      expect(
        (await resultAlerts(peerEvent)).filter(
          (row) => row['event_key'] === `result.entry_ready:${peerEvent}`
        )
      ).toHaveLength(1);
      const [retryTick] = await sqlRows(
        `select public.process_match_result_lifecycle_alerts(1, 1) as result`
      );
      expect(asRecord(retryTick?.['result'])).toMatchObject({ entry_ready: 0, failed: 0 });
      expect(
        (await resultAlerts(blockedEvent)).filter(
          (row) => row['event_key'] === `result.entry_ready:${blockedEvent}`
        )
      ).toHaveLength(0);
    } finally {
      await holder.stop();
    }
    await fixtureSql(`update public.match_result_alert_entry_ready_queue
      set next_attempt_at = pg_catalog.clock_timestamp()
      where match_event_id = '${blockedEvent}'`);
    const [retryRow] = await sqlRows(
      `select public.process_match_result_lifecycle_alerts(1, 1) as result`
    );
    expect(asRecord(retryRow?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(blockedEvent)).filter(
        (row) => row['event_key'] === `result.entry_ready:${blockedEvent}`
      )
    ).toHaveLength(1);
  });

  it('scans past an event-locked deadline candidate and retries after unlock', async () => {
    const makeReminderCandidate = async (deadlineOffsetSeconds: number) => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, deadlineOffsetSeconds);
      return { eventId, proposalId };
    };
    const blocked = await makeReminderCandidate(60);
    const peer = await makeReminderCandidate(120);
    const marker = `paf8-reminder-event-lock-${crypto.randomUUID().replaceAll('-', '')}`;
    const holder = await acquireVerifiedRowLock(
      marker,
      `select pg_catalog.pg_sleep(900)
        from (select id from public.match_events where id = '${blocked.eventId}' for update) locked;`,
      `select id from public.match_events where id = '${blocked.eventId}' for update;`
    );
    try {
      const [first] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(first?.['result'])).toMatchObject({
        reminders: 4,
        reminder_claims: 1,
        failed: 0
      });
      const [retryTick] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(retryTick?.['result'])).toMatchObject({ reminders: 0, failed: 0 });
      expect(
        (await resultAlerts(peer.eventId)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(4);
      expect(
        (await resultAlerts(blocked.eventId)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(0);
    } finally {
      await holder.stop();
    }
    await fixtureSql(`update public.match_result_alert_deadline_queue
      set next_attempt_at = pg_catalog.clock_timestamp()
      where proposal_id = '${blocked.proposalId}' and proposal_version = 1`);
    const [retry] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(retry?.['result'])).toMatchObject({ reminders: 4, failed: 0 });
    expect(
      (await resultAlerts(blocked.eventId)).filter((row) =>
        String(row['event_key']).startsWith('result.deadline:')
      )
    ).toHaveLength(4);
  });

  it('K2 skips more locked queue heads than K×L and serves young candidates each tick', async () => {
    const lockedEvents: string[] = [];
    for (let index = 0; index < 11; index += 1)
      lockedEvents.push(await finishedEntryEvent(40_003_000 - index));
    const youngEvent = await finishedEntryEvent(40_002_980);
    const initialEvents = [...lockedEvents, youngEvent];
    const dueBase = await entryReadyDueBase(initialEvents);
    for (const [index, eventId] of lockedEvents.entries())
      await setEntryReadyQueueTime(eventId, dueBase, index, 23);
    await setEntryReadyQueueTime(youngEvent, dueBase, 1_000);

    const lockedIds = lockedEvents.map((eventId) => `'${eventId}'`).join(', ');
    const holder = await acquireVerifiedRowLock(
      `paf8-queue-head-lock-${crypto.randomUUID().replaceAll('-', '')}`,
      `with locked_rows as materialized (
         select match_event_id from public.match_result_alert_entry_ready_queue
          where match_event_id = any(array[${lockedIds}]::uuid[]) for update
       )
       select pg_catalog.pg_sleep(900) from (select count(*) from locked_rows) acquired;`,
      `select match_event_id from public.match_result_alert_entry_ready_queue
        where match_event_id = '${lockedEvents[0]}' for update;`
    );
    const arrivals: string[] = [];
    try {
      for (let tickNumber = 1; tickNumber <= 3; tickNumber += 1) {
        const arrival = await finishedEntryEvent(40_002_970 - tickNumber);
        arrivals.push(arrival);
        await setEntryReadyQueueTime(arrival, dueBase, 2_000 + tickNumber);
        const [tick] = await sqlRows(
          'select public.process_match_result_lifecycle_alerts(1, 1) as result'
        );
        expect(asRecord(tick?.['result'])).toMatchObject({
          entry_ready: 1,
          entry_ready_claims: 1,
          failed: 0
        });
        for (const dispatchedId of [youngEvent, ...arrivals.slice(0, tickNumber - 1)])
          expect(
            (await resultAlerts(dispatchedId)).some(
              (row) => row['event_key'] === `result.entry_ready:${dispatchedId}`
            )
          ).toBe(true);
      }
    } finally {
      await holder.stop();
    }

    const [drained] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(100, 100) as result'
    );
    expect(asRecord(drained?.['result'])).toMatchObject({ failed: 0 });
    // This call exhausts the suffix after the claim-limit cursor. The queue-locked
    // heads were skipped, not deferred, so the next scan starts at head after reset.
    const [revisitedHeads] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(100, 100) as result'
    );
    expect(asRecord(revisitedHeads?.['result'])).toMatchObject({ failed: 0 });
    const allCandidates = [...lockedEvents, youngEvent, ...arrivals];
    const [dispatches] = await sqlRows(`select count(*)::int as dispatched
      from public.match_event_result_entry_ready_dispatch dispatch
      where dispatch.match_event_id = any(array[${allCandidates.map((id) => `'${id}'`).join(',')}]
        ::uuid[])`);
    expect(dispatches).toEqual({ dispatched: allCandidates.length });
  });

  it('K1″ resumes capped scans for both producers until locked heads are passed', async () => {
    const cap = 5;
    const headCount = 12;
    await fixtureSql(`update public.match_result_alert_scan_state
      set resume_effective_key = null, resume_candidate_id = null,
          resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    const deadlineHeads: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < headCount; index += 1) {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + index * 60);
      deadlineHeads.push({ eventId, proposalId });
    }
    const deadlineTailEvent = await f.protectedEvent();
    const deadlineTailSubmission = await f.submit(deadlineTailEvent, { submitter: f.admin });
    expect(deadlineTailSubmission.error).toBeNull();
    const deadlineTailProposal = String(asRecord(deadlineTailSubmission.data).proposal_id);
    await setResultReviewDeadlineOffset(deadlineTailProposal, 1, 5 * 60 * 60 + headCount * 60);

    const entryHeads: string[] = [];
    for (let index = 0; index < headCount; index += 1)
      entryHeads.push(await finishedEntryEvent(40_008_000 - index));
    const entryTail = await finishedEntryEvent(40_007_980);
    const entryCandidates = [...entryHeads, entryTail];
    const entryDueBase = await entryReadyDueBase(entryCandidates);
    for (const [index, eventId] of entryHeads.entries())
      await setEntryReadyQueueTime(eventId, entryDueBase, index, 23);
    await setEntryReadyQueueTime(entryTail, entryDueBase, 120, 23);

    const deadlineCandidateAt = async (proposalId: string) => {
      const [row] = await sqlRows(`select effective_key::text as effective_key
        from public.match_result_alert_deadline_queue
        where proposal_id = '${proposalId}' and proposal_version = 1`);
      return row?.['effective_key'];
    };
    const entryCandidateAt = async (eventId: string) => {
      const [row] = await sqlRows(`select effective_key::text as effective_key
        from public.match_result_alert_entry_ready_queue where match_event_id = '${eventId}'`);
      return row?.['effective_key'];
    };
    const scanCursor = async (kind: 'deadline' | 'entry_ready') => {
      const [row] = await sqlRows(`select
          state.resume_candidate_id::text as candidate_id,
          state.resume_candidate_version::int as candidate_version,
          state.resume_effective_key::text as resume_effective_key,
          case when state.alert_kind = 'deadline' then (
            select queue.effective_key::text from public.match_result_alert_deadline_queue queue
             where queue.proposal_id = state.resume_candidate_id
               and queue.proposal_version = state.resume_candidate_version
          ) else (
            select queue.effective_key::text from public.match_result_alert_entry_ready_queue queue
             where queue.match_event_id = state.resume_candidate_id
          ) end as candidate_effective_key
        from public.match_result_alert_scan_state state
        where state.alert_kind = '${kind}'`);
      return row;
    };
    const headIds = deadlineHeads.map(({ proposalId }) => `'${proposalId}'`).join(',');
    const entryHeadIds = entryHeads.map((eventId) => `'${eventId}'`).join(',');
    const makeVisitedHeadsDueNextTick = async (visitedCount: number) => {
      const visitedDeadlineIds = deadlineHeads
        .slice(0, visitedCount)
        .map(({ proposalId }) => `'${proposalId}'`)
        .join(',');
      const visitedEntryIds = entryHeads
        .slice(0, visitedCount)
        .map((eventId) => `'${eventId}'`)
        .join(',');
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
        where proposal_id = any(array[${visitedDeadlineIds}]::uuid[]);
        update public.match_result_alert_entry_ready_queue
        set next_attempt_at = pg_catalog.clock_timestamp() + interval '30 seconds'
        where match_event_id = any(array[${visitedEntryIds}]::uuid[])`);
    };
    const deadlineOwnedIds = [
      ...deadlineHeads.map(({ proposalId }) => proposalId),
      deadlineTailProposal
    ]
      .map((id) => `'${id}'`)
      .join(',');
    const entryOwnedIds = entryCandidates.map((eventId) => `'${eventId}'`).join(',');
    const lockMarker = `paf8-k10-resume-${crypto.randomUUID().replaceAll('-', '')}`;
    const holders = await acquireVerifiedEventLocks(
      [...deadlineHeads.map(({ eventId }) => eventId), ...entryHeads],
      lockMarker,
      300_000
    );

    try {
      const capTicks = Math.ceil(headCount / cap) + 1;
      let tailDispatchTick: number | null = null;
      for (let tick = 0; tick < capTicks; tick += 1) {
        if (tick > 0) await advanceTrustedResultSchedulerClock(60);
        const [processed] = await sqlRows(`select public.process_match_result_lifecycle_alerts(
          p_reminder_limit => 100,
          p_entry_ready_limit => 100,
          p_max_examined => ${cap}
        ) as result`);
        expect(asRecord(processed?.['result']).failed).toBe(0);
        expect(tick + 1).toBeLessThanOrEqual(capTicks);

        const deadlineTailAlerts = (await resultAlerts(deadlineTailEvent)).filter((row) =>
          String(row['event_key']).startsWith(`result.deadline:${deadlineTailProposal}`)
        );
        const entryTailAlerts = (await resultAlerts(entryTail)).filter(
          (row) => row['event_key'] === `result.entry_ready:${entryTail}`
        );
        const tailsDispatched = deadlineTailAlerts.length === 4 && entryTailAlerts.length === 1;
        expect(deadlineTailAlerts).toHaveLength(tailsDispatched ? 4 : 0);
        expect(entryTailAlerts).toHaveLength(tailsDispatched ? 1 : 0);

        const cursorIndex = tailsDispatched ? null : Math.min((tick + 1) * cap, headCount) - 1;
        const deadlineCursorId =
          cursorIndex === null ? null : deadlineHeads[cursorIndex]!.proposalId;
        const entryCursorId = cursorIndex === null ? null : entryHeads[cursorIndex]!;
        const [actualDeadlineCursor, actualEntryCursor] = await Promise.all([
          scanCursor('deadline'),
          scanCursor('entry_ready')
        ]);
        const deadlineCursorKey = deadlineCursorId
          ? await deadlineCandidateAt(deadlineCursorId)
          : null;
        const entryCursorKey = entryCursorId ? await entryCandidateAt(entryCursorId) : null;
        expect(actualDeadlineCursor).toEqual({
          candidate_id: deadlineCursorId,
          candidate_version: deadlineCursorId ? 1 : 0,
          resume_effective_key: deadlineCursorKey,
          candidate_effective_key: deadlineCursorKey
        });
        expect(actualEntryCursor).toEqual({
          candidate_id: entryCursorId,
          candidate_version: 0,
          resume_effective_key: entryCursorKey,
          candidate_effective_key: entryCursorKey
        });

        const [deferredDeadline] = await sqlRows(`select count(*)::int as deferred
          from public.match_result_alert_deadline_queue
          where proposal_id = any(array[${headIds}]::uuid[])
            and proposal_version = 1 and next_attempt_at is not null`);
        const [deferredEntry] = await sqlRows(`select count(*)::int as deferred
          from public.match_result_alert_entry_ready_queue
          where match_event_id = any(array[${entryHeadIds}]::uuid[])
            and next_attempt_at is not null`);
        expect(deferredDeadline?.['deferred']).toBe(Math.min((tick + 1) * cap, headCount));
        expect(deferredEntry?.['deferred']).toBe(Math.min((tick + 1) * cap, headCount));
        const [held] = await sqlRows(`select count(*)::int as active_holders
          from pg_catalog.pg_stat_activity
          where state = 'active' and pid <> pg_catalog.pg_backend_pid()
            and query like '%${lockMarker}%'`);
        expect(held?.['active_holders']).toBe(headCount * 2);

        if (tailsDispatched) {
          tailDispatchTick = tick + 1;
          break;
        }

        expect(tick + 1).toBeLessThan(capTicks);
        await makeVisitedHeadsDueNextTick(Math.min((tick + 1) * cap, headCount));
      }
      expect(tailDispatchTick).not.toBeNull();
      expect(tailDispatchTick).toBeLessThanOrEqual(capTicks);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false, next_attempt_at = null
        where proposal_id = any(array[${deadlineOwnedIds}]::uuid[]);
        update public.match_result_alert_entry_ready_queue
        set active = false, next_attempt_at = null
        where match_event_id = any(array[${entryOwnedIds}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  }, 300_000);

  it('K1‴ preserves both cursors across claim-limit stops and resets at the due tail', async () => {
    const claimLimit = 2;
    const resumeBudget = Math.ceil(claimLimit / 2);
    const claimableCount = 5;
    await fixtureSql(`update public.match_result_alert_scan_state
      set resume_effective_key = null, resume_candidate_id = null,
          resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);

    const makeDeadlineCandidate = async (offsetSeconds: number) => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + offsetSeconds);
      return { eventId, proposalId };
    };
    const deadlineHeads: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < 2; index += 1)
      deadlineHeads.push(await makeDeadlineCandidate(index));
    const deadlineClaimable: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < claimableCount; index += 1)
      deadlineClaimable.push(await makeDeadlineCandidate(10 + index));
    const deadlineTail = await makeDeadlineCandidate(20);
    const deadlineCandidates = [...deadlineHeads, ...deadlineClaimable, deadlineTail];
    const deadlineSortRows = deadlineCandidates
      .map(({ proposalId }, index) => `('${proposalId}'::uuid, ${index})`)
      .join(', ');
    await fixtureSql(`update public.match_result_alert_deadline_queue queue
      set enqueued_at = pg_catalog.clock_timestamp() - interval '10 years'
        + pg_catalog.make_interval(secs => fixture.sort_order)
      from (values ${deadlineSortRows}) as fixture(proposal_id, sort_order)
      where queue.proposal_id = fixture.proposal_id and queue.proposal_version = 1`);

    const entryHeads = [await finishedEntryEvent(40_010_000), await finishedEntryEvent(40_009_999)];
    const entryClaimable: string[] = [];
    for (let index = 0; index < claimableCount; index += 1)
      entryClaimable.push(await finishedEntryEvent(40_009_000 - index));
    const entryTail = await finishedEntryEvent(40_008_000);
    const entryCandidates = [...entryHeads, ...entryClaimable, entryTail];
    const entryDueBase = await entryReadyDueBase(entryCandidates);
    for (const [index, eventId] of entryCandidates.entries())
      await setEntryReadyQueueTime(eventId, entryDueBase, index, 23);
    const entrySortRows = entryCandidates
      .map((eventId, index) => `('${eventId}'::uuid, ${index})`)
      .join(', ');
    await fixtureSql(`update public.match_result_alert_entry_ready_queue queue
      set enqueued_at = pg_catalog.clock_timestamp() - interval '10 years'
        + pg_catalog.make_interval(secs => fixture.sort_order)
      from (values ${entrySortRows}) as fixture(match_event_id, sort_order)
      where queue.match_event_id = fixture.match_event_id`);

    const deadlineOwnedIds = deadlineCandidates
      .map(({ proposalId }) => `'${proposalId}'`)
      .join(', ');
    const entryOwnedIds = entryCandidates.map((eventId) => `'${eventId}'`).join(', ');
    const marker = `paf8-k11-claim-limit-${crypto.randomUUID().replaceAll('-', '')}`;
    const holders = await acquireVerifiedEventLocks(
      [...deadlineHeads.map(({ eventId }) => eventId), ...entryHeads],
      marker,
      300_000
    );

    const scanCursor = async (kind: 'deadline' | 'entry_ready') => {
      const [row] = await sqlRows(`select
          state.resume_candidate_id::text as candidate_id,
          state.resume_candidate_version::int as candidate_version,
          state.resume_effective_key::text as resume_effective_key
        from public.match_result_alert_scan_state state
        where state.alert_kind = '${kind}'`);
      return row;
    };
    const candidateKey = async (kind: 'deadline' | 'entry_ready', id: string) => {
      const [row] = await sqlRows(
        kind === 'deadline'
          ? `select effective_key::text as effective_key
             from public.match_result_alert_deadline_queue
            where proposal_id = '${id}' and proposal_version = 1`
          : `select effective_key::text as effective_key
             from public.match_result_alert_entry_ready_queue
            where match_event_id = '${id}'`
      );
      return row?.['effective_key'];
    };
    const expectCursorAt = async (
      kind: 'deadline' | 'entry_ready',
      id: string | null,
      version: number
    ) => {
      expect(await scanCursor(kind)).toEqual({
        candidate_id: id,
        candidate_version: version,
        resume_effective_key: id === null ? null : await candidateKey(kind, id)
      });
    };

    try {
      const run = async (limit: number) => {
        const [row] = await sqlRows(`select public.process_match_result_lifecycle_alerts(
          p_reminder_limit => ${limit},
          p_entry_ready_limit => ${limit},
          p_max_examined => 1000
        ) as result`);
        return asRecord(row?.['result']);
      };

      expect(await run(claimLimit)).toMatchObject({
        reminder_claims: claimLimit,
        entry_ready_claims: claimLimit,
        failed: 0
      });
      await expectCursorAt('deadline', deadlineClaimable[resumeBudget - 1]!.proposalId, 1);
      await expectCursorAt('entry_ready', entryClaimable[resumeBudget - 1]!, 0);

      expect(await run(claimLimit)).toMatchObject({
        reminder_claims: claimLimit,
        entry_ready_claims: claimLimit,
        failed: 0
      });
      await expectCursorAt('deadline', deadlineClaimable[resumeBudget * 2]!.proposalId, 1);
      await expectCursorAt('entry_ready', entryClaimable[resumeBudget * 2]!, 0);

      expect(await run(100)).toMatchObject({
        reminder_claims: claimableCount - claimLimit * 2 + 1,
        entry_ready_claims: claimableCount - claimLimit * 2 + 1,
        failed: 0
      });
      await expectCursorAt('deadline', null, 0);
      await expectCursorAt('entry_ready', null, 0);

      for (const candidate of [...deadlineClaimable, deadlineTail])
        expect(
          (await resultAlerts(candidate.eventId)).filter((row) =>
            String(row['event_key']).startsWith(`result.deadline:${candidate.proposalId}`)
          )
        ).toHaveLength(4);
      for (const eventId of [...entryClaimable, entryTail])
        expect(
          (await resultAlerts(eventId)).filter(
            (row) => row['event_key'] === `result.entry_ready:${eventId}`
          )
        ).toHaveLength(1);
      for (const candidate of deadlineHeads)
        expect(
          (await resultAlerts(candidate.eventId)).filter((row) =>
            String(row['event_key']).startsWith(`result.deadline:${candidate.proposalId}`)
          )
        ).toHaveLength(0);
      for (const eventId of entryHeads)
        expect(
          (await resultAlerts(eventId)).filter(
            (row) => row['event_key'] === `result.entry_ready:${eventId}`
          )
        ).toHaveLength(0);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
      await fixtureSql(`update public.match_result_alert_deadline_queue
        set active = false, next_attempt_at = null
        where proposal_id = any(array[${deadlineOwnedIds}]::uuid[]);
        update public.match_result_alert_entry_ready_queue
        set active = false, next_attempt_at = null
        where match_event_id = any(array[${entryOwnedIds}]::uuid[]);
        update public.match_result_alert_scan_state
        set resume_effective_key = null, resume_candidate_id = null,
            resume_candidate_version = 0, updated_at = pg_catalog.clock_timestamp()`);
    }
  }, 300_000);

  it('K2b′/K1′ defers ten deadline heads, serves first-tick tail, then retries heads', async () => {
    const heads: Array<{ eventId: string; proposalId: string }> = [];
    for (let index = 0; index < 10; index += 1) {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      await setResultReviewDeadlineOffset(proposalId, 1, 5 * 60 * 60 + index);
      heads.push({ eventId, proposalId });
    }
    const tailEvent = await f.protectedEvent();
    const tailSubmission = await f.submit(tailEvent, { submitter: f.admin });
    expect(tailSubmission.error).toBeNull();
    const tailProposalId = String(asRecord(tailSubmission.data).proposal_id);
    await setResultReviewDeadlineOffset(tailProposalId, 1, 5 * 60 * 60 + 120);

    const holders = await acquireVerifiedEventLocks(
      heads.map(({ eventId }) => eventId),
      'paf8-k2b-deadline-head'
    );
    try {
      const [first] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(first?.['result'])).toMatchObject({
        reminders: 4,
        reminder_claims: 1,
        failed: 0
      });
      expect(
        (await resultAlerts(tailEvent)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(4);
      const headIds = heads.map(({ proposalId }) => `'${proposalId}'`).join(',');
      expect(
        await sqlRows(`select count(*)::int as deferred,
            bool_and(next_attempt_at > pg_catalog.clock_timestamp() + interval '60 seconds') as outside_next_tick,
            bool_and(next_attempt_at <= pg_catalog.clock_timestamp() + interval '180 seconds') as bounded
          from public.match_result_alert_deadline_queue
          where proposal_id = any(array[${headIds}]::uuid[]) and proposal_version = 1`)
      ).toEqual([{ deferred: 10, outside_next_tick: true, bounded: true }]);
      expect(
        await sqlRows(`select count(*)::int as attempts
          from public.match_result_alert_processing_state
          where alert_kind = 'deadline'
            and candidate_id = any(array[${headIds}]::uuid[]) and candidate_version = 1`)
      ).toEqual([{ attempts: 0 }]);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
    }

    await makeMatchResultAlertRetriesDue(
      'deadline',
      heads.map(({ proposalId }) => proposalId)
    );
    const [drained] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(100, 100) as result'
    );
    expect(asRecord(drained?.['result'])).toMatchObject({ reminders: 40, failed: 0 });
    for (const { eventId } of heads)
      expect(
        (await resultAlerts(eventId)).filter((row) =>
          String(row['event_key']).startsWith('result.deadline:')
        )
      ).toHaveLength(4);
  });

  it('K2b′/K1′ defers ten entry-ready heads, serves first-tick tail, then retries heads', async () => {
    const heads: string[] = [];
    for (let index = 0; index < 10; index += 1)
      heads.push(await finishedEntryEvent(40_010_000 - index));
    const tailEvent = await finishedEntryEvent(40_009_980);
    const candidates = [...heads, tailEvent];
    const dueBase = await entryReadyDueBase(candidates);
    for (const [index, eventId] of heads.entries())
      await setEntryReadyQueueTime(eventId, dueBase, index, 23);
    await setEntryReadyQueueTime(tailEvent, dueBase, 120, 23);

    const holders = await acquireVerifiedEventLocks(heads, 'paf8-k2b-entry-ready-head');
    try {
      const [first] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(first?.['result'])).toMatchObject({
        entry_ready: 1,
        entry_ready_claims: 1,
        failed: 0
      });
      expect(
        (await resultAlerts(tailEvent)).filter(
          (row) => row['event_key'] === `result.entry_ready:${tailEvent}`
        )
      ).toHaveLength(1);
      const headIds = heads.map((eventId) => `'${eventId}'`).join(',');
      expect(
        await sqlRows(`select count(*)::int as deferred,
            bool_and(next_attempt_at > pg_catalog.clock_timestamp() + interval '60 seconds') as outside_next_tick,
            bool_and(next_attempt_at <= pg_catalog.clock_timestamp() + interval '180 seconds') as bounded
          from public.match_result_alert_entry_ready_queue
          where match_event_id = any(array[${headIds}]::uuid[])`)
      ).toEqual([{ deferred: 10, outside_next_tick: true, bounded: true }]);
      expect(
        await sqlRows(`select count(*)::int as attempts
          from public.match_result_alert_processing_state
          where alert_kind = 'entry_ready'
            and candidate_id = any(array[${headIds}]::uuid[])`)
      ).toEqual([{ attempts: 0 }]);
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
    }

    await makeMatchResultAlertRetriesDue('entry_ready', heads);
    const [drained] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(100, 100) as result'
    );
    expect(asRecord(drained?.['result'])).toMatchObject({ entry_ready: 10, failed: 0 });
    for (const eventId of heads)
      expect(
        (await resultAlerts(eventId)).filter(
          (row) => row['event_key'] === `result.entry_ready:${eventId}`
        )
      ).toHaveLength(1);
  });

  it('K2c′ quarantines deadline poisons at claim limits 1 and 4, then recovers same identities', async () => {
    const singlePoison = await runPoisonBacklog('deadline', 1);
    await runPoisonBacklog('deadline', 4);

    const proposalId = singlePoison.poisonProposalIds[0]!;
    const corrected = await correct(proposalId, 1, 1);
    expect(corrected.error).toBeNull();
    await setResultReviewDeadlineOffset(proposalId, 2, 5 * 60 * 60);

    const [versionQueue] = await sqlRows(`select
        count(*) filter (where proposal_version = 1 and not active)::int as old_inactive,
        count(*) filter (where proposal_version = 2 and active)::int as new_active
      from public.match_result_alert_deadline_queue where proposal_id = '${proposalId}'`);
    expect(versionQueue).toEqual({ old_inactive: 1, new_active: 1 });
    const [reactivated] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(reactivated?.['result'])).toMatchObject({ reminders: 4, failed: 0 });
    expect(
      (await resultAlerts(singlePoison.poisonEvents[0]!)).filter((item) =>
        String(item['event_key']).startsWith(`result.deadline:${proposalId}:v2`)
      )
    ).toHaveLength(4);
    expect(
      await sqlRows(`select attempt_count, failure_count, terminal_outcome
        from public.match_result_alert_processing_state
        where alert_kind = 'deadline' and candidate_id = '${proposalId}' and candidate_version = 2`)
    ).toEqual([{ attempt_count: 1, failure_count: 0, terminal_outcome: null }]);
  });

  it('K2c′ quarantines entry-ready poisons at claim limits 1 and 4, then recovers same identities', async () => {
    const singlePoison = await runPoisonBacklog('entry_ready', 1);
    const fullClaimLimit = await runPoisonBacklog('entry_ready', 4);
    expect(singlePoison.poisonEvents).toHaveLength(1);
    expect(fullClaimLimit.poisonEvents).toHaveLength(4);
  });

  it('caps dispatches at one per tick when primary and fallback state rows are locked', async () => {
    const candidates: string[] = [];
    for (let index = 0; index < 3; index += 1)
      candidates.push(await finishedEntryEvent(40_004_000 - index));
    const dueBase = await entryReadyDueBase(candidates);
    for (const [index, eventId] of candidates.entries())
      await setEntryReadyQueueTime(eventId, dueBase, index);
    await fixtureSql(`
      insert into public.match_result_alert_processing_state(
        alert_kind, candidate_id, candidate_version, attempt_count, failure_count
      ) values ${candidates.map((id) => `('entry_ready', '${id}', 0, 0, 0)`).join(',')};
      insert into public.match_result_alert_retry_fallback(
        alert_kind, candidate_id, candidate_version, attempt_count, failure_count, updated_at
      ) values ${candidates.map((id) => `('entry_ready', '${id}', 0, 0, 0, pg_catalog.clock_timestamp() - interval '1 minute')`).join(',')}`);
    const ordered = await sqlRows(`select match_event_id::text as id
      from public.match_result_alert_entry_ready_queue
      where active and due_at <= pg_catalog.clock_timestamp()
      order by effective_key, match_event_id
      limit 3`);
    expect(ordered.map((row) => String(row['id']))).toEqual(candidates);

    const holders: Array<ReturnType<typeof startSql>> = [];
    try {
      for (const [index, eventId] of candidates.entries()) {
        const marker = `paf8-alert-state-${index}-${crypto.randomUUID().replaceAll('-', '')}`;
        holders.push(
          await acquireVerifiedRowLock(
            `${marker}-primary`,
            `select pg_catalog.pg_sleep(900)
              from (select candidate_id from public.match_result_alert_processing_state
                where alert_kind = 'entry_ready'
                  and candidate_id = '${eventId}' and candidate_version = 0 for update) locked;`,
            `select candidate_id from public.match_result_alert_processing_state
              where alert_kind = 'entry_ready'
                and candidate_id = '${eventId}' and candidate_version = 0 for update;`
          )
        );
        holders.push(
          await acquireVerifiedRowLock(
            `${marker}-fallback`,
            `select pg_catalog.pg_sleep(900)
              from (select candidate_id from public.match_result_alert_retry_fallback
                where alert_kind = 'entry_ready' and candidate_id = '${eventId}'
                  and candidate_version = 0 for update) locked;`,
            `select candidate_id from public.match_result_alert_retry_fallback
              where alert_kind = 'entry_ready' and candidate_id = '${eventId}'
                and candidate_version = 0 for update;`
          )
        );
      }

      for (const eventId of candidates) {
        let dispatchedThisEvent = 0;
        let dispatchResult: Record<string, unknown> | undefined;
        for (let turn = 0; turn < 3; turn += 1) {
          const [before] = await sqlRows(`select count(*)::int as count
            from public.match_event_result_entry_ready_dispatch
            where match_event_id = any(array[${candidates.map((id) => `'${id}'`).join(',')}]::uuid[])`);
          const [row] = await sqlRows(
            'select public.process_match_result_lifecycle_alerts(1, 1) as result'
          );
          const result = asRecord(row?.['result']);
          const [after] = await sqlRows(`select count(*)::int as count
            from public.match_event_result_entry_ready_dispatch
            where match_event_id = any(array[${candidates.map((id) => `'${id}'`).join(',')}]::uuid[])`);
          dispatchedThisEvent = Number(after?.['count']) - Number(before?.['count']);
          if (dispatchedThisEvent !== 0) {
            dispatchResult = result;
            break;
          }
        }
        expect(dispatchedThisEvent).toBe(1);
        expect(dispatchResult).toMatchObject({ entry_ready: 1, failed: 1 });
        expect(dispatchResult?.['errors']).toMatchObject([
          { match_event_id: eventId, kind: 'entry_ready_bookkeeping' }
        ]);
        expect(
          (await resultAlerts(eventId)).filter(
            (item) => item['event_key'] === `result.entry_ready:${eventId}`
          )
        ).toHaveLength(1);
      }
    } finally {
      await Promise.all(holders.map((holder) => holder.stop()));
    }
  });

  it('isolates bookkeeping failures and retains failure details while peer bookkeeping succeeds', async () => {
    const failedEvent = await finishedEntryEvent(2000);
    const peerEvent = await finishedEntryEvent(1999);
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const triggerName = `paf8_attempt_state_failure_${suffix}`;
    const functionName = `paf8_attempt_state_failure_fn_${suffix}`;
    const sequenceName = `paf8_attempt_state_failure_seq_${suffix}`;
    const removeNotificationFailure = await installAlertFailure(failedEvent, 'result.entry_ready:');
    await fixtureSql(`create sequence public.${sequenceName};
      create function public.${functionName}() returns trigger
      language plpgsql set search_path = '' as $$ begin
        if new.candidate_id = '${failedEvent}'::uuid and pg_catalog.nextval('public.${sequenceName}') = 1
          then raise exception 'fixture bookkeeping failure'; end if;
        return new;
      end $$;
      create trigger ${triggerName} before insert or update on public.match_result_alert_processing_state
        for each row execute function public.${functionName}();`);
    try {
      const [row] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(row?.['result'])).toMatchObject({ entry_ready: 0, failed: 1 });
      expect(asRecord(row?.['result'])['errors']).toMatchObject([
        { match_event_id: failedEvent, kind: 'entry_ready' }
      ]);
      expect(
        (await resultAlerts(peerEvent)).filter(
          (item) => item['event_key'] === `result.entry_ready:${peerEvent}`
        )
      ).toHaveLength(0);
      expect(
        await sqlRows(`select attempt_count,failure_count from public.match_result_alert_retry_fallback
          where alert_kind='entry_ready' and candidate_id='${failedEvent}'`)
      ).toEqual([{ attempt_count: 1, failure_count: 1 }]);
      await fixtureSql(`update public.match_result_alert_retry_fallback
        set updated_at = pg_catalog.clock_timestamp() + interval '1 minute'
        where alert_kind = 'entry_ready' and candidate_id = '${failedEvent}'`);
      const [backoffTurn] = await sqlRows(
        'select public.process_match_result_lifecycle_alerts(1, 1) as result'
      );
      expect(asRecord(backoffTurn?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
      expect(
        (await resultAlerts(peerEvent)).filter(
          (item) => item['event_key'] === `result.entry_ready:${peerEvent}`
        )
      ).toHaveLength(1);
      expect(
        await sqlRows(`select attempt_count,failure_count,last_failure_code from public.match_result_alert_processing_state
          where alert_kind='entry_ready' and candidate_id='${peerEvent}'`)
      ).toEqual([{ attempt_count: 1, failure_count: 0, last_failure_code: null }]);
    } finally {
      await fixtureSql(`drop trigger if exists ${triggerName} on public.match_result_alert_processing_state;
        drop function if exists public.${functionName}();
        drop sequence if exists public.${sequenceName};`);
      await removeNotificationFailure();
    }
    await fixtureSql(`update public.match_result_alert_retry_fallback
      set updated_at = pg_catalog.clock_timestamp() - interval '1 second'
      where alert_kind = 'entry_ready' and candidate_id = '${failedEvent}'`);
    const [retry] = await sqlRows(
      'select public.process_match_result_lifecycle_alerts(1, 1) as result'
    );
    expect(asRecord(retry?.['result'])).toMatchObject({ entry_ready: 1, failed: 0 });
    expect(
      (await resultAlerts(failedEvent)).filter(
        (item) => item['event_key'] === `result.entry_ready:${failedEvent}`
      )
    ).toHaveLength(1);
    expect(
      await sqlRows(`select attempt_count from public.match_result_alert_processing_state
        where alert_kind='entry_ready' and candidate_id='${failedEvent}'`)
    ).toEqual([{ attempt_count: 1 }]);
  });

  it('K3 backs off failed reminders until next_attempt_at then retries within the delay bound', async () => {
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
        last_failure_message: 'Lifecycle alert failed; recovery policy applied.',
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

    await sleep(31_000);
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
