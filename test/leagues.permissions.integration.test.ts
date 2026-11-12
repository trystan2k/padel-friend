import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  decodeLeagueDetail,
  decodeLeagueDto,
  decodeLeagueList
} from '../src/features/leagues/league-decoders';
import type { Database, Json } from '../src/lib/supabase/database.types';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  createLeagueArgs,
  insertLeague,
  leagueEventActions,
  leagueRow,
  leagueWorld,
  localDate,
  sqlRows,
  type LeagueActor,
  type LeagueWorld
} from './helpers/league-fixtures';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  sqlText
} from './helpers/provisional-player-fixtures';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('League permissions', { timeout: 300_000 }, () => {
  let world: LeagueWorld;

  const create = (
    actor: LeagueActor,
    communityId: string,
    overrides: Parameters<typeof createLeagueArgs>[1] = {}
  ) => actor.client.rpc('create_league', createLeagueArgs(communityId, overrides));
  const manualArgs = { p_end_mode: 'manual', p_end_date: undefined } as const;
  /** A community whose Admin is world.admin and whose ordinary members are the given actors. */
  const communityWith = async (...members: LeagueActor[]) => {
    const id = crypto.randomUUID();
    await insertFixtureCommunity({
      id,
      visibility: 'public',
      adminId: world.admin.id,
      memberIds: members.map((member) => member.id)
    });
    return id;
  };
  const asActor = (actorId: string) =>
    `select set_config('request.jwt.claims', '{"sub":"${actorId}","role":"authenticated"}', true)`;
  const activeCount = async (communityId: string) =>
    Number(
      (
        await sqlRows(
          `select count(*)::int as n from public.leagues where community_id = ${sqlText(communityId)} and status = 'active'`
        )
      )[0]?.['n']
    );
  const version = async (id: string) => Number((await leagueRow(id))['version']);

  beforeAll(async () => {
    if (!environment.env) return;
    world = await leagueWorld(environment.env, 'perms');
  });

  describe('creation', () => {
    it.skipIf(!environment.env)(
      'lets an active member create Fixed and Manual Leagues and own them',
      async () => {
        const fixed = await create(world.owner, world.communityId, {
          p_name: 'Fixed one',
          p_description: 'Weekly',
          p_minimum_matches: 4
        });
        expect(fixed.error).toBeNull();
        expect(decodeLeagueDto(fixed.data)).toMatchObject({
          name: 'Fixed one',
          description: 'Weekly',
          owner_id: world.owner.id,
          end_mode: 'fixed_date',
          status: 'upcoming',
          timezone: 'Europe/Madrid',
          minimum_matches_for_final_award: 4,
          version: 1,
          can_manage: true,
          period_locked: false,
          blocked_reason: null
        });
        const manual = await create(world.owner, world.communityId, {
          ...manualArgs,
          p_name: 'Open one'
        });
        expect(manual.error).toBeNull();
        const dto = decodeLeagueDto(manual.data);
        expect(dto).toMatchObject({
          end_mode: 'manual',
          end_at: null,
          end_date: null,
          owner_id: world.owner.id
        });
        // Omitting the minimum applies the default of 1.
        expect(dto.minimum_matches_for_final_award).toBe(1);
        expect(await leagueEventActions(dto.id)).toEqual(['created']);
        const [audit] = await sqlRows(
          `select actor_id::text as actor from public.league_events where league_id = ${sqlText(dto.id)}`
        );
        expect(audit).toEqual({ actor: world.owner.id });
      }
    );

    it.skipIf(!environment.env)(
      'honors the member-creation setting without blocking Admins, and applies a toggle immediately',
      async () => {
        await world.setMemberCreation(false);
        try {
          const denied = await create(world.owner, world.communityId);
          expect(denied.error).toMatchObject({
            code: '42501',
            message: 'LEAGUE_CREATION_DISABLED'
          });
          const admin = await create(world.admin, world.communityId, { p_name: 'Admin override' });
          expect(admin.error).toBeNull();
          expect(decodeLeagueDto(admin.data).owner_id).toBe(world.admin.id);
          const view = await world.member.client.rpc('list_leagues', {
            p_community_id: world.communityId
          });
          expect(decodeLeagueList(view.data).community).toMatchObject({
            creation_enabled: false,
            can_create: false
          });
          const adminView = await world.admin.client.rpc('list_leagues', {
            p_community_id: world.communityId
          });
          expect(decodeLeagueList(adminView.data).community).toMatchObject({
            creation_enabled: false,
            can_create: true
          });
        } finally {
          await world.setMemberCreation(true);
        }
        expect((await create(world.owner, world.communityId)).error).toBeNull();
      }
    );

    it.skipIf(!environment.env)(
      'denies inactive, non-member, provisional and unauthenticated actors',
      async () => {
        expect((await create(world.former, world.communityId)).error).toMatchObject({
          code: '42501',
          message: 'LEAGUE_FORBIDDEN'
        });
        expect((await create(world.outsider, world.communityId)).error).toMatchObject({
          code: '42501',
          message: 'LEAGUE_FORBIDDEN'
        });
        expect((await create(world.provisional, world.communityId)).error).toMatchObject({
          code: '42501',
          message: 'PROVISIONAL_PLAYER_RESTRICTED'
        });
        const anonymous = createClient<Database>(environment.env!.url, environment.env!.key, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        const result = await anonymous.rpc('create_league', createLeagueArgs(world.communityId));
        expect(result.error).not.toBeNull();
        expect(result.data).toBeNull();
        const [none] = await sqlRows(
          `select count(*)::int as n from public.leagues where owner_id in (${[world.former.id, world.outsider.id, world.provisional.id].map(sqlText).join(',')})`
        );
        expect(none).toEqual({ n: 0 });
      }
    );

    it.skipIf(!environment.env)(
      'refuses a member who does not belong to the target community, even with a valid request',
      async () => {
        const foreign = await communityWith();
        expect((await create(world.owner, foreign)).error?.message).toBe('LEAGUE_FORBIDDEN');
        expect((await create(world.owner, crypto.randomUUID())).error?.message).toBe(
          'LEAGUE_FORBIDDEN'
        );
      }
    );

    it.skipIf(!environment.env)('rejects invalid input with a named condition', async () => {
      const cases: [string, Parameters<typeof createLeagueArgs>[1], string][] = [
        ['blank name', { p_name: '' }, 'LEAGUE_NAME_INVALID'],
        ['untrimmed name', { p_name: ' League' }, 'LEAGUE_NAME_INVALID'],
        ['81-char name', { p_name: 'x'.repeat(81) }, 'LEAGUE_NAME_INVALID'],
        ['blank description', { p_description: '' }, 'LEAGUE_DESCRIPTION_INVALID'],
        ['501-char description', { p_description: 'x'.repeat(501) }, 'LEAGUE_DESCRIPTION_INVALID'],
        ['minimum 0', { p_minimum_matches: 0 }, 'LEAGUE_MINIMUM_INVALID'],
        ['minimum 101', { p_minimum_matches: 101 }, 'LEAGUE_MINIMUM_INVALID'],
        ['unknown mode', { p_end_mode: 'draft' }, 'LEAGUE_END_MODE_INVALID'],
        ['missing end', { p_end_date: undefined }, 'LEAGUE_END_DATE_REQUIRED'],
        [
          'equal end',
          { p_start_date: localDate(10), p_end_date: localDate(10) },
          'LEAGUE_END_NOT_AFTER_START'
        ],
        [
          'reversed end',
          { p_start_date: localDate(10), p_end_date: localDate(5) },
          'LEAGUE_END_NOT_AFTER_START'
        ],
        ['manual with an end', { p_end_mode: 'manual' }, 'LEAGUE_END_DATE_NOT_ALLOWED'],
        [
          'start in the past',
          { p_start_date: localDate(-2), p_end_date: localDate(10) },
          'LEAGUE_START_IN_PAST'
        ],
        [
          'absurd year',
          { p_start_date: '1999-01-01', p_end_date: '2030-01-01' },
          'LEAGUE_START_DATE_INVALID'
        ]
      ];
      for (const [label, overrides, message] of cases) {
        const result = await create(world.owner, world.communityId, overrides);
        expect({ label, error: result.error }).toMatchObject({ error: { code: '22023', message } });
      }
    });

    it.skipIf(!environment.env)(
      'makes creation idempotent per request id and rejects reuse with different details',
      async () => {
        const args = createLeagueArgs(world.communityId, { p_name: 'Idempotent' });
        const first = await world.owner.client.rpc('create_league', args);
        const replay = await world.owner.client.rpc('create_league', args);
        expect(first.error).toBeNull();
        expect(replay.error).toBeNull();
        expect(decodeLeagueDto(replay.data).id).toBe(decodeLeagueDto(first.data).id);
        const [count] = await sqlRows(
          `select count(*)::int as n from public.leagues where create_request_id = ${sqlText(args.p_request_id)}`
        );
        expect(count).toEqual({ n: 1 });
        const changed = await world.owner.client.rpc('create_league', {
          ...args,
          p_name: 'Different'
        });
        expect(changed.error).toMatchObject({ code: 'P0001', message: 'LEAGUE_REQUEST_CONFLICT' });
        // Another actor can use the same id for their own League.
        const other = await world.member.client.rpc('create_league', args);
        expect(other.error).toBeNull();
        expect(decodeLeagueDto(other.data).id).not.toBe(decodeLeagueDto(first.data).id);
      }
    );

    it.skipIf(!environment.env)(
      'activates a League starting today at once and blocks a second one that is due while it is Active',
      async () => {
        const communityId = await communityWith(world.owner);
        const first = decodeLeagueDto(
          (await create(world.owner, communityId, { p_start_date: localDate(0), ...manualArgs }))
            .data
        );
        expect(first).toMatchObject({ status: 'active', blocked_reason: null });
        const second = decodeLeagueDto(
          (await create(world.admin, communityId, { p_start_date: localDate(0), ...manualArgs }))
            .data
        );
        expect(second).toMatchObject({
          status: 'upcoming',
          blocked_reason: 'active_league_exists'
        });
        const later = decodeLeagueDto(
          (await create(world.admin, communityId, { p_start_date: localDate(30), ...manualArgs }))
            .data
        );
        expect(later).toMatchObject({ status: 'upcoming', blocked_reason: null });
        expect(await activeCount(communityId)).toBe(1);
      }
    );
  });

  describe('reading', () => {
    it.skipIf(!environment.env)(
      'shows Leagues to active members only, restricts provisional actors and hides unreadable ones identically',
      async () => {
        const communityId = await communityWith(world.owner, world.member);
        const created = decodeLeagueDto(
          (await create(world.owner, communityId, { p_name: 'Readable' })).data
        );
        for (const actor of [world.owner, world.member, world.admin]) {
          const list = decodeLeagueList(
            (await actor.client.rpc('list_leagues', { p_community_id: communityId })).data
          );
          expect(list.leagues.map((league) => league.id)).toEqual([created.id]);
          const detail = decodeLeagueDetail(
            (await actor.client.rpc('get_league', { p_league_id: created.id })).data
          );
          expect(detail.league.can_manage).toBe(actor !== world.member);
        }
        expect(
          (await world.outsider.client.rpc('list_leagues', { p_community_id: communityId })).error
            ?.message
        ).toBe('LEAGUE_FORBIDDEN');
        expect(
          (await world.former.client.rpc('list_leagues', { p_community_id: communityId })).error
            ?.message
        ).toBe('LEAGUE_FORBIDDEN');
        expect(
          (await world.provisional.client.rpc('list_leagues', { p_community_id: communityId }))
            .error?.message
        ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
        expect(
          (await world.provisional.client.rpc('get_league', { p_league_id: created.id })).error
            ?.message
        ).toBe('PROVISIONAL_PLAYER_RESTRICTED');
        const hidden = await world.outsider.client.rpc('get_league', { p_league_id: created.id });
        const unknown = await world.outsider.client.rpc('get_league', {
          p_league_id: crypto.randomUUID()
        });
        expect(hidden.error).toMatchObject({ code: 'P0002', message: 'LEAGUE_NOT_FOUND' });
        expect(unknown.error).toEqual(hidden.error);
      }
    );

    it.skipIf(!environment.env)(
      'returns Leagues newest-created first (a stable keyset order); sections are ordered by the page',
      async () => {
        const communityId = await communityWith();
        const fixture = (overrides: Partial<Parameters<typeof insertLeague>[0]>) =>
          insertLeague({
            communityId,
            ownerId: world.admin.id,
            startAt: '2030-01-01T00:00:00Z',
            endAt: null,
            ...overrides
          });
        const closedOld = await fixture({
          status: 'closed',
          closedAt: '2030-02-01T00:00:00Z',
          closedBy: world.admin.id
        });
        const upcomingLate = await fixture({ startAt: '2031-06-01T00:00:00Z' });
        const closedNew = await fixture({
          status: 'closed',
          closedAt: '2030-05-01T00:00:00Z',
          closedBy: world.admin.id
        });
        const active = await fixture({ status: 'active' });
        const upcomingSoon = await fixture({ startAt: '2031-01-01T00:00:00Z' });
        const list = decodeLeagueList(
          (await world.admin.client.rpc('list_leagues', { p_community_id: communityId })).data
        );
        expect(list.leagues.map((league) => league.id)).toEqual([
          upcomingSoon,
          active,
          closedNew,
          upcomingLate,
          closedOld
        ]);
      }
    );
  });

  describe('owner and Admin controls', () => {
    it.skipIf(!environment.env)(
      'lets the owner and any Admin edit, but not another member or a non-member',
      async () => {
        const communityId = await communityWith(world.owner, world.member);
        const league = decodeLeagueDto(
          (await create(world.owner, communityId, { p_name: 'Controlled' })).data
        );
        const update = (actor: LeagueActor, expected: number, changes: Json) =>
          actor.client.rpc('update_league', {
            p_league_id: league.id,
            p_expected_version: expected,
            p_changes: changes
          });

        const byOwner = await update(world.owner, 1, {
          name: 'Renamed',
          description: 'Notes',
          minimum_matches_for_final_award: 3
        });
        expect(byOwner.error).toBeNull();
        expect(decodeLeagueDto(byOwner.data)).toMatchObject({
          name: 'Renamed',
          description: 'Notes',
          minimum_matches_for_final_award: 3,
          version: 2
        });
        const byAdmin = await update(world.admin, 2, { description: null });
        expect(byAdmin.error).toBeNull();
        expect(decodeLeagueDto(byAdmin.data)).toMatchObject({ description: null, version: 3 });

        expect((await update(world.member, 3, { name: 'Hijack' })).error).toMatchObject({
          code: '42501',
          message: 'LEAGUE_FORBIDDEN'
        });
        expect((await update(world.outsider, 3, { name: 'Hijack' })).error).toMatchObject({
          code: 'P0002',
          message: 'LEAGUE_NOT_FOUND'
        });
        expect((await update(world.provisional, 3, { name: 'Hijack' })).error?.message).toBe(
          'PROVISIONAL_PLAYER_RESTRICTED'
        );
        expect((await leagueRow(league.id))['name']).toBe('Renamed');
        expect(await leagueEventActions(league.id)).toEqual(['created', 'updated', 'updated']);
      }
    );

    it.skipIf(!environment.env)(
      'rejects stale versions for every command and treats a no-op edit as unchanged',
      async () => {
        const communityId = await communityWith(world.owner);
        const league = decodeLeagueDto(
          (await create(world.owner, communityId, { p_start_date: localDate(0), ...manualArgs }))
            .data
        );
        expect(league.status).toBe('active');
        const staleVersion = { p_league_id: league.id, p_expected_version: 99 };
        const stale = {
          update_league: () =>
            world.owner.client.rpc('update_league', { ...staleVersion, p_changes: { name: 'x' } }),
          close_league: () => world.owner.client.rpc('close_league', staleVersion),
          activate_league: () => world.owner.client.rpc('activate_league', staleVersion)
        };
        for (const [name, call] of Object.entries(stale))
          expect({ name, error: (await call()).error }).toMatchObject({
            error: { code: 'P0001', message: 'LEAGUE_VERSION_CONFLICT' }
          });
        const current = await version(league.id);
        const noop = await world.owner.client.rpc('update_league', {
          p_league_id: league.id,
          p_expected_version: current,
          p_changes: { name: league.name, minimum_matches_for_final_award: 1 }
        });
        expect(noop.error).toBeNull();
        expect(decodeLeagueDto(noop.data).version).toBe(current);
        expect(await leagueEventActions(league.id)).not.toContain('updated');
        // Two writers with the same version: exactly one wins.
        const [one, two] = await Promise.all([
          world.owner.client.rpc('update_league', {
            p_league_id: league.id,
            p_expected_version: current,
            p_changes: { name: 'Winner A' }
          }),
          world.admin.client.rpc('update_league', {
            p_league_id: league.id,
            p_expected_version: current,
            p_changes: { name: 'Winner B' }
          })
        ]);
        expect([one.error, two.error].filter(Boolean)).toHaveLength(1);
        expect([one.error, two.error].find(Boolean)).toMatchObject({
          message: 'LEAGUE_VERSION_CONFLICT'
        });
      }
    );

    it.skipIf(!environment.env)(
      'validates edits and enforces what may still change per status',
      async () => {
        const communityId = await communityWith(world.owner);
        const upcoming = decodeLeagueDto(
          (
            await create(world.owner, communityId, {
              p_start_date: localDate(20),
              p_end_date: localDate(40)
            })
          ).data
        );
        const edit = (id: string, expected: number, changes: Json) =>
          world.owner.client.rpc('update_league', {
            p_league_id: id,
            p_expected_version: expected,
            p_changes: changes
          });

        expect((await edit(upcoming.id, 1, {})).error?.message).toBe('LEAGUE_CHANGES_INVALID');
        expect((await edit(upcoming.id, 1, { owner_id: world.member.id })).error?.message).toBe(
          'LEAGUE_CHANGES_INVALID'
        );
        expect((await edit(upcoming.id, 1, { name: 5 })).error?.message).toBe(
          'LEAGUE_CHANGES_INVALID'
        );
        expect((await edit(upcoming.id, 1, { name: ' ' })).error?.message).toBe(
          'LEAGUE_NAME_INVALID'
        );
        expect(
          (await edit(upcoming.id, 1, { minimum_matches_for_final_award: 0 })).error?.message
        ).toBe('LEAGUE_MINIMUM_INVALID');
        expect((await edit(upcoming.id, 1, { end_date: localDate(10) })).error?.message).toBe(
          'LEAGUE_END_NOT_AFTER_START'
        );
        expect((await edit(upcoming.id, 1, { start_date: localDate(-3) })).error?.message).toBe(
          'LEAGUE_START_IN_PAST'
        );
        expect(
          (await edit(upcoming.id, 1, { end_mode: 'manual', end_date: localDate(50) })).error
            ?.message
        ).toBe('LEAGUE_END_DATE_NOT_ALLOWED');
        expect((await edit(upcoming.id, 1, { end_mode: 'weekly' })).error?.message).toBe(
          'LEAGUE_END_MODE_INVALID'
        );
        expect((await edit(upcoming.id, 1, { start_date: 'garbage' })).error?.message).toBe(
          'LEAGUE_CHANGES_INVALID'
        );

        // An Upcoming League can still move its whole period and switch mode while nothing references it.
        const moved = await edit(upcoming.id, 1, {
          start_date: localDate(25),
          end_date: localDate(45)
        });
        expect(decodeLeagueDto(moved.data)).toMatchObject({
          start_date: localDate(25),
          end_date: localDate(45),
          version: 2
        });
        const toManual = await edit(upcoming.id, 2, { end_mode: 'manual', end_date: null });
        expect(decodeLeagueDto(toManual.data)).toMatchObject({
          end_mode: 'manual',
          end_at: null,
          version: 3
        });
        const toFixed = await edit(upcoming.id, 3, {
          end_mode: 'fixed_date',
          end_date: localDate(60)
        });
        expect(decodeLeagueDto(toFixed.data)).toMatchObject({
          end_mode: 'fixed_date',
          end_date: localDate(60),
          version: 4
        });

        // An Active League has started: its start is frozen, its end still editable.
        const active = decodeLeagueDto(
          (
            await create(world.admin, await communityWith(), {
              p_start_date: localDate(0),
              p_end_date: localDate(30)
            })
          ).data
        );
        expect(active.status).toBe('active');
        const startLocked = await world.admin.client.rpc('update_league', {
          p_league_id: active.id,
          p_expected_version: active.version,
          p_changes: { start_date: localDate(1) }
        });
        expect(startLocked.error).toMatchObject({ code: '55000', message: 'LEAGUE_START_LOCKED' });
        const endInPast = await world.admin.client.rpc('update_league', {
          p_league_id: active.id,
          p_expected_version: active.version,
          p_changes: { end_date: localDate(-1) }
        });
        expect(endInPast.error?.message).toMatch(/LEAGUE_END_IN_PAST|LEAGUE_END_NOT_AFTER_START/);
        const extended = await world.admin.client.rpc('update_league', {
          p_league_id: active.id,
          p_expected_version: active.version,
          p_changes: { end_date: localDate(90) }
        });
        expect(decodeLeagueDto(extended.data)).toMatchObject({
          end_date: localDate(90),
          status: 'active'
        });

        // Closed Leagues accept no edits.
        const closed = await insertLeague({
          communityId,
          ownerId: world.owner.id,
          startAt: '2030-01-01T00:00:00Z',
          endAt: null,
          status: 'closed',
          closedAt: '2030-02-01T00:00:00Z',
          closedBy: world.owner.id
        });
        expect((await edit(closed, 1, { name: 'Late' })).error).toMatchObject({
          code: '55000',
          message: 'LEAGUE_INVALID_STATE'
        });
      }
    );

    it.skipIf(!environment.env)(
      'freezes start, end mode and end once a published event references the League',
      async () => {
        const communityId = await communityWith(world.owner);
        const league = decodeLeagueDto(
          (
            await create(world.owner, communityId, {
              p_start_date: localDate(20),
              p_end_date: localDate(40)
            })
          ).data
        );
        const eventId = crypto.randomUUID();
        await insertFixtureEvent({
          id: eventId,
          communityId,
          creatorId: world.admin.id,
          visibility: 'community_open'
        });
        const [before] = await sqlRows(
          `select public.league_has_published_events(${sqlText(league.id)}) as referenced`
        );
        expect(before).toEqual({ referenced: false });

        const connection = await openDedicatedSqlConnection();
        try {
          await connection.query('begin');
          // Bind a real published event to the League inside this rolled-back transaction.
          const bound = crypto.randomUUID();
          const photo = matchPhotoFixture(communityId, bound, world.admin.id);
          await connection.query(photo.sql);
          await connection.query(
            `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,league_id,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
               select ${sqlText(bound)}, ${sqlText(communityId)}, ${sqlText(world.admin.id)}, l.start_at + interval '1 day', 'UTC', 'competitive', l.id,
                      'community_open', 'POST_MATCH_TEAMS', 'Bound court', 'https://maps.google.com/maps/place/bound', ${sqlText(photo.path)}, l.start_at + interval '12 hours'
                 from public.leagues l where l.id = ${sqlText(league.id)}`
          );
          await connection.query(asActor(world.owner.id));
          const [after] = (
            await connection.query(
              `select public.league_has_published_events(${sqlText(league.id)}) as referenced`
            )
          ).rows;
          expect(after).toEqual({ referenced: true });
          const detail = await connection.query(
            `select public.get_league(${sqlText(league.id)}) as detail`
          );
          expect(decodeLeagueDetail(detail.rows[0]?.['detail']).league.period_locked).toBe(true);
          // Name, description and minimum matches stay editable.
          const renamed = await connection.query(
            `select public.update_league(${sqlText(league.id)}, 1, '{"name":"Still editable","minimum_matches_for_final_award":2}'::jsonb) as league`
          );
          expect(decodeLeagueDto(renamed.rows[0]?.['league']).name).toBe('Still editable');
          // Any actual period change is refused (attempts run in sub-transactions so the test txn survives).
          await connection.query(`create function pg_temp.attempt(p_version integer, p_changes jsonb) returns text
          language plpgsql as $f$ begin
            perform public.update_league(${sqlText(league.id)}, p_version, p_changes); return 'ok';
          exception when others then return sqlerrm; end $f$`);
          for (const changes of [
            { start_date: localDate(21) },
            { end_date: localDate(41) },
            { end_mode: 'manual', end_date: null }
          ]) {
            const attempt = await connection.query(
              `select pg_temp.attempt(2, ${sqlText(JSON.stringify(changes))}::jsonb) as outcome`
            );
            expect(attempt.rows[0]).toEqual({ outcome: 'LEAGUE_PERIOD_LOCKED' });
          }
          // Restating the current period is not a change.
          const same = await connection.query(
            `select public.update_league(${sqlText(league.id)}, 2, ${sqlText(JSON.stringify({ start_date: localDate(20), end_date: localDate(40), minimum_matches_for_final_award: 3 }))}::jsonb) as league`
          );
          expect(decodeLeagueDto(same.rows[0]?.['league'])).toMatchObject({
            minimum_matches_for_final_award: 3,
            version: 3
          });
        } finally {
          await connection.query('rollback').catch(() => undefined);
          await connection.close();
        }
        expect((await leagueRow(league.id))['name']).not.toBe('Still editable');
      }
    );
  });

  describe('membership and setting changes cannot bypass the recheck', () => {
    it.skipIf(!environment.env)(
      'ends owner rights when the owner leaves the community, while an Admin keeps control',
      async () => {
        const communityId = await communityWith(world.owner);
        const upcoming = decodeLeagueDto(
          (
            await create(world.owner, communityId, {
              p_start_date: localDate(20),
              p_end_date: localDate(40)
            })
          ).data
        );
        const manual = decodeLeagueDto(
          (await create(world.owner, communityId, { p_start_date: localDate(0), ...manualArgs }))
            .data
        );
        expect(manual.status).toBe('active');

        const [membership] = await sqlRows(
          `select id::text as id from public.community_members where community_id = ${sqlText(communityId)} and user_id = ${sqlText(world.owner.id)} and valid_until is null`
        );
        const removed = await world.admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: String(membership?.['id']),
          p_action: 'remove'
        });
        expect(removed.error).toBeNull();

        const stale = await world.owner.client.rpc('update_league', {
          p_league_id: upcoming.id,
          p_expected_version: 1,
          p_changes: { name: 'Still mine' }
        });
        expect(stale.error).toMatchObject({ code: 'P0002', message: 'LEAGUE_NOT_FOUND' });
        expect(
          (
            await world.owner.client.rpc('close_league', {
              p_league_id: manual.id,
              p_expected_version: manual.version
            })
          ).error?.message
        ).toBe('LEAGUE_NOT_FOUND');
        expect(
          (await world.owner.client.rpc('get_league', { p_league_id: upcoming.id })).error?.message
        ).toBe('LEAGUE_NOT_FOUND');
        expect(
          (await world.owner.client.rpc('list_leagues', { p_community_id: communityId })).error
            ?.message
        ).toBe('LEAGUE_FORBIDDEN');
        expect((await create(world.owner, communityId)).error?.message).toBe('LEAGUE_FORBIDDEN');
        // The League survives its owner's departure and the Admin controls it; ownership is unchanged.
        const adminClose = await world.admin.client.rpc('close_league', {
          p_league_id: manual.id,
          p_expected_version: manual.version
        });
        expect(adminClose.error).toBeNull();
        expect(decodeLeagueDto(adminClose.data)).toMatchObject({
          status: 'closed',
          owner_id: world.owner.id
        });
        expect(
          (
            await world.admin.client.rpc('update_league', {
              p_league_id: upcoming.id,
              p_expected_version: 1,
              p_changes: { name: 'Admin edit' }
            })
          ).error
        ).toBeNull();
      }
    );

    it.skipIf(!environment.env)(
      'rechecks the creation setting under the community lock when a toggle races a create',
      async () => {
        const communityId = await communityWith(world.owner);
        const holder = await openDedicatedSqlConnection();
        try {
          await holder.query('begin');
          await holder.query(asActor(world.admin.id));
          await holder.query(
            `select public.update_community_admin_defaults(${sqlText(communityId)},
             '{"timezone":"Europe/Madrid","currency":"EUR","member_created_leagues_enabled":false}'::jsonb)`
          );
          let settled = false;
          const pending = create(world.owner, communityId).then((result) => {
            settled = true;
            return result;
          });
          await delay(700);
          expect(settled, 'creation must wait for the uncommitted setting change').toBe(false);
          await holder.query('commit');
          const result = await pending;
          expect(result.error).toMatchObject({
            code: '42501',
            message: 'LEAGUE_CREATION_DISABLED'
          });
        } finally {
          await holder.query('rollback').catch(() => undefined);
          await holder.close();
        }
        const [count] = await sqlRows(
          `select count(*)::int as n from public.leagues where community_id = ${sqlText(communityId)}`
        );
        expect(count).toEqual({ n: 0 });
      }
    );

    it.skipIf(!environment.env)(
      'rechecks membership under the community lock when a removal races a create',
      async () => {
        const communityId = await communityWith(world.owner);
        const [membership] = await sqlRows(
          `select id::text as id from public.community_members where community_id = ${sqlText(communityId)} and user_id = ${sqlText(world.owner.id)} and valid_until is null`
        );
        const holder = await openDedicatedSqlConnection();
        try {
          await holder.query('begin');
          await holder.query(asActor(world.admin.id));
          await holder.query(
            `select * from public.govern_community_member(${sqlText(communityId)}, ${sqlText(String(membership?.['id']))}, 'remove')`
          );
          let settled = false;
          const pending = create(world.owner, communityId).then((result) => {
            settled = true;
            return result;
          });
          await delay(700);
          expect(settled).toBe(false);
          await holder.query('commit');
          expect((await pending).error).toMatchObject({
            code: '42501',
            message: 'LEAGUE_FORBIDDEN'
          });
        } finally {
          await holder.query('rollback').catch(() => undefined);
          await holder.close();
        }
        expect(await activeCount(communityId)).toBe(0);
      }
    );
  });

  describe('concurrency', () => {
    it.skipIf(!environment.env)(
      'never yields two Active Leagues when several creations are due at the same moment',
      async () => {
        const communityId = await communityWith(world.owner, world.member);
        const results = await Promise.all(
          [world.owner, world.member, world.admin, world.owner, world.member, world.admin].map(
            (actor) => create(actor, communityId, { p_start_date: localDate(0), ...manualArgs })
          )
        );
        expect(results.map((result) => result.error)).toEqual(results.map(() => null));
        const dtos = results.map((result) => decodeLeagueDto(result.data));
        expect(dtos.filter((dto) => dto.status === 'active')).toHaveLength(1);
        expect(
          dtos.filter(
            (dto) => dto.status === 'upcoming' && dto.blocked_reason === 'active_league_exists'
          )
        ).toHaveLength(5);
        expect(await activeCount(communityId)).toBe(1);
      }
    );

    it.skipIf(!environment.env)(
      'never yields two Active Leagues when an explicit activation races a due creation',
      async () => {
        for (let round = 0; round < 3; round += 1) {
          const communityId = await communityWith(world.owner);
          const waiting = await insertLeague({
            communityId,
            ownerId: world.admin.id,
            startAt: '2024-01-01T00:00:00Z',
            endAt: null,
            blocked: true
          });
          const [activation, creation] = await Promise.all([
            world.admin.client.rpc('activate_league', {
              p_league_id: waiting,
              p_expected_version: 1
            }),
            create(world.owner, communityId, { p_start_date: localDate(0), ...manualArgs })
          ]);
          expect(creation.error).toBeNull();
          expect(await activeCount(communityId), `round ${round}`).toBe(1);
          expect([undefined, 'LEAGUE_ACTIVE_EXISTS']).toContain(activation.error?.message);
        }
      }
    );
  });

  describe('provisional actors', () => {
    it.skipIf(!environment.env)('cannot call any League command or reader', async () => {
      const communityId = world.communityId;
      const league = decodeLeagueDto(
        (await create(world.admin, communityId, { p_name: 'For provisional' })).data
      );
      const calls = [
        world.provisional.client.rpc('create_league', createLeagueArgs(communityId)),
        world.provisional.client.rpc('list_leagues', { p_community_id: communityId }),
        world.provisional.client.rpc('get_league', { p_league_id: league.id }),
        world.provisional.client.rpc('update_league', {
          p_league_id: league.id,
          p_expected_version: 1,
          p_changes: { name: 'x' }
        }),
        world.provisional.client.rpc('activate_league', {
          p_league_id: league.id,
          p_expected_version: 1
        }),
        world.provisional.client.rpc('close_league', {
          p_league_id: league.id,
          p_expected_version: 1
        })
      ];
      for (const result of await Promise.all(calls))
        expect(result.error).toMatchObject({
          code: '42501',
          message: 'PROVISIONAL_PLAYER_RESTRICTED'
        });
    });
  });
});
