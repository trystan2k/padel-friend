import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAlertSender,
  sweepOperationalAlerts,
  type AlertMessage
} from '../src/features/notifications/operational-alerts.server';
import { runRestoreRehearsal } from '../scripts/release-backup-restore.mjs';
import {
  dispatchNotificationPush,
  sweepNotificationPushOnSchedule
} from '../src/features/notifications/push-dispatch.server';
import {
  recordManualRatingFailure,
  sweepJobDiagnostics
} from '../src/features/result-repairs/job-diagnostics.server';
import {
  installRatingProjectionFailure,
  installResultConfirmationFailure,
  makeResultProcessingRetryDue,
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';
import { playedAt } from './helpers/ranked-result-fixtures';
import { localAdminClient } from './helpers/match-add-player-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows, waitForRows } from './helpers/match-registration-sql';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import {
  backdateMemberships,
  closeLeague,
  confirmRankedGroup,
  dayAt
} from './helpers/result-correction-fixtures';
import {
  claimRepair,
  queueCorrection,
  repairNow,
  requeueJob,
  withFailingPublication,
  withNoopPublication
} from './helpers/result-replay-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

/**
 * PAF-168: representative data (two quartets, rating history, a closed League snapshot, notification
 * and Push queue state, a failed repair job) survives a scripted restore into disposable databases
 * twice, and the failed repair job raises exactly one deduplicated alert with recovery.
 */
describe.skipIf(!environment.env)('release integrity', { timeout: 900_000 }, () => {
  let kit: RankedResultKit;
  let jobId: string;
  let firstGroup: Awaited<ReturnType<typeof confirmRankedGroup>>;
  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!, { levels: [7, 6, 5, 4, 4, 4, 4, 4] });
    await backdateMemberships(kit, new Date(Date.now() - 90 * 86_400_000).toISOString());
    const anchor = new Date(Date.now() - 40 * 86_400_000);
    const leagueId = await kit.league({
      status: 'active',
      endMode: 'manual',
      endAt: null,
      startAt: dayAt(anchor, 0)
    });
    const eventId = await kit.event(leagueId);
    const first = await confirmRankedGroup(kit, { eventId, playedAt: dayAt(anchor, 2) });
    await confirmRankedGroup(kit, { eventId, playedAt: dayAt(anchor, 2), groupNumber: 2 });
    await closeLeague(kit, leagueId);
    firstGroup = first;
    jobId = (await queueCorrection(first)).jobId;
    // Read state: one notification of the first player is read, the rest stay unread.
    await fixtureSql(
      `update public.notifications set read_at = now() where id = (select id from public.notifications where recipient_user_id = '${kit.players[0]!.id}' limit 1)`
    );
  });
  afterAll(async () => {
    if (jobId)
      await fixtureSql(`delete from public.operational_alerts where reference = '${jobId}';`);
    if (kit)
      await fixtureSql(
        `delete from public.operational_job_events where reference in (select id from public.result_repair_jobs where community_id='${kit.communityId}') or reference in (select p.id from public.match_event_result_proposals p join public.match_events e on e.id=p.match_event_id where e.community_id='${kit.communityId}'); delete from public.operational_alerts where reference in(select n.id::text from public.notifications n where recipient_user_id=any(array[${kit.players.map((p) => `'${p.id}'`).join(',')}]::uuid[])) or reference='configuration';`
      );
    await kit?.cleanup();
  });

  it('restores the representative source twice with identical invariants', () => {
    const base = `restore_rehearsal_it${Date.now().toString(36)}`;
    const report = runRestoreRehearsal({
      source: 'postgres',
      base,
      confirm: base,
      requireRepresentative: true
    });
    if (process.env.RELEASE_REHEARSAL_REPORT)
      writeFileSync(process.env.RELEASE_REHEARSAL_REPORT, JSON.stringify(report, null, 2));
    expect(report.sourceStable).toBe(true);
    expect(report.runs).toHaveLength(2);
    for (const run of report.runs) {
      expect(run.mismatchedTables).toEqual([]);
      expect(run.schemaDiff).toEqual([]);
      expect(run.authorizedReads.match).toBe(true);
      expect(run.dispatchDisabled.cronAbsent).toBe(true);
    }
    expect(report.pass).toBe(true);
    expect(report.representative['public.statistics_group_facts']).toBeGreaterThanOrEqual(2);
  });

  it('alerts once per terminal failure, retries a dead receiver, and reports recovery', async () => {
    const client = localAdminClient(environment.env!);
    await withFailingPublication(() => repairNow(jobId));
    // A retryable failure inside its retry budget is a transient retry, never a page.
    const key = (attempt: number) => `repair:${jobId}:${attempt}`;
    const sent: AlertMessage[] = [];
    const sink = async (message: AlertMessage) => void sent.push(message);
    await sweepOperationalAlerts(client, sink);
    expect(sent.filter((m) => m.reference === jobId)).toEqual([]);

    await fixtureSql(
      `update public.result_repair_jobs set attempt_count = 5 where id = '${jobId}'`
    );
    let reachable = false;
    const receiver = createServer((request, response) => {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', (chunk: string) => {
        body += chunk;
      });
      request.on('end', () => {
        if (reachable) {
          const value: unknown = JSON.parse(body);
          if (
            !value ||
            typeof value !== 'object' ||
            !('state' in value) ||
            (value.state !== 'open' && value.state !== 'resolved') ||
            !('key' in value) ||
            typeof value.key !== 'string' ||
            !('source' in value) ||
            typeof value.source !== 'string' ||
            !('severity' in value) ||
            typeof value.severity !== 'string' ||
            !('reference' in value) ||
            typeof value.reference !== 'string'
          )
            throw new Error('Invalid local alert payload');
          sent.push({
            state: value.state,
            key: value.key,
            source: value.source,
            severity: value.severity,
            reference: value.reference
          });
        }
        response.writeHead(reachable ? 204 : 503).end();
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const address = receiver.address();
    if (!address || typeof address === 'string') throw new Error('Local receiver unavailable');
    const flaky = createAlertSender({
      OPS_ALERT_WEBHOOK_URL: `http://127.0.0.1:${address.port}/alerts`
    })!;
    try {
      const dead = await sweepOperationalAlerts(client, flaky);
      expect(dead.failed).toBeGreaterThanOrEqual(1);
      expect(sent.filter((m) => m.key === key(5))).toEqual([]);
      reachable = true;
      await sweepOperationalAlerts(client, flaky);
      await sweepOperationalAlerts(client, flaky);
      expect(sent.filter((m) => m.key === key(5) && m.state === 'open')).toHaveLength(1);

      await requeueJob(jobId);
      await withNoopPublication(() => repairNow(jobId));
      await sweepOperationalAlerts(client, flaky);
      await sweepOperationalAlerts(client, flaky);
      expect(sent.filter((m) => m.key === key(5) && m.state === 'resolved')).toHaveLength(1);
      const [row] = await sqlRows(
        `select count(*)::int as n from public.operational_alerts where alert_key = '${key(5)}' and resolved_at is not null`
      );
      expect(row?.['n']).toBe(1);
      const [notification] = await sqlRows(
        `select id from public.notifications where recipient_user_id='${kit.players[0]!.id}' limit 1`
      );
      const pushId = String(notification?.['id']);
      await fixtureSql(
        `update public.notification_push_jobs set created_at=now()-interval '25 hours' where notification_id='${pushId}';`
      );
      expect((await client.rpc('claim_notification_push_jobs', { p_limit: 1 })).error).toBeNull();
      let entered!: () => void;
      let release!: () => void;
      const claimed = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = sweepOperationalAlerts(client, async (message) => {
        entered();
        await held;
        await flaky(message);
      });
      await claimed;
      const competing = await sweepOperationalAlerts(client, flaky);
      expect(competing.sent).toBe(0);
      release();
      await first;
      expect(sent.filter((m) => m.key === `push:${pushId}` && m.state === 'open')).toHaveLength(1);
      await fixtureSql(
        `update public.notification_push_jobs set status='completed' where notification_id='${pushId}';`
      );
      await sweepOperationalAlerts(client, flaky);
      expect(sent.filter((m) => m.key === `push:${pushId}` && m.state === 'resolved')).toHaveLength(
        1
      );

      await expect(
        sweepNotificationPushOnSchedule({
          client,
          env: { WEB_PUSH_ENABLED: 'true', WEB_PUSH_VAPID_SUBJECT: 'invalid' }
        })
      ).rejects.toThrow('PUSH_CONFIG_UNAVAILABLE');
      await sweepOperationalAlerts(client, flaky);
      await sweepOperationalAlerts(client, flaky);
      expect(sent.filter((m) => m.key === 'push:configuration' && m.state === 'open')).toHaveLength(
        1
      );
      await dispatchNotificationPush(client, { keys: new Map(), revoked: [] }, async () => ({
        status: 201,
        retryAfter: null
      }));
      await sweepOperationalAlerts(client, flaky);
      expect(
        sent.filter((m) => m.key === 'push:configuration' && m.state === 'resolved')
      ).toHaveLength(1);
      // Permanent provider rejection is terminal even when the parent job completes normally.
      const failedPush = crypto.randomUUID();
      const device = crypto.randomUUID();
      await fixtureSql(`
        insert into public.push_subscriptions(id,user_id,endpoint,p256dh,auth,vapid_key_id,locale,created_at)
          values('${device}','${kit.players[0]!.id}','https://fcm.googleapis.com/fcm/send/${device}','B'||repeat('A',86),repeat('A',22),'key-1','en',now()-interval '1 minute');
        insert into public.notification_preferences(user_id,push_enabled) values('${kit.players[0]!.id}',true)
          on conflict(user_id) do update set push_enabled=true,push_community=true;
        insert into public.notifications(id,recipient_user_id,event_key,kind,category,target_type,target_id)
          values('${failedPush}','${kit.players[0]!.id}','release:${failedPush}','community_invitation','community','community_invitation','${failedPush}');
        update public.notification_push_jobs set next_attempt_at=now()-interval '1 day' where notification_id='${failedPush}';
      `);
      const rejected = await dispatchNotificationPush(
        client,
        {
          keys: new Map([
            [
              'key-1',
              { publicKey: 'public', privateKey: 'private', subject: 'mailto:test@example.test' }
            ]
          ]),
          revoked: []
        },
        async () => ({ status: 400, retryAfter: null })
      );
      expect(rejected.failed).toBeGreaterThanOrEqual(1);
      await sweepOperationalAlerts(client, flaky);
      expect(sent.filter((m) => m.key === `push:${failedPush}` && m.state === 'open')).toHaveLength(
        1
      );
      // Explicit operator retirement of failed delivery is recovery, not a fabricated successful send.
      await fixtureSql(
        `update public.notification_push_deliveries set status='skipped' where notification_id='${failedPush}';`
      );
      await sweepOperationalAlerts(client, flaky);
      expect(
        sent.filter((m) => m.key === `push:${failedPush}` && m.state === 'resolved')
      ).toHaveLength(1);
      await fixtureSql(`delete from public.push_subscriptions where id='${device}';`);
    } finally {
      await new Promise<void>((resolve, reject) =>
        receiver.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });
  it('emits a safe rating-stage diagnostic when a normal confirmation fails at projection', async () => {
    const eventId = await kit.event(null);
    await kit.submit(eventId, playedAt(7200).played);
    const proposal = await kit.proposalId(eventId);
    await setResultReviewDeadlineOffset(proposal, 1, -1);
    const removeFailure = await installRatingProjectionFailure(proposal);
    try {
      expect(await processDueMatchEventResults()).toMatchObject({ failed: 1 });
    } finally {
      await removeFailure();
    }
    // The confirmation rolled back; only the committed failure evidence survives, and it is safe.
    expect(
      await sqlRows(
        `select event,outcome,code,stage from public.operational_job_events where reference='${proposal}' order by event`
      )
    ).toEqual([
      {
        event: 'rating.failure',
        outcome: 'failure',
        code: 'RATING_PROJECTION_FAILED',
        stage: 'rating_projection'
      },
      {
        event: 'result.confirm',
        outcome: 'failure',
        code: 'AUTO_CONFIRM_FAILED',
        stage: 'auto_confirm'
      }
    ]);
    expect(
      await sqlRows(`select status from public.match_event_result_proposals where id='${proposal}'`)
    ).toEqual([{ status: 'pending' }]);
    // Non-rating confirmation failures never claim the rating stage.
    const other = await kit.event(null);
    await kit.submit(other, playedAt(10800).played);
    const otherProposal = await kit.proposalId(other);
    await setResultReviewDeadlineOffset(otherProposal, 1, -1);
    const removeOther = await installResultConfirmationFailure(otherProposal);
    try {
      expect(await processDueMatchEventResults()).toMatchObject({ failed: 1 });
    } finally {
      await removeOther();
    }
    expect(
      await sqlRows(
        `select event from public.operational_job_events where reference='${otherProposal}'`
      )
    ).toEqual([{ event: 'result.confirm' }]);
  });
  it('records exactly one rating.failure when a manual confirmation fails at projection, none on success', async () => {
    const client = localAdminClient(environment.env!);
    const eventId = await kit.event(null);
    await kit.submit(eventId, playedAt(14400).played);
    const proposal = await kit.proposalId(eventId);
    const requestId = crypto.randomUUID();
    const events = () =>
      sqlRows(
        `select event,outcome,code,stage,attempt from public.operational_job_events where reference='${proposal}'`
      );
    const removeFailure = await installRatingProjectionFailure(proposal);
    let failed: Awaited<ReturnType<typeof kit.approve>>;
    try {
      failed = await kit.approve(proposal);
    } finally {
      await removeFailure();
    }
    expect(failed.error).toMatchObject({ details: 'rating_projection' });
    // The whole confirmation rolled back: nothing durable exists until the server reports it.
    expect(await events()).toEqual([]);
    expect(
      await sqlRows(`select status from public.match_event_result_proposals where id='${proposal}'`)
    ).toEqual([{ status: 'pending' }]);

    // A failure without the fixed rating-stage marker is not a rating failure.
    await recordManualRatingFailure({ details: null }, proposal, requestId, client);
    expect(await events()).toEqual([]);

    await recordManualRatingFailure(failed.error!, proposal, requestId, client);
    await recordManualRatingFailure(failed.error!, proposal, requestId, client);
    expect(await events()).toEqual([
      {
        event: 'rating.failure',
        outcome: 'failure',
        code: 'RATING_PROJECTION_FAILED',
        stage: 'rating_projection',
        attempt: 0
      }
    ]);

    // The retried confirmation succeeds: the command never reports, so no further event appears.
    expect((await kit.approve(proposal)).error).toBeNull();
    expect(await events()).toHaveLength(1);
    // A late duplicate of the same command's report stays idempotent after confirmation.
    await recordManualRatingFailure(failed.error!, proposal, requestId, client);
    expect(await events()).toHaveLength(1);
  });
  it('records a manual rating failure even when the proposal is confirmed before the report runs', async () => {
    const client = localAdminClient(environment.env!);
    const eventId = await kit.event(null);
    await kit.submit(eventId, playedAt(18000).played);
    const proposal = await kit.proposalId(eventId);
    const requestId = crypto.randomUUID();
    const events = () =>
      sqlRows(
        `select event,code,stage from public.operational_job_events where reference='${proposal}'`
      );
    const removeFailure = await installRatingProjectionFailure(proposal);
    let failed: Awaited<ReturnType<typeof kit.approve>>;
    try {
      failed = await kit.approve(proposal);
    } finally {
      await removeFailure();
    }
    expect(failed.error).toMatchObject({ details: 'rating_projection' });
    // Another reviewer (or the due processor) confirms before the diagnostic transaction runs.
    expect((await kit.approve(proposal)).error).toBeNull();
    expect(
      await sqlRows(`select status from public.match_event_result_proposals where id='${proposal}'`)
    ).toEqual([{ status: 'confirmed' }]);
    expect(await events()).toEqual([]);
    // The observed failure is still evidence; a repeat of the same command report adds nothing.
    await recordManualRatingFailure(failed.error!, proposal, requestId, client);
    await recordManualRatingFailure(failed.error!, proposal, requestId, client);
    expect(await events()).toEqual([
      { event: 'rating.failure', code: 'RATING_PROJECTION_FAILED', stage: 'rating_projection' }
    ]);
  });
  it('fences alert reconciliation in the database across independent clients', async () => {
    const lockKey = "pg_catalog.hashtextextended('padel-friend:operational-alert-reconcile', 0)";
    const holder = await openDedicatedSqlConnection();
    const first = localAdminClient(environment.env!);
    const second = localAdminClient(environment.env!);
    try {
      // An in-flight reconciliation owns the fence; two other isolates start meanwhile.
      await holder.query('begin');
      await holder.query(`select pg_catalog.pg_advisory_xact_lock(${lockKey})`);
      // Postgrest builders are lazy: Promise.resolve starts each request now.
      const racing = [
        Promise.resolve(first.rpc('reconcile_current_operational_alerts')),
        Promise.resolve(second.rpc('reconcile_current_operational_alerts'))
      ];
      await waitForRows(
        `select count(*)::int as waiters from pg_catalog.pg_locks l where l.locktype = 'advisory' and not l.granted and ((l.classid::bigint << 32) | l.objid::bigint) = ${lockKey}`,
        (rows) => Number(rows[0]?.['waiters']) >= 1,
        'a reconciliation waiting on the fence',
        30_000
      );
      // Newer state commits while they wait. A snapshot read BEFORE the fence would miss it and
      // reconcile it away afterwards; behind the fence every run reads after the holder's commit.
      await fixtureSql(
        `insert into public.operational_push_health(singleton,code) values(true,'PUSH_CONFIG_UNAVAILABLE') on conflict(singleton) do update set code=excluded.code`
      );
      await holder.query('commit');
      for (const result of await Promise.all(racing)) {
        expect(result.error).toBeNull();
        expect(JSON.stringify(result.data)).toContain('push:configuration');
      }
      expect(
        await sqlRows(
          `select resolved_at is null as open from public.operational_alerts where alert_key='push:configuration'`
        )
      ).toEqual([{ open: true }]);
      // Mixed-version rollout: an old Worker still calling the legacy signature succeeds, gets the
      // fenced behavior, and its stale self-supplied snapshot ([] would resolve the alert) is ignored.
      const legacy = await first.rpc('reconcile_operational_alerts', { p_signals: [] });
      expect(legacy.error).toBeNull();
      expect(JSON.stringify(legacy.data)).toContain('push:configuration');
      expect(
        await sqlRows(
          `select resolved_at is null as open from public.operational_alerts where alert_key='push:configuration'`
        )
      ).toEqual([{ open: true }]);
      // The snapshot-applying core is not reachable by any API role.
      expect(
        (await first.rpc('apply_operational_alert_signals', { p_signals: [] })).error
      ).not.toBeNull();
    } finally {
      await holder.query('rollback').catch(() => undefined);
      await holder.close();
      await fixtureSql(
        `update public.operational_push_health set code=null; delete from public.operational_alerts where alert_key='push:configuration';`
      );
    }
  });
  it('exports committed auto-confirm/replay outcomes and rating-stage failure', async () => {
    const client = localAdminClient(environment.env!);
    const eventId = await kit.event(null);
    await kit.submit(eventId, playedAt(3600).played);
    const proposal = await kit.proposalId(eventId);
    await setResultReviewDeadlineOffset(proposal, 1, -1);
    const removeFailure = await installResultConfirmationFailure(proposal);
    try {
      expect(await processDueMatchEventResults()).toMatchObject({ failed: 1 });
    } finally {
      await removeFailure();
    }
    const failures = await sqlRows(
      `select event,outcome from public.operational_job_events where reference='${proposal}' order by occurred_at`
    );
    expect(failures).toEqual([{ event: 'result.confirm', outcome: 'failure' }]);
    await makeResultProcessingRetryDue(proposal, 1);
    expect(await processDueMatchEventResults()).toMatchObject({ confirmed: 1 });
    const success = await sqlRows(
      `select event,outcome from public.operational_job_events where reference='${proposal}' and outcome='success'`
    );
    expect(success).toEqual([{ event: 'result.confirm', outcome: 'success' }]);

    const correction = await queueCorrection(firstGroup);
    const [row] = await sqlRows(
      `select pg_get_functiondef('public.rating_projection_replay(bigint,jsonb)'::regprocedure) as definition`
    );
    const original = String(row?.['definition']);
    const fault = original.replace(
      /AS \$(\w*)\$[\s\S]*?\$\1\$/i,
      () => "AS $fault$ begin raise exception 'RATING_CONFIG_UNSUPPORTED'; end $fault$"
    );
    expect(fault).not.toBe(original);
    await fixtureSql(fault);
    try {
      expect((await claimRepair(correction.jobId)).claimed).toBe(true);
      await fixtureSql('select public.run_claimed_result_repairs(1);');
    } finally {
      await fixtureSql(original);
    }
    const replay = await sqlRows(
      `select event,outcome,stage from public.operational_job_events where reference='${correction.jobId}' order by occurred_at,event`
    );
    expect(replay).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'replay.start', outcome: 'success' }),
        expect.objectContaining({ event: 'replay.fail', outcome: 'failure', stage: 'replay' }),
        expect.objectContaining({
          event: 'rating.failure',
          outcome: 'failure',
          stage: 'rating_projection'
        })
      ])
    );
    expect(replay.some((event) => event['event'] === 'replay.complete')).toBe(false);
    await requeueJob(correction.jobId);
    await withNoopPublication(() => repairNow(correction.jobId));
    expect(
      await sqlRows(
        `select event from public.operational_job_events where reference='${correction.jobId}' and event='replay.complete'`
      )
    ).toHaveLength(1);
    // The outbox read is bounded (100 oldest unlogged rows, globally), so sibling suites' backlog can
    // push this test's events past the first batch: drain until a sweep comes back short.
    let swept = await sweepJobDiagnostics(client);
    expect(swept).toBeGreaterThan(0);
    for (let batch = 0; swept === 100 && batch < 50; batch++) {
      swept = await sweepJobDiagnostics(client);
    }
    expect(
      await sqlRows(
        `select event from public.operational_job_events where reference='${proposal}' and logged_at is null`
      )
    ).toEqual([]);
    // Service-only evidence and alert leases are never exposed to a browser identity.
    expect((await kit.players[0]!.client.rpc('read_operational_job_events')).error).not.toBeNull();
    await fixtureSql(
      `delete from public.operational_alerts where reference='${correction.jobId}';`
    );
  });
});
