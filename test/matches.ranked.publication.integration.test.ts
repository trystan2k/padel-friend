import { beforeAll, describe, expect, it } from 'vitest';
import {
  insertLeague,
  leagueWorld,
  sqlRows,
  type LeagueActor,
  type LeagueWorld
} from './helpers/league-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { insertFixtureEvent, sqlText } from './helpers/provisional-player-fixtures';
import { isoDay, publishCompetitive, sqlMessage } from './helpers/ranked-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();
const day = (offset: number) => `${isoDay(offset)}T00:00:00Z`;

describe.skipIf(!environment.env)('Ranked event publication', { timeout: 300_000 }, () => {
  let world: LeagueWorld;
  let owner: LeagueActor;

  beforeAll(async () => {
    world = await leagueWorld(environment.env!, 'ranked-pub');
    await world.setTimezone('UTC');
    owner = world.owner;
  });

  const league = (
    overrides: Parameters<typeof insertLeague>[0] extends infer T ? Partial<T> : never = {}
  ) =>
    insertLeague({
      communityId: world.communityId,
      ownerId: owner.id,
      status: 'upcoming',
      startAt: day(-5),
      endAt: day(60),
      ...overrides
    });
  const leagueOf = async (eventId: string) =>
    (
      await sqlRows(
        `select league_id::text as id from public.match_events where id = ${sqlText(eventId)}`
      )
    )[0]?.['id'] ?? null;
  const ratingSnapshot = async () =>
    JSON.stringify(
      await sqlRows(
        `select user_id::text, display_level::text from public.global_player_ratings
          where user_id in (${[world.admin, world.owner, world.member].map((a) => sqlText(a.id)).join(',')}) order by user_id`
      )
    );

  it('publishes Unranked events with a null association by default and when explicitly requested', async () => {
    const unusedLeague = await league();
    const legacy = (await publishCompetitive(owner, world.communityId, { competition: undefined }))
      .eventId;
    const explicit = (
      await publishCompetitive(owner, world.communityId, {
        competition: 'unranked',
        league_id: null
      })
    ).eventId;
    expect(await leagueOf(legacy)).toBeNull();
    expect(await leagueOf(explicit)).toBeNull();
    // A League that already exists never claims events it was not selected for.
    expect(unusedLeague).toBeTruthy();
    const detail = await owner.client.rpc('get_match_event', { p_event_id: explicit });
    expect(detail.data).toMatchObject({
      competition_status: 'unranked',
      league_id: null,
      league_name: null
    });
  });

  it('binds a Ranked event to the explicit League and exposes it only to active members', async () => {
    const leagueId = await league({ name: 'Ranked Pub League' });
    const before = await ratingSnapshot();
    const { eventId, result } = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: leagueId
    });
    expect(result.error).toBeNull();
    expect(await leagueOf(eventId)).toBe(leagueId);
    const member = await world.member.client.rpc('get_match_event', { p_event_id: eventId });
    expect(member.data).toMatchObject({
      competition_status: 'ranked',
      league_id: leagueId,
      league_name: 'Ranked Pub League'
    });
    const guest = await world.outsider.client.rpc('get_match_event', { p_event_id: eventId });
    expect(guest.data).toMatchObject({
      competition_status: 'ranked',
      league_id: null,
      league_name: null
    });
    const listed = await owner.client.rpc('list_match_events', {
      p_entry: 'my',
      p_community_id: world.communityId
    });
    expect(JSON.stringify(listed.data)).toContain(leagueId);
    // Global ratings are independent of League binding.
    expect(await ratingSnapshot()).toBe(before);
  });

  it('rejects incoherent competition intent with stable tokens', async () => {
    const leagueId = await league();
    const attempt = async (overrides: Record<string, unknown>) =>
      (await publishCompetitive(owner, world.communityId, overrides)).result.error?.message;
    expect(await attempt({ competition: 'ranked' })).toBe('MATCH_LEAGUE_SELECTION_REQUIRED');
    expect(await attempt({ competition: 'ranked', league_id: null })).toBe(
      'MATCH_LEAGUE_SELECTION_REQUIRED'
    );
    expect(await attempt({ competition: 'unranked', league_id: leagueId })).toBe(
      'MATCH_LEAGUE_INTENT_CONFLICT'
    );
    expect(
      await attempt({ event_type: 'friendly', league_id: leagueId, competition: undefined })
    ).toBe('MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED');
    expect(
      await attempt({ event_type: 'friendly', competition: 'ranked', league_id: leagueId })
    ).toBe('MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED');
    expect(
      (await publishCompetitive(owner, world.communityId, { competition: 'casual' })).result.error
        ?.code
    ).toBe('22023');
    expect(
      (
        await publishCompetitive(owner, world.communityId, {
          competition: 'ranked',
          league_id: 'nope'
        })
      ).result.error?.code
    ).toBe('22023');
  });

  it('rejects unknown, cross-community, closed and out-of-period Leagues under the publication locks', async () => {
    const rank = (leagueId: string, overrides: Record<string, unknown> = {}) =>
      publishCompetitive(owner, world.communityId, {
        competition: 'ranked',
        league_id: leagueId,
        ...overrides
      }).then((r) => r.result.error?.message);
    expect(await rank(crypto.randomUUID())).toBe('MATCH_LEAGUE_NOT_FOUND');

    const otherCommunity = await world.newCommunity(world.admin.id);
    const foreign = await insertLeague({
      communityId: otherCommunity,
      ownerId: world.admin.id,
      status: 'active',
      startAt: day(-5),
      endAt: day(60)
    });
    expect(await rank(foreign)).toBe('MATCH_LEAGUE_NOT_FOUND');

    const closed = await league({
      status: 'closed',
      closedAt: day(-1),
      endAt: day(-1),
      startAt: day(-30)
    });
    expect(await rank(closed)).toBe('MATCH_LEAGUE_CLOSED');

    const ended = await league({ endAt: day(1) });
    expect(await rank(ended)).toBe('MATCH_LEAGUE_OUT_OF_PERIOD');

    const later = await league({ status: 'upcoming', startAt: day(20), endAt: day(40) });
    expect(await rank(later)).toBe('MATCH_LEAGUE_OUT_OF_PERIOD');
    // The same Upcoming League is valid once the event starts inside its window (start inclusive).
    const ok = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: later,
      date: isoDay(21)
    });
    expect(ok.result.error).toBeNull();
    expect(await leagueOf(ok.eventId)).toBe(later);
  });

  it('treats a Fixed end as inclusive and a Manual League as open-ended', async () => {
    const fixedEnd = await league({
      startAt: day(-5),
      endAt: `${isoDay(10)}T23:59:59.999999Z`
    });
    const lastDay = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: fixedEnd,
      date: isoDay(10),
      start_time: '23:59'
    });
    expect(lastDay.result.error).toBeNull();
    const pastEnd = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: fixedEnd,
      date: isoDay(11)
    });
    expect(pastEnd.result.error?.message).toBe('MATCH_LEAGUE_OUT_OF_PERIOD');
    const manual = await league({ endMode: 'manual', endAt: null });
    const far = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: manual,
      date: isoDay(400)
    });
    expect(far.result.error).toBeNull();
  });

  it('makes publish retries idempotent and fails closed on a same-ID conflicting intent', async () => {
    const first = await league({ name: 'Retry A' });
    const second = await league({ name: 'Retry B', status: 'upcoming', startAt: day(-2) });
    const { eventId, result } = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: first
    });
    expect(result.error).toBeNull();
    // Exact retry (new staged photo object, same stored photo path is required for equality).
    const stored = (
      await sqlRows(`select photo_path from public.match_events where id = ${sqlText(eventId)}`)
    )[0]?.['photo_path'];
    const replay = await owner.client.rpc('publish_match_event', {
      p_event_id: eventId,
      p_input: {
        community_id: world.communityId,
        date: isoDay(3),
        start_time: '10:00',
        event_type: 'competitive',
        competition: 'ranked',
        league_id: first,
        visibility: 'community_open',
        team_assignment_mode: 'POST_MATCH_TEAMS',
        venue_name: 'Ranked court',
        maps_url: 'https://maps.google.com/maps/place/ranked-fixture',
        photo_path: String(stored)
      },
      p_invitee_ids: []
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(eventId);
    const send = (input: Record<string, unknown>) =>
      owner.client.rpc('publish_match_event', {
        p_event_id: eventId,
        p_input: {
          community_id: world.communityId,
          date: isoDay(3),
          start_time: '10:00',
          event_type: 'competitive',
          visibility: 'community_open',
          team_assignment_mode: 'POST_MATCH_TEAMS',
          venue_name: 'Ranked court',
          maps_url: 'https://maps.google.com/maps/place/ranked-fixture',
          photo_path: String(stored),
          ...input
        },
        p_invitee_ids: []
      });
    expect((await send({ competition: 'ranked', league_id: second })).error?.message).toBe(
      'MATCH_CONFLICT'
    );
    expect((await send({ competition: 'unranked' })).error?.message).toBe('MATCH_CONFLICT');
    expect((await send({})).error?.message).toBe('MATCH_CONFLICT');
    expect(await leagueOf(eventId)).toBe(first);

    // A retry after the League closed still replays the stored event instead of re-validating it.
    await executeTrustedSql(
      `update public.leagues set status = 'closed', closed_at = now(), closed_reason = 'fixed_end_reached', activation_blocked_at = null where id = ${sqlText(first)}`
    );
    expect((await send({ competition: 'ranked', league_id: first })).error).toBeNull();
  });

  it('cannot attach a later-created League to an earlier event by any route', async () => {
    const before = crypto.randomUUID();
    await insertFixtureEvent({
      id: before,
      communityId: world.communityId,
      creatorId: owner.id,
      visibility: 'community_open'
    });
    const { eventId } = await publishCompetitive(owner, world.communityId);
    const created = await league({ name: 'Created later' });
    for (const id of [before, eventId]) {
      expect(await leagueOf(id)).toBeNull();
      // Direct column update (even trusted, even with a valid version bump) is rejected.
      expect(
        await sqlMessage(
          `update public.match_events set league_id = ${sqlText(created)}, version = version + 1 where id = ${sqlText(id)}`
        )
      ).toContain('Invalid match event mutation');
      // Browser roles hold no write privilege on the table at all.
      const tamper = await owner.client
        .from('match_events')
        .update({ league_id: created })
        .eq('id', id);
      expect(tamper.error).not.toBeNull();
      expect(await leagueOf(id)).toBeNull();
    }
    // Republishing the stored event with the new League is a conflict, never a rebinding.
    const stored = (
      await sqlRows(`select photo_path from public.match_events where id = ${sqlText(eventId)}`)
    )[0]?.['photo_path'];
    const rebind = await owner.client.rpc('publish_match_event', {
      p_event_id: eventId,
      p_input: {
        community_id: world.communityId,
        date: isoDay(3),
        start_time: '10:00',
        event_type: 'competitive',
        competition: 'ranked',
        league_id: created,
        visibility: 'community_open',
        team_assignment_mode: 'POST_MATCH_TEAMS',
        venue_name: 'Ranked court',
        maps_url: 'https://maps.google.com/maps/place/ranked-fixture',
        photo_path: String(stored)
      },
      p_invitee_ids: []
    });
    expect(rebind.error?.message).toBe('MATCH_CONFLICT');
    expect(await leagueOf(eventId)).toBeNull();
  });

  it('enforces the binding on direct inserts, retimes and type changes', async () => {
    const leagueId = await league({ endAt: day(30) });
    const { eventId } = await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: leagueId,
      date: isoDay(3)
    });
    expect(
      await sqlMessage(
        `update public.match_events set starts_at = now() + interval '90 days', version = version + 1 where id = ${sqlText(eventId)}`
      )
    ).toContain('MATCH_LEAGUE_OUT_OF_PERIOD');
    expect(
      await sqlMessage(
        `update public.match_events set event_type = 'friendly', version = version + 1 where id = ${sqlText(eventId)}`
      )
    ).toContain('MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED');
    expect(
      await sqlMessage(
        `update public.match_events set starts_at = starts_at + interval '1 day', version = version + 1 where id = ${sqlText(eventId)}`
      )
    ).toBeNull();
    expect(
      await sqlMessage(`insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,league_id,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
      values (gen_random_uuid(), ${sqlText(world.communityId)}, ${sqlText(owner.id)}, now() + interval '3 days', 'UTC', 'friendly', ${sqlText(leagueId)}, 'community_open', 'POST_MATCH_TEAMS', 'v', 'https://maps.google.com/maps/place/x', 'x', now() + interval '2 days')`)
    ).not.toBeNull();
  });

  it('activates the Q4 period lock once a published event references the League', async () => {
    const leagueId = await league({
      status: 'upcoming',
      startAt: day(2),
      endAt: day(40),
      name: 'Locked soon'
    });
    const [row] = await sqlRows(
      `select version from public.leagues where id = ${sqlText(leagueId)}`
    );
    const version = Number(row?.['version']);
    const stretched = await owner.client.rpc('update_league', {
      p_league_id: leagueId,
      p_expected_version: version,
      p_changes: { end_date: isoDay(45) }
    });
    expect(stretched.error).toBeNull();
    await publishCompetitive(owner, world.communityId, {
      competition: 'ranked',
      league_id: leagueId,
      date: isoDay(5)
    }).then((r) => expect(r.result.error).toBeNull());
    const [next] = await sqlRows(
      `select version from public.leagues where id = ${sqlText(leagueId)}`
    );
    const locked = await owner.client.rpc('update_league', {
      p_league_id: leagueId,
      p_expected_version: Number(next?.['version']),
      p_changes: { end_date: isoDay(50) }
    });
    expect(locked.error?.message).toBe('LEAGUE_PERIOD_LOCKED');
    const renamed = await owner.client.rpc('update_league', {
      p_league_id: leagueId,
      p_expected_version: Number(next?.['version']),
      p_changes: { name: 'Still editable' }
    });
    expect(renamed.error).toBeNull();
  });

  describe('eligible League options', () => {
    const options = (
      actor: LeagueActor,
      date = isoDay(5),
      time = '10:00',
      community = world.communityId
    ) =>
      actor.client.rpc('list_match_league_options', {
        p_community_id: community,
        p_date: date,
        p_start_time: time
      });
    const names = (data: unknown): string[] => {
      const leagues = typeof data === 'object' && data !== null ? Reflect.get(data, 'leagues') : [];
      return Array.isArray(leagues)
        ? leagues.map((entry) => String(Reflect.get(entry, 'name')))
        : [];
    };

    it('lists only Active/Upcoming Leagues of this community covering the intended start', async () => {
      await league({ name: 'Opt in-window', status: 'active' });
      await league({
        name: 'Opt upcoming',
        status: 'upcoming',
        startAt: day(2),
        endAt: day(30)
      });
      await league({
        name: 'Opt too late',
        status: 'upcoming',
        startAt: day(20),
        endAt: day(30)
      });
      await league({ name: 'Opt too early', startAt: day(-30), endAt: day(1) });
      await league({
        name: 'Opt closed',
        status: 'closed',
        startAt: day(-30),
        endAt: day(30),
        closedAt: day(30)
      });
      const foreignCommunity = await world.newCommunity(world.admin.id);
      await insertLeague({
        communityId: foreignCommunity,
        ownerId: world.admin.id,
        name: 'Opt foreign',
        status: 'active',
        startAt: day(-5),
        endAt: day(60)
      });
      const result = await options(owner);
      expect(result.error).toBeNull();
      const listed = names(result.data).filter((name) => name.startsWith('Opt '));
      expect(listed.sort()).toEqual(['Opt in-window', 'Opt upcoming']);
      expect(result.data).toMatchObject({ starts_at: `${isoDay(5)}T10:00:00.000000Z` });
    });

    it('converts the community-local start to UTC and rejects invalid input and outsiders', async () => {
      await world.setTimezone('Europe/Madrid');
      const summer = await options(owner, `${new Date().getUTCFullYear() + 1}-07-01`, '10:00');
      expect(summer.data).toMatchObject({
        starts_at: `${new Date().getUTCFullYear() + 1}-07-01T08:00:00.000000Z`
      });
      await world.setTimezone('UTC');
      expect((await options(owner, '2030-02-31')).error?.code).toBe('22023');
      expect((await options(owner, isoDay(5), '25:00')).error?.code).toBe('22023');
      expect((await options(world.outsider)).error?.code).toBe('42501');
      expect((await options(world.former)).error?.code).toBe('42501');
      // Provisional sessions are restricted actors.
      expect((await options(world.provisional)).error).not.toBeNull();
    });
  });
});
