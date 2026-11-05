import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';

const rowsOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
import { provisionProvisionalPlayer } from './helpers/provisional-player-fixtures';
import {
  createResultAmendmentFixtures,
  originalResultSets
} from './helpers/result-amendment-fixtures';

describe(
  'result amendment requests, corrected candidates and approvals',
  { timeout: 180000 },
  () => {
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

    it('requests a correction without touching the official result; retries are idempotent', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const before = await f.originalEvidence(group.eventId);
      const projections = await f.projectionFingerprint(group);

      const command = crypto.randomUUID();
      const first = await f.request(f.p2, group, { p_command_id: command });
      expect(first.error).toBeNull();
      expect(first.data).toMatchObject({
        lifecycle: 'requested',
        base_confirmation_id: group.confirmationId,
        official_confirmation_id: group.confirmationId,
        candidate_version: null,
        pending_application: false,
        replayed: false
      });
      const amendmentId = String(asRecord(first.data).amendment_id);

      const replay = await f.request(f.p2, group, { p_command_id: command });
      expect(asRecord(replay.data)).toMatchObject({ amendment_id: amendmentId, replayed: true });
      const changed = await f.request(f.p2, group, {
        p_command_id: command,
        p_reason: 'A different reason'
      });
      expect(changed.error?.message).toBe('RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT');

      expect(await f.originalEvidence(group.eventId)).toBe(before);
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(
        (
          await sqlRows(
            `select status from public.match_event_result_proposals where id='${group.proposalId}'`
          )
        )[0]
      ).toEqual({ status: 'confirmed' });
      const events = await sqlRows(
        `select event_type from public.result_amendment_events where amendment_id='${amendmentId}'`
      );
      expect(events).toEqual([{ event_type: 'requested' }]);
      const audits = await sqlRows(
        `select action from public.match_event_audit_log where match_event_id='${group.eventId}' and action like 'result_amendment_%'`
      );
      expect(audits).toEqual([{ action: 'result_amendment_requested' }]);
    });

    it('authorizes only original participants, the creator and the current Community Admin', async () => {
      const group = await f.confirmedGroup();
      for (const actor of [f.p1, f.p3, f.admin]) {
        const result = await f.request(actor, group);
        expect(result.error).toBeNull();
        // One live amendment per game group: free the slot for the next actor.
        await f.cancel(actor, String(asRecord(result.data).amendment_id));
      }
      // Same community, but neither participant nor admin.
      const reserve = await f.request(f.reserve, group);
      expect(reserve.error?.message).toBe('RESULT_AMENDMENT_FORBIDDEN');
      expect(reserve.error?.code).toBe('42501');
      expect((await f.request(f.outsider, group)).error?.message).toBe(
        'RESULT_AMENDMENT_FORBIDDEN'
      );
      // An admin of another community has no rights over this event.
      expect((await f.request(foreign.admin, group)).error?.message).toBe(
        'RESULT_AMENDMENT_FORBIDDEN'
      );
      expect(
        (await f.request({ ...f.admin, token: f.anonymousToken }, group)).error?.message
      ).toBeDefined();
    });

    it('rejects unconfirmed groups, stale bases and parallel live requests', async () => {
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId);
      const pending = {
        eventId,
        proposalId: String(asRecord(submitted.data).proposal_id),
        confirmationId: crypto.randomUUID()
      };
      expect((await f.request(f.p0, pending)).error?.message).toBe(
        'RESULT_AMENDMENT_NOT_CONFIRMED'
      );

      const group = await f.confirmedGroup();
      const stale = await f.request(f.p0, group, {
        p_expected_confirmation_id: crypto.randomUUID()
      });
      expect(stale.error?.message).toBe('RESULT_AMENDMENT_BASE_CONFLICT');
      expect(JSON.parse(stale.error?.details ?? 'null')).toEqual({
        current_confirmation_id: group.confirmationId
      });

      const [a, b] = await Promise.all([f.request(f.p0, group), f.request(f.p2, group)]);
      const outcomes = [a, b].map((r) => r.error?.message ?? 'ok').sort();
      expect(outcomes).toEqual(['RESULT_AMENDMENT_ALREADY_OPEN', 'ok']);
      expect(
        await sqlRows(
          `select count(*)::int as n from public.result_amendment_requests where proposal_id='${group.proposalId}'`
        )
      ).toEqual([{ n: 1 }]);
    });

    it('keeps prior proposals, reviews, confirmations and audit rows byte-equivalent after a candidate', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const evidence = await f.originalEvidence(group.eventId);
      const projections = await f.projectionFingerprint(group);
      const { amendmentId, version } = await f.openCandidate(group);
      expect(version).toBe(2);
      expect(await f.originalEvidence(group.eventId)).toBe(evidence);
      expect(await f.projectionFingerprint(group)).toBe(projections);

      const rows = await sqlRows(
        `select version, submitted_by::text as submitted_by from public.match_event_result_proposal_versions
        where proposal_id='${group.proposalId}' order by version`
      );
      expect(rows).toEqual([
        { version: 1, submitted_by: f.p0.id },
        { version: 2, submitted_by: f.p0.id }
      ]);
      const proposal = (
        await sqlRows(
          `select status, active_version::int as active_version from public.match_event_result_proposals where id='${group.proposalId}'`
        )
      )[0];
      expect(proposal).toEqual({ status: 'confirmed', active_version: 1 });
      expect(await f.officialState(group.proposalId)).toMatchObject({
        current_confirmation_id: group.confirmationId,
        current_version: 1,
        official_revision: 1,
        is_void: false
      });
      const link = await sqlRows(
        `select amendment_id::text as amendment_id, base_confirmation_id::text as base from public.result_amendment_candidates
        where proposal_id='${group.proposalId}' and version=2`
      );
      expect(link).toEqual([{ amendment_id: amendmentId, base: group.confirmationId }]);

      // The original official facts stay what readers see while the candidate is pending.
      const official = await f.rpc(f.p1, 'get_match_event_official_results', {
        p_match_event_id: group.eventId
      });
      expect(official.data).toHaveLength(1);
      expect(asRecord(rowsOf(official.data)[0])).toMatchObject({
        confirmation_id: group.confirmationId,
        version: 1
      });
      const proposals = await f.rpc(f.p1, 'get_match_event_result_proposals', {
        p_match_event_id: group.eventId
      });
      const timeline = asRecord(rowsOf(proposals.data)[0])['version_timeline'];
      expect(timeline).toHaveLength(1);
    });

    it('requires opposing approval for a playing submitter and uses the corrected teams for coverage', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const projections = await f.projectionFingerprint(group);
      const { amendmentId, version } = await f.openCandidate(group, f.p0);
      // p2 partners the submitter in the corrected arrangement: no longer an opponent.
      expect((await f.review(f.p2, group, amendmentId, version)).error?.message).toBe(
        'RESULT_AMENDMENT_REVIEW_FORBIDDEN'
      );
      expect((await f.review(f.p0, group, amendmentId, version)).error?.message).toBe(
        'RESULT_AMENDMENT_REVIEW_FORBIDDEN'
      );
      // The community admin who does not play in the corrected teams cannot approve either.
      expect((await f.review(f.admin, group, amendmentId, version)).error?.message).toBe(
        'RESULT_AMENDMENT_REVIEW_FORBIDDEN'
      );
      const approved = await f.review(f.p1, group, amendmentId, version);
      expect(approved.error).toBeNull();
      expect(approved.data).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'MANUAL',
        pending_application: true,
        candidate_version: 2,
        official_confirmation_id: group.confirmationId
      });
      // Accepted-pending-publication never switches facts or projections.
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(await f.officialState(group.proposalId)).toMatchObject({
        current_confirmation_id: group.confirmationId,
        official_revision: 1
      });
      expect(
        await sqlRows(
          `select count(*)::int as n from public.match_event_result_confirmations where proposal_id='${group.proposalId}'`
        )
      ).toEqual([{ n: 1 }]);
      const events = await sqlRows(
        `select event_type, decision_source from public.result_amendment_events where amendment_id='${amendmentId}' order by seq`
      );
      expect(events.map((e) => e['event_type'])).toEqual([
        'requested',
        'candidate_submitted',
        'approved',
        'accepted'
      ]);
    });

    it('requires one approval per corrected team for a nonplaying submitter', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.admin);
      const first = await f.review(f.p0, group, amendmentId, version);
      expect(first.data).toMatchObject({
        lifecycle: 'proposal_pending',
        pending_application: false
      });
      // Same team as p0 in the corrected arrangement: does not cover the other team.
      const same = await f.review(f.p2, group, amendmentId, version);
      expect(same.data).toMatchObject({ lifecycle: 'proposal_pending' });
      const last = await f.review(f.p3, group, amendmentId, version);
      expect(last.data).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'MANUAL'
      });
    });

    it('blocks provisional actors and lets other corrected-team members cover the approval', async () => {
      const { env } = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
      const isolated = await createResultAmendmentFixtures(env!, { onboard: false });
      try {
        await isolated.p0.client.rpc('onboard_player', {
          p_display_name: 'Inviter',
          p_preferred_side: 'EITHER',
          p_initial_level: 3
        });
        const group = await isolated.confirmedGroup();
        const { amendmentId, version } = await isolated.openCandidate(group, isolated.admin);
        expect(
          await provisionProvisionalPlayer({
            userId: isolated.p1.id,
            displayName: 'Provisional Pat',
            estimatedLevel: 3,
            invitedBy: isolated.p0.id,
            sourceEventId: group.eventId
          })
        ).toBe(true);
        const blocked = await isolated.review(isolated.p1, group, amendmentId, version);
        expect(blocked.error?.message).toBe('PROVISIONAL_PLAYER_RESTRICTED');
        expect((await isolated.request(isolated.p1, group)).error?.message).toBe(
          'PROVISIONAL_PLAYER_RESTRICTED'
        );
        expect(
          (
            await isolated.rpc(isolated.p1, 'get_result_amendments', {
              p_match_event_id: group.eventId
            })
          ).error?.message
        ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
        expect(
          (await isolated.review(isolated.p0, group, amendmentId, version)).data
        ).toMatchObject({
          lifecycle: 'proposal_pending'
        });
        expect(
          (await isolated.review(isolated.p3, group, amendmentId, version)).data
        ).toMatchObject({
          lifecycle: 'approved_pending_repair'
        });
      } finally {
        await isolated.cleanup();
      }
    });

    it('only the creator or a current Community Admin submits corrected facts, with scoring validation', async () => {
      const group = await f.confirmedGroup();
      const requested = await f.request(f.p2, group);
      const amendmentId = String(asRecord(requested.data).amendment_id);
      expect((await f.candidate(f.p2, group, amendmentId)).error?.message).toBe(
        'RESULT_AMENDMENT_FORBIDDEN'
      );
      expect(
        (
          await f.candidate(f.admin, group, amendmentId, {
            p_sets: [{ position: 1, team_a_games: 9, team_b_games: 0, completed: true }]
          })
        ).error?.message
      ).toBe('MATCH_RESULT_INVALID_SET_SCORE');
      expect(
        (
          await f.candidate(f.admin, group, amendmentId, {
            p_teams: { team_a: [f.p0.id, f.p1.id], team_b: [f.p2.id, f.reserve.id] }
          })
        ).error?.message
      ).toBe('MATCH_RESULT_GROUP_PLAYERS');
      // Identical to the official facts: nothing to correct.
      expect(
        (
          await f.candidate(f.admin, group, amendmentId, {
            p_teams: { team_a: [f.p1.id, f.p0.id], team_b: [f.p3.id, f.p2.id] },
            p_sets: originalResultSets
          })
        ).error?.message
      ).toBe('RESULT_AMENDMENT_NO_CHANGE');
      const stale = await f.candidate(f.admin, group, amendmentId, {
        p_expected_base_confirmation_id: crypto.randomUUID()
      });
      expect(stale.error?.message).toBe('RESULT_AMENDMENT_BASE_CONFLICT');
      const wrongVersion = await f.candidate(f.admin, group, amendmentId, {
        p_expected_candidate_version: 7
      });
      expect(wrongVersion.error?.message).toBe('RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT');
      expect(
        await sqlRows(
          `select count(*)::int as n from public.match_event_result_proposal_versions where proposal_id='${group.proposalId}'`
        )
      ).toEqual([{ n: 1 }]);
    });

    it('a rejection disputes the candidate and blocks automatic acceptance; a superseding candidate invalidates old approvals by selection', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.admin);
      const rejected = await f.review(f.p1, group, amendmentId, version, {
        p_decision: 'reject',
        p_reason_code: 'SCORE_INCORRECT'
      });
      expect(rejected.data).toMatchObject({ lifecycle: 'disputed' });
      expect((await f.review(f.p3, group, amendmentId, version)).error?.message).toBe(
        'RESULT_AMENDMENT_STATE_CONFLICT'
      );
      await f.expireCandidate(group.proposalId, version);
      await fixtureSql('select public.process_due_result_amendments(100)');
      expect(await f.amendmentRow(amendmentId)).toMatchObject({ lifecycle: 'disputed' });

      const superseding = await f.candidate(f.admin, group, amendmentId, {
        p_expected_candidate_version: version,
        p_sets: [
          { position: 1, team_a_games: 6, team_b_games: 1, completed: true },
          { position: 2, team_a_games: 6, team_b_games: 2, completed: true }
        ]
      });
      expect(superseding.data).toMatchObject({
        lifecycle: 'proposal_pending',
        candidate_version: 3
      });
      // An approval for the superseded version is stale; the old rows are retained.
      const stale = await f.review(f.p0, group, amendmentId, version);
      expect(stale.error?.message).toBe('RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT');
      expect(JSON.parse(stale.error?.details ?? 'null')).toMatchObject({ current_version: 3 });
      expect(
        await sqlRows(
          `select proposal_version::int as v, decision from public.match_event_result_reviews
          where proposal_id='${group.proposalId}' and proposal_version > 1 order by decided_at`
        )
      ).toEqual([{ v: 2, decision: 'reject' }]);
      const events = await sqlRows(
        `select event_type from public.result_amendment_events where amendment_id='${amendmentId}' order by seq`
      );
      expect(events.map((e) => e['event_type'])).toEqual([
        'requested',
        'candidate_submitted',
        'disputed',
        'candidate_superseded',
        'candidate_submitted'
      ]);
      // The fresh candidate has its own full approval requirement.
      expect((await f.review(f.p0, group, amendmentId, 3)).data).toMatchObject({
        lifecycle: 'proposal_pending'
      });
      expect((await f.review(f.p3, group, amendmentId, 3)).data).toMatchObject({
        lifecycle: 'approved_pending_repair'
      });
    });

    it('gives each candidate a fresh 48h window and auto-accepts after it without rejection', async () => {
      const group = await f.confirmedGroup({ competitive: true });
      const projections = await f.projectionFingerprint(group);
      const { amendmentId, version } = await f.openCandidate(group, f.admin);
      const [window] = await sqlRows(
        `select extract(epoch from review_deadline_at - submitted_at)::int as span, submitted_at > c.confirmed_at as fresh
         from public.match_event_result_proposal_versions v, public.match_event_result_confirmations c
        where v.proposal_id='${group.proposalId}' and v.version=${version} and c.id='${group.confirmationId}'`
      );
      expect(window).toMatchObject({ span: 48 * 3600, fresh: true });

      await fixtureSql('select public.process_due_result_amendments(100)');
      expect(await f.amendmentRow(amendmentId)).toMatchObject({ lifecycle: 'proposal_pending' });

      await f.expireCandidate(group.proposalId, version);
      const processed = await sqlRows('select public.process_due_result_amendments(100) as result');
      expect(asRecord(asRecord(processed[0])['result'])['accepted']).toBeGreaterThanOrEqual(1);
      expect(await f.amendmentRow(amendmentId)).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'AUTO_48H',
        decision_actor_id: null
      });
      expect(await f.projectionFingerprint(group)).toBe(projections);
      expect(await f.officialState(group.proposalId)).toMatchObject({
        current_confirmation_id: group.confirmationId
      });
      const audit = await sqlRows(
        `select actor_id from public.match_event_audit_log where match_event_id='${group.eventId}' and action='result_amendment_accepted'`
      );
      expect(audit).toEqual([{ actor_id: null }]);
    });

    it('a review after the deadline records automatic acceptance instead of a late vote', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.admin);
      await f.expireCandidate(group.proposalId, version);
      const late = await f.review(f.p1, group, amendmentId, version);
      expect(late.error).toBeNull();
      expect(late.data).toMatchObject({
        lifecycle: 'approved_pending_repair',
        decision_source: 'AUTO_48H',
        conflict: 'deadline_elapsed'
      });
      expect(
        await sqlRows(
          `select count(*)::int as n from public.match_event_result_reviews where proposal_id='${group.proposalId}' and proposal_version=${version}`
        )
      ).toEqual([{ n: 0 }]);
    });

    it('replays an identical review and conflicts on a changed payload', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId, version } = await f.openCandidate(group, f.admin);
      const command = crypto.randomUUID();
      const first = await f.review(f.p0, group, amendmentId, version, { p_command_id: command });
      const replay = await f.review(f.p0, group, amendmentId, version, { p_command_id: command });
      expect(asRecord(replay.data)).toMatchObject({
        replayed: true,
        lifecycle: 'proposal_pending'
      });
      expect(asRecord(first.data)['replayed']).toBe(false);
      const changed = await f.review(f.p0, group, amendmentId, version, {
        p_command_id: command,
        p_decision: 'reject',
        p_reason_code: 'OTHER',
        p_reason_note: 'No'
      });
      expect(changed.error?.message).toBe('RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT');
      const submitCommand = crypto.randomUUID();
      const reqSecond = await f.candidate(f.admin, group, amendmentId, {
        p_command_id: submitCommand,
        p_expected_candidate_version: version,
        p_court_label: 'Court 9'
      });
      expect(reqSecond.error).toBeNull();
      const submitReplay = await f.candidate(f.admin, group, amendmentId, {
        p_command_id: submitCommand,
        p_expected_candidate_version: version,
        p_court_label: 'Court 9'
      });
      expect(asRecord(submitReplay.data)).toMatchObject({ replayed: true, candidate_version: 3 });
      expect(
        (
          await f.candidate(f.admin, group, amendmentId, {
            p_command_id: submitCommand,
            p_expected_candidate_version: version,
            p_court_label: 'Court 8'
          })
        ).error?.message
      ).toBe('RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT');
    });

    it('cancels a live request, then allows a new one; accepted corrections cannot be canceled', async () => {
      const group = await f.confirmedGroup();
      const requested = await f.request(f.p3, group);
      const amendmentId = String(asRecord(requested.data).amendment_id);
      expect((await f.cancel(f.p1, amendmentId)).error?.message).toBe('RESULT_AMENDMENT_FORBIDDEN');
      const canceled = await f.cancel(f.p3, amendmentId);
      expect(canceled.data).toMatchObject({ lifecycle: 'canceled' });
      expect((await f.candidate(f.admin, group, amendmentId)).error?.message).toBe(
        'RESULT_AMENDMENT_STATE_CONFLICT'
      );
      expect(await f.originalEvidence(group.eventId)).toContain(group.confirmationId);

      const { amendmentId: next, version } = await f.openCandidate(group, f.admin);
      await f.review(f.p0, group, next, version);
      await f.review(f.p3, group, next, version);
      expect((await f.cancel(f.admin, next)).error?.message).toBe(
        'RESULT_AMENDMENT_STATE_CONFLICT'
      );
      // Accepted-pending-publication holds the slot: no second correction until it is applied.
      expect((await f.request(f.p0, group)).error?.message).toBe('RESULT_AMENDMENT_ALREADY_OPEN');
    });

    it('exposes amendment state to readers only and flags capabilities per viewer', async () => {
      const group = await f.confirmedGroup();
      const { amendmentId } = await f.openCandidate(group, f.admin);
      const asParticipant = await f.rpc(f.p1, 'get_result_amendments', {
        p_match_event_id: group.eventId
      });
      expect(asParticipant.error).toBeNull();
      const [dto] = rowsOf(asParticipant.data).map(asRecord);
      expect(dto).toMatchObject({
        amendment_id: amendmentId,
        lifecycle: 'proposal_pending',
        official_confirmation_id: group.confirmationId,
        can_approve: true,
        can_reject: true,
        can_submit_candidate: false,
        pending_application: false
      });
      expect(asRecord(dto!['candidate'])).toMatchObject({ version: 2, classification: 'team_b' });
      const asAdmin = await f.rpc(f.admin, 'get_result_amendments', {
        p_match_event_id: group.eventId
      });
      expect(asRecord(rowsOf(asAdmin.data)[0])).toMatchObject({
        can_approve: false,
        can_submit_candidate: true,
        can_cancel: true
      });
      expect(
        (await f.rpc(f.outsider, 'get_result_amendments', { p_match_event_id: group.eventId }))
          .error?.message
      ).toBe('RESULT_AMENDMENT_FORBIDDEN');
      expect(
        (await f.rpc(foreign.admin, 'get_result_amendments', { p_match_event_id: group.eventId }))
          .error?.message
      ).toBe('RESULT_AMENDMENT_FORBIDDEN');
    });
  }
);
