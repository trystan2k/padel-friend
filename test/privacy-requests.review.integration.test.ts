import { beforeAll, describe, expect, it } from 'vitest';
import { countWithdrawn, scalar, tablesMentioning } from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  expireLease,
  faultyAdmin,
  operator,
  setQuiescence,
  storageNames,
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

/**
 * Review round 2: F5 (challenge bound to the issued address), F6 (arm expiry and fresh proof at claim),
 * F7 (a failing finish quarantines the case), F9 (freeze fences producers and waits for in-flight work).
 * Subjects: 1 = F5, 2 = F6, 3 = F7, 4 = F9 storage/quiescence, 5 = F9 producers (frozen only).
 */
describe.skipIf(!environment.env)('Privacy review fixes', { timeout: 600_000 }, () => {
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

  beforeAll(async () => {
    await setQuiescence(0);
    kit = await createRankedResultFixtures(environment.env!);
    await kit.event();
  });

  it('F5: a code issued to one mailbox never verifies another address', async () => {
    const subject = player(1).id;
    const original = await emailOf(subject);
    const reference = await requested(1);
    const started = await operator('start-verification', reference);
    expect(started['address']).toBe(original.toLowerCase());
    await fixtureSql(
      'update auth.users set email = ' +
        L('moved-' + crypto.randomUUID() + '@changed.test') +
        ' where id = ' +
        L(subject)
    );
    const stale = await operator(
      'confirm-proof',
      reference,
      '--code',
      String(started['code']),
      '--confirm'
    );
    expect(stale).toEqual({ status: 'rejected', code: 'VERIFICATION_STALE' });
    expect(await caseRow(reference)).toMatchObject({ state: 'received' });
    // The cancelled proof cannot be replayed; verification restarts against the new address.
    expect(
      (await operator('confirm-proof', reference, '--code', String(started['code']), '--confirm'))[
        'code'
      ]
    ).toBe('NO_OPEN_CHALLENGE');
    const fresh = await operator('start-verification', reference);
    expect(fresh['address']).not.toBe(original.toLowerCase());
    expect(
      (await operator('confirm-proof', reference, '--code', String(fresh['code']), '--confirm'))[
        'status'
      ]
    ).toBe('ok');
    await operator('refuse', reference);
  });

  it('F6: an armed approval expires, and the claim re-checks the verified address before executing', async () => {
    const subject = player(2).id;
    const email = await emailOf(subject);
    const reference = await requested(2);
    await verifyCase(reference, email);
    await armCase(reference);
    expect(Date.parse(String((await caseRow(reference))['arm_expires_at']))).toBeGreaterThan(
      Date.now()
    );

    // Expired: refused at the claim, not consumed, no phase ran.
    await fixtureSql(
      "update privacy_internal.privacy_cases set arm_expires_at = now() - interval '1 second' where reference = " +
        L(reference)
    );
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      blocker_code: 'ARM_EXPIRED',
      next_action: 'operator_rearm',
      armed_consumed_at: null,
      last_phase: null
    });
    expect(
      await scalar(
        'select count(*)::int from privacy_internal.frozen_subjects where subject_id = ' +
          L(subject)
      )
    ).toBe(0);

    // Re-armed, then the address changes before the claim: refused again, verification must restart.
    await armCase(reference);
    expect((await caseRow(reference))['state']).toBe('ready');
    const moved = 'moved-' + crypto.randomUUID() + '@changed.test';
    await fixtureSql('update auth.users set email = ' + L(moved) + ' where id = ' + L(subject));
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      blocker_code: 'VERIFICATION_STALE',
      armed_consumed_at: null,
      last_phase: null
    });
    expect(
      await scalar(
        'select count(*)::int from privacy_internal.frozen_subjects where subject_id = ' +
          L(subject)
      )
    ).toBe(0);

    // A fresh verification of the new address and a fresh arm execute normally.
    const restarted = await operator('start-verification', reference);
    expect(restarted['address']).toBe(moved);
    expect(
      (
        await operator('confirm-proof', reference, '--code', String(restarted['code']), '--confirm')
      )['status']
    ).toBe('ok');
    await armCase(reference);
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
  });

  it('F7: a failing finish is quarantined (not reclaimed forever) and the operator retry completes it', async () => {
    const subject = player(3).id;
    const email = await emailOf(subject);
    const reference = await requested(3);
    await verifyCase(reference, email);
    await armCase(reference);
    const withdrawnBefore = await countWithdrawn();
    const outage = faultyAdmin({ finishFails: 99 });
    expect(await sweep({ client: outage })).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'supabase_erased',
      last_phase: 'auth',
      attempt_count: 1
    });
    let guard = 0;
    while ((await caseRow(reference))['state'] !== 'blocked' && guard++ < 10) {
      await fixtureSql(
        "update privacy_internal.privacy_cases set next_attempt_at = now() - interval '1 second' where reference = " +
          L(reference)
      );
      await sweep({ client: outage });
    }
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      resume_state: 'supabase_erased',
      last_phase: 'auth',
      blocker_code: 'RETRIES_EXHAUSTED',
      next_action: 'operator_retry'
    });
    // Quarantined: no worker reclaims it.
    expect(await sweep({ client: outage })).toEqual({ disabled: false, processed: 0 });
    expect((await operator('retry', reference))['state']).toBe('supabase_erased');
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'closed',
      outcome: 'erased',
      subject_id: null
    });
    // Resuming the finish repeated no destructive side effect: still exactly one tombstone for this subject.
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);
    expect(await tablesMentioning(subject)).toEqual([]);
    expect((await trustedClient().auth.admin.getUserById(subject)).error?.status).toBe(404);
  });

  it('F9: the destructive phase waits for a write that started before the freeze became visible', async () => {
    const subject = player(4).id;
    const email = await emailOf(subject);
    const reference = await requested(4);
    await verifyCase(reference, email);
    await armCase(reference);

    // An upload transaction opened BEFORE the freeze (it passed every live check) and is still running.
    const writer = await openDedicatedSqlConnection();
    const objectName = subject + '/' + crypto.randomUUID() + '.png';
    try {
      await writer.query('begin');
      await writer.query(
        "insert into storage.objects(bucket_id, name, owner_id, metadata) values ('player-avatars', " +
          L(objectName) +
          ', ' +
          L(subject) +
          ', \'{"size":"12","mimetype":"image/png"}\'::jsonb)'
      );
      await expect(
        sweep({
          hooks: {
            afterStep: (step) => {
              if (step === 'freeze') throw crash;
            }
          }
        })
      ).rejects.toBe(crash);
      expect(await caseRow(reference)).toMatchObject({ state: 'executing', last_phase: 'freeze' });
      // The erasure does not run past the in-flight writer: the case waits without recording a failure.
      await expireLease(reference);
      expect(await sweep()).toEqual({ disabled: false, processed: 1 });
      expect(await caseRow(reference)).toMatchObject({
        state: 'executing',
        last_phase: 'freeze',
        attempt_count: 0
      });
      expect(
        await scalar(
          'select count(*)::int from public.player_profiles where user_id = ' + L(subject)
        )
      ).toBe(1);
      await writer.query('commit');
    } finally {
      await writer.close();
    }
    // The writer finished: the next attempt erases, and the late object is found and removed (no orphan).
    await fixtureSql(
      'update privacy_internal.privacy_cases set next_attempt_at = null, lease_expires_at = null where reference = ' +
        L(reference)
    );
    expect(await storageNames(subject)).toEqual(['player-avatars/' + objectName]);
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
    expect(await storageNames(subject)).toEqual([]);
    expect(await tablesMentioning(subject)).toEqual([]);
  });

  it('F9: player-add redrive and dispatch refuse a frozen actor', async () => {
    const actor = player(7).id;
    const eventId = String(
      await scalar('select id::text from public.match_events order by created_at desc limit 1')
    );
    const operation = crypto.randomUUID();
    const request = crypto.randomUUID();
    const email = 'f9-' + crypto.randomUUID() + '@invitee.test';
    await fixtureSql(
      'insert into public.match_player_add_operations(id, match_event_id, actor_id, request_id, fingerprint, email, display_name, estimated_level, locale, state, dispatch_state, email_eligible, retry_after) values (' +
        [
          L(operation),
          L(eventId),
          L(actor),
          L(request),
          L('fp-' + operation),
          L(email),
          L('Frozen Actor Invitee'),
          '3.5',
          L('en'),
          "'awaiting_identity'",
          "'failed'",
          'true',
          "now() - interval '1 minute'"
        ].join(', ') +
        ');' +
        'insert into privacy_internal.frozen_subjects(subject_id, case_id) values (' +
        L(actor) +
        ', gen_random_uuid());'
    );
    try {
      const claimed = await trustedClient().rpc('claim_match_player_add_redrives', {
        p_limit: 100
      });
      expect(JSON.stringify(claimed.data ?? [])).not.toContain(request);
      expect(
        await scalar(
          'select dispatch_attempts::int from public.match_player_add_operations where id = ' +
            L(operation)
        )
      ).toBe(0);
      const dispatched = await trustedClient().rpc('dispatch_match_player_add', {
        p_actor_id: actor,
        p_match_event_id: eventId,
        p_request_id: request
      });
      expect(dispatched.data).toEqual({ action: 'none' });
    } finally {
      await fixtureSql(
        'delete from privacy_internal.frozen_subjects where subject_id = ' +
          L(actor) +
          ';' +
          'delete from public.match_player_add_operations where id = ' +
          L(operation) +
          ';'
      );
    }
  });

  it('F9: a settle time also holds the destructive phase back, and a live push lease delays it', async () => {
    const subject = player(5).id;
    const email = await emailOf(subject);
    const reference = await requested(5);
    await verifyCase(reference, email);
    // Queued push work exists before the arm (the plan counts it); it must stop at the freeze.
    await fixtureSql(
      'insert into public.notifications(recipient_user_id, event_key, kind, category, target_type, target_id, community_id) values (' +
        L(subject) +
        ", 'f9-push:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
        L(kit.communityId) +
        ')'
    );
    await armCase(reference);
    await setQuiescence(3600);
    await expect(
      sweep({
        hooks: {
          afterStep: (step) => {
            if (step === 'freeze') throw crash;
          }
        }
      })
    ).rejects.toBe(crash);
    await expireLease(reference);
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'executing', last_phase: 'freeze' });
    expect(Date.parse(String((await caseRow(reference))['next_attempt_at']))).toBeGreaterThan(
      Date.now()
    );
    await setQuiescence(0);

    // Producers refuse the frozen subject: no push claim, no notification, no player-add redrive or dispatch.
    const notification = String(
      await scalar(
        'select public.persist_notification(' +
          L(player(6).id) +
          ", 'f9-probe:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ')'
      )
    );
    expect(notification).not.toBe('');
    expect(
      await scalar(
        'select public.persist_notification(' +
          L(subject) +
          ", 'f9-frozen:' || gen_random_uuid(), 'match_event_cancelled', 'matches', 'match_event', gen_random_uuid(), " +
          L(kit.communityId) +
          ')'
      )
    ).toBeNull();
    // A pending push job of the frozen subject (queued before the arm) is never claimed.
    const jobs = await trustedClient().rpc('claim_notification_push_jobs', { p_limit: 25 });
    const claimedFor = (
      await sqlRows(
        'select distinct n.recipient_user_id::text as r from public.notifications n where n.id = any (' +
          L(
            '{' +
              (Array.isArray(jobs.data)
                ? jobs.data.map((j) => String(asRecord(j)['notification_id'])).join(',')
                : '') +
              '}'
          ) +
          '::uuid[])'
      )
    ).map((row) => row['r']);
    expect(claimedFor).not.toContain(subject);
    // Settled: the case completes and its subject's pending push work disappears with the account.
    await fixtureSql(
      'update privacy_internal.privacy_cases set next_attempt_at = null, lease_expires_at = null where reference = ' +
        L(reference)
    );
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
  });
});
