import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  insertFixtureEvent,
  provisionProvisionalPlayer,
  sqlText
} from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { communityMemberGuard, withTriggersDisabled } from './helpers/trigger-state-sql';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const L = (id: string) => sqlText(id);
const incompleteSets = [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }];
const deniedLeague = { code: 'P0002', message: 'LEAGUE_NOT_FOUND' };

/**
 * PAF-173: a former community member reads, read-only, the Leagues they actually played in
 * (earned counter row or a confirmed group of a League event) and nothing else of the community.
 * Group 1 = players 0-3, group 2 = players 4-7; player 0 is the retained Admin and League owner.
 */
describe.skipIf(!environment.env)('League former-participant reads', { timeout: 600_000 }, () => {
  let kit: RankedResultKit;
  let closedLeague: string; // closed, published versions 1 and 2 (group 2 confirmed late)
  let openLeague: string; // active, group 1 confirmed
  let idleLeague: string; // nobody played
  let incompleteLeague: string; // only a confirmed Incomplete group (no earned counter row)
  let pendingLeague: string; // only a pending (unconfirmed) group
  let rejectedLeague: string; // only a rejected group (player 4 played it, never confirmed)

  const id = (index: number) => kit.players[index]!.id;
  const who = (index: number) => kit.players[index]!;
  // players 3, 4, 5 and 7 leave; players 0 (Admin), 1, 2 and 6 stay members.
  const FORMER = 3;
  const MEMBER = 6;

  async function confirmGroup(
    eventId: string,
    groupNumber: number,
    options: { sets?: unknown; approve?: boolean } = {}
  ) {
    const submitted = await kit.submit(eventId, playedAt(120).played, {
      groupNumber,
      ...(options.sets ? { sets: options.sets } : {})
    });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    if (options.approve === false) return proposalId;
    const first = (groupNumber - 1) * 4;
    if (groupNumber === 1) {
      expect((await kit.approve(proposalId, 1, kit.players[first + 2])).error).toBeNull();
    } else {
      expect((await kit.approve(proposalId, 1, kit.players[first])).error).toBeNull();
      expect((await kit.approve(proposalId, 1, kit.players[first + 2])).error).toBeNull();
    }
    return proposalId;
  }
  const rpc = (actorIndex: number, name: string, args: Record<string, unknown>) =>
    kit.rpc(who(actorIndex), name, args);
  const read = async (actorIndex: number, leagueId: string, version?: number) => {
    const [detail, standings, counters, versions] = await Promise.all([
      rpc(actorIndex, 'get_league', { p_league_id: leagueId }),
      rpc(actorIndex, 'get_league_standings', {
        p_league_id: leagueId,
        p_standings_version: version ?? null
      }),
      rpc(actorIndex, 'get_league_counters', { p_league_id: leagueId }),
      rpc(actorIndex, 'list_league_standings_versions', {
        p_league_id: leagueId,
        p_before_version: null
      })
    ]);
    return { detail, standings, counters, versions, all: [detail, standings, counters, versions] };
  };
  const leave = async (index: number) => {
    const left = await rpc(index, 'leave_community', { p_community_id: kit.communityId });
    expect(left.error).toBeNull();
  };
  const close = (leagueId: string) =>
    rpc(0, 'close_league', { p_league_id: leagueId, p_expected_version: 1 });

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
    await fixtureSql(
      `update public.communities set visibility = 'private' where id = ${L(kit.communityId)};`
    );

    // Closed League: version 1 from the close, version 2 from a late first confirmation.
    closedLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    const closedEvent = await kit.event(closedLeague);
    await confirmGroup(closedEvent, 1);
    const late = await confirmGroup(closedEvent, 2, { approve: false });
    for (const step of [
      await close(closedLeague),
      await kit.approve(late, 1, kit.players[4]),
      await kit.approve(late, 1, kit.players[6])
    ])
      if (step.error) throw new Error(`Fixture step failed: ${step.error.message}`);

    openLeague = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    await confirmGroup(await kit.event(openLeague), 1);

    idleLeague = await kit.league({ status: 'upcoming' });
    incompleteLeague = await kit.league({ status: 'upcoming' });
    await confirmGroup(await kit.event(incompleteLeague), 2, { sets: incompleteSets });
    pendingLeague = await kit.league({ status: 'upcoming' });
    await confirmGroup(await kit.event(pendingLeague), 2, { approve: false });
    rejectedLeague = await kit.league({ status: 'upcoming' });
    const rejectedProposal = await confirmGroup(await kit.event(rejectedLeague), 2, {
      approve: false
    });
    const rejection = await rpc(6, 'review_match_event_result', {
      p_proposal_id: rejectedProposal,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_request_id: crypto.randomUUID()
    });
    if (rejection.error) throw new Error(`Fixture step failed: ${rejection.error.message}`);

    for (const index of [3, 4, 5, 7]) await leave(index);
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });

  it('seeds the intended fixture: former players are no longer members, facts exist', async () => {
    const [members] = await sqlRows(
      `select count(*)::int as n from public.community_members
        where community_id = ${L(kit.communityId)} and valid_until is null and status = 'active'`
    );
    expect(members).toEqual({ n: 4 });
    const [earned] = await sqlRows(
      `select count(*)::int as n from public.league_player_counters where league_id = ${L(incompleteLeague)}`
    );
    expect(earned).toEqual({ n: 0 });
  });

  describe('member-view parity', () => {
    it('shows an open League detail, live standings and counters equal to the member view', async () => {
      const former = await read(FORMER, openLeague);
      const member = await read(MEMBER, openLeague);
      for (const response of former.all) expect(response.error).toBeNull();
      expect(asRecord(former.detail.data)['access_mode']).toBe('former_participant');
      expect(asRecord(member.detail.data)['access_mode']).toBe('member');
      expect({ ...asRecord(former.detail.data), access_mode: null }).toEqual({
        ...asRecord(member.detail.data),
        access_mode: null
      });
      expect(asRecord(asRecord(former.detail.data)['league'])['can_manage']).toBe(false);
      expect(former.standings.data).toEqual(member.standings.data);
      expect(asRecord(former.standings.data)['source']).toBe('live');
      expect(former.counters.data).toEqual(member.counters.data);
      expect(former.versions.data).toEqual(member.versions.data);
      const participants = asRecord(former.counters.data)['participants'];
      expect(
        Array.isArray(participants) ? participants.map((row) => asRecord(row)['user_id']) : []
      ).toContain(id(FORMER));
    });

    it('shows every published version of a closed League equal to the member view', async () => {
      for (const version of [undefined, 1, 2]) {
        const former = await read(FORMER, closedLeague, version);
        const member = await read(MEMBER, closedLeague, version);
        for (const response of former.all) expect(response.error).toBeNull();
        // Only the access mode may differ between the two views.
        const sporting = (view: typeof former) =>
          view.all.map((response, index) =>
            index === 0 ? { ...asRecord(response.data), access_mode: null } : response.data
          );
        expect(sporting(former)).toEqual(sporting(member));
      }
      const { standings } = await read(FORMER, closedLeague, 1);
      expect(asRecord(standings.data)).toMatchObject({
        source: 'final',
        standings_version: 1,
        latest_standings_version: 2
      });
    });

    it('returns a minimal community context without creation settings', async () => {
      const { detail } = await read(FORMER, openLeague);
      expect(Object.keys(asRecord(asRecord(detail.data)['community'])).sort()).toEqual([
        'id',
        'name',
        'timezone'
      ]);
    });
  });

  describe('participation predicate', () => {
    it('grants access through a confirmed Incomplete group without any earned counter row', async () => {
      // Player 7 was in the confirmed Incomplete group only (League excludes it from counters).
      const granted = await read(7, incompleteLeague);
      for (const response of granted.all) expect(response.error).toBeNull();
      expect(asRecord(granted.detail.data)['access_mode']).toBe('former_participant');
    });

    it('does not grant access for pending-only participation or another League', async () => {
      for (const response of (await read(5, pendingLeague)).all)
        expect(response.error).toMatchObject(deniedLeague);
      for (const response of (await read(FORMER, idleLeague)).all)
        expect(response.error).toMatchObject(deniedLeague);
      // Player 3 played group 1 of the open and closed Leagues only.
      for (const response of (await read(FORMER, incompleteLeague)).all)
        expect(response.error).toMatchObject(deniedLeague);
    });

    it('grants access through an earned counter row alone and ignores a zero-match row', async () => {
      const stranger = await kit.actor();
      const zero = await kit.actor();
      await fixtureSql(
        `insert into public.league_player_counters(league_id, community_id, user_id, matches, wins)
           values (${L(idleLeague)}, ${L(kit.communityId)}, ${L(stranger.id)}, 1, 1),
                  (${L(idleLeague)}, ${L(kit.communityId)}, ${L(zero.id)}, 0, 0);`
      );
      try {
        const granted = await kit.rpc(stranger, 'get_league', { p_league_id: idleLeague });
        expect(granted.error).toBeNull();
        expect(asRecord(granted.data)['access_mode']).toBe('former_participant');
        expect(
          (await kit.rpc(stranger, 'get_league_counters', { p_league_id: idleLeague })).error
        ).toBeNull();
        expect(
          (await kit.rpc(zero, 'get_league', { p_league_id: idleLeague })).error
        ).toMatchObject(deniedLeague);
      } finally {
        await fixtureSql(
          `delete from public.league_player_counters where league_id = ${L(idleLeague)};`
        );
      }
    });
  });

  describe('denial matrix', () => {
    it('keeps the participation predicate private to the readers', async () => {
      const [privileges] = await sqlRows(
        `select has_function_privilege('authenticated', 'public.league_actor_has_participation(uuid)', 'execute') as authenticated,
                has_function_privilege('anon', 'public.league_actor_has_participation(uuid)', 'execute') as anon`
      );
      expect(privileges).toEqual({ authenticated: false, anon: false });
    });

    it('keeps a non-playing former member and a never-member out, indistinguishably from unknown', async () => {
      const outsider = await kit.actor();
      const unknown = crypto.randomUUID();
      for (const leagueId of [openLeague, closedLeague]) {
        // Player 4 played group 2 of the closed League only; players 5 and 7 likewise.
        const nonPlaying = leagueId === openLeague ? [4, 5, 7] : [];
        for (const index of nonPlaying)
          for (const response of (await read(index, leagueId)).all)
            expect(response.error).toMatchObject(deniedLeague);
        for (const name of ['get_league', 'get_league_standings', 'get_league_counters'])
          expect((await kit.rpc(outsider, name, { p_league_id: leagueId })).error).toMatchObject(
            deniedLeague
          );
      }
      for (const name of ['get_league', 'get_league_standings', 'get_league_counters'])
        expect((await kit.rpc(outsider, name, { p_league_id: unknown })).error).toMatchObject(
          deniedLeague
        );
      const former = await rpc(FORMER, 'get_league', { p_league_id: unknown });
      expect(former.error).toEqual(
        (await kit.rpc(outsider, 'get_league', { p_league_id: unknown })).error
      );
    });

    it('rejects anonymous callers with the existing contract', async () => {
      const noSession = createClient<Database>(environment.env!.url, environment.env!.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const bare = await noSession.rpc('get_league', { p_league_id: openLeague });
      expect(bare.data).toBeNull();
      expect(bare.error).not.toBeNull();
      expect(bare.error?.code).toBe('42501');
      // Local Auth disables anonymous sign-in, so the anonymous-auth JWT is simulated in SQL: the
      // readers must reject it as UNAUTHENTICATED even for an actor who really played the League.
      for (const name of [
        'get_league',
        'get_league_standings',
        'get_league_counters',
        'list_league_standings_versions'
      ]) {
        await fixtureSql(`do $$ begin
          perform set_config('request.jwt.claims',
            '{"sub":"${id(FORMER)}","role":"authenticated","is_anonymous":true}', true);
          begin
            perform public.${name}(${L(openLeague)}::uuid);
            raise exception 'READER_ACCEPTED_ANONYMOUS';
          exception when others then
            if sqlerrm <> 'UNAUTHENTICATED' then raise; end if;
          end;
        end $$;`);
      }
    });
  });

  describe('no authority beyond reading', () => {
    it('cannot write, close, activate, audit or list, and changes nothing', async () => {
      const before = await sqlRows(
        `select id::text, version, name, status from public.leagues
          where community_id = ${L(kit.communityId)} order by id`
      );
      const calls = await Promise.all([
        rpc(FORMER, 'update_league', {
          p_league_id: openLeague,
          p_expected_version: 1,
          p_changes: { name: 'Hijacked' }
        }),
        rpc(FORMER, 'close_league', { p_league_id: openLeague, p_expected_version: 1 }),
        rpc(FORMER, 'activate_league', { p_league_id: idleLeague, p_expected_version: 1 }),
        rpc(FORMER, 'get_league_standings_audit', { p_league_id: closedLeague })
      ]);
      for (const call of calls) {
        expect(call.data).toBeNull();
        expect(call.error).toMatchObject(deniedLeague);
      }
      const list = await rpc(FORMER, 'list_leagues', {
        p_community_id: kit.communityId,
        p_after_created_at: null,
        p_after_id: null
      });
      expect(list.data).toBeNull();
      expect(list.error).not.toBeNull();
      const created = await rpc(FORMER, 'create_league', {
        p_request_id: crypto.randomUUID(),
        p_community_id: kit.communityId,
        p_name: 'Not allowed',
        p_end_mode: 'manual',
        p_start_date: '2030-01-01'
      });
      expect(created.data).toBeNull();
      expect(created.error).not.toBeNull();
      expect(
        await sqlRows(
          `select id::text, version, name, status from public.leagues
            where community_id = ${L(kit.communityId)} order by id`
        )
      ).toEqual(before);
    });

    it('keeps the private community closed: members, requests, venues, invitations, audit and settings', async () => {
      const applicant = await kit.actor();
      const invitee = await kit.actor();
      await fixtureSql(
        `insert into public.player_profiles(user_id, display_name, preferred_side)
           values (${L(applicant.id)}, 'Pending Applicant', 'EITHER');`
      );
      await setMembershipHistory(kit.communityId, applicant.id, [{ activatedAt: null }]);
      const tokenHash = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const invited = await who(0)
        .client.from('community_invitations')
        .insert({
          community_id: kit.communityId,
          invitee_user_id: invitee.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 3_600_000).toISOString()
        });
      expect(invited.error).toBeNull();
      await fixtureSql(
        `insert into public.community_venues(community_id, name, created_by)
           values (${L(kit.communityId)}, 'Hidden court', ${L(id(0))});
         insert into public.community_audit_log(community_id, actor_user_id, entity, entity_id, action)
           values (${L(kit.communityId)}, ${L(id(0))}, 'communities', ${L(kit.communityId)}, 'UPDATE');`
      );
      const outsider = await kit.actor();

      // The production community readers, exactly as the admin server functions call them.
      const readers = {
        pendingRequests: (actor: { client: SupabaseClient<Database> }) =>
          actor.client.rpc('search_community_members', {
            p_community_id: kit.communityId,
            p_query: '',
            p_status: 'pending',
            p_offset: 0,
            p_limit: 50
          }),
        members: (actor: { client: SupabaseClient<Database> }) =>
          actor.client.rpc('search_community_members', {
            p_community_id: kit.communityId,
            p_query: '',
            p_status: 'active',
            p_offset: 0,
            p_limit: 50
          }),
        settings: (actor: { client: SupabaseClient<Database> }) =>
          actor.client.rpc('get_community_settings', { p_community_id: kit.communityId }),
        venues: (actor: { client: SupabaseClient<Database> }) =>
          actor.client
            .from('community_venues')
            .select('id,name')
            .eq('community_id', kit.communityId)
            .is('archived_at', null),
        invitations: (actor: { client: SupabaseClient<Database> }) =>
          actor.client
            .from('community_invitations')
            .select('id,invitee_user_id')
            .eq('community_id', kit.communityId),
        audit: (actor: { client: SupabaseClient<Database> }) =>
          actor.client
            .from('community_audit_log')
            .select('id,entity')
            .eq('community_id', kit.communityId)
      };

      // Positive control: the retained Admin sees every protected record, so the denials below
      // cannot be vacuous.
      const adminPending = await readers.pendingRequests(who(0));
      expect(adminPending.error).toBeNull();
      expect((adminPending.data ?? []).map((row) => row.user_id)).toContain(applicant.id);
      const adminMembers = await readers.members(who(0));
      expect(adminMembers.error).toBeNull();
      expect((adminMembers.data ?? []).map((row) => row.user_id)).toContain(id(MEMBER));
      expect((await readers.settings(who(0))).error).toBeNull();
      expect((await readers.venues(who(0))).data?.map((row) => row.name)).toContain('Hidden court');
      expect((await readers.invitations(who(0))).data?.map((row) => row.invitee_user_id)).toContain(
        invitee.id
      );
      expect((await readers.audit(who(0))).data?.map((row) => row.entity)).toContain('communities');
      const membershipId = adminPending.data!.find(
        (row) => row.user_id === applicant.id
      )!.membership_id;
      const adminMember = await who(0).client.rpc('get_community_member_by_id', {
        p_community_id: kit.communityId,
        p_membership_id: membershipId
      });
      expect(adminMember.error).toBeNull();
      expect(adminMember.data).toHaveLength(1);

      // The former participant is denied exactly like a never-member, on every reader.
      for (const reader of [readers.pendingRequests, readers.members, readers.settings] as const) {
        const former = await reader(who(FORMER));
        expect(former.data).toBeNull();
        expect(former.error).not.toBeNull();
        expect(former.error).toEqual((await reader(outsider)).error);
      }
      const formerMember = await who(FORMER).client.rpc('get_community_member_by_id', {
        p_community_id: kit.communityId,
        p_membership_id: membershipId
      });
      expect(formerMember.error).not.toBeNull();
      expect(formerMember.data ?? []).toEqual([]);
      for (const reader of [readers.venues, readers.invitations, readers.audit] as const) {
        const former = await reader(who(FORMER));
        // Table grants or RLS: an error or no rows, never the protected records.
        expect(former.data ?? []).toEqual([]);
      }

      // Raw tables: nothing foreign beyond the caller's own ended membership row.
      const client = who(FORMER).client;
      for (const table of [
        'communities',
        'community_members',
        'community_venues',
        'community_invitations',
        'community_audit_log'
      ] as const) {
        const rows = await client.from(table).select('*');
        const foreign = (rows.data ?? []).filter(
          (row) =>
            ('community_id' in row ? row.community_id : row.id) === kit.communityId &&
            (!('user_id' in row) || row.user_id !== id(FORMER))
        );
        expect(foreign).toEqual([]);
      }
    });
  });

  describe('former privileged and restricted actors', () => {
    const leagueRows = () =>
      sqlRows(
        `select id::text, version, name, status from public.leagues
          where community_id = ${L(kit.communityId)} order by id`
      );
    const grantCounter = (leagueId: string, userId: string) =>
      fixtureSql(
        `insert into public.league_player_counters(league_id, community_id, user_id, matches, wins)
           values (${L(leagueId)}, ${L(kit.communityId)}, ${L(userId)}, 1, 1);`
      );
    const dropCounters = (leagueId: string) =>
      fixtureSql(`delete from public.league_player_counters where league_id = ${L(leagueId)};`);
    /** Removal of an active member by the retained Admin, through the production RPC. */
    const removeByAdmin = async (userId: string) => {
      const membership = await who(0)
        .client.from('community_members')
        .select('id')
        .eq('community_id', kit.communityId)
        .eq('user_id', userId)
        .is('valid_until', null)
        .single();
      if (membership.error) throw new Error(`Fixture step failed: ${membership.error.message}`);
      return who(0).client.rpc('govern_community_member', {
        p_community_id: kit.communityId,
        p_membership_id: membership.data.id,
        p_action: 'remove'
      });
    };

    // Both ways a privileged member loses authority: leaving, and removal by another Admin.
    for (const ending of ['leave', 'remove'] as const)
      it(`ex-Admin and ex-owner (${ending}) keep reads of a played League only; commands, audit and list stay denied`, async () => {
        const exAdmin = await kit.member();
        const ownLeague = await kit.league({ status: 'upcoming', ownerId: exAdmin.id });
        await withTriggersDisabled(
          [communityMemberGuard],
          `update public.community_members set role = 'admin'
          where community_id = ${L(kit.communityId)} and user_id = ${L(exAdmin.id)};`
        );
        // Positive control while the membership lasts: owner and Admin read the audit.
        expect(
          (await kit.rpc(exAdmin, 'get_league_standings_audit', { p_league_id: ownLeague })).error
        ).toBeNull();
        expect(
          (
            await kit.rpc(exAdmin, 'list_leagues', {
              p_community_id: kit.communityId,
              p_after_created_at: null,
              p_after_id: null
            })
          ).error
        ).toBeNull();
        const ended =
          ending === 'leave'
            ? await kit.rpc(exAdmin, 'leave_community', { p_community_id: kit.communityId })
            : await removeByAdmin(exAdmin.id);
        expect(ended.error).toBeNull();

        await grantCounter(idleLeague, exAdmin.id);
        try {
          const before = await leagueRows();
          // Reads of the League they played still work, strictly read-only.
          const played = await kit.rpc(exAdmin, 'get_league', { p_league_id: idleLeague });
          expect(played.error).toBeNull();
          expect(asRecord(played.data)['access_mode']).toBe('former_participant');
          expect(asRecord(asRecord(played.data)['league'])['can_manage']).toBe(false);
          expect(
            (await kit.rpc(exAdmin, 'get_league_counters', { p_league_id: idleLeague })).error
          ).toBeNull();

          // Their own League, which they never played: every reader stays denied.
          for (const [name, args] of [
            ['get_league', { p_league_id: ownLeague }],
            ['get_league_standings', { p_league_id: ownLeague, p_standings_version: null }],
            ['get_league_counters', { p_league_id: ownLeague }],
            ['list_league_standings_versions', { p_league_id: ownLeague, p_before_version: null }]
          ] as const)
            expect((await kit.rpc(exAdmin, name, args)).error).toMatchObject(deniedLeague);

          // Commands, audit and the list stay denied on both Leagues.
          for (const leagueId of [ownLeague, idleLeague]) {
            const calls = await Promise.all([
              kit.rpc(exAdmin, 'update_league', {
                p_league_id: leagueId,
                p_expected_version: 1,
                p_changes: { name: 'Hijacked' }
              }),
              kit.rpc(exAdmin, 'close_league', { p_league_id: leagueId, p_expected_version: 1 }),
              kit.rpc(exAdmin, 'activate_league', { p_league_id: leagueId, p_expected_version: 1 }),
              kit.rpc(exAdmin, 'get_league_standings_audit', { p_league_id: leagueId })
            ]);
            for (const call of calls) {
              expect(call.data).toBeNull();
              expect(call.error).toMatchObject(deniedLeague);
            }
          }
          const list = await kit.rpc(exAdmin, 'list_leagues', {
            p_community_id: kit.communityId,
            p_after_created_at: null,
            p_after_id: null
          });
          expect(list.data).toBeNull();
          expect(list.error).toMatchObject({ message: 'LEAGUE_FORBIDDEN' });
          expect(await leagueRows()).toEqual(before);
        } finally {
          await dropCounters(idleLeague);
        }
      });

    it('a confirmation that was rejected, or a provisional actor, grants nothing', async () => {
      // Player 4 played a group that was rejected (never confirmed): denied on all four readers.
      for (const response of (await read(4, rejectedLeague)).all)
        expect(response.error).toMatchObject(deniedLeague);

      // A provisional actor stays restricted by the unchanged prologue, even with a played row.
      const provisional = await kit.actor();
      const sourceEventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: sourceEventId,
        communityId: kit.communityId,
        creatorId: id(0),
        visibility: 'community_open',
        past: true
      });
      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Provisional Former',
        estimatedLevel: 3.5,
        invitedBy: id(0),
        sourceEventId
      });
      await grantCounter(idleLeague, provisional.id);
      try {
        for (const [name, args] of [
          ['get_league', { p_league_id: idleLeague }],
          ['get_league_standings', { p_league_id: idleLeague, p_standings_version: null }],
          ['get_league_counters', { p_league_id: idleLeague }],
          ['list_league_standings_versions', { p_league_id: idleLeague, p_before_version: null }]
        ] as const)
          expect((await kit.rpc(provisional, name, args)).error).toMatchObject({
            code: '42501',
            message: 'PROVISIONAL_PLAYER_RESTRICTED'
          });
      } finally {
        await dropCounters(idleLeague);
      }
    });
  });
});
