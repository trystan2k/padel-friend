import { beforeAll, describe, expect, it } from 'vitest';
import { scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  expireLease,
  operator,
  setQuiescence,
  setQuiescenceCap,
  sweep,
  verifyCase
} from './helpers/privacy-request-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import { trustedClient } from './helpers/trusted-client';

const environment = localSupabaseEnv();
const L = sqlText;
const crash = new Error('CRASH');
const crashAfterFreeze = {
  afterStep: (step: string) => {
    if (step === 'freeze') throw crash;
  }
};

/**
 * Review round 3: F15 (irreversibility marker + re-arm lifecycle), F16 (producer pause, external follow-up),
 * F18 (bounded quiescence wait), F19 (address digests do not survive).
 * Subjects: 1 = F15 restart, 2 = F15/F16 frozen case, 3 = F15 address change after the freeze, 4 = F16 activity,
 * 5 = F16 quiet window, 6 = F18, 7 = F19 erased, 0 = F19 withdrawn (and the live player-add actor).
 */
describe.skipIf(!environment.env)(
  'Privacy irreversibility and bounded quiescence',
  { timeout: 900_000 },
  () => {
    let kit: RankedResultKit;
    const player = (index: number) => kit.players[index]!;
    const emailOf = async (id: string) =>
      String(await scalar('select email from auth.users where id = ' + L(id)));
    const requested = async (index: number) => {
      const result = await player(index).client.rpc('request_account_deletion', {
        p_command_id: crypto.randomUUID()
      });
      expect(result.error).toBeNull();
      return String(asRecord(result.data)['reference']);
    };
    /** The operator's case list (service-role RPC through the same path the script uses). */
    const listed = async () =>
      JSON.stringify((await trustedClient().rpc('privacy_op_list_cases')).data);
    const moveAddress = (id: string) =>
      fixtureSql(
        'update auth.users set email = ' +
          L('moved-' + crypto.randomUUID() + '@changed.test') +
          ' where id = ' +
          L(id)
      );
    const interrupt = async (reference: string) => {
      await expect(sweep({ hooks: crashAfterFreeze })).rejects.toBe(crash);
      expect(await caseRow(reference)).toMatchObject({ state: 'executing', last_phase: 'freeze' });
    };
    /** The relational phase failed after the freeze (a seam blocker): the operator may only re-arm or retry. */
    const failRelational = (reference: string) =>
      fixtureSql(
        "update privacy_internal.privacy_cases set state = 'blocked', resume_state = 'executing', blocker_code = 'PLAN_MISMATCH', " +
          "next_action = 'operator_rearm', lease_expires_at = null where reference = " +
          L(reference)
      );

    beforeAll(async () => {
      await setQuiescence(0);
      await setQuiescenceCap(12);
      kit = await createRankedResultFixtures(environment.env!);
      await kit.event();
    });

    it('F15: an expired arm followed by an address change can restart verification (no stranded case)', async () => {
      const subject = player(1).id;
      const reference = await requested(1);
      await verifyCase(reference, await emailOf(subject));
      await armCase(reference);
      await fixtureSql(
        "update privacy_internal.privacy_cases set arm_expires_at = now() - interval '1 second' where reference = " +
          L(reference)
      );
      expect(await sweep()).toEqual({ disabled: false, processed: 0 });
      expect(await caseRow(reference)).toMatchObject({
        state: 'blocked',
        blocker_code: 'ARM_EXPIRED',
        destructive_started_at: null
      });
      await moveAddress(subject);
      // The arm is refused as stale, and the case is not stranded: verification restarts from the blocked state.
      const stale = await operator(
        'arm',
        reference,
        '--plan',
        JSON.stringify(
          (({ blockers: _blockers, ...plan }) => plan)(
            asRecord(asRecord(await operator('dry-run', reference))['plan'])
          )
        )
      );
      expect(stale).toEqual({ status: 'rejected', code: 'VERIFICATION_STALE' });
      expect(await caseRow(reference)).toMatchObject({
        state: 'blocked',
        blocker_code: 'VERIFICATION_STALE'
      });
      const restarted = await operator('start-verification', reference);
      expect(restarted['status']).toBe('ok');
      expect(
        (
          await operator(
            'confirm-proof',
            reference,
            '--code',
            String(restarted['code']),
            '--confirm'
          )
        )['status']
      ).toBe('ok');
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
    });

    it('F15 + F16: a frozen case pauses producers for the subject as actor AND target and cannot be withdrawn or restarted', async () => {
      const subject = player(2).id;
      const email = await emailOf(subject);
      const actor = player(0).id;
      const reference = await requested(2);
      await verifyCase(reference, email);
      // Queued push work of the subject exists before the arm.
      await fixtureSql(
        'insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id, community_id) values (' +
          L(subject) +
          ", 'f16-push:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ')'
      );
      await armCase(reference);
      await interrupt(reference);

      // The pause is durable and atomic with the freeze.
      expect(
        await scalar(
          'select count(*)::int from privacy_internal.case_producer_pause where active and subject_id = ' +
            L(subject)
        )
      ).toBe(1);
      const started = String((await caseRow(reference))['destructive_started_at']);
      expect(started).not.toBe('null');

      // A queued player-add whose ACTOR is live but whose TARGET is the frozen subject is neither redriven nor dispatched.
      const eventId = String(
        await scalar('select id::text from public.match_events order by created_at desc limit 1')
      );
      const byTarget = crypto.randomUUID();
      const byAddress = crypto.randomUUID();
      const requestTarget = crypto.randomUUID();
      const requestAddress = crypto.randomUUID();
      const insertOperation = (
        id: string,
        request: string,
        target: string | null,
        address: string
      ) =>
        'insert into public.match_player_add_operations(id, match_event_id, actor_id, request_id, fingerprint, email, display_name, estimated_level, locale, state, dispatch_state, email_eligible, retry_after, target_user_id) values (' +
        [
          L(id),
          L(eventId),
          L(actor),
          L(request),
          L('fp-' + id),
          L(address),
          L('Paused Target'),
          '3.5',
          L('en'),
          "'awaiting_identity'",
          "'failed'",
          'true',
          "now() - interval '1 minute'",
          target ? L(target) : 'null'
        ].join(', ') +
        ');';
      await fixtureSql(
        insertOperation(
          byTarget,
          requestTarget,
          subject,
          'f16-target-' + crypto.randomUUID() + '@invitee.test'
        ) + insertOperation(byAddress, requestAddress, null, email.toLowerCase())
      );
      try {
        const claimed = await trustedClient().rpc('claim_match_player_add_redrives', {
          p_limit: 100
        });
        const body = JSON.stringify(claimed.data ?? []);
        expect(body).not.toContain(requestTarget);
        expect(body).not.toContain(requestAddress);
        for (const request of [requestTarget, requestAddress]) {
          const dispatched = await trustedClient().rpc('dispatch_match_player_add', {
            p_actor_id: actor,
            p_match_event_id: eventId,
            p_request_id: request
          });
          expect(dispatched.data).toEqual({ action: 'none' });
        }
        expect(
          await scalar(
            'select count(*)::int from public.match_player_add_operations where dispatch_attempts > 0 and id = any (' +
              L('{' + byTarget + ',' + byAddress + '}') +
              '::uuid[])'
          )
        ).toBe(0);
      } finally {
        await fixtureSql(
          'delete from public.match_player_add_operations where id = any (' +
            L('{' + byTarget + ',' + byAddress + '}') +
            '::uuid[]);'
        );
      }

      // Push: the frozen subject's job is never claimed; notifications for the subject are refused.
      const jobs = await trustedClient().rpc('claim_notification_push_jobs', { p_limit: 25 });
      const claimedIds = Array.isArray(jobs.data)
        ? jobs.data.map((job) => String(asRecord(job)['notification_id']))
        : [];
      const recipients =
        claimedIds.length === 0
          ? []
          : (
              await sqlRows(
                'select distinct recipient_user_id::text as r from public.notifications where id = any (' +
                  L('{' + claimedIds.join(',') + '}') +
                  '::uuid[])'
              )
            ).map((row) => row['r']);
      expect(recipients).not.toContain(subject);
      // Hand the leases this probe took back: they belong to other subjects' tests.
      if (claimedIds.length > 0)
        await fixtureSql(
          "update public.notification_push_jobs set status = 'pending', claim_token = null, lease_expires_at = null where notification_id = any (" +
            L('{' + claimedIds.join(',') + '}') +
            '::uuid[])'
        );
      expect(
        await scalar(
          'select public.persist_notification(' +
            L(subject) +
            ", 'f16-frozen:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
            L(kit.communityId) +
            ')'
        )
      ).toBeNull();

      // Irreversible from the first freeze: blocked or not, no withdrawal, restart or refusal.
      await failRelational(reference);
      await expect(
        fixtureSql(
          "update privacy_internal.privacy_cases set state = 'withdrawn' where reference = " +
            L(reference)
        )
      ).rejects.toThrow(/PRIVACY_CASE_IRREVERSIBLE/);
      await expect(
        fixtureSql(
          "update privacy_internal.privacy_cases set state = 'received' where reference = " +
            L(reference)
        )
      ).rejects.toThrow(/PRIVACY_CASE_IRREVERSIBLE/);
      await expect(
        fixtureSql(
          'update privacy_internal.privacy_cases set destructive_started_at = null where reference = ' +
            L(reference)
        )
      ).rejects.toThrow(/PRIVACY_CASE_IRREVERSIBLE/);
      expect(await operator('refuse', reference)).toEqual({
        status: 'rejected',
        code: 'STATE_NOT_REFUSABLE'
      });
      expect((await operator('start-verification', reference))['code']).toBe(
        'STATE_NOT_VERIFIABLE'
      );
      expect(await listed()).toContain('"irreversible":true');

      // Re-arm after an address change: identity was verified before the freeze, so it is recorded, not blocking.
      await moveAddress(subject);
      await armCase(reference);
      expect(await caseRow(reference)).toMatchObject({ state: 'ready' });
      expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
        response_address_changed: true
      });
      // The consumed marker is never reset by a re-arm, and the marker did not move.
      expect((await caseRow(reference))['armed_consumed_at']).not.toBeNull();
      expect(String((await caseRow(reference))['destructive_started_at'])).toBe(started);

      // An expired re-arm blocks again (nothing consumed afresh) but still cannot be withdrawn; re-arming resumes.
      await fixtureSql(
        "update privacy_internal.privacy_cases set arm_expires_at = now() - interval '1 second' where reference = " +
          L(reference)
      );
      expect(await sweep()).toEqual({ disabled: false, processed: 0 });
      expect(await caseRow(reference)).toMatchObject({
        state: 'blocked',
        blocker_code: 'ARM_EXPIRED'
      });
      await expect(
        fixtureSql(
          "update privacy_internal.privacy_cases set state = 'withdrawn' where reference = " +
            L(reference)
        )
      ).rejects.toThrow(/PRIVACY_CASE_IRREVERSIBLE/);
      expect((await operator('start-verification', reference))['code']).toBe(
        'STATE_NOT_VERIFIABLE'
      );
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
        response_address_changed: true
      });
      expect(await tablesMentioning(subject)).toEqual([]);
      expect(
        await scalar(
          'select count(*)::int from privacy_internal.case_producer_pause where subject_id = ' +
            L(subject)
        )
      ).toBe(0);
    });

    it('F15: an address change after the freeze does not block the execution; the response flag records it', async () => {
      const subject = player(3).id;
      const reference = await requested(3);
      await verifyCase(reference, await emailOf(subject));
      await armCase(reference);
      await interrupt(reference);
      await moveAddress(subject);
      await expireLease(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
        response_address_changed: true
      });
      expect(await listed()).toContain('"response_address_changed":true');
    });

    it('F16: subject-scoped external work seen in the window is recorded as external_followup, not awaited', async () => {
      const subject = player(4).id;
      const reference = await requested(4);
      await verifyCase(reference, await emailOf(subject));
      await fixtureSql(
        'insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id, community_id) values (' +
          L(subject) +
          ", 'f16-lease:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ')'
      );
      // A worker holds a live lease on the subject's push job (it may be mid-send to the browser vendor).
      await fixtureSql(
        "update public.notification_push_jobs set status = 'leased', claim_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes' " +
          'where notification_id in (select id from public.notifications where recipient_user_id = ' +
          L(subject) +
          ')'
      );
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
        external_followup: true
      });
      expect(await listed()).toContain('"external_followup":true');
    });

    it('F16: a quiet window sets no external_followup flag', async () => {
      const subject = player(5).id;
      const reference = await requested(5);
      await verifyCase(reference, await emailOf(subject));
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      const manifest = asRecord((await caseRow(reference))['phase_manifest']);
      expect(manifest).not.toHaveProperty('external_followup');
      expect(manifest).not.toHaveProperty('response_address_changed');
    });

    it('F18: an unrelated long transaction ends in a blocked QUIESCENCE_TIMEOUT (freeze kept), and retry resumes fresh', async () => {
      const subject = player(6).id;
      const reference = await requested(6);
      await verifyCase(reference, await emailOf(subject));
      await armCase(reference);
      await setQuiescenceCap(2);
      const writer = await openDedicatedSqlConnection();
      try {
        // An unrelated transaction that started before the freeze and stays open.
        await writer.query('begin');
        await writer.query('select 1');
        await interrupt(reference);
        for (const expected of [1, 2]) {
          await expireLease(reference);
          expect(await sweep()).toEqual({ disabled: false, processed: 1 });
          expect(await caseRow(reference)).toMatchObject({
            state: 'executing',
            last_phase: 'freeze',
            quiescence_attempts: expected,
            attempt_count: 0
          });
        }
        // Cap reached: fail closed for the operator. Nothing was deleted and the freeze is still in force.
        await expireLease(reference);
        expect(await sweep()).toEqual({ disabled: false, processed: 1 });
        expect(await caseRow(reference)).toMatchObject({
          state: 'blocked',
          resume_state: 'executing',
          last_phase: 'freeze',
          blocker_code: 'QUIESCENCE_TIMEOUT',
          next_action: 'operator_retry',
          quiescence_attempts: 2
        });
        expect(
          await scalar(
            'select count(*)::int from privacy_internal.frozen_subjects where subject_id = ' +
              L(subject)
          )
        ).toBe(1);
        expect(
          await scalar(
            'select count(*)::int from public.player_profiles where user_id = ' + L(subject)
          )
        ).toBe(1);
        expect(await sweep()).toEqual({ disabled: false, processed: 0 });

        // Resume re-enters the quiescence phase with fresh attempts (the transaction is still open: it waits again).
        expect((await operator('retry', reference))['state']).toBe('executing');
        expect(await caseRow(reference)).toMatchObject({ quiescence_attempts: 0 });
        expect(await sweep()).toEqual({ disabled: false, processed: 1 });
        expect(await caseRow(reference)).toMatchObject({
          state: 'executing',
          quiescence_attempts: 1
        });
        await writer.query('commit');
      } finally {
        await writer.close();
        await setQuiescenceCap(12);
      }
      // The transaction ended: the operator retry completes the erasure.
      expect((await caseRow(reference))['state']).toBe('executing');
      await expireLease(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(await tablesMentioning(subject)).toEqual([]);
    });

    it('F19: address digests are cleared at expiry, consumption and every terminal state', async () => {
      const digests = async (reference: string) =>
        asRecord(
          (
            await sqlRows(
              'select challenge_address_digest is not null as challenge, verified_address_digest is not null as verified, challenge_digest is not null as code ' +
                'from privacy_internal.privacy_cases where reference = ' +
                L(reference)
            )
          )[0]
        );
      const subject = player(7).id;
      const email = await emailOf(subject);
      const reference = await requested(7);

      // An issued challenge carries the address digest; an expired one is cleared by the sweep.
      const first = await operator('start-verification', reference);
      expect(await digests(reference)).toEqual({ challenge: true, verified: false, code: true });
      await fixtureSql(
        "update privacy_internal.privacy_cases set challenge_expires_at = now() - interval '1 second' where reference = " +
          L(reference)
      );
      await sweep();
      expect(await digests(reference)).toEqual({ challenge: false, verified: false, code: false });
      expect(
        (await operator('confirm-proof', reference, '--code', String(first['code']), '--confirm'))[
          'code'
        ]
      ).toBe('NO_OPEN_CHALLENGE');

      // Consumption moves the digest to the verified column only; both are gone once the case closes.
      await verifyCase(reference, email);
      expect(await digests(reference)).toEqual({ challenge: false, verified: true, code: false });
      await armCase(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
      expect(await digests(reference)).toEqual({ challenge: false, verified: false, code: false });
      await operator('record-response', reference);
      expect(await digests(reference)).toEqual({ challenge: false, verified: false, code: false });

      // A withdrawn case keeps no digest either.
      const withdrawnRef = await requested(0);
      await verifyCase(withdrawnRef, await emailOf(player(0).id));
      expect((await digests(withdrawnRef))['verified']).toBe(true);
      const withdrawn = await player(0).client.rpc('withdraw_my_deletion_request', {
        p_command_id: crypto.randomUUID()
      });
      expect(withdrawn.error).toBeNull();
      expect(await caseRow(withdrawnRef)).toMatchObject({ state: 'withdrawn' });
      expect(await digests(withdrawnRef)).toEqual({
        challenge: false,
        verified: false,
        code: false
      });
    });
  }
);
