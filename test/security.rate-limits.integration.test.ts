import { describe, expect, it } from 'vitest';
import { createLeagueArgs, localDate } from './helpers/league-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import {
  insertFixtureCommunity,
  signUpFixtureActor,
  sqlText,
  type ProvisionalFixtureActor
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();
if (!environment.env)
  throw new Error(`Rate-limit suite requires live local Supabase: ${environment.reason}`);
const env = environment.env;

// Mirrors public.security_rate_limits() (PAF-189).
const LIMITS = {
  communityCreate: 3,
  communityOwned: 10,
  requestMessage: 10,
  matchEvent: 20,
  leagueCreate: 5
} as const;

type Actor = ProvisionalFixtureActor;
const newActor = (label: string): Promise<Actor> =>
  signUpFixtureActor(env, `rl-${label}`, { displayName: `RL ${label}`.slice(0, 40), level: 3.2 });

const createCommunity = (actor: Actor) =>
  actor.client.rpc('create_community', {
    p_name: `Limit ${crypto.randomUUID().slice(0, 8)}`,
    p_visibility: 'public',
    p_join_policy: 'instant'
  });

describe('per-user rate limits (PAF-189)', { timeout: 300_000 }, () => {
  it('exposes the named limits as one trusted function', async () => {
    const { rows } = await queryTrustedSql('select * from public.security_rate_limits()');
    expect(rows[0]).toMatchObject({
      community_create_max: LIMITS.communityCreate,
      community_owned_max: LIMITS.communityOwned,
      request_message_max: LIMITS.requestMessage,
      match_event_max: LIMITS.matchEvent,
      league_create_max: LIMITS.leagueCreate
    });
  });

  it('accepts 3 community creations per user per 24h, rejects the 4th, frees on window expiry and isolates users', async () => {
    const [user, other] = await Promise.all([newActor('c-user'), newActor('c-other')]);
    expect(
      (
        await user.client.rpc('create_community', {
          p_name: '',
          p_visibility: 'public',
          p_join_policy: 'instant'
        })
      ).error?.code
    ).toBe('23514');
    for (let i = 0; i < LIMITS.communityCreate; i += 1)
      expect((await createCommunity(user)).error).toBeNull();
    const rejected = await createCommunity(user);
    expect(rejected.error?.message).toBe('COMMUNITY_CREATE_RATE_LIMITED');
    expect(rejected.error?.code).toBe('P0001');
    // The rejected call left no half-created community behind.
    const count = await queryTrustedSql(
      'select count(*)::int as n from public.communities where created_by = $1',
      { values: [user.id] }
    );
    expect(count.rows[0]?.n).toBe(LIMITS.communityCreate);

    expect((await createCommunity(other)).error).toBeNull();

    await executeTrustedSql(
      `update public.communities set created_at = created_at - interval '25 hours' where created_by = ${sqlText(user.id)}`
    );
    expect((await createCommunity(user)).error).toBeNull();
  });

  it('accepts exactly one community when two requests race for the last slot', async () => {
    const user = await newActor('c-race');
    for (let i = 0; i < LIMITS.communityCreate - 1; i += 1)
      expect((await createCommunity(user)).error).toBeNull();
    const results = await Promise.all([createCommunity(user), createCommunity(user)]);
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      results.filter((result) => result.error?.message === 'COMMUNITY_CREATE_RATE_LIMITED')
    ).toHaveLength(1);
  });

  it('caps owned communities at 10 even when the creation window is clear', async () => {
    const user = await newActor('c-owned');
    const past = Array.from(
      { length: LIMITS.communityOwned - 1 },
      () =>
        `(${sqlText(crypto.randomUUID())}, 'Old owned', 'public', ${sqlText(user.id)}, now() - interval '5 days')`
    ).join(',');
    await executeTrustedSql(
      `insert into public.communities(id, name, visibility, created_by, created_at) values ${past}`
    );
    const raced = await Promise.all([createCommunity(user), createCommunity(user)]);
    expect(raced.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      raced.filter((result) => result.error?.message === 'COMMUNITY_OWNED_LIMIT_REACHED')
    ).toHaveLength(1);
    const tenth = raced.find((result) => result.error === null);
    if (!tenth) throw new Error('Last ownership slot missing');
    expect(tenth.error).toBeNull();
    if (!tenth.data) throw new Error('Tenth community missing');
    const rejected = await createCommunity(user);
    expect(rejected.error?.message).toBe('COMMUNITY_OWNED_LIMIT_REACHED');

    // No community archive/transfer status exists: created_by is immutable ownership.
    // Leaving administration is not an ownership transfer and must not release a slot.
    const backup = await newActor('c-backup');
    await executeTrustedSql(
      `insert into public.community_members(community_id, user_id, role, status)
         values (${sqlText(tenth.data)}, ${sqlText(backup.id)}, 'admin', 'active')`
    );
    expect(
      (await user.client.rpc('leave_community', { p_community_id: tenth.data })).error
    ).toBeNull();
    expect((await createCommunity(user)).error?.message).toBe('COMMUNITY_OWNED_LIMIT_REACHED');
    expect(
      (await user.client.from('communities').update({ created_by: backup.id }).eq('id', tenth.data))
        .error?.code
    ).toBe('42501');
  });

  it('limits request messages to 10 per thread per hour without touching other threads, retries or users', async () => {
    const [admin, otherAdmin] = await Promise.all([newActor('m-admin'), newActor('m-admin2')]);
    const applicants = await Promise.all([newActor('m-app1'), newActor('m-app2')]);
    const created = await createCommunity(admin);
    expect(created.error).toBeNull();
    if (typeof created.data !== 'string') throw new Error('Community fixture missing');
    const communityId = created.data;
    const memberships = await Promise.all(
      applicants.map(async (applicant) => {
        const id = crypto.randomUUID();
        await executeTrustedSql(
          `insert into public.community_members(id, community_id, user_id, role, status)
             values (${sqlText(id)}, ${sqlText(communityId)}, ${sqlText(applicant.id)}, 'member', 'pending')`
        );
        return id;
      })
    );
    const send = (membershipId: string, requestId = crypto.randomUUID(), sender = admin) =>
      sender.client.rpc('send_community_request_message', {
        p_community_id: communityId,
        p_membership_id: membershipId,
        p_body: 'Hello applicant',
        p_client_request_id: requestId
      });

    expect((await send(memberships[0]!, crypto.randomUUID(), applicants[0])).error?.code).toBe(
      '42501'
    );
    const firstRequestId = crypto.randomUUID();
    expect((await send(memberships[0]!, firstRequestId)).error).toBeNull();
    for (let i = 1; i < LIMITS.requestMessage - 1; i += 1)
      expect((await send(memberships[0]!)).error).toBeNull();
    const raced = await Promise.all([send(memberships[0]!), send(memberships[0]!)]);
    expect(raced.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      raced.filter((result) => result.error?.message === 'COMMUNITY_REQUEST_MESSAGE_RATE_LIMITED')
    ).toHaveLength(1);
    const rejected = await send(memberships[0]!);
    expect(rejected.error?.message).toBe('COMMUNITY_REQUEST_MESSAGE_RATE_LIMITED');
    expect(rejected.error?.code).toBe('P0001');

    // An idempotent replay of an already stored message does not trip the quota.
    expect((await send(memberships[0]!, firstRequestId)).error).toBeNull();
    // A different thread is independent.
    expect((await send(memberships[1]!)).error).toBeNull();
    // Another admin of the same thread is scoped separately from the first sender.
    await executeTrustedSql(
      `insert into public.community_members(community_id, user_id, role, status)
         values (${sqlText(communityId)}, ${sqlText(otherAdmin.id)}, 'admin', 'active')`
    );
    expect((await send(memberships[0]!, crypto.randomUUID(), otherAdmin)).error).toBeNull();

    await executeTrustedSql(
      `update public.community_request_messages set created_at = created_at - interval '61 minutes'
         where sender_user_id = ${sqlText(admin.id)}`
    );
    expect((await send(memberships[0]!)).error).toBeNull();
  });

  it('limits match publications to 20 per user per day, expiring and per user', async () => {
    const [creator, other] = await Promise.all([newActor('e-creator'), newActor('e-other')]);
    const communityId = crypto.randomUUID();
    const otherCommunityId = crypto.randomUUID();
    await insertFixtureCommunity({ id: communityId, visibility: 'public', adminId: creator.id });
    await insertFixtureCommunity({ id: otherCommunityId, visibility: 'public', adminId: other.id });
    const publish = async (actor: Actor, community: string) => {
      const eventId = crypto.randomUUID();
      const photo = matchPhotoFixture(community, eventId, actor.id);
      await executeTrustedSql(photo.sql);
      const args = {
        p_event_id: eventId,
        p_input: {
          community_id: community,
          date: localDate(3),
          start_time: '10:00',
          event_type: 'friendly',
          visibility: 'community_open',
          team_assignment_mode: 'POST_MATCH_TEAMS',
          venue_name: 'Limit court',
          maps_url: 'https://maps.google.com/maps/place/limit-fixture',
          photo_path: photo.path
        },
        p_invitee_ids: []
      };
      const result = await actor.client.rpc('publish_match_event', args);
      return { ...result, retry: () => actor.client.rpc('publish_match_event', args) };
    };

    for (let i = 0; i < LIMITS.matchEvent - 1; i += 1)
      expect((await publish(creator, communityId)).error).toBeNull();
    const raced = await Promise.all([publish(creator, communityId), publish(creator, communityId)]);
    expect(raced.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      raced.filter((result) => result.error?.message === 'MATCH_EVENT_CREATE_RATE_LIMITED')
    ).toHaveLength(1);
    const rejected = await publish(creator, communityId);
    expect(rejected.error?.message).toBe('MATCH_EVENT_CREATE_RATE_LIMITED');
    expect(rejected.error?.code).toBe('P0001');
    const accepted = raced.find((result) => result.error === null);
    if (!accepted) throw new Error('Last publication slot missing');
    const retry = await accepted.retry();
    expect(retry.error).toBeNull();
    expect(retry.data).toBe(accepted.data);
    expect((await publish(other, otherCommunityId)).error).toBeNull();

    // Transferring the published events (organizer ownership transfer) must not restore quota:
    // the limit counts the immutable publisher, not the current created_by owner.
    await executeTrustedSql(
      `update public.match_events set created_by = ${sqlText(other.id)}, version = version + 1
         where published_by = ${sqlText(creator.id)}`
    );
    const afterTransfer = await publish(creator, communityId);
    expect(afterTransfer.error?.message).toBe('MATCH_EVENT_CREATE_RATE_LIMITED');
    expect((await publish(other, otherCommunityId)).error).toBeNull();

    await executeTrustedSql(`
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set published_at = published_at - interval '25 hours'
        where published_by = ${sqlText(creator.id)};
      alter table public.match_events enable trigger match_event_immutable;`);
    expect((await publish(creator, communityId)).error).toBeNull();
  });

  it('limits League creation to 5 per user per day, expiring and per user, with idempotent replay', async () => {
    const [owner, other] = await Promise.all([newActor('l-owner'), newActor('l-other')]);
    const communityId = crypto.randomUUID();
    const otherCommunityId = crypto.randomUUID();
    await insertFixtureCommunity({ id: communityId, visibility: 'public', adminId: owner.id });
    await insertFixtureCommunity({ id: otherCommunityId, visibility: 'public', adminId: other.id });
    const create = (actor: Actor, community: string) =>
      actor.client.rpc('create_league', createLeagueArgs(community));

    expect(
      (
        await owner.client.rpc(
          'create_league',
          createLeagueArgs(communityId, {
            p_minimum_matches: 0
          })
        )
      ).error?.message
    ).toBe('LEAGUE_MINIMUM_INVALID');
    const replay = createLeagueArgs(communityId);
    expect((await owner.client.rpc('create_league', replay)).error).toBeNull();
    for (let i = 1; i < LIMITS.leagueCreate - 1; i += 1)
      expect((await create(owner, communityId)).error).toBeNull();
    const raced = await Promise.all([create(owner, communityId), create(owner, communityId)]);
    expect(raced.filter((result) => result.error === null)).toHaveLength(1);
    expect(
      raced.filter((result) => result.error?.message === 'LEAGUE_CREATE_RATE_LIMITED')
    ).toHaveLength(1);
    const rejected = await create(owner, communityId);
    expect(rejected.error?.message).toBe('LEAGUE_CREATE_RATE_LIMITED');
    expect(rejected.error?.code).toBe('P0001');
    // Retrying the first accepted request returns the stored League instead of tripping the limit.
    expect((await owner.client.rpc('create_league', replay)).error).toBeNull();
    expect((await create(other, otherCommunityId)).error).toBeNull();

    await executeTrustedSql(
      `alter table public.leagues disable trigger leagues_identity_guard;
       update public.leagues set created_at = created_at - interval '25 hours' where owner_id = ${sqlText(owner.id)};
       alter table public.leagues enable trigger leagues_identity_guard;`
    );
    expect((await create(owner, communityId)).error).toBeNull();
  });
});
