import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  sqlRows,
  waitForRows,
  withDeadline
} from './helpers/match-registration-sql';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import { createResultAmendmentFixtures } from './helpers/result-amendment-fixtures';

const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

describe('result dispute resolution and audited override', { timeout: 240000 }, () => {
  let f: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;
  let foreign: Awaited<ReturnType<typeof createResultAmendmentFixtures>>;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createResultAmendmentFixtures(env);
    foreign = await createResultAmendmentFixtures(env);
  });
  afterAll(async () => {
    if (f) await f.cleanup();
    if (foreign) await foreign.cleanup();
  });

  async function rejectionReviews(proposalId: string, version: number) {
    return sqlRows(
      "select to_jsonb(r)::text as row from public.match_event_result_reviews r where r.proposal_id='" +
        proposalId +
        "' and r.proposal_version=" +
        version +
        " and r.decision='reject' order by r.id"
    );
  }

  async function auditActions(eventId: string) {
    return (
      await sqlRows(
        "select action from public.match_event_audit_log where match_event_id='" +
          eventId +
          "' and action in ('result_dispute_upheld','result_dispute_replaced','result_dispute_voided','result_repair_queued') order by action"
      )
    ).map((row) => String(row['action']));
  }

  describe('amendment branch (prior official fact)', () => {
    it('upholds the original: dispute resolved, no job, no invalidation, rejecting review kept', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.disputedCandidate(group);
      const evidence = await f.originalEvidence(group.eventId);
      const projections = await f.projectionFingerprint(group);
      const rejections = await rejectionReviews(group.proposalId, version);
      expect(rejections).toHaveLength(1);

      const command = crypto.randomUUID();
      const done = await f.resolve(f.admin, group.proposalId, version, 'uphold', {
        p_expected_base_confirmation_id: group.confirmationId,
        p_command_id: command
      });
      expect(done.error).toBeNull();
      expect(done.data).toMatchObject({
        amendment_lifecycle: 'rejected',
        official_confirmation_id: group.confirmationId,
        repair: null,
        pending_application: false,
        command_id: command,
        replayed: false,
        resolution: {
          decision: 'uphold',
          resolution_kind: 'amendment',
          amendment_id: amendmentId,
          base_confirmation_id: group.confirmationId,
          candidate_version: version,
          actor_id: f.admin.id,
          justification: 'Court booking record confirms the score'
        }
      });
      const row = await f.amendmentRow(amendmentId);
      expect(row).toMatchObject({
        lifecycle: 'rejected',
        decision_source: 'ADMIN_OVERRIDE',
        decision_actor_id: f.admin.id,
        repair_job_id: null
      });
      expect(row['closed_at']).not.toBeNull();
      expect(await f.repairJobs(group.proposalId)).toEqual([]);
      expect(await f.originalEvidence(group.eventId)).toBe(evidence);
      expect(await f.projectionFingerprint(group)).toBe(projections);
      // The rejecting review stays exactly as the player wrote it.
      expect(await rejectionReviews(group.proposalId, version)).toEqual(rejections);
      expect(await auditActions(group.eventId)).toEqual(['result_dispute_upheld']);
      const audit = await sqlRows(
        "select actor_id::text as actor, request_id::text as request, reason, after_data from public.match_event_audit_log where match_event_id='" +
          group.eventId +
          "' and action='result_dispute_upheld'"
      );
      expect(audit[0]).toMatchObject({
        actor: f.admin.id,
        request: command,
        reason: 'Court booking record confirms the score'
      });
      expect(asRecord(audit[0]!['after_data'])).toMatchObject({
        amendment_id: amendmentId,
        source: 'ADMIN_OVERRIDE'
      });
      // The group is correctable again once the dispute is closed.
      expect((await f.request(f.p2, group)).error).toBeNull();
    });

    it('replaces: queues exactly one correction job and never touches the official fact', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.disputedCandidate(group);
      const evidence = await f.originalEvidence(group.eventId);
      const projections = await f.projectionFingerprint(group);
      const rejections = await rejectionReviews(group.proposalId, version);

      const done = await f.resolve(f.admin, group.proposalId, version, 'replace', {
        p_expected_base_confirmation_id: group.confirmationId
      });
      expect(done.error).toBeNull();
      const receipt = asRecord(done.data);
      const resolution = asRecord(receipt['resolution']);
      const repair = asRecord(receipt['repair']);
      expect(receipt).toMatchObject({
        amendment_lifecycle: 'approved_pending_repair',
        official_confirmation_id: group.confirmationId,
        pending_application: true
      });
      expect(repair).toMatchObject({
        kind: 'replace',
        status: 'queued',
        publication: 'pending',
        projections_complete: false,
        attempt_count: 0,
        failure_code: null,
        committed_revision: null,
        amendment_id: amendmentId,
        resolution_id: resolution['resolution_id']
      });

      const jobs = await f.repairJobs(group.proposalId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        kind: 'replace',
        status: 'queued',
        reason: 'admin_override_replace',
        requested_by: f.admin.id,
        amendment_id: amendmentId,
        expected_base_confirmation_id: group.confirmationId,
        candidate_version: version,
        lease_token: null,
        committed_revision: null
      });
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'ADMIN_OVERRIDE',
        decision_actor_id: f.admin.id,
        repair_job_id: jobs[0]!['id']
      });
      // No official mutation before repair processing.
      expect(await f.originalEvidence(group.eventId)).toBe(evidence);
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(await f.officialState(group.proposalId)).toMatchObject({
        current_confirmation_id: group.confirmationId,
        official_revision: 1,
        is_void: false
      });
      expect(await rejectionReviews(group.proposalId, version)).toEqual(rejections);
      expect(await auditActions(group.eventId)).toEqual([
        'result_dispute_replaced',
        'result_repair_queued'
      ]);
      // A queued correction still blocks a competing request for the same group.
      expect((await f.request(f.p2, group)).error?.message).toBe('RESULT_AMENDMENT_ALREADY_OPEN');

      // Readers see the pending application, never a completed one.
      const dto = asRecord(
        rowsOf(
          (await f.rpc(f.p1, 'get_result_amendments', { p_match_event_id: group.eventId })).data
        )[0]
      );
      expect(dto).toMatchObject({
        lifecycle: 'approved_pending_repair',
        pending_application: true,
        can_resolve: false,
        repair: { status: 'queued', projections_complete: false },
        resolution: { decision: 'replace' }
      });
      const reads = await f.rpc(f.p3, 'get_result_repair_jobs', {
        p_match_event_id: group.eventId
      });
      expect(rowsOf(reads.data)).toHaveLength(1);
      expect(asRecord(rowsOf(reads.data)[0])).not.toHaveProperty('lease_token');
    });

    it('voids the prior confirmed fact with its own correction job and source-invalidation intent', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.disputedCandidate(group);
      const projections = await f.projectionFingerprint(group);

      const done = await f.resolve(f.admin, group.proposalId, version, 'void', {
        p_expected_base_confirmation_id: group.confirmationId
      });
      expect(done.error).toBeNull();
      expect(asRecord(done.data)).toMatchObject({
        amendment_lifecycle: 'approved_pending_repair',
        pending_application: true,
        repair: { kind: 'void', status: 'queued', publication: 'pending' }
      });
      const jobs = await f.repairJobs(group.proposalId);
      expect(jobs).toHaveLength(1);
      // The invalidation intent points at the ORIGINAL official fact, which stays active.
      expect(jobs[0]).toMatchObject({
        kind: 'void',
        reason: 'admin_override_void',
        expected_base_confirmation_id: group.confirmationId,
        amendment_id: amendmentId
      });
      expect(await f.officialState(group.proposalId)).toMatchObject({
        current_confirmation_id: group.confirmationId,
        is_void: false
      });
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(await auditActions(group.eventId)).toEqual([
        'result_dispute_voided',
        'result_repair_queued'
      ]);
    });

    it('allows an override of a still-pending candidate without a recorded rejection', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.p0);
      const done = await f.resolve(f.admin, group.proposalId, version, 'replace', {
        p_expected_base_confirmation_id: group.confirmationId
      });
      expect(done.error).toBeNull();
      expect(asRecord(asRecord(done.data)['resolution'])).toMatchObject({
        decision: 'replace',
        evidence_review_id: null
      });
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'ADMIN_OVERRIDE'
      });
      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
    });

    it('queues one job when player approval accepts a correction (no override involved)', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.openCandidate(group, f.p0);
      const approved = await f.review(f.p1, group, amendmentId, version);
      expect(approved.error).toBeNull();
      expect(asRecord(approved.data)).toMatchObject({
        lifecycle: 'approved_pending_repair',
        pending_application: true,
        repair_status: 'queued',
        publication: 'pending'
      });
      const jobs = await f.repairJobs(group.proposalId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({
        kind: 'replace',
        reason: 'amendment_accepted',
        requested_by: f.p1.id,
        resolution_id: null
      });
      // Overriding an already accepted correction is a state conflict, never a second job.
      const late = await f.resolve(f.admin, group.proposalId, version, 'void', {
        p_expected_base_confirmation_id: group.confirmationId
      });
      expect(late.error?.message).toBe('RESULT_AMENDMENT_STATE_CONFLICT');
      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
    });

    it('queues one job for an automatically accepted correction', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.openCandidate(group, f.p0);
      await f.expireCandidate(group.proposalId, version);
      await fixtureSql(
        "select public.try_auto_accept_result_amendment('" + amendmentId + "', " + version + ')'
      );
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'AUTO_48H'
      });
      const jobs = await f.repairJobs(group.proposalId);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]).toMatchObject({ reason: 'amendment_accepted', requested_by: null });
      expect(await auditActions(group.eventId)).toEqual(['result_repair_queued']);
      // Re-running the trusted acceptance neither duplicates the job nor the audit.
      await fixtureSql(
        "select public.try_auto_accept_result_amendment('" + amendmentId + "', " + version + ')'
      );
      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
      expect(await auditActions(group.eventId)).toEqual(['result_repair_queued']);
    });
  });

  describe('exactly-once command and conflicting decisions', () => {
    it('returns the original receipt for the same command and conflicts on changed payloads', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.disputedCandidate(group);
      const command = crypto.randomUUID();
      const args = { p_expected_base_confirmation_id: group.confirmationId, p_command_id: command };
      const first = await f.resolve(f.admin, group.proposalId, version, 'replace', args);
      expect(first.error).toBeNull();
      const replay = await f.resolve(f.admin, group.proposalId, version, 'replace', args);
      expect(replay.error).toBeNull();
      expect(asRecord(replay.data)).toMatchObject({ replayed: true, command_id: command });
      expect(asRecord(asRecord(replay.data)['resolution'])['resolution_id']).toBe(
        asRecord(asRecord(first.data)['resolution'])['resolution_id']
      );
      const changed = await f.resolve(f.admin, group.proposalId, version, 'replace', {
        ...args,
        p_justification: 'A different justification'
      });
      expect(changed.error?.message).toBe('RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT');
      const opposite = await f.resolve(f.admin, group.proposalId, version, 'uphold', args);
      expect(opposite.error?.message).toBe('RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT');

      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
      const counts = await sqlRows(
        "select (select count(*) from public.result_dispute_resolutions where proposal_id='" +
          group.proposalId +
          "')::int as resolutions, (select count(*) from public.match_event_audit_log where match_event_id='" +
          group.eventId +
          "' and action in ('result_dispute_replaced','result_repair_queued'))::int as audits, (select count(*) from public.notifications n where n.event_key like 'result.repair_queued:%' and n.target_id='" +
          group.eventId +
          "')::int as repair_notices"
      );
      expect(counts[0]).toMatchObject({ resolutions: 1, audits: 2 });
      expect(Number(counts[0]!['repair_notices'])).toBeGreaterThan(0);
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'approved_pending_repair'
      });
    });

    it('lets a new command with a contradictory decision conflict after the first resolution', async () => {
      const group = await f.confirmedGroup();
      const { version } = await f.disputedCandidate(group);
      const args = { p_expected_base_confirmation_id: group.confirmationId };
      expect(
        (await f.resolve(f.admin, group.proposalId, version, 'uphold', args)).error
      ).toBeNull();
      for (const decision of ['uphold', 'replace', 'void'] as const) {
        const again = await f.resolve(f.admin, group.proposalId, version, decision, args);
        expect(again.error?.message).toBe('RESULT_AMENDMENT_ALREADY_RESOLVED');
        expect(JSON.parse(again.error?.details ?? 'null')).toMatchObject({ decision: 'uphold' });
      }
      expect(await f.repairJobs(group.proposalId)).toEqual([]);
    });

    it('lets two concurrent opposite resolutions succeed at most once', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { version } = await f.disputedCandidate(group);
      const args = { p_expected_base_confirmation_id: group.confirmationId };
      const [a, b] = await Promise.all([
        f.resolve(f.admin, group.proposalId, version, 'uphold', args),
        f.resolve(f.admin, group.proposalId, version, 'void', args)
      ]);
      expect([a, b].map((r) => r.error?.message ?? 'ok').sort()).toEqual([
        'RESULT_AMENDMENT_ALREADY_RESOLVED',
        'ok'
      ]);
      const winner = [a, b].find((r) => !r.error)!;
      const decision = asRecord(asRecord(winner.data)['resolution'])['decision'];
      const resolutions = await sqlRows(
        "select decision from public.result_dispute_resolutions where proposal_id='" +
          group.proposalId +
          "'"
      );
      expect(resolutions).toEqual([{ decision }]);
      expect((await f.repairJobs(group.proposalId)).length).toBe(decision === 'void' ? 1 : 0);
    });

    it('collapses identical concurrent commands into one resolution and one job', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { version } = await f.disputedCandidate(group);
      const args = {
        p_expected_base_confirmation_id: group.confirmationId,
        p_command_id: crypto.randomUUID()
      };
      const results = await Promise.all([
        f.resolve(f.admin, group.proposalId, version, 'replace', args),
        f.resolve(f.admin, group.proposalId, version, 'replace', args)
      ]);
      expect(results.map((r) => r.error)).toEqual([null, null]);
      expect(
        results.map((r) => asRecord(r.data)['replayed']).sort((a, b) => Number(a) - Number(b))
      ).toEqual([false, true]);
      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
    });

    it('does not create a second job for the same logical correction', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { amendmentId, version } = await f.disputedCandidate(group);
      expect(
        (
          await f.resolve(f.admin, group.proposalId, version, 'replace', {
            p_expected_base_confirmation_id: group.confirmationId
          })
        ).error
      ).toBeNull();
      const job = (await f.repairJobs(group.proposalId))[0]!;
      // Trusted callers re-queueing the accepted amendment get the existing job back.
      const again = await sqlRows(
        "select public.queue_result_repair_job_locked('" +
          amendmentId +
          "', 'replace', null, null, 'amendment_accepted', null, now())::text as id"
      );
      expect(again).toEqual([{ id: job['id'] }]);
      expect(await f.repairJobs(group.proposalId)).toHaveLength(1);
      // Storage backs the rule: neither the amendment nor the (group, base) pair can repeat.
      await expect(
        fixtureSql(
          "insert into public.result_repair_jobs(community_id, match_event_id, proposal_id, group_number, kind, amendment_id, expected_base_confirmation_id, candidate_version, command_fingerprint, reason) select community_id, match_event_id, proposal_id, group_number, 'void', amendment_id, expected_base_confirmation_id, candidate_version, 'x', 'admin_override_void' from public.result_repair_jobs where id='" +
            job['id'] +
            "'"
        )
      ).rejects.toThrow(/duplicate key/);
    });
  });

  describe('versions, base and reasons', () => {
    it('rejects stale candidate versions, stale bases and malformed justifications', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.p0);
      const args = { p_expected_base_confirmation_id: group.confirmationId };

      // A superseding candidate makes the old version stale; the decision never lands on it.
      const next = await f.candidate(f.admin, group, amendmentId, {
        p_expected_candidate_version: version,
        p_sets: [
          { position: 1, team_a_games: 6, team_b_games: 2, completed: true },
          { position: 2, team_a_games: 6, team_b_games: 2, completed: true }
        ]
      });
      expect(next.error).toBeNull();
      const stale = await f.resolve(f.admin, group.proposalId, version, 'replace', args);
      expect(stale.error?.message).toBe('RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT');
      expect(JSON.parse(stale.error?.details ?? 'null')).toEqual({
        current_version: version + 1,
        lifecycle: 'proposal_pending'
      });

      const staleBase = await f.resolve(f.admin, group.proposalId, version + 1, 'replace', {
        p_expected_base_confirmation_id: crypto.randomUUID()
      });
      expect(staleBase.error?.message).toBe('RESULT_AMENDMENT_BASE_CONFLICT');
      expect(JSON.parse(staleBase.error?.details ?? 'null')).toEqual({
        current_confirmation_id: group.confirmationId
      });

      for (const justification of ['', '   ', 'x'.repeat(501), 'bad\u0007text']) {
        const invalid = await f.resolve(f.admin, group.proposalId, version + 1, 'replace', {
          ...args,
          p_justification: justification
        });
        expect(invalid.error?.message).toBe('RESULT_AMENDMENT_INVALID_JUSTIFICATION');
      }
      const badDecision = await f.resolve(f.admin, group.proposalId, version + 1, 'reject', args);
      expect(badDecision.error?.message).toBe('RESULT_AMENDMENT_INVALID_REQUEST');
      expect(await f.repairJobs(group.proposalId)).toEqual([]);
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'proposal_pending',
        candidate_version: version + 1,
        decision_source: null
      });
    });

    it('conflicts when no candidate exists yet or the group is not confirmed', async () => {
      const group = await f.confirmedGroup();
      const requested = await f.request(f.p0, group);
      expect(requested.error).toBeNull();
      const none = await f.resolve(f.admin, group.proposalId, 2, 'replace', {
        p_expected_base_confirmation_id: group.confirmationId
      });
      expect(none.error?.message).toBe('RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT');
      expect(JSON.parse(none.error?.details ?? 'null')).toEqual({
        current_version: null,
        lifecycle: 'requested'
      });
      const pending = await f.disputedOriginal();
      const wrong = await f.resolve(f.admin, pending.proposalId, 1, 'replace', {
        p_expected_base_confirmation_id: crypto.randomUUID()
      });
      expect(wrong.error?.message).toBe('RESULT_AMENDMENT_NOT_CONFIRMED');
    });

    it('re-reads admin rights under the event lock (revocation racing the command)', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { version } = await f.disputedCandidate(group);
      const racer = await f.addPlayers(1).then(([actor]) => actor!);
      await f.promoteAdmin(racer);
      const holder = await openDedicatedSqlConnection();
      try {
        await holder.query('begin');
        await holder.query("select public.lock_match_event_registration('" + group.eventId + "')");
        const pending = f.resolve(racer, group.proposalId, version, 'replace', {
          p_expected_base_confirmation_id: group.confirmationId
        });
        await waitForRows(
          "select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%resolve_result_dispute%' and pid <> pg_backend_pid()",
          (rows) => rows.length > 0,
          'resolution blocked on the event lock'
        );
        await holder.query(
          "alter table public.community_members disable trigger community_member_guard; update public.community_members set role='member' where community_id='" +
            f.communityId +
            "' and user_id='" +
            racer.id +
            "'; alter table public.community_members enable trigger community_member_guard"
        );
        await holder.query('commit');
        const denied = await withDeadline(pending, 20000, 'racing resolution');
        expect(denied.error?.code).toBe('42501');
        expect(denied.error?.message).toBe('RESULT_AMENDMENT_FORBIDDEN');
      } finally {
        await holder.close();
      }
      expect(await f.repairJobs(group.proposalId)).toEqual([]);
      const resolutions = await sqlRows(
        "select count(*)::int as n from public.result_dispute_resolutions where proposal_id='" +
          group.proposalId +
          "'"
      );
      expect(resolutions).toEqual([{ n: 0 }]);
    });
  });

  describe('first-confirmation branch (never-confirmed result)', () => {
    it('overrides a disputed unconfirmed result with an audited ADMIN_OVERRIDE confirmation', async () => {
      const pending = await f.disputedOriginal({ competitive: true });
      const rejections = await rejectionReviews(pending.proposalId, 1);
      expect(rejections).toHaveLength(1);
      expect(await f.officialState(pending.proposalId)).toBeUndefined();

      const command = crypto.randomUUID();
      const done = await f.resolve(f.admin, pending.proposalId, 1, 'uphold', {
        p_command_id: command
      });
      expect(done.error).toBeNull();
      const receipt = asRecord(done.data);
      const resolution = asRecord(receipt['resolution']);
      expect(receipt).toMatchObject({
        amendment_lifecycle: null,
        repair: null,
        pending_application: false
      });
      expect(resolution).toMatchObject({
        resolution_kind: 'first_confirmation',
        decision: 'uphold',
        amendment_id: null,
        base_confirmation_id: null
      });
      const confirmationId = String(resolution['confirmation_id']);

      // Ordinary first confirmation: pointer, confirmation, audit and projections in one go.
      const confirmation = await sqlRows(
        "select source, actor_id::text as actor, effective_at = confirmed_at as exact from public.match_event_result_confirmations where id='" +
          confirmationId +
          "'"
      );
      expect(confirmation).toEqual([{ source: 'ADMIN_OVERRIDE', actor: f.admin.id, exact: true }]);
      expect(await f.officialState(pending.proposalId)).toMatchObject({
        current_confirmation_id: confirmationId,
        official_revision: 1
      });
      expect(
        await sqlRows(
          "select status from public.match_event_result_proposals where id='" +
            pending.proposalId +
            "'"
        )
      ).toEqual([{ status: 'confirmed' }]);
      // The rejecting review survives; the override is never recorded as a player approval.
      expect(await rejectionReviews(pending.proposalId, 1)).toEqual(rejections);
      expect(
        await sqlRows(
          "select count(*)::int as n from public.match_event_result_reviews where proposal_id='" +
            pending.proposalId +
            "' and decision='approve'"
        )
      ).toEqual([{ n: 0 }]);
      expect(await f.repairJobs(pending.proposalId)).toEqual([]);
      const events = await sqlRows(
        "select count(*)::int as n from public.player_rating_events where game_group_id='" +
          pending.proposalId +
          "'"
      );
      expect(events).toEqual([{ n: 4 }]);
      const audit = await sqlRows(
        "select action, after_data ->> 'source' as source, reason from public.match_event_audit_log where match_event_id='" +
          pending.eventId +
          "' and action in ('result_confirmed','result_dispute_upheld') order by action"
      );
      expect(audit).toEqual([
        {
          action: 'result_confirmed',
          source: 'ADMIN_OVERRIDE',
          reason: 'Court booking record confirms the score'
        },
        {
          action: 'result_dispute_upheld',
          source: 'ADMIN_OVERRIDE',
          reason: 'Court booking record confirms the score'
        }
      ]);
      // Replay is exactly-once.
      const replay = await f.resolve(f.admin, pending.proposalId, 1, 'uphold', {
        p_command_id: command
      });
      expect(asRecord(replay.data)).toMatchObject({ replayed: true });
      expect(
        await sqlRows(
          "select count(*)::int as n from public.match_event_result_confirmations where proposal_id='" +
            pending.proposalId +
            "'"
        )
      ).toEqual([{ n: 1 }]);
      // Now it is a confirmed fact: a correction can be requested through the amendment path.
      expect(
        (
          await f.request(f.p0, {
            eventId: pending.eventId,
            proposalId: pending.proposalId,
            confirmationId
          })
        ).error
      ).toBeNull();
    });

    it('voids a pending candidate: no job, the voided version can never be confirmed', async () => {
      const pending = await f.disputedOriginal();
      const done = await f.resolve(f.admin, pending.proposalId, 1, 'void');
      expect(done.error).toBeNull();
      expect(asRecord(done.data)).toMatchObject({
        repair: null,
        pending_application: false,
        resolution: {
          decision: 'void',
          resolution_kind: 'first_confirmation',
          confirmation_id: null
        }
      });
      expect(await f.officialState(pending.proposalId)).toBeUndefined();
      expect(await f.repairJobs(pending.proposalId)).toEqual([]);
      expect(await auditActions(pending.eventId)).toEqual(['result_dispute_voided']);
      // Neither another resolution nor a direct confirmation can resurrect the voided version.
      expect((await f.resolve(f.admin, pending.proposalId, 1, 'uphold')).error?.message).toBe(
        'RESULT_AMENDMENT_ALREADY_RESOLVED'
      );
      await expect(
        fixtureSql(
          "insert into public.match_event_result_confirmations(proposal_id, proposal_version, match_event_id, group_number, source, confirmed_at, effective_at, actor_id, event_type, ratable_eligible) select p.id, 1, p.match_event_id, p.group_number, 'AUTO_48H', now(), p.review_deadline_at, null, 'friendly', false from public.match_event_result_proposals p where p.id='" +
            pending.proposalId +
            "'"
        )
      ).rejects.toThrow(/current pending result version/);
    });

    it('rejects replace without a prior fact, void without a dispute and stale versions', async () => {
      const pending = await f.disputedOriginal();
      expect((await f.resolve(f.admin, pending.proposalId, 1, 'replace')).error?.message).toBe(
        'RESULT_AMENDMENT_INVALID_DECISION'
      );
      const stale = await f.resolve(f.admin, pending.proposalId, 2, 'uphold');
      expect(stale.error?.message).toBe('RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT');
      expect(JSON.parse(stale.error?.details ?? 'null')).toEqual({
        current_version: 1,
        lifecycle: null
      });
      // A result that is merely pending (no dispute) can be overridden but not voided.
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId);
      const proposalId = String(asRecord(submitted.data).proposal_id);
      expect((await f.resolve(f.admin, proposalId, 1, 'void')).error?.message).toBe(
        'RESULT_AMENDMENT_INVALID_DECISION'
      );
      expect((await f.resolve(f.admin, proposalId, 1, 'uphold')).error).toBeNull();
      // Already confirmed: a first-confirmation command now conflicts with the official fact.
      const confirmed = await f.resolve(f.admin, proposalId, 1, 'uphold');
      expect(confirmed.error?.message).toBe('RESULT_AMENDMENT_ALREADY_RESOLVED');
    });
  });

  describe('authority', () => {
    it('denies players, creators without the admin role, revoked admins and foreign admins', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const { version } = await f.disputedCandidate(group);
      const args = { p_expected_base_confirmation_id: group.confirmationId };
      const projections = await f.projectionFingerprint(group);
      const attempt = (actor: Parameters<typeof f.resolve>[0]) =>
        f.resolve(actor, group.proposalId, version, 'replace', args);

      // Participants that are not admins.
      for (const player of [f.p1, f.p2, f.p3]) {
        const denied = await attempt(player);
        expect(denied.error?.code).toBe('42501');
        expect(denied.error?.message).toBe('RESULT_AMENDMENT_FORBIDDEN');
      }
      // The creator (p0) loses the admin role: creator status alone grants nothing.
      await f.revokeAdmin(f.p0);
      const creator = await attempt(f.p0);
      expect(creator.error?.message).toBe('RESULT_AMENDMENT_FORBIDDEN');
      // A revoked admin that no longer reads the event cannot even see it exists.
      await f.revokeAdmin(f.admin);
      expect((await attempt(f.admin)).error?.message).toBe('RESULT_AMENDMENT_NOT_FOUND');
      // Another community's admin: identical not-found answer, no existence leak.
      const alien = await attempt(foreign.admin);
      expect(alien.error?.message).toBe('RESULT_AMENDMENT_NOT_FOUND');
      const unknown = await f.resolve(foreign.admin, crypto.randomUUID(), 1, 'replace', args);
      expect(unknown.error?.message).toBe(alien.error?.message);
      const anon = await attempt({ ...f.admin, token: f.anonymousToken });
      expect(anon.error?.code).toBe('42501');

      expect(await f.repairJobs(group.proposalId)).toEqual([]);
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(
        await sqlRows(
          "select count(*)::int as n from public.result_dispute_resolutions where proposal_id='" +
            group.proposalId +
            "'"
        )
      ).toEqual([{ n: 0 }]);
    });
  });
});
