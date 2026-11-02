import { beforeAll, describe, expect, it } from 'vitest';
import { addPlayer, uniqueEmail } from './helpers/match-add-player-fixtures';
import {
  insertLeague,
  leagueWorld,
  sqlRows,
  type LeagueActor,
  type LeagueWorld
} from './helpers/league-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { signUpFixtureActor, sqlText } from './helpers/provisional-player-fixtures';
import { isoDay, publishCompetitive } from './helpers/ranked-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe.skipIf(!environment.env)('Ranked members-only admission', { timeout: 300_000 }, () => {
  let world: LeagueWorld;
  let leagueId: string;

  beforeAll(async () => {
    world = await leagueWorld(environment.env!, 'ranked-adm');
    await world.setTimezone('UTC');
    leagueId = await insertLeague({
      communityId: world.communityId,
      ownerId: world.owner.id,
      status: 'upcoming',
      startAt: `${isoDay(-5)}T00:00:00Z`,
      endAt: `${isoDay(60)}T00:00:00Z`
    });
  });

  const ranked = async (overrides: Record<string, unknown> = {}, invitees: string[] = []) => {
    const { eventId, result } = await publishCompetitive(
      world.owner,
      world.communityId,
      { competition: 'ranked', league_id: leagueId, ...overrides },
      invitees
    );
    expect(result.error).toBeNull();
    return eventId;
  };
  const unranked = async () => (await publishCompetitive(world.owner, world.communityId)).eventId;
  const join = (actor: LeagueActor, eventId: string) =>
    actor.client.rpc('submit_match_registration', { p_match_event_id: eventId });
  const registrations = async (eventId: string, userId: string) =>
    sqlRows(
      `select lifecycle::text, registration_source::text from public.match_event_registrations
        where match_event_id = ${sqlText(eventId)} and user_id = ${sqlText(userId)}`
    );

  it('admits active members and denies nonmembers before persisting anything', async () => {
    const eventId = await ranked();
    expect((await join(world.member, eventId)).error).toBeNull();
    expect((await registrations(eventId, world.member.id))[0]?.['lifecycle']).toBe('accepted');
    for (const denied of [world.outsider, world.former]) {
      const result = await join(denied, eventId);
      expect(result.error?.message).toContain('MATCH_REGISTRATION_RANKED_MEMBERS_ONLY');
      expect(await registrations(eventId, denied.id)).toEqual([]);
    }
  });

  it('keeps public guest requests working on Unranked events', async () => {
    const eventId = await unranked();
    expect((await join(world.outsider, eventId)).error).toBeNull();
    expect(await registrations(eventId, world.outsider.id)).toEqual([
      { lifecycle: 'pending', registration_source: 'guest' }
    ]);
  });

  it('exposes member-only denial through caller capabilities, never a guest CTA or League identity', async () => {
    const eventId = await ranked();
    const guest = await world.outsider.client.rpc('get_match_event', { p_event_id: eventId });
    expect(guest.data).toMatchObject({
      caller_eligibility: 'ranked_members_only',
      caller_requires_approval: false,
      league_id: null,
      league_name: null
    });
    const open = await unranked();
    const control = await world.outsider.client.rpc('get_match_event', { p_event_id: open });
    expect(control.data).toMatchObject({
      caller_eligibility: 'nonmember',
      caller_requires_approval: true
    });
  });

  it('only invites active members (provisional members included) when publishing Ranked', async () => {
    const rejected = await publishCompetitive(
      world.owner,
      world.communityId,
      { competition: 'ranked', league_id: leagueId, visibility: 'invite_only' },
      [world.outsider.id]
    );
    expect(rejected.result.error?.code).toBe('23514');
    const accepted = await publishCompetitive(
      world.owner,
      world.communityId,
      { competition: 'ranked', league_id: leagueId, visibility: 'invite_only' },
      [world.member.id, world.provisional.id]
    );
    expect(accepted.result.error).toBeNull();
  });

  it('refuses a pending Ranked invitation once the invitee is no longer a member', async () => {
    const eventId = await ranked({ visibility: 'invite_only' }, [world.member.id]);
    const invitation = await world.member.client.rpc('get_my_match_invitation', {
      p_match_event_id: eventId
    });
    expect(invitation.data).toMatchObject({ ranked_members_only: false });
    await world.removeMember(world.member);
    const stale = await world.member.client.rpc('get_my_match_invitation', {
      p_match_event_id: eventId
    });
    expect(stale.data ?? { ranked_members_only: true }).toMatchObject({
      ranked_members_only: true
    });
    const invitationId = String(
      invitation.data && typeof invitation.data === 'object'
        ? Reflect.get(invitation.data, 'invitation_id')
        : ''
    );
    const accept = await world.member.client.rpc('respond_match_event_invitation', {
      p_match_event_id: eventId,
      p_invitation_id: invitationId,
      p_response: 'accept'
    });
    expect(accept.error?.message).toContain('MATCH_REGISTRATION_RANKED_MEMBERS_ONLY');
    expect(await registrations(eventId, world.member.id)).toEqual([]);
  });

  it('re-checks current membership at organizer approval (member removed between request and approval)', async () => {
    const requester = await signUpFixtureActor(environment.env!, 'ranked-adm-late', {
      displayName: 'Late Member',
      level: 3
    });
    await executeTrustedSql(
      `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
         values (${sqlText(world.communityId)},${sqlText(requester.id)},'member','active',now()-interval '1 day',now()-interval '1 day')`
    );
    const restricted = { restriction_enabled: true, min_level: 6.5, max_level: 7 };
    const pendingFor = async (eventId: string) => {
      const [row] = await sqlRows(
        `select current_attempt_id::text as attempt, lifecycle::text as lifecycle from public.match_event_registrations
          where match_event_id = ${sqlText(eventId)} and user_id = ${sqlText(requester.id)}`
      );
      return row;
    };
    const decide = (eventId: string, attempt: unknown) =>
      world.owner.client.rpc('decide_match_registration', {
        p_match_event_id: eventId,
        p_attempt_id: String(attempt),
        p_decision: 'approve'
      });

    // Still a member at approval: approved normally.
    const kept = await ranked(restricted);
    expect((await join(requester, kept)).error).toBeNull();
    const request = await pendingFor(kept);
    expect(request?.['lifecycle']).toBe('pending');
    expect((await decide(kept, request?.['attempt'])).error).toBeNull();

    // Removed between request and approval: refused, request stays pending.
    const lost = await ranked(restricted);
    const second = await signUpFixtureActor(environment.env!, 'ranked-adm-gone', {
      displayName: 'Gone Member',
      level: 3
    });
    await executeTrustedSql(
      `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
         values (${sqlText(world.communityId)},${sqlText(second.id)},'member','active',now()-interval '1 day',now()-interval '1 day')`
    );
    expect((await join(second, lost)).error).toBeNull();
    await world.removeMember(second);
    const [gone] = await sqlRows(
      `select current_attempt_id::text as attempt from public.match_event_registrations
        where match_event_id = ${sqlText(lost)} and user_id = ${sqlText(second.id)}`
    );
    const refused = await decide(lost, gone?.['attempt']);
    expect(refused.error?.message).toContain('MATCH_REGISTRATION_REQUESTER_INELIGIBLE');
    expect((await registrations(lost, second.id))[0]?.['lifecycle']).toBe('pending');
  });

  it('admits provisional members as targets but never lets a provisional actor act', async () => {
    const eventId = await ranked();
    await executeTrustedSql(
      `select public.submit_match_registration_locked(${sqlText(eventId)}, ${sqlText(world.provisional.id)})`
    );
    expect((await registrations(eventId, world.provisional.id))[0]?.['lifecycle']).toBe('accepted');
    const asActor = await join(world.provisional, await ranked());
    expect(asActor.error).not.toBeNull();
  });

  it('keeps add-by-email blind while refusing Ranked invitations to registered nonmembers', async () => {
    const eventId = await ranked();
    const outsiderMail = world.outsider.email;
    const blind = await addPlayer(environment.env!, world.owner, {
      eventId,
      displayName: 'Outsider Oz',
      email: outsiderMail,
      level: 3
    });
    expect(blind.command).toMatchObject({ status: 'ok' });
    const [op] = await sqlRows(
      `select outcome from public.match_player_add_operations where match_event_id = ${sqlText(eventId)} and email = ${sqlText(outsiderMail.toLowerCase())}`
    );
    expect(op?.['outcome']).toBe('ranked_members_only');
    expect(
      await sqlRows(
        `select 1 from public.match_event_invites where match_event_id = ${sqlText(eventId)} and invitee_user_id = ${sqlText(world.outsider.id)}`
      )
    ).toEqual([]);

    const fresh = uniqueEmail('ranked-new');
    const added = await addPlayer(environment.env!, world.owner, {
      eventId,
      displayName: 'Ranked Newcomer',
      email: fresh,
      level: 3.5
    });
    expect(added.result).toEqual({ status: 'ok' });
    const [created] = await sqlRows(
      `select r.lifecycle::text as lifecycle from public.match_event_registrations r
        join auth.users u on u.id = r.user_id where r.match_event_id = ${sqlText(eventId)} and lower(u.email) = ${sqlText(fresh.toLowerCase())}`
    );
    expect(created?.['lifecycle']).toBe('accepted');
  });
});
