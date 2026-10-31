import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  addPlayer,
  addPlayerArgs,
  authUsersByEmail,
  failingInviteAdmin,
  INVITE_ORIGIN,
  localAdminClient,
  mailCount,
  operation,
  uniqueEmail
} from './helpers/match-add-player-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  signUpFixtureActor,
  type ProvisionalFixtureActor
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';
import {
  deliverMatchPlayerAdd,
  reconcileMatchPlayerAdds,
  runScheduledMatchPlayerAddSweep
} from '../src/features/matches/match-add-player.server';

// F9/F10/F12: invitation delivery runs after the response, so the ledger must bring every
// undelivered add back by itself. Each test breaks one step (failed send, crashed holder,
// racing waiter, abandoned dispatch) and proves later add/read activity completes it.
const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

function deferred() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function scenario() {
  const env = environment.env!;
  const [admin, owner] = await Promise.all([
    signUpFixtureActor(env, 'recon-admin', { displayName: 'Recon Admin', level: 4 }),
    signUpFixtureActor(env, 'recon-owner', { displayName: 'Recon Owner', level: 4 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'public',
    adminId: admin.id,
    memberIds: [owner.id]
  });
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  return { env, admin, owner, eventId };
}

/** Everything the server function does after the response, minus the platform's waitUntil. */
async function afterAdd(
  env: NonNullable<typeof environment.env>,
  actor: ProvisionalFixtureActor,
  eventId: string,
  requestId: string
) {
  const admin = localAdminClient(env);
  try {
    await deliverMatchPlayerAdd(admin, {
      actor_id: actor.id,
      event_id: eventId,
      request_id: requestId,
      origin: INVITE_ORIGIN
    });
  } finally {
    await reconcileMatchPlayerAdds(admin, INVITE_ORIGIN);
  }
}

/** The grace and backoff windows are wall-clock; fixtures make every operation due now. */
const makeDue = (email: string) =>
  executeTrustedSql(
    `update public.match_player_add_operations set retry_after = clock_timestamp() - interval '1 second'
      where email = lower('${email}')`
  );

async function accept(
  actor: ProvisionalFixtureActor,
  eventId: string,
  email: string,
  label: string
) {
  const args = addPlayerArgs({ eventId, displayName: label, email, level: 3 });
  expect((await actor.client.rpc('add_match_player', args)).error).toBeNull();
  return args.p_request_id;
}

async function userCount(email: string) {
  return (await authUsersByEmail(email)).length;
}

describe('match player add reconciliation', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'completes a failed unknown-address add when the same actor later adds someone else',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('stranded');
      const stranded = addPlayerArgs({ eventId, displayName: 'Stranded', email, level: 3 });
      expect((await owner.client.rpc('add_match_player', stranded)).error).toBeNull();
      const failed = await deliverMatchPlayerAdd(failingInviteAdmin(env), {
        actor_id: owner.id,
        event_id: eventId,
        request_id: stranded.p_request_id,
        origin: INVITE_ORIGIN
      });
      // Uniform answer, nothing delivered, retry recorded in the ledger.
      expect(failed).toEqual({ status: 'ok' });
      expect(await operation(owner.id, eventId, stranded.p_request_id)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'failed'
      });
      expect(await userCount(email)).toBe(0);

      // Before the backoff elapses, unrelated activity leaves it alone.
      const early = await accept(owner, eventId, uniqueEmail('early'), 'Early');
      await afterAdd(env, owner, eventId, early);
      expect(await userCount(email)).toBe(0);

      await makeDue(email);
      const unrelated = await accept(owner, eventId, uniqueEmail('unrelated'), 'Unrelated');
      await afterAdd(env, owner, eventId, unrelated);
      expect(await operation(owner.id, eventId, stranded.p_request_id)).toMatchObject({
        state: 'completed',
        branch: 'new',
        dispatch_state: 'sent'
      });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);

      // Settled work is never re-driven: no second mail, nothing handed out.
      await makeDue(email);
      await reconcileMatchPlayerAdds(localAdminClient(env), INVITE_ORIGIN);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'retries a persistently failing delivery a bounded number of times with backoff',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('bounded');
      const requestId = await accept(owner, eventId, email, 'Bounded');
      const failing = failingInviteAdmin(env);
      const rows = async () =>
        (
          await queryTrustedSql(
            `select dispatch_attempts, dispatch_state, retry_after > clock_timestamp() as backed_off
               from public.match_player_add_operations where request_id = $1`,
            { values: [requestId] }
          )
        ).rows[0];
      for (let attempt = 1; attempt <= 6; attempt++) {
        await makeDue(email);
        await reconcileMatchPlayerAdds(failing, INVITE_ORIGIN);
        expect(await rows()).toMatchObject({ dispatch_attempts: attempt, backed_off: true });
      }
      // The attempt budget is spent: even a due operation is no longer handed out.
      await makeDue(email);
      const claimed = await localAdminClient(env).rpc('claim_match_player_add_redrives', {
        p_limit: 5
      });
      expect(claimed.data).toEqual([]);
      expect(await userCount(email)).toBe(0);
      expect(await mailCount(email)).toBe(0);
    }
  );

  it.skipIf(!environment.env)('hands out at most the requested batch, oldest first', async () => {
    const { env, owner, eventId } = await scenario();
    const emails = [uniqueEmail('batch-a'), uniqueEmail('batch-b'), uniqueEmail('batch-c')];
    const requests: string[] = [];
    for (const email of emails) {
      requests.push(await accept(owner, eventId, email, 'Batch'));
      await makeDue(email);
    }
    const admin = localAdminClient(env);
    const first = await admin.rpc('claim_match_player_add_redrives', { p_limit: 2 });
    const second = await admin.rpc('claim_match_player_add_redrives', { p_limit: 2 });
    const ids = (value: unknown) =>
      (Array.isArray(value) ? value : []).map((entry) => Reflect.get(entry, 'request_id'));
    expect(ids(first.data)).toEqual(requests.slice(0, 2));
    expect(ids(second.data)).toEqual(requests.slice(2));
    expect(
      (await owner.client.rpc('claim_match_player_add_redrives', { p_limit: 1 })).error?.code
    ).toBe('42501');
  });

  it.skipIf(!environment.env)(
    'completes the waiter of a crashed holder once its capability has expired',
    async () => {
      const { env, admin, owner, eventId } = await scenario();
      const email = uniqueEmail('crashed');
      const holderRequest = await accept(owner, eventId, email, 'Holder');
      const service = localAdminClient(env);
      // The holder dispatches (takes the creation capability) and its worker dies: no settle.
      const dispatched = await service.rpc('dispatch_match_player_add', {
        p_actor_id: owner.id,
        p_match_event_id: eventId,
        p_request_id: holderRequest
      });
      expect(dispatched.data).toMatchObject({ action: 'create' });
      const waiter = await addPlayer(env, admin, {
        eventId,
        displayName: 'Waiter',
        email,
        level: 3
      });
      const waiterRequest = String(Reflect.get(Object(waiter.command), 'request_id'));
      expect(await operation(admin.id, eventId, waiterRequest)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'none'
      });

      // While the capability is live nothing is handed out, however much activity there is.
      await makeDue(email);
      await reconcileMatchPlayerAdds(service, INVITE_ORIGIN);
      expect(await userCount(email)).toBe(0);

      await executeTrustedSql(
        `update public.match_player_add_operations set capability_expires_at = clock_timestamp() - interval '1 minute'
          where email = lower('${email}') and capability_expires_at is not null`
      );
      await makeDue(email);
      const later = await accept(owner, eventId, uniqueEmail('later'), 'Later');
      await afterAdd(env, owner, eventId, later);
      expect(await operation(owner.id, eventId, holderRequest)).toMatchObject({
        state: 'completed'
      });
      expect(await operation(admin.id, eventId, waiterRequest)).toMatchObject({
        state: 'completed',
        branch: 'new'
      });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'does not strand a waiter that arrives while a re-driven waiter holds the capability',
    async () => {
      const { env, admin, owner, eventId } = await scenario();
      const email = uniqueEmail('redrive');
      const gates = [deferred(), deferred()];
      const reached = [deferred(), deferred()];
      // Invite #0 (holder) and #1 (re-driven waiter) block, then fail; later ones are real.
      const flaky = localAdminClient(env);
      const realInvite = flaky.auth.admin.inviteUserByEmail.bind(flaky.auth.admin);
      let calls = 0;
      flaky.auth.admin.inviteUserByEmail = async (...args) => {
        const call = calls++;
        if (call > 1) return realInvite(...args);
        reached[call]!.resolve();
        await gates[call]!.promise;
        return { data: { user: null }, error: new AuthApiError('smtp down', 500, 'unexpected') };
      };
      const holderRequest = await accept(owner, eventId, email, 'Holder');
      const holding = deliverMatchPlayerAdd(flaky, {
        actor_id: owner.id,
        event_id: eventId,
        request_id: holderRequest,
        origin: INVITE_ORIGIN
      });
      await reached[0]!.promise;
      const first = await addPlayer(env, admin, { eventId, displayName: 'W1', email, level: 3 });
      const firstRequest = String(Reflect.get(Object(first.command), 'request_id'));
      gates[0]!.resolve();
      // The holder failed; its settle re-drives W1, which now holds the capability in flight.
      await reached[1]!.promise;
      const second = await addPlayer(env, owner, { eventId, displayName: 'W2', email, level: 3 });
      const secondRequest = String(Reflect.get(Object(second.command), 'request_id'));
      expect(await operation(owner.id, eventId, secondRequest)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'none'
      });
      // The re-drive fails too, and (non-recursive) settles nobody else: W2 is orphaned,
      // W1 and the holder are failed with no worker left.
      gates[1]!.resolve();
      await holding;
      expect(await userCount(email)).toBe(0);
      for (const [actor, request] of [
        [owner, holderRequest],
        [admin, firstRequest],
        [owner, secondRequest]
      ] as const)
        expect(await operation(actor.id, eventId, request)).toMatchObject({
          state: 'awaiting_identity'
        });

      await makeDue(email);
      const trigger = await accept(owner, eventId, uniqueEmail('trigger'), 'Trigger');
      await afterAdd(env, owner, eventId, trigger);
      for (const [actor, request] of [
        [owner, holderRequest],
        [admin, firstRequest],
        [owner, secondRequest]
      ] as const)
        expect(await operation(actor.id, eventId, request)).toMatchObject({ state: 'completed' });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'redelivers a provisional invitation whose dispatch was abandoned mid-flight',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('abandoned');
      const created = await addPlayer(env, owner, {
        eventId,
        displayName: 'Abandoned',
        email,
        level: 3
      });
      expect(created.result).toEqual({ status: 'ok' });
      expect(await mailCount(email)).toBe(1);

      // A second add of the provisional address dispatches a resend that crashes before settling.
      const requestId = await accept(owner, eventId, email, 'Abandoned');
      await executeTrustedSql(
        `delete from public.match_player_add_recipient_sends
          where operation_id in (select id from public.match_player_add_operations where email = lower('${email}'))`
      );
      const service = localAdminClient(env);
      const dispatched = await service.rpc('dispatch_match_player_add', {
        p_actor_id: owner.id,
        p_match_event_id: eventId,
        p_request_id: requestId
      });
      expect(dispatched.data).toMatchObject({ action: 'resend' });
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        dispatch_state: 'pending'
      });

      // The in-flight send is left alone until it has been quiet for the capability TTL.
      await makeDue(email);
      await reconcileMatchPlayerAdds(service, INVITE_ORIGIN);
      expect(await mailCount(email)).toBe(1);

      await executeTrustedSql(
        `update public.match_player_add_recipient_sends set sent_at = clock_timestamp() - interval '1 hour'
          where operation_id in (select id from public.match_player_add_operations where email = lower('${email}'))`
      );
      await makeDue(email);
      await reconcileMatchPlayerAdds(service, INVITE_ORIGIN);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        dispatch_state: 'sent'
      });
      expect(await mailCount(email)).toBe(2);
    }
  );

  it.skipIf(!environment.env)(
    'a late original attempt cannot settle the attempt that replaced it (F13)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('fenced');
      const requestId = await accept(owner, eventId, email, 'Fenced');
      const reachedOriginal = deferred();
      const releaseOriginal = deferred();
      const reachedNewer = deferred();
      const releaseNewer = deferred();

      // Original attempt: its HTTP call hangs past the capability TTL, then fails.
      const original = localAdminClient(env);
      original.auth.admin.inviteUserByEmail = async () => {
        reachedOriginal.resolve();
        await releaseOriginal.promise;
        return { data: { user: null }, error: new AuthApiError('late', 500, 'unexpected') };
      };
      const holding = deliverMatchPlayerAdd(original, {
        actor_id: owner.id,
        event_id: eventId,
        request_id: requestId,
        origin: INVITE_ORIGIN
      });
      await reachedOriginal.promise;

      // TTL lapses: the sweep abandons the original and a newer attempt takes over (and hangs too).
      await executeTrustedSql(
        `update public.match_player_add_operations set capability_expires_at = clock_timestamp() - interval '1 minute'
          where email = lower('${email}');
         update public.match_player_add_recipient_sends set sent_at = clock_timestamp() - interval '1 hour'
          where operation_id in (select id from public.match_player_add_operations where email = lower('${email}'))`
      );
      await makeDue(email);
      const newer = localAdminClient(env);
      const realInvite = newer.auth.admin.inviteUserByEmail.bind(newer.auth.admin);
      newer.auth.admin.inviteUserByEmail = async (...args) => {
        reachedNewer.resolve();
        await releaseNewer.promise;
        return realInvite(...args);
      };
      const sweeping = reconcileMatchPlayerAdds(newer, INVITE_ORIGIN);
      await reachedNewer.promise;
      const inFlight = async () =>
        (
          await queryTrustedSql(
            `select o.dispatch_state, o.dispatch_attempt, o.capability_hash is not null as has_capability,
                    exists (select 1 from public.match_player_add_recipient_sends s where s.operation_id = o.id) as holds_slot
               from public.match_player_add_operations o where o.request_id = $1`,
            { values: [requestId] }
          )
        ).rows[0];
      const before = await inFlight();
      expect(before).toMatchObject({
        dispatch_state: 'pending',
        has_capability: true,
        holds_slot: true
      });

      // The stale original now settles (as a failure, the destructive case): clean no-op.
      releaseOriginal.resolve();
      await expect(holding).resolves.toEqual({ status: 'ok' });
      expect(await inFlight()).toEqual(before);

      // The newer attempt is untouched and completes normally.
      releaseNewer.resolve();
      await sweeping;
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        branch: 'new',
        dispatch_state: 'sent'
      });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'retires an operation whose attempts are spent: slot released, never audited, re-add works (F14, F19)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('exhausted');
      const requestId = await accept(owner, eventId, email, 'Exhausted');
      const failing = failingInviteAdmin(env);
      for (let attempt = 1; attempt <= 6; attempt++) {
        await makeDue(email);
        await reconcileMatchPlayerAdds(failing, INVITE_ORIGIN);
      }
      // A slot still held for this operation must be released when it is retired.
      await executeTrustedSql(
        `insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at)
           select public.match_player_add_digest(email), id, clock_timestamp()
             from public.match_player_add_operations where request_id = '${requestId}'`
      );
      await makeDue(email);
      const claimed = await localAdminClient(env).rpc('claim_match_player_add_redrives', {
        p_limit: 5
      });
      expect(claimed.data).toEqual([]);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'exhausted'
      });
      const evidence = async () =>
        (
          await queryTrustedSql(
            `select (select count(*) from public.match_player_add_recipient_sends s
                      join public.match_player_add_operations o on o.id = s.operation_id
                     where o.request_id = $1)::int as slots,
                    (select count(*) from public.match_event_audit_log a
                      where a.request_id = $1 and a.action not in ('player_added'))::int as audits`,
            { values: [requestId] }
          )
        ).rows[0];
      expect(await evidence()).toEqual({ slots: 0, audits: 0 });

      // Retired once: later sweeps neither hand it out nor write anything else.
      await makeDue(email);
      await reconcileMatchPlayerAdds(localAdminClient(env), INVITE_ORIGIN);
      expect(await evidence()).toEqual({ slots: 0, audits: 0 });

      // A fresh add of the same address is not blocked by the retired one.
      const fresh = await addPlayer(env, owner, { eventId, displayName: 'Again', email, level: 3 });
      expect(fresh.result).toEqual({ status: 'ok' });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'completes a stranded add from a sweep on an otherwise idle event (F14)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('idle');
      const requestId = await accept(owner, eventId, email, 'Idle');
      await deliverMatchPlayerAdd(failingInviteAdmin(env), {
        actor_id: owner.id,
        event_id: eventId,
        request_id: requestId,
        origin: INVITE_ORIGIN
      });
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        dispatch_state: 'failed'
      });
      // No add anywhere: the sweep a roster reader triggers is all that runs.
      await makeDue(email);
      await reconcileMatchPlayerAdds(localAdminClient(env), INVITE_ORIGIN);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        dispatch_state: 'sent'
      });
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'exhaustion leaves the manager-visible audit exactly as it was (F19)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const eventAudit = async () =>
        (
          await queryTrustedSql(
            `select action, request_id from public.match_event_audit_log
              where match_event_id = $1 order by occurred_at, id`,
            { values: [eventId] }
          )
        ).rows;
      const managerView = async () => {
        const listed = await owner.client.rpc('list_match_event_audit', {
          p_match_event_id: eventId
        });
        expect(listed.error).toBeNull();
        return JSON.stringify(listed.data);
      };
      const email = uniqueEmail('audit-stuck');
      const requestId = await accept(owner, eventId, email, 'Stuck');
      // Every attempt of the budget fails; the operation is still "failed", not yet retired.
      for (let attempt = 1; attempt <= 6; attempt++) {
        await makeDue(email);
        await reconcileMatchPlayerAdds(failingInviteAdmin(env), INVITE_ORIGIN);
      }
      const before = { audit: await eventAudit(), listed: await managerView() };

      // The retiring sweep: ledger state changes, the audit does not.
      await makeDue(email);
      await reconcileMatchPlayerAdds(failingInviteAdmin(env), INVITE_ORIGIN);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        dispatch_state: 'exhausted'
      });
      expect({ audit: await eventAudit(), listed: await managerView() }).toEqual(before);
      expect(before.listed).not.toContain('exhausted');
      expect(before.listed).not.toContain(requestId);
    }
  );

  it.skipIf(!environment.env)(
    'a replay of the same request during an in-flight Auth call neither replaces the capability nor re-sends (F18)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('replay');
      const requestId = await accept(owner, eventId, email, 'Replay');
      const key = { actor_id: owner.id, event_id: eventId, request_id: requestId };

      // Auth answers only when released, so the first attempt stays in flight.
      const slow = localAdminClient(env);
      const realInvite = slow.auth.admin.inviteUserByEmail.bind(slow.auth.admin);
      const release = deferred();
      let inviteCalls = 0;
      slow.auth.admin.inviteUserByEmail = async (...args) => {
        inviteCalls++;
        await release.promise;
        return realInvite(...args);
      };
      const attemptOf = async () =>
        (
          await queryTrustedSql(
            `select dispatch_attempt, capability_hash from public.match_player_add_operations where request_id = $1`,
            { values: [requestId] }
          )
        ).rows[0];

      const first = deliverMatchPlayerAdd(slow, { ...key, origin: INVITE_ORIGIN });
      await vi.waitFor(async () => expect((await attemptOf())?.dispatch_attempt).toBeTruthy());
      const live = await attemptOf();

      // Replays (uniform answer) while the first attempt holds the lease.
      const replays = await Promise.all([
        deliverMatchPlayerAdd(localAdminClient(env), { ...key, origin: INVITE_ORIGIN }),
        deliverMatchPlayerAdd(localAdminClient(env), { ...key, origin: INVITE_ORIGIN })
      ]);
      expect(replays).toEqual([{ status: 'ok' }, { status: 'ok' }]);
      expect(
        (
          await localAdminClient(env).rpc('dispatch_match_player_add', {
            p_actor_id: owner.id,
            p_match_event_id: eventId,
            p_request_id: requestId
          })
        ).data
      ).toEqual({ action: 'none' });
      expect(await attemptOf()).toEqual(live);
      expect(inviteCalls).toBe(1);

      release.resolve();
      expect(await first).toEqual({ status: 'ok' });
      expect(inviteCalls).toBe(1);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        branch: 'new',
        dispatch_state: 'sent'
      });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'a replay after the lease expired starts a new attempt (F18 replacement only after expiry)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('replay-expired');
      const requestId = await accept(owner, eventId, email, 'Expired');
      const service = localAdminClient(env);
      const args = {
        p_actor_id: owner.id,
        p_match_event_id: eventId,
        p_request_id: requestId
      };
      expect((await service.rpc('dispatch_match_player_add', args)).data).toMatchObject({
        action: 'create'
      });
      expect((await service.rpc('dispatch_match_player_add', args)).data).toEqual({
        action: 'none'
      });
      await executeTrustedSql(
        `update public.match_player_add_operations set capability_expires_at = clock_timestamp() - interval '1 minute'
          where request_id = '${requestId}'`
      );
      await executeTrustedSql(
        `delete from public.match_player_add_recipient_sends s using public.match_player_add_operations o
          where o.id = s.operation_id and o.request_id = '${requestId}'`
      );
      expect((await service.rpc('dispatch_match_player_add', args)).data).toMatchObject({
        action: 'create'
      });
    }
  );

  it.skipIf(!environment.env)(
    'the scheduled sweep completes a failed add with no further add or read traffic (F20)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('cron');
      const requestId = await accept(owner, eventId, email, 'Cron');
      await deliverMatchPlayerAdd(failingInviteAdmin(env), {
        actor_id: owner.id,
        event_id: eventId,
        request_id: requestId,
        origin: INVITE_ORIGIN
      });
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        dispatch_state: 'failed'
      });
      expect(await userCount(email)).toBe(0);

      // Before the deadline the scheduled run leaves it alone ...
      await runScheduledMatchPlayerAddSweep(localAdminClient(env), INVITE_ORIGIN);
      expect(await mailCount(email)).toBe(0);
      // ... once due, the cron alone brings it home.
      await makeDue(email);
      await runScheduledMatchPlayerAddSweep(localAdminClient(env), `${INVITE_ORIGIN}/ignored/path`);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        branch: 'new',
        dispatch_state: 'sent'
      });
      expect(await userCount(email)).toBe(1);
      expect(await mailCount(email)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'the scheduled sweep exhausts a persistently failing add within the budget (F20)',
    async () => {
      const { env, owner, eventId } = await scenario();
      const email = uniqueEmail('cron-exhaust');
      const requestId = await accept(owner, eventId, email, 'Exhaust');
      for (let run = 1; run <= 7; run++) {
        await makeDue(email);
        await runScheduledMatchPlayerAddSweep(failingInviteAdmin(env), INVITE_ORIGIN);
      }
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'exhausted'
      });
      expect(await mailCount(email)).toBe(0);
    }
  );

  it('refuses to run the scheduled sweep without a usable app origin (F20)', async () => {
    const rpc = vi.fn<() => Promise<never>>();
    const admin = Object.assign(Object.create(null), { rpc });
    await expect(runScheduledMatchPlayerAddSweep(admin, undefined)).rejects.toThrow(
      'APP_ORIGIN_UNAVAILABLE'
    );
    await expect(runScheduledMatchPlayerAddSweep(admin, 'not a url')).rejects.toThrow(
      'APP_ORIGIN_UNAVAILABLE'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(['data:text/plain,x', 'mailto:a@b.co', 'ftp://example.com', 'file:///tmp/x'])(
    'rejects the non-http app origin %s before any sweep work (F25)',
    async (origin) => {
      const rpc = vi.fn<() => Promise<never>>();
      const admin = Object.assign(Object.create(null), { rpc });
      await expect(runScheduledMatchPlayerAddSweep(admin, origin)).rejects.toThrow(
        'APP_ORIGIN_UNAVAILABLE'
      );
      expect(rpc).not.toHaveBeenCalled();
    }
  );

  it.each(['http://localhost:3000', 'https://example.com'])(
    'accepts the http(s) app origin %s (F25)',
    async (origin) => {
      const rpc = vi.fn<() => Promise<{ data: unknown[]; error: null }>>(() =>
        Promise.resolve({ data: [], error: null })
      );
      const admin = Object.assign(Object.create(null), { rpc });
      await expect(runScheduledMatchPlayerAddSweep(admin, origin)).resolves.toBeUndefined();
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  );

  it('fails the scheduled sweep when the claim RPC errors, while the traffic sweep swallows it (F24)', async () => {
    const rpc = vi.fn<() => Promise<{ data: null; error: { message: string } }>>(() =>
      Promise.resolve({ data: null, error: { message: 'permission denied' } })
    );
    const admin = Object.assign(Object.create(null), { rpc });
    await expect(runScheduledMatchPlayerAddSweep(admin, INVITE_ORIGIN)).rejects.toThrow(
      'MATCH_PLAYER_ADD_CLAIM_FAILED'
    );
    await expect(reconcileMatchPlayerAdds(admin, INVITE_ORIGIN)).resolves.toBeUndefined();
  });
});
