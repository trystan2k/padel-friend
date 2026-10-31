import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  addPlayerArgs,
  authUsersByEmail,
  localAdminClient,
  mailCount,
  operation,
  patchFixtureEvent,
  uniqueEmail,
  INVITE_ORIGIN
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
import { queryTrustedSql } from './helpers/sql-transport';
import { deliverMatchPlayerAdd } from '../src/features/matches/match-add-player.server';
import { AuthApiError, createClient } from '@supabase/supabase-js';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function event(admin: ProvisionalFixtureActor, owner: ProvisionalFixtureActor) {
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
  return eventId;
}

async function actors() {
  const env = environment.env!;
  const [admin, owner] = await Promise.all([
    signUpFixtureActor(env, 'race-admin', { displayName: 'Race Admin', level: 4 }),
    signUpFixtureActor(env, 'race-owner', { displayName: 'Race Owner', level: 4 })
  ]);
  return { env, admin, owner };
}

async function counts(email: string, eventIds: string[]) {
  const [user] = await authUsersByEmail(email);
  const rows = await queryTrustedSql(
    `select (select count(*)::int from public.player_profiles where user_id = $1) as profiles,
            (select count(*)::int from public.match_event_registrations
              where user_id = $1 and match_event_id = any($2::uuid[]) and lifecycle = 'accepted') as accepted`,
    { values: [user?.id ?? null, eventIds] }
  );
  return {
    users: (await authUsersByEmail(email)).length,
    ...rows.rows[0],
    mails: await mailCount(email)
  };
}

describe('concurrent match player adds', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'creates one identity and one email for parallel same-email adds to one event',
    async () => {
      const { env, admin, owner } = await actors();
      const eventId = await event(admin, owner);
      const email = uniqueEmail('race-same');
      const results = await Promise.all(
        [owner, admin, owner].map((actor, index) =>
          addPlayer(env, actor, { eventId, displayName: `Racer ${index}`, email, level: 3 })
        )
      );
      expect(results.map(({ result }) => result)).toEqual(
        Array.from({ length: 3 }, () => ({ status: 'ok' }))
      );
      expect(await counts(email, [eventId])).toEqual({
        users: 1,
        profiles: 1,
        accepted: 1,
        mails: 1
      });
    }
  );

  it.skipIf(!environment.env)(
    'joins parallel adds of one email across communities to the same identity',
    async () => {
      const { env, admin, owner } = await actors();
      const events = await Promise.all([event(admin, owner), event(admin, owner)]);
      const email = uniqueEmail('race-cross');
      const results = await Promise.all(
        events.map((eventId) =>
          addPlayer(env, owner, { eventId, displayName: 'Cross', email, level: 3 })
        )
      );
      expect(results.map(({ result }) => result)).toEqual([{ status: 'ok' }, { status: 'ok' }]);
      expect(await counts(email, events)).toEqual({ users: 1, profiles: 1, accepted: 2, mails: 1 });
      const memberships = await queryTrustedSql(
        `select count(*)::int as count from public.community_members m
           join auth.users u on u.id = m.user_id where lower(u.email) = $1 and m.status = 'active'`,
        { values: [email] }
      );
      expect(memberships.rows).toEqual([{ count: 2 }]);
    }
  );

  it.skipIf(!environment.env)(
    'never exceeds capacity when parallel adds race for the last place',
    async () => {
      const { env, admin, owner } = await actors();
      const eventId = await event(admin, owner);
      // The publication trigger registered the owner: one place remains.
      await patchFixtureEvent(eventId, 'maximum_registrations = 2');
      const emails = [uniqueEmail('cap-a'), uniqueEmail('cap-b'), uniqueEmail('cap-c')];
      await Promise.all(
        emails.map((email) =>
          addPlayer(env, owner, { eventId, displayName: 'Cap', email, level: 3 })
        )
      );
      const accepted = await queryTrustedSql(
        `select count(*)::int as count from public.match_event_registrations
          where match_event_id = $1 and lifecycle = 'accepted'`,
        { values: [eventId] }
      );
      expect(accepted.rows).toEqual([{ count: 2 }]);
      const users = (await Promise.all(emails.map(authUsersByEmail))).flat();
      expect(users).toHaveLength(1);
      expect((await Promise.all(emails.map(mailCount))).reduce((a, b) => a + b, 0)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'completes an add that waited on a creator whose delivery failed',
    async () => {
      const { env, admin, owner } = await actors();
      const eventId = await event(admin, owner);
      const email = uniqueEmail('race-fail');

      // The first add holds the creation capability while its Auth invite is in flight.
      let reached!: () => void;
      const inFlight = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      const holder = localAdminClient(env);
      const realInvite = holder.auth.admin.inviteUserByEmail.bind(holder.auth.admin);
      let calls = 0;
      holder.auth.admin.inviteUserByEmail = async (...args) => {
        if (calls++ > 0) return realInvite(...args);
        reached();
        await released;
        return {
          data: { user: null },
          error: new AuthApiError('smtp down', 500, 'unexpected_failure')
        };
      };
      const first = addPlayerArgs({ eventId, displayName: 'Holder', email, level: 3 });
      expect((await owner.client.rpc('add_match_player', first)).error).toBeNull();
      const holding = deliverMatchPlayerAdd(holder, {
        actor_id: owner.id,
        event_id: eventId,
        request_id: first.p_request_id,
        origin: INVITE_ORIGIN
      });
      await inFlight;

      // The concurrent add is accepted but cannot create the identity while the holder runs.
      const waiter = await addPlayer(env, admin, {
        eventId,
        displayName: 'Waiter',
        email,
        level: 3
      });
      expect(waiter.result).toEqual({ status: 'ok' });
      const waiterRequest = String(Reflect.get(Object(waiter.command), 'request_id'));
      expect(await operation(admin.id, eventId, waiterRequest)).toMatchObject({
        state: 'awaiting_identity'
      });
      expect(await authUsersByEmail(email)).toEqual([]);

      // The holder fails; settling re-drives the waiter, so it is not stranded.
      release();
      expect(await holding).toEqual({ status: 'ok' });
      expect(await counts(email, [eventId])).toEqual({
        users: 1,
        profiles: 1,
        accepted: 1,
        mails: 1
      });
      expect(await operation(admin.id, eventId, waiterRequest)).toMatchObject({
        state: 'completed',
        branch: 'new'
      });
      expect(await operation(owner.id, eventId, first.p_request_id)).toMatchObject({
        state: 'completed'
      });
    }
  );

  it.skipIf(!environment.env)(
    'resolves to the registered branch when a signup wins the race before delivery',
    async () => {
      const { env, admin, owner } = await actors();
      const eventId = await event(admin, owner);
      const email = uniqueEmail('race-signup');
      const args = addPlayerArgs({ eventId, displayName: 'Racing Signup', email, level: 3 });
      expect((await owner.client.rpc('add_match_player', args)).data).toMatchObject({
        status: 'ok'
      });
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({ email, password: 'Password123!' });
      expect(signup.error).toBeNull();
      const result = await deliverMatchPlayerAdd(localAdminClient(env), {
        actor_id: owner.id,
        event_id: eventId,
        request_id: args.p_request_id,
        origin: INVITE_ORIGIN
      });
      expect(result).toEqual({ status: 'ok' });
      const userId = signup.data.user!.id;
      const state = await queryTrustedSql(
        `select (select count(*)::int from public.player_profiles where user_id = $1) as profiles,
                (select status::text from public.match_event_invites where invitee_user_id = $1 and match_event_id = $2) as invite,
                (select count(*)::int from public.match_event_registrations where user_id = $1) as registrations`,
        { values: [userId, eventId] }
      );
      expect(state.rows).toEqual([{ profiles: 0, invite: 'pending', registrations: 0 }]);
      expect(await mailCount(email)).toBe(0);
    }
  );
});
