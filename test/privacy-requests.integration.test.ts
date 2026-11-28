import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import { challengeDigest } from '../scripts/privacy-operator.mjs';
import {
  confirmGroup,
  countWithdrawn,
  erasurePlan,
  scalar,
  survivorSnapshot,
  tablesMentioning
} from './helpers/account-erasure-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  armCase,
  caseRow,
  expireLease,
  faultyAdmin,
  objectExists,
  operator,
  privacyTablesMentioning,
  storageNames,
  setQuiescence,
  sweep,
  uploadObject,
  verifyCase
} from './helpers/privacy-request-fixtures';
import {
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { trustedClient } from './helpers/trusted-client';

const environment = localSupabaseEnv();
const L = sqlText;
const REFERENCE = /^PR-[0-9A-F]{12}$/;
const crash = new Error('CRASH');

/**
 * PAF-232: verified case lifecycle and resumable deletion over the real test-stack Auth, Storage and
 * database. Subjects: 3 full lifecycle, 5 crash at every boundary, 7 drift + provider outage + race,
 * 4 environment/kill switch, 6 withdrawal/rate limit. Players 0, 1 and 2 only ever act as bystanders.
 */
describe.skipIf(!environment.env)('Privacy request lifecycle', { timeout: 900_000 }, () => {
  let kit: RankedResultKit;
  let eventId: string;
  let leagueId: string;
  const player = (index: number) => kit.players[index]!;
  const emailOf = async (id: string) =>
    String(await scalar('select email from auth.users where id = ' + L(id)));
  const request = (index: number, command: string = crypto.randomUUID()) =>
    player(index).client.rpc('request_account_deletion', { p_command_id: command });
  const requested = async (index: number) => {
    const result = await request(index);
    expect(result.error).toBeNull();
    return String(asRecord(result.data)['reference']);
  };
  const withdraw = (index: number, command: string = crypto.randomUUID()) =>
    player(index).client.rpc('withdraw_my_deletion_request', { p_command_id: command });
  const avatarKey = (id: string) => id + '/' + crypto.randomUUID() + '.png';

  /** Uploads one object of every kind a subject can own, plus bystander photos that must survive. */
  async function seedStorage(subject: string, bystander: string) {
    const community = kit.communityId;
    const venue = crypto.randomUUID();
    await trustedClient()
      .from('community_venues')
      .insert({ id: venue, community_id: community, name: 'Probe venue', created_by: subject });
    const own = {
      ownerless: avatarKey(subject),
      venue: community + '/' + venue + '/' + subject + '/' + crypto.randomUUID() + '.webp',
      match: community + '/' + eventId + '/' + subject + '/' + crypto.randomUUID() + '.webp'
    };
    const others = {
      venue: community + '/' + venue + '/' + bystander + '/' + crypto.randomUUID() + '.webp',
      match: community + '/' + eventId + '/' + bystander + '/' + crypto.randomUUID() + '.webp'
    };
    await uploadObject('player-avatars', own.ownerless, 'image/png');
    await uploadObject('community-venue-photos', own.venue, 'image/webp');
    await uploadObject('match-event-photos', own.match, 'image/webp');
    await uploadObject('community-venue-photos', others.venue, 'image/webp');
    await uploadObject('match-event-photos', others.match, 'image/webp');
    await fixtureSql(
      'update public.player_profiles set avatar_url = ' +
        L(own.ownerless) +
        ' where user_id = ' +
        L(subject) +
        ';'
    );
    return { own, others };
  }

  beforeAll(async () => {
    await setQuiescence(0);
    kit = await createRankedResultFixtures(environment.env!);
    leagueId = await kit.league();
    eventId = await kit.event(leagueId);
    await confirmGroup(kit, eventId, 1);
    await confirmGroup(kit, eventId, 2);
  });

  it('is self-only and role-bound: only the service-role operator path can execute anything destructive', async () => {
    const anonymous = createClient(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false }
    });
    expect(
      (await anonymous.rpc('request_account_deletion', { p_command_id: crypto.randomUUID() })).error
    ).not.toBeNull();

    const first = await request(1);
    expect(first.error).toBeNull();
    const receipt = asRecord(first.data);
    expect(receipt['reference']).toMatch(REFERENCE);
    expect(receipt).toMatchObject({ state: 'received', replayed: false, can_withdraw: true });
    expect(Object.keys(receipt).sort()).toEqual([
      'can_withdraw',
      'command_id',
      'received_at',
      'reference',
      'replayed',
      'state'
    ]);
    // The same command, or a new one while a case is open, returns the original receipt.
    const replay = await request(1, String(receipt['command_id']));
    expect(asRecord(replay.data)).toMatchObject({
      reference: receipt['reference'],
      replayed: true
    });
    const again = await request(1);
    expect(asRecord(again.data)).toMatchObject({ reference: receipt['reference'], replayed: true });
    // Another user sees no trace of it and gets an independent case.
    expect(asRecord((await player(2).client.rpc('get_my_deletion_request')).data ?? {})).toEqual(
      {}
    );
    const other = await requested(2);
    expect(other).not.toBe(receipt['reference']);
    expect(
      asRecord((await player(1).client.rpc('get_my_deletion_request')).data)['reference']
    ).toBe(receipt['reference']);

    // Provisional and not-yet-onboarded identities cannot self-serve.
    const provisional = await signUpFixtureActor(environment.env!, 'privacy-provisional');
    await provisionProvisionalPlayer({
      userId: provisional.id,
      displayName: 'Provisional Probe',
      estimatedLevel: 4,
      invitedBy: player(0).id,
      sourceEventId: eventId
    });
    expect(
      (
        await provisional.client.rpc('request_account_deletion', {
          p_command_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    const bare = await signUpFixtureActor(environment.env!, 'privacy-noprofile');
    expect(
      (await bare.client.rpc('request_account_deletion', { p_command_id: crypto.randomUUID() }))
        .error?.message
    ).toBe('PRIVACY_REQUEST_ACCOUNT_REQUIRED');

    // Role matrix on the privileged wrappers: anon, member, community admin and platform reviewer are denied.
    await fixtureSql(
      'insert into public.platform_admins(user_id, granted_by) values (' +
        L(player(2).id) +
        ', ' +
        L(player(0).id) +
        ')'
    );
    const bogus = { p_case: crypto.randomUUID(), p_fence: 1, p_token: crypto.randomUUID() };
    const clients = [anonymous, player(1).client, player(0).client, player(2).client];
    for (const client of clients) {
      expect((await client.rpc('privacy_proc_erase_relational', bogus)).error?.code).toBe('42501');
      expect(
        (await client.rpc('privacy_proc_claim', { p_lease_seconds: 60, p_project_ref: 'local' }))
          .error?.code
      ).toBe('42501');
      expect((await client.rpc('privacy_op_list_cases')).error?.code).toBe('42501');
      expect(
        (await client.rpc('privacy_op_set_switch', { p_key: 'executor_enabled', p_value: false }))
          .error?.code
      ).toBe('42501');
    }
    await fixtureSql('delete from public.platform_admins where user_id = ' + L(player(2).id));
    // The service role reaches the wrapper (a bogus lease is the only rejection) but is not an actor.
    expect((await trustedClient().rpc('privacy_proc_erase_relational', bogus)).error?.message).toBe(
      'PRIVACY_LEASE_LOST'
    );
    expect(
      (await trustedClient().rpc('request_account_deletion', { p_command_id: crypto.randomUUID() }))
        .error?.code
    ).toBe('42501');
    const tablePrivileges = await sqlRows(
      "select has_table_privilege('authenticated', 'privacy_internal.privacy_cases', 'SELECT') as a, has_table_privilege('service_role', 'privacy_internal.privacy_cases', 'UPDATE') as s, has_table_privilege('anon', 'privacy_internal.frozen_subjects', 'INSERT') as f"
    );
    expect(tablePrivileges[0]).toEqual({ a: false, s: false, f: false });
    await operator('refuse', String(receipt['reference']));
    await operator('refuse', other);
  });

  it('caps fresh reopen attempts and withdraws until the executor claims', async () => {
    const references: string[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      references.push(await requested(6));
      const command = crypto.randomUUID();
      const done = await withdraw(6, command);
      expect(asRecord(done.data)).toMatchObject({ state: 'withdrawn', can_withdraw: false });
      expect(asRecord((await withdraw(6, command)).data)['state']).toBe('withdrawn');
    }
    expect(new Set(references).size).toBe(3);
    expect((await request(6)).error?.message).toBe('PRIVACY_REQUEST_RATE_LIMITED');
    expect((await withdraw(6)).error?.message).toBe('PRIVACY_REQUEST_NOT_FOUND');
    const status = asRecord((await player(6).client.rpc('get_my_deletion_request')).data);
    expect(status).toMatchObject({ state: 'withdrawn', blocked: false, can_withdraw: false });
    expect((await caseRow(references[0]!))['outcome']).toBe('withdrawn');
  });

  it('verifies the address on file with an expiring, single-use, attempt-capped challenge', async () => {
    const subject = player(4).id;
    const reference = await requested(4);
    const email = await emailOf(subject);
    // Nothing is plannable or armable before verification.
    expect((await operator('dry-run', reference))['code']).toBe('STATE_NOT_PLANNABLE');
    const blankPlan = JSON.stringify({ revision: 1, fingerprint: 'x', impact: {}, successors: {} });
    expect((await operator('arm', reference, '--plan', blankPlan))['code']).toBe(
      'STATE_NOT_ARMABLE'
    );

    // A code issued for another case never verifies this one.
    const otherReference = await requested(1);
    const foreign = await operator('start-verification', otherReference);
    const started = await operator('start-verification', reference);
    expect(started['address']).toBe(email.toLowerCase());
    expect(
      (await operator('confirm-proof', reference, '--code', String(foreign['code']), '--confirm'))[
        'code'
      ]
    ).toBe('CHALLENGE_INVALID');
    expect(challengeDigest(reference, String(started['code']))).not.toBe(
      challengeDigest(otherReference, String(started['code']))
    );
    // No stored copy of the code: only a digest and expiry exist.
    expect(await privacyTablesMentioning(String(started['code']))).toEqual([]);
    // Attempts are capped even when the right code follows.
    for (let attempt = 0; attempt < 3; attempt++)
      expect(
        (await operator('confirm-proof', reference, '--code', 'WRONGCODE' + attempt, '--confirm'))[
          'code'
        ]
      ).toBe('CHALLENGE_INVALID');
    expect(
      (await operator('confirm-proof', reference, '--code', String(started['code']), '--confirm'))[
        'status'
      ]
    ).toBe('ok');
    expect(
      (await operator('confirm-proof', reference, '--code', String(started['code']), '--confirm'))[
        'code'
      ]
    ).toBe('CHALLENGE_CONSUMED');

    // Restarting verification invalidates it; an expired challenge is refused; confirmation is explicit.
    const restarted = await operator('start-verification', reference);
    expect((await caseRow(reference))['state']).toBe('received');
    await fixtureSql(
      "update privacy_internal.privacy_cases set challenge_expires_at = now() - interval '1 second' where reference = " +
        L(reference)
    );
    expect(
      (
        await operator('confirm-proof', reference, '--code', String(restarted['code']), '--confirm')
      )['code']
    ).toBe('CHALLENGE_EXPIRED');
    const third = await operator('start-verification', reference);
    expect(
      (await operator('confirm-proof', reference, '--code', String(third['code'])))['code']
    ).toBe('OPERATOR_CONFIRMATION_REQUIRED');
    for (let attempt = 0; attempt < 5; attempt++)
      await operator('confirm-proof', reference, '--code', 'WRONGCODE' + attempt, '--confirm');
    expect(
      (await operator('confirm-proof', reference, '--code', String(third['code']), '--confirm'))[
        'code'
      ]
    ).toBe('CHALLENGE_ATTEMPTS_EXCEEDED');
    await verifyCase(reference, email);
    expect((await caseRow(reference))['state']).toBe('verified');

    // The dry run is exactly the unit B plan; a tampered plan cannot arm.
    const dry = await operator('dry-run', reference);
    const { blockers, ...plan } = asRecord(dry['plan']);
    expect(blockers).toEqual([]);
    const direct = await erasurePlan(subject);
    expect(plan).toEqual({
      revision: direct.revision,
      fingerprint: direct.fingerprint,
      impact: direct.impact,
      successors: direct.successors
    });
    const tampered = { ...plan, impact: { ...asRecord(plan['impact']), anchor_rekey: 9999 } };
    expect((await operator('arm', reference, '--plan', JSON.stringify(tampered)))['code']).toBe(
      'PLAN_MISMATCH'
    );

    // A plan armed for another project is blocked at the claim, before anything irreversible happens.
    const wrong = await trustedClient().rpc('privacy_op_arm', {
      p_reference: reference,
      p_expected: plan,
      p_project_ref: 'elsewhere',
      p_environment: 'local'
    });
    expect(asRecord(wrong.data)['status']).toBe('ok');
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      blocker_code: 'ENVIRONMENT_MISMATCH',
      next_action: 'operator_rearm',
      armed_consumed_at: null
    });
    await armCase(reference);
    expect((await caseRow(reference))['state']).toBe('ready');

    // Kill switches: intake and the executor both stop; existing receipts still replay.
    expect((await operator('switch', 'executor', 'off'))['enabled']).toBe(false);
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
    expect((await caseRow(reference))['state']).toBe('ready');
    expect((await operator('arm', reference, '--plan', JSON.stringify(plan)))['code']).toBe(
      'EXECUTOR_DISABLED'
    );
    await operator('switch', 'executor', 'on');
    await operator('switch', 'intake', 'off');
    expect((await request(5)).error?.message).toBe('PRIVACY_REQUESTS_DISABLED');
    await operator('switch', 'intake', 'on');
    await operator('refuse', reference);
    await operator('refuse', otherReference);
    expect((await caseRow(reference))['outcome']).toBe('refused');
  });

  it('erases a verified account end to end: freeze, relational, storage, Auth, closed', async () => {
    const subject = player(3).id;
    const email = await emailOf(subject);
    const { own, others } = await seedStorage(subject, player(1).id);
    const ownedAvatar = avatarKey(subject);
    expect(
      (
        await player(3)
          .client.storage.from('player-avatars')
          .upload(ownedAvatar, new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 9]), {
            contentType: 'image/png'
          })
      ).error
    ).toBeNull();
    const survivors = [0, 1, 2].map((index) => player(index).id);
    const survivorsBefore = await survivorSnapshot(survivors, kit.communityId, [eventId]);
    const withdrawnBefore = await countWithdrawn();
    const reference = await requested(3);
    await verifyCase(reference, email);
    await armCase(reference);
    expect((await player(3).client.from('communities').select('id')).data?.length).toBeGreaterThan(
      0
    );
    expect((await player(3).client.rpc('is_actor_live')).data).toBe(true);

    // Crash right after the freeze commits: the stale access token is rejected at every boundary.
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
    expect((await player(3).client.from('communities').select('id')).data).toEqual([]);
    // The protected boundary resolves a frozen subject as signed out; bystanders stay live.
    expect((await player(3).client.rpc('is_actor_live')).data).toBe(false);
    expect((await player(1).client.rpc('is_actor_live')).data).toBe(true);
    expect(
      (await player(3).client.rpc('get_league', { p_league_id: leagueId })).error?.message
    ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    expect(
      (
        await player(3)
          .client.storage.from('player-avatars')
          .upload(avatarKey(subject), new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 7]), {
            contentType: 'image/png'
          })
      ).error
    ).not.toBeNull();
    expect((await player(1).client.from('communities').select('id')).data?.length).toBeGreaterThan(
      0
    );
    // The arm was consumed by the claim: withdrawal is no longer possible.
    // A frozen subject is restricted at every boundary, including this one.
    expect((await withdraw(3)).error?.message).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    expect((await operator('refuse', reference))['code']).toBe('STATE_NOT_REFUSABLE');

    await expireLease(reference);
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    const closed = await caseRow(reference);
    expect(closed).toMatchObject({
      state: 'closed',
      outcome: 'erased',
      subject_id: null,
      armed_plan: null
    });
    const manifest = asRecord(closed['phase_manifest']);
    expect(Object.keys(manifest).sort()).toEqual(['auth', 'freeze', 'relational', 'storage']);
    expect(asRecord(manifest['freeze'])['others_photos_for_review']).toBe(1);

    // Relational: no residue, no mapping, other players' facts unchanged, exactly one tombstone.
    expect(await tablesMentioning(subject)).toEqual([]);
    expect(await privacyTablesMentioning(subject)).toEqual([]);
    expect(await privacyTablesMentioning(email)).toEqual([]);
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);
    expect(await survivorSnapshot(survivors, kit.communityId, [eventId])).toEqual(survivorsBefore);
    // Storage: every object of the subject is gone (including the ownerless avatar); bystanders' stay.
    expect(await storageNames(subject)).toEqual([]);
    for (const key of [own.ownerless, ownedAvatar])
      expect(await objectExists('player-avatars', key)).toBe(false);
    expect(await objectExists('community-venue-photos', own.venue)).toBe(false);
    expect(await objectExists('match-event-photos', own.match)).toBe(false);
    expect(await objectExists('community-venue-photos', others.venue)).toBe(true);
    expect(await objectExists('match-event-photos', others.match)).toBe(true);
    // Auth: the user is gone and the old token is rejected.
    expect((await trustedClient().auth.admin.getUserById(subject)).error?.status).toBe(404);
    expect((await player(3).client.auth.getUser()).error).not.toBeNull();
    // Erased: the signature-valid old token still resolves as signed out (no live identity).
    expect((await player(3).client.rpc('is_actor_live')).data).toBe(false);
    expect((await player(3).client.from('player_profiles').select('user_id')).data).toEqual([]);

    // The final response starts the 90-day purge down to outcome counts.
    const responded = await operator('record-response', reference);
    const days = (Date.parse(String(responded['purge_after'])) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
    await fixtureSql(
      "update privacy_internal.privacy_cases set purge_after = now() - interval '1 second' where reference = " +
        L(reference)
    );
    expect(Number(asRecord(await operator('purge'))['purged'])).toBeGreaterThanOrEqual(1);
    expect(
      await scalar(
        'select count(*)::int from privacy_internal.privacy_cases where reference = ' + L(reference)
      )
    ).toBe(0);
    expect(
      Number(
        await scalar(
          "select coalesce(sum(cases), 0)::int from privacy_internal.privacy_case_outcomes where outcome = 'erased'"
        )
      )
    ).toBeGreaterThanOrEqual(1);
  });

  it('resumes a crash at every committed boundary exactly once, under a kill switch and a single tombstone', async () => {
    const subject = player(5).id;
    const email = await emailOf(subject);
    await seedStorage(subject, player(1).id);
    const withdrawnBefore = await countWithdrawn();
    const reference = await requested(5);
    await verifyCase(reference, email);
    await armCase(reference);

    // Crash before the very first phase: nothing was done, the case is claimed and recoverable.
    await expect(
      sweep({
        hooks: {
          beforeStep: () => {
            throw crash;
          }
        }
      })
    ).rejects.toBe(crash);
    expect(await caseRow(reference)).toMatchObject({ state: 'executing', last_phase: null });
    // Claimed but not yet frozen: the arm is consumed, so withdrawal is already refused.
    expect((await withdraw(5)).error?.message).toBe('PRIVACY_REQUEST_NOT_WITHDRAWABLE');
    expect(
      await scalar(
        'select count(*)::int from privacy_internal.frozen_subjects where subject_id = ' +
          L(subject)
      )
    ).toBe(0);
    // A second worker cannot take it while the lease holds.
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });

    const executed: string[] = [];
    const committed: unknown[] = [];
    for (const step of ['freeze', 'relational', 'storage', 'auth', 'finish']) {
      await expireLease(reference);
      await expect(
        sweep({
          hooks: {
            afterStep: (done) => {
              executed.push(done);
              if (done === step) throw crash;
            }
          }
        })
      ).rejects.toBe(crash);
      committed.push((await caseRow(reference))['last_phase']);
    }
    expect(executed).toEqual(['freeze', 'relational', 'storage', 'auth', 'finish']);
    expect(committed).toEqual(['freeze', 'relational', 'storage', 'auth', 'auth']);
    expect(await caseRow(reference)).toMatchObject({
      state: 'closed',
      outcome: 'erased',
      subject_id: null
    });
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);
    expect(await tablesMentioning(subject)).toEqual([]);
    expect(await storageNames(subject)).toEqual([]);
    expect((await trustedClient().auth.admin.getUserById(subject)).error?.status).toBe(404);
    expect(await sweep()).toEqual({ disabled: false, processed: 0 });
  });

  it('blocks on drift, retries provider outages with backoff, fences a stale worker and never double-runs', async () => {
    const subject = player(7).id;
    const email = await emailOf(subject);
    await seedStorage(subject, player(1).id);
    const withdrawnBefore = await countWithdrawn();
    const reference = await requested(7);
    await verifyCase(reference, email);
    // A platform grant is a surfaced blocker the operator removes first.
    await fixtureSql(
      'insert into public.platform_admins(user_id, granted_by) values (' +
        L(subject) +
        ', ' +
        L(player(0).id) +
        ')'
    );
    const refused = await operator('dry-run', reference);
    expect(asRecord(refused['plan'])['blockers']).toContain('platform_admin_grant');
    const { blockers: _blockers, ...blockedPlan } = asRecord(refused['plan']);
    expect((await operator('arm', reference, '--plan', JSON.stringify(blockedPlan)))['code']).toBe(
      'PLAN_BLOCKED'
    );
    await fixtureSql('delete from public.platform_admins where user_id = ' + L(subject));
    await armCase(reference);

    // Overlap: two workers race for the same case; exactly one claims, and the older fence is rejected.
    const claims = await Promise.all(
      [0, 1].map(() =>
        trustedClient().rpc('privacy_proc_claim', { p_lease_seconds: 60, p_project_ref: 'local' })
      )
    );
    const claimed = claims
      .map((claim) => asRecord(claim.data ?? {}))
      .filter((row) => row['status'] === 'claimed');
    expect(claimed).toHaveLength(1);
    await expireLease(reference);
    const second = asRecord(
      (
        await trustedClient().rpc('privacy_proc_claim', {
          p_lease_seconds: 60,
          p_project_ref: 'local'
        })
      ).data
    );
    expect(Number(second['fence'])).toBe(Number(claimed[0]!['fence']) + 1);
    const stale = await trustedClient().rpc('privacy_proc_freeze', {
      p_case: claimed[0]!['case_id'],
      p_fence: claimed[0]!['fence'],
      p_token: claimed[0]!['lease_token']
    });
    expect(stale.error?.message).toBe('PRIVACY_LEASE_LOST');
    expect((await caseRow(reference))['last_phase']).toBeNull();

    // Drift after the arm: the seam aborts atomically and the case blocks with a sanitized code.
    await expireLease(reference);
    await fixtureSql(
      'insert into public.platform_admins(user_id, granted_by) values (' +
        L(subject) +
        ', ' +
        L(player(0).id) +
        ')'
    );
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'blocked',
      last_phase: 'freeze',
      blocker_code: 'PLATFORM_ADMIN_GRANT',
      next_action: 'operator_remove_platform_grant'
    });
    expect(
      await scalar('select count(*)::int from public.player_profiles where user_id = ' + L(subject))
    ).toBe(1);
    expect(
      await scalar(
        'select count(*)::int from public.participant_identities where id = ' +
          L(subject) +
          " and state = 'live'"
      )
    ).toBe(1);
    expect(await countWithdrawn()).toBe(withdrawnBefore);
    expect(
      (
        await player(7).client.rpc('withdraw_my_deletion_request', {
          p_command_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    await fixtureSql('delete from public.platform_admins where user_id = ' + L(subject));
    await armCase(reference);

    // Provider outage: Storage fails once, then Auth keeps failing; backoff, then quarantine.
    const outage = faultyAdmin({ removeFails: 1, deleteUserFails: 99 });
    expect(await sweep({ client: outage })).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({
      state: 'app_data_erased',
      last_phase: 'relational',
      attempt_count: 1
    });
    expect(Date.parse(String((await caseRow(reference))['next_attempt_at']))).toBeGreaterThan(
      Date.now()
    );
    expect(await sweep({ client: outage })).toEqual({ disabled: false, processed: 0 });
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
      resume_state: 'app_data_erased',
      last_phase: 'storage',
      blocker_code: 'RETRIES_EXHAUSTED',
      next_action: 'operator_retry'
    });
    expect((await trustedClient().auth.admin.getUserById(subject)).error).toBeNull();
    // The operator resumes it; completed phases are not repeated and exactly one tombstone exists.
    expect((await operator('retry', reference))['state']).toBe('app_data_erased');
    expect(await sweep()).toEqual({ disabled: false, processed: 1 });
    expect(await caseRow(reference)).toMatchObject({ state: 'closed', outcome: 'erased' });
    expect(await countWithdrawn()).toBe(withdrawnBefore + 1);
    expect(await tablesMentioning(subject)).toEqual([]);
    expect(await privacyTablesMentioning(subject)).toEqual([]);
    expect((await trustedClient().auth.admin.getUserById(subject)).error?.status).toBe(404);
  });
});
