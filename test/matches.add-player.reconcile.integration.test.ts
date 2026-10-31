import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
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
  reconcileMatchPlayerAdds
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
});
