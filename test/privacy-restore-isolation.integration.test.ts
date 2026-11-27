import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { privacyTablesMentioning, setQuiescence } from './helpers/privacy-request-fixtures';
import { scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  expireLease,
  operator,
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
const settles = async (promise: Promise<unknown>, withinMs: number) =>
  Promise.race([
    promise.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), withinMs))
  ]);

/**
 * Round 4: F22 (no reconcile on a live database), F23 (erased subjects never receive producer work again),
 * F24 (freeze serializes against producer admission), F25 (address revalidated by the freeze).
 * Subjects: 1 = F23, 2 = F24, 3 = F25; player 0 is the live actor and 4 a live bystander.
 */
describe.skipIf(!environment.env)(
  'Privacy restore isolation and producer fencing',
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
    const notify = (recipient: string, key: string) =>
      scalar(
        'select public.persist_notification(' +
          L(recipient) +
          ', ' +
          L(key + ':' + crypto.randomUUID()) +
          ", 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ')'
      );

    beforeAll(async () => {
      await setQuiescence(0);
      kit = await createRankedResultFixtures(environment.env!);
      await kit.event();
    });

    it('F22: a live database (gate closed) refuses every restore RPC and keeps the subject', async () => {
      const live = player(4).id;
      for (const [name, args] of [
        [
          'privacy_op_restore_reconcile',
          { p_subject: live, p_project_ref: 'local', p_storage_verified: true }
        ],
        ['privacy_op_restore_storage_set', { p_subject: live, p_project_ref: 'local' }]
      ] as const) {
        const result = await trustedClient().rpc(name, args);
        expect(result.data).toEqual({ status: 'rejected', code: 'RESTORE_GATE_NOT_PENDING' });
      }
      expect(
        await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(live))
      ).toBe(1);
      expect(await scalar('select status from privacy_internal.restore_gate')).toBe('closed');
    });

    it('F23: an erased subject stays fenced for good, late sends cannot link, and the response needs the follow-up ack', async () => {
      const subject = player(1).id;
      const email = await emailOf(subject);
      const actor = player(0).id;
      const eventId = String(
        await scalar('select id::text from public.match_events order by created_at desc limit 1')
      );
      const reference = await requested(1);
      await verifyCase(reference, email);
      const lateRequest = crypto.randomUUID();
      const targetRequest = crypto.randomUUID();
      const lateOperation = crypto.randomUUID();
      const targetOperation = crypto.randomUUID();
      const attempt = crypto.randomUUID();
      const insertOperation = (
        id: string,
        request: string,
        address: string,
        extra: { dispatchState: string; target?: string; attempt?: string }
      ) =>
        'insert into public.match_player_add_operations(id, match_event_id, actor_id, request_id, fingerprint, email, display_name, estimated_level, locale, state, dispatch_state, email_eligible, retry_after, target_user_id, dispatch_attempt) values (' +
        [
          L(id),
          L(eventId),
          L(actor),
          L(request),
          L('fp-' + id),
          L(address),
          L('Late Invitee'),
          '3.5',
          L('en'),
          "'awaiting_identity'",
          L(extra.dispatchState),
          'true',
          "now() - interval '1 minute'",
          extra.target ? L(extra.target) : 'null',
          extra.attempt ? L(extra.attempt) : 'null'
        ].join(', ') +
        ');';
      // An invitation to the subject's address is mid-send (a worker holds the attempt) when the case runs, and a
      // queued add of ANOTHER address targets the subject (it will be re-keyed to the tombstone).
      await fixtureSql(
        insertOperation(lateOperation, lateRequest, email.toLowerCase(), {
          dispatchState: 'pending',
          attempt
        }) +
          insertOperation(
            targetOperation,
            targetRequest,
            'f23-' + crypto.randomUUID() + '@invitee.test',
            {
              dispatchState: 'failed',
              target: subject
            }
          ) +
          'insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id, community_id) values (' +
          L(subject) +
          ", 'f23-lease:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ');' +
          "update public.notification_push_jobs set status = 'leased', claim_token = gen_random_uuid(), lease_expires_at = now() + interval '10 minutes' where notification_id in (select id from public.notifications where recipient_user_id = " +
          L(subject) +
          ')'
      );
      try {
        await armCase(reference);
        expect(await sweep()).toEqual({ disabled: false, processed: 1 });
        expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
        expect(await tablesMentioning(subject)).toEqual([]);
        expect(await privacyTablesMentioning(subject)).toEqual([]);

        // The pause row outlives the finish (un-linked from the subject); the dead anchor is the durable fence.
        const caseId = String((await caseRow(reference))['id']);
        expect(
          await sqlRows(
            'select active, subject_id is null as unlinked from privacy_internal.case_producer_pause where case_id = ' +
              L(caseId)
          )
        ).toEqual([{ active: true, unlinked: true }]);
        const tombstone = String(
          await scalar(
            'select target_user_id::text from public.match_player_add_operations where id = ' +
              L(targetOperation)
          )
        );
        expect(tombstone).not.toBe(subject);
        for (const dead of [subject, tombstone])
          expect(await scalar('select privacy_internal.producer_paused(' + L(dead) + ')')).toBe(
            true
          );
        expect(
          await scalar('select privacy_internal.producer_paused(' + L(player(4).id) + ')')
        ).toBe(false);
        // Every entry point asks the one fence.
        for (const fn of [
          'claim_match_player_add_redrives',
          'dispatch_match_player_add',
          'claim_notification_push_jobs',
          'persist_notification'
        ])
          expect(
            await scalar(
              "select pg_get_functiondef(p.oid) ~ 'producer_paused|player_add_paused' from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = " +
                L(fn)
            )
          ).toBe(true);
        expect(await notify(subject, 'f23-erased')).toBeNull();
        expect(await notify(tombstone, 'f23-tombstone')).toBeNull();
        // The queued add that now targets the tombstone is neither redriven nor dispatched.
        const claimed = await trustedClient().rpc('claim_match_player_add_redrives', {
          p_limit: 100
        });
        expect(JSON.stringify(claimed.data ?? [])).not.toContain(targetRequest);
        expect(
          (
            await trustedClient().rpc('dispatch_match_player_add', {
              p_actor_id: actor,
              p_match_event_id: eventId,
              p_request_id: targetRequest
            })
          ).data
        ).toEqual({ action: 'none' });

        // A pre-freeze invitation settling late finds the scrubbed operation: refused, nothing completes.
        expect(
          await sqlRows(
            'select email, dispatch_state, email_eligible, state from public.match_player_add_operations where id = ' +
              L(lateOperation)
          )
        ).toEqual([
          {
            email: 'redacted',
            dispatch_state: 'suppressed',
            email_eligible: false,
            state: 'awaiting_identity'
          }
        ]);
        const settled = await trustedClient().rpc('settle_match_player_add', {
          p_actor_id: actor,
          p_match_event_id: eventId,
          p_request_id: lateRequest,
          p_delivered: true,
          p_attempt: attempt
        });
        expect(asRecord(settled.data)['completed']).toBe(false);
        // The same address is a legitimate NEW person: no linkage to anything erased.
        const fresh = await createClient(environment.env!.url, environment.env!.key, {
          auth: { persistSession: false }
        }).auth.signUp({ email, password: 'Password123!' });
        expect(fresh.error).toBeNull();
        const freshId = String(fresh.data.user?.id);
        expect(freshId).not.toBe(subject);
        expect(
          await scalar(
            'select count(*)::int from public.match_player_add_operations where target_user_id = ' +
              L(freshId)
          )
        ).toBe(0);
        expect(await tablesMentioning(subject)).toEqual([]);

        // The response of a case with outstanding external work needs the acknowledgment.
        expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
          external_followup: true
        });
        const refused = await operator('record-response', reference);
        expect(refused).toMatchObject({
          status: 'rejected',
          code: 'EXTERNAL_FOLLOWUP_ACK_REQUIRED'
        });
        expect((await caseRow(reference))['final_response_at']).toBeNull();
        const acknowledged = await operator(
          'record-response',
          reference,
          '--ack-external-followup'
        );
        expect(acknowledged['status']).toBe('ok');
        expect(asRecord((await caseRow(reference))['phase_manifest'])).toMatchObject({
          external_followup_ack: true
        });
      } finally {
        await fixtureSql(
          'delete from public.match_player_add_operations where id = any (' +
            L('{' + lateOperation + ',' + targetOperation + '}') +
            '::uuid[])'
        );
      }
    });

    it('F24: producer admission and the freeze UPDATE serialize on the pause row', async () => {
      const subject = player(2).id;
      const reference = await requested(2);
      const caseId = String((await caseRow(reference))['id']);
      // The pause row exists from the case opening, inactive.
      expect(
        await sqlRows(
          'select active, subject_id::text as subject from privacy_internal.case_producer_pause where case_id = ' +
            L(caseId)
        )
      ).toEqual([{ active: false, subject }]);
      const admit = (key: string) =>
        'select public.persist_notification(' +
        L(subject) +
        ', ' +
        L(key + ':' + crypto.randomUUID()) +
        ", 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
        L(kit.communityId) +
        ')::text as id';
      const freeze =
        'update privacy_internal.case_producer_pause set active = true where case_id = ' +
        L(caseId);

      const producer = await openDedicatedSqlConnection();
      const freezer = await openDedicatedSqlConnection();
      try {
        // 1. A producer admitted BEFORE the freeze holds the share lock: the freeze waits for it, the producer
        //    proceeds legitimately (not paused yet), and only then does the freeze commit.
        await producer.query('begin');
        const admitted = await producer.query(admit('f24-pre'));
        expect(admitted.rows[0]?.['id']).toEqual(expect.any(String));
        await freezer.query('begin');
        const freezing = freezer.query(freeze);
        expect(await settles(freezing, 600)).toBe(false);
        await producer.query('commit');
        await freezing;
        await freezer.query('commit');
        // 2. After the freeze commit a new admission sees the pause and refuses.
        expect(await notify(subject, 'f24-post')).toBeNull();
        await fixtureSql(
          'update privacy_internal.case_producer_pause set active = false where case_id = ' +
            L(caseId)
        );

        // 3. The other order: a freeze in flight makes an arriving producer wait, then refuse (no MVCC window).
        await freezer.query('begin');
        await freezer.query(freeze);
        await producer.query('begin');
        const arriving = producer.query(admit('f24-race'));
        expect(await settles(arriving, 600)).toBe(false);
        await freezer.query('commit');
        expect((await arriving).rows[0]?.['id']).toBeNull();
        await producer.query('commit');
      } finally {
        await producer.query('rollback').catch(() => undefined);
        await freezer.query('rollback').catch(() => undefined);
        await producer.close();
        await freezer.close();
        await fixtureSql(
          'update privacy_internal.case_producer_pause set active = false where case_id = ' +
            L(caseId)
        );
      }
      await operator('refuse', reference);
    });

    it('F25: the freeze refuses an address that changed after the claim (before any ban), and verification restarts', async () => {
      const subject = player(3).id;
      const reference = await requested(3);
      await verifyCase(reference, await emailOf(subject));
      await armCase(reference);
      // Claim consumed the arm; the run stops right before the freeze.
      await expect(
        sweep({
          hooks: {
            beforeStep: (step) => {
              if (step === 'freeze') throw crash;
            }
          }
        })
      ).rejects.toBe(crash);
      expect(await caseRow(reference)).toMatchObject({ state: 'executing', last_phase: null });
      const moved = 'moved-' + crypto.randomUUID() + '@changed.test';
      await fixtureSql('update auth.users set email = ' + L(moved) + ' where id = ' + L(subject));
      await expireLease(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({
        state: 'blocked',
        blocker_code: 'VERIFICATION_STALE',
        next_action: 'operator_review',
        last_phase: null,
        armed_consumed_at: null,
        destructive_started_at: null
      });
      // Nothing destructive happened: no ban, no freeze, no pause.
      const user = await trustedClient().auth.admin.getUserById(subject);
      expect(user.data.user?.banned_until ?? null).toBeNull();
      expect(
        await scalar(
          'select count(*)::int from privacy_internal.frozen_subjects where subject_id = ' +
            L(subject)
        )
      ).toBe(0);
      expect(
        await scalar(
          'select active from privacy_internal.case_producer_pause where subject_id = ' + L(subject)
        )
      ).toBe(false);
      // Restart, re-verify against the new address, arm: the case completes.
      const restarted = await operator('start-verification', reference);
      expect(restarted['address']).toBe(moved);
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
  }
);
