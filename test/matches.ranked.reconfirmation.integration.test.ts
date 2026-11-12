import { beforeAll, describe, expect, it } from 'vitest';
import type { Json } from '../src/lib/supabase/database.types';
import {
  insertLeague,
  leagueWorld,
  sqlRows,
  type LeagueActor,
  type LeagueWorld
} from './helpers/league-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  ensureProvisionalMembership,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { isoDay, publishCompetitive } from './helpers/ranked-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();
const day = (offset: number) => `${isoDay(offset)}T00:00:00Z`;
const at = (offset: number, time = '10:00:00') => `${isoDay(offset)}T${time}.000Z`;

/**
 * U3 / AC5, AC7, AC8, AC13: Ranked and League changes join the existing major-edit consent
 * protocol; out-of-period moves are rejected atomically; provisional players carry automatically.
 */
describe.skipIf(!environment.env)(
  'Ranked/League change reconfirmation',
  { timeout: 300_000 },
  () => {
    let world: LeagueWorld;
    let owner: LeagueActor;
    let leagueA: string;
    let leagueB: string;

    beforeAll(async () => {
      world = await leagueWorld(environment.env!, 'ranked-rec');
      await world.setTimezone('UTC');
      owner = world.owner;
      leagueA = await league({ name: 'League Alpha' });
      leagueB = await league({ name: 'League Beta' });
    });

    function league(overrides: Partial<Parameters<typeof insertLeague>[0]> = {}): Promise<string> {
      return insertLeague({
        communityId: world.communityId,
        ownerId: owner.id,
        status: 'upcoming',
        startAt: day(-5),
        endAt: day(60),
        ...overrides
      });
    }
    const unranked = async (overrides: Record<string, unknown> = {}) =>
      (await publishCompetitive(owner, world.communityId, overrides)).eventId;
    const ranked = async (leagueId: string, overrides: Record<string, unknown> = {}) => {
      const published = await publishCompetitive(owner, world.communityId, {
        competition: 'ranked',
        league_id: leagueId,
        ...overrides
      });
      expect(published.result.error).toBeNull();
      return published.eventId;
    };
    const eventRow = async (eventId: string) => {
      const [row] = await sqlRows(
        `select version::int as version, reconfirmation_generation::int as generation,
          league_id::text as league_id, event_type::text as event_type, starts_at
         from public.match_events where id = ${sqlText(eventId)}`
      );
      return row!;
    };
    const edit = async (
      eventId: string,
      patch: Record<string, Json>,
      options: { request?: string; version?: number; actor?: LeagueActor } = {}
    ) =>
      (options.actor ?? owner).client.rpc('edit_match_event', {
        p_match_event_id: eventId,
        p_expected_version: options.version ?? Number((await eventRow(eventId)).version),
        p_patch: patch,
        p_request_id: options.request ?? crypto.randomUUID()
      });
    const join = (actor: LeagueActor, eventId: string) =>
      actor.client.rpc('submit_match_registration', { p_match_event_id: eventId });
    const registrations = (eventId: string) =>
      sqlRows(
        `select r.user_id::text as user_id, r.lifecycle::text as lifecycle, r.participation_status::text as participation,
          r.accepted_order::int as accepted_order, r.accepted_at, r.current_attempt_id::text as attempt,
          r.required_generation::int as required, r.confirmed_generation::int as confirmed, r.reconfirmed_at,
          a.required_generation::int as attempt_required, a.confirmed_generation::int as attempt_confirmed,
          a.reconfirmed_at as attempt_reconfirmed_at
         from public.match_event_registrations r
         left join public.match_event_registration_attempts a on a.id = r.current_attempt_id
        where r.match_event_id = ${sqlText(eventId)} order by r.accepted_order nulls last, r.user_id`
      );
    const consentNotices = (eventId: string) =>
      sqlRows(
        `select recipient_user_id::text as recipient, count(*)::int as total from public.notifications
        where target_id = ${sqlText(eventId)} and kind = 'match_reconfirmation_required'
        group by 1 order by 1`
      );
    const audit = (eventId: string, action: string) =>
      sqlRows(
        `select target_user_id::text as target, reason, before_data, after_data, changed_fields
         from public.match_event_audit_log
        where match_event_id = ${sqlText(eventId)} and action = ${sqlText(action)} order by occurred_at, id`
      );
    const pendingAttempt = async (eventId: string, userId: string) =>
      String(
        (
          await sqlRows(
            `select current_attempt_id::text as id from public.match_event_registrations
            where match_event_id = ${sqlText(eventId)} and user_id = ${sqlText(userId)}`
          )
        )[0]?.['id']
      );
    const approveGuest = async (eventId: string, guest: LeagueActor) =>
      owner.client.rpc('decide_match_registration', {
        p_match_event_id: eventId,
        p_attempt_id: await pendingAttempt(eventId, guest.id),
        p_decision: 'approve'
      });
    const reconfirm = async (eventId: string, actor: LeagueActor, generation: number) =>
      actor.client.rpc('reconfirm_match_registration', {
        p_match_event_id: eventId,
        p_attempt_id: await pendingAttempt(eventId, actor.id),
        p_generation: generation,
        p_request_id: crypto.randomUUID()
      });
    /** Trusted stand-in for the verified claim: it only clears the profile marker (identity is permanent). */
    const claim = (actor: LeagueActor) =>
      executeTrustedSql(
        `update public.player_profiles set is_provisional = false where user_id = ${sqlText(actor.id)}`
      );
    /** Real registration writer for a target that cannot act itself (provisional players). */
    const acceptTarget = (eventId: string, userId: string) =>
      executeTrustedSql(
        `select public.submit_match_registration_locked(${sqlText(eventId)}, ${sqlText(userId)})`
      );
    /** A fresh provisional member (the marker is one-way, so claim tests cannot reuse the world's). */
    const newProvisional = async (label: string) => {
      const actor = await signUpFixtureActor(environment.env!, `ranked-rec-${label}`);
      const sourceEventId = await unranked();
      await provisionProvisionalPlayer({
        userId: actor.id,
        displayName: `Provisional ${label}`.slice(0, 40),
        estimatedLevel: 3.5,
        invitedBy: world.admin.id,
        sourceEventId
      });
      await ensureProvisionalMembership({
        communityId: world.communityId,
        userId: actor.id,
        addedBy: world.admin.id,
        sourceEventId
      });
      return actor;
    };
    const sleepUntilCutoff = async (eventId: string) => {
      await executeTrustedSql(`do $$ begin alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set registration_cutoff_at = now() - interval '1 minute' where id = ${sqlText(eventId)};
      alter table public.match_events enable trigger match_event_immutable; end $$;`);
      await executeTrustedSql(
        `select public.process_match_event_registration_cutoff(${sqlText(eventId)}, false)`
      );
    };

    it('rank flip: Unranked to Ranked is one major generation that pauses registered players and notifies once', async () => {
      const eventId = await unranked();
      expect((await join(world.member, eventId)).error).toBeNull();
      const result = await edit(eventId, { league_id: leagueA });
      expect(result.error).toBeNull();
      expect(result.data).toMatchObject({
        change_kind: 'major',
        changed_fields: ['league_id'],
        reconfirmation_generation: 1,
        carried_count: 0,
        version: 2
      });
      expect(await eventRow(eventId)).toMatchObject({ league_id: leagueA, generation: 1 });
      const rows = await registrations(eventId);
      expect(rows).toHaveLength(2);
      for (const row of rows)
        expect(row).toMatchObject({
          participation: null,
          required: 1,
          confirmed: 0,
          attempt_required: 1,
          attempt_confirmed: 0
        });
      const [major] = await audit(eventId, 'major_edit');
      expect(major?.['before_data']).toMatchObject({
        league_id: null,
        competition: { competition_status: 'unranked', league_id: null }
      });
      expect(major?.['after_data']).toMatchObject({
        league_id: leagueA,
        reconfirmation_generation: 1,
        competition: {
          competition_status: 'ranked',
          league_id: leagueA,
          league_name: 'League Alpha'
        }
      });
      expect(await consentNotices(eventId)).toEqual(
        [owner.id, world.member.id]
          .sort((a, b) => a.localeCompare(b))
          .map((recipient) => ({ recipient, total: 1 }))
      );
    });

    it('retries, replays and no-op edits never create a second consent generation or notification', async () => {
      const eventId = await unranked();
      await join(world.member, eventId);
      const request = crypto.randomUUID();
      const first = await edit(eventId, { league_id: leagueA.toUpperCase() }, { request });
      expect(first.error).toBeNull();
      // Offset/case-equivalent replay of the same request returns the stored result.
      const replay = await edit(eventId, { league_id: leagueA }, { request, version: 1 });
      expect(replay.data).toMatchObject({ replayed: true, reconfirmation_generation: 1 });
      // Same request id with a different intent is an idempotency conflict.
      expect(
        (await edit(eventId, { league_id: leagueB }, { request, version: 1 })).error?.message
      ).toBe('MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT');
      // Fresh request for the already-applied state is a no-op, not a new major edit.
      const noop = await edit(eventId, { league_id: leagueA });
      expect(noop.data).toMatchObject({
        changed: false,
        change_kind: 'none',
        reconfirmation_generation: 1
      });
      // Stale version fails typed, nothing changes.
      expect((await edit(eventId, { league_id: leagueB }, { version: 1 })).error?.message).toBe(
        'MATCH_MANAGEMENT_VERSION_CONFLICT'
      );
      expect(await eventRow(eventId)).toMatchObject({
        generation: 1,
        version: 2,
        league_id: leagueA
      });
      expect((await consentNotices(eventId)).every((row) => row['total'] === 1)).toBe(true);
      expect(await audit(eventId, 'major_edit')).toHaveLength(1);
    });

    it('League-ID switch is major even when both events are Ranked, and downgrade is explicit', async () => {
      const eventId = await ranked(leagueA);
      await join(world.member, eventId);
      const switched = await edit(eventId, { league_id: leagueB });
      expect(switched.data).toMatchObject({ change_kind: 'major', reconfirmation_generation: 1 });
      expect((await registrations(eventId)).every((row) => row['required'] === 1)).toBe(true);
      const [major] = await audit(eventId, 'major_edit');
      expect(major?.['before_data']).toMatchObject({
        competition: { league_name: 'League Alpha' }
      });
      expect(major?.['after_data']).toMatchObject({ competition: { league_name: 'League Beta' } });
      const downgrade = await edit(eventId, { league_id: null });
      expect(downgrade.data).toMatchObject({ change_kind: 'major', reconfirmation_generation: 2 });
      expect(await eventRow(eventId)).toMatchObject({ league_id: null });
    });

    it('accepted nonmember prevents the Ranked switch and leaves event, roster and generations unchanged', async () => {
      const eventId = await unranked();
      expect((await join(world.member, eventId)).error).toBeNull();
      expect((await join(world.outsider, eventId)).error).toBeNull();
      expect((await approveGuest(eventId, world.outsider)).error).toBeNull();
      const before = { event: await eventRow(eventId), rows: await registrations(eventId) };
      const rejected = await edit(eventId, { league_id: leagueA });
      expect(rejected.error?.message).toBe('MATCH_MANAGEMENT_RANKED_NONMEMBERS_ACCEPTED');
      expect(JSON.parse(rejected.error?.details ?? '{}')).toEqual({ accepted_nonmember_count: 1 });
      expect({ event: await eventRow(eventId), rows: await registrations(eventId) }).toEqual(
        before
      );
      expect(await consentNotices(eventId)).toEqual([]);
      // Explicit resolution first (real removal), then the eligible change triggers consent.
      const removed = await owner.client.rpc('remove_match_registration', {
        p_match_event_id: eventId,
        p_target_user_id: world.outsider.id,
        p_attempt_id: await pendingAttempt(eventId, world.outsider.id),
        p_reason: 'Ranked event',
        p_request_id: crypto.randomUUID()
      });
      expect(removed.error).toBeNull();
      const resolved = await edit(eventId, { league_id: leagueA });
      expect(resolved.data).toMatchObject({ change_kind: 'major', reconfirmation_generation: 1 });
      expect(
        (await registrations(eventId))
          .filter((row) => row['lifecycle'] === 'accepted')
          .every((row) => row['participation'] === null && row['required'] === 1)
      ).toBe(true);
    });

    it('genuine membership activation resolves an accepted guest without removing anyone', async () => {
      const eventId = await unranked();
      expect((await join(world.outsider, eventId)).error).toBeNull();
      expect((await approveGuest(eventId, world.outsider)).error).toBeNull();
      expect((await edit(eventId, { league_id: leagueA })).error?.message).toBe(
        'MATCH_MANAGEMENT_RANKED_NONMEMBERS_ACCEPTED'
      );
      await executeTrustedSql(
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
         values (${sqlText(world.communityId)},${sqlText(world.outsider.id)},'member','active',now()-interval '1 day',now()-interval '1 day')`
      );
      expect((await edit(eventId, { league_id: leagueA })).data).toMatchObject({
        change_kind: 'major'
      });
      expect(
        (await registrations(eventId)).find((row) => row['user_id'] === world.outsider.id)
      ).toMatchObject({ lifecycle: 'accepted', required: 1 });
      // Reset for the other tests: the outsider stays a nonmember there.
      await world.removeMember(world.outsider);
    });

    it('pending nonmember requests become non-actionable after the switch and are never auto-resolved', async () => {
      const eventId = await unranked();
      expect((await join(world.outsider, eventId)).error).toBeNull();
      expect((await edit(eventId, { league_id: leagueA })).error).toBeNull();
      const approval = await approveGuest(eventId, world.outsider);
      expect(approval.error).not.toBeNull();
      const [row] = await registrations(eventId).then((rows) =>
        rows.filter((entry) => entry['user_id'] === world.outsider.id)
      );
      expect(row?.['lifecycle']).toBe('pending');
    });

    it('rejects an outside-period move atomically and offers explicit repairs', async () => {
      const short = await league({ name: 'Short window', startAt: day(-5), endAt: day(6) });
      const eventId = await ranked(short);
      await join(world.member, eventId);
      const before = { event: await eventRow(eventId), rows: await registrations(eventId) };
      const rejected = await edit(eventId, { starts_at: at(20) });
      expect(rejected.error?.message).toBe('MATCH_MANAGEMENT_LEAGUE_OUT_OF_PERIOD');
      expect(JSON.parse(rejected.error?.details ?? '{}')).toMatchObject({
        league: { league_id: short, league_name: 'Short window', competition_status: 'ranked' }
      });
      // Whole edit rejected: unrelated fields in the same patch are not partially applied.
      const partial = await edit(eventId, { starts_at: at(20), venue_name: 'Elsewhere' });
      expect(partial.error?.message).toBe('MATCH_MANAGEMENT_LEAGUE_OUT_OF_PERIOD');
      expect({ event: await eventRow(eventId), rows: await registrations(eventId) }).toEqual(
        before
      );
      expect(await consentNotices(eventId)).toEqual([]);
      // Repair 1: reschedule inside the League window keeps the League and asks for consent.
      const inside = await edit(eventId, { starts_at: at(5) });
      expect(inside.data).toMatchObject({ change_kind: 'major', reconfirmation_generation: 1 });
      expect(await eventRow(eventId)).toMatchObject({ league_id: short });
      // Repair 2: explicit Unranked + changed date is one atomic major edit, never automatic.
      const repaired = await edit(eventId, { starts_at: at(20), league_id: null });
      expect(repaired.data).toMatchObject({ change_kind: 'major', reconfirmation_generation: 2 });
      expect(await eventRow(eventId)).toMatchObject({ league_id: null });
      const [major] = await audit(eventId, 'major_edit').then((rows) => rows.slice(-1));
      expect(major?.['after_data']).toMatchObject({
        competition: { competition_status: 'unranked', league_id: null }
      });
    });

    it('validates League association together with Friendly, availability and closure', async () => {
      const eventId = await ranked(leagueA);
      expect((await edit(eventId, { event_type: 'friendly' })).error?.message).toBe(
        'MATCH_MANAGEMENT_LEAGUE_FRIENDLY'
      );
      const later = await league({ name: 'Created later' });
      expect((await edit(eventId, { league_id: later })).error?.message).toBe(
        'MATCH_MANAGEMENT_LEAGUE_UNAVAILABLE'
      );
      expect((await edit(eventId, { league_id: crypto.randomUUID() })).error?.message).toBe(
        'MATCH_MANAGEMENT_LEAGUE_UNAVAILABLE'
      );
      expect((await edit(eventId, { league_id: 'nope' })).error?.code).toBe('22023');
      const closed = await league({
        status: 'closed',
        startAt: day(-30),
        endAt: day(-20),
        closedAt: day(-20)
      });
      const unrankedEvent = await unranked();
      // Closed Leagues cannot be newly selected (and are out of period anyway for a future event).
      expect((await edit(unrankedEvent, { league_id: closed })).error).not.toBeNull();
      // Friendly with an explicit Unranked repair is allowed.
      expect((await edit(eventId, { event_type: 'friendly', league_id: null })).data).toMatchObject(
        {
          change_kind: 'major'
        }
      );
      expect(await eventRow(eventId)).toMatchObject({ league_id: null, event_type: 'friendly' });
    });

    it('keeps a League closed after booking as a valid historical association for in-window edits', async () => {
      const closing = await league({ name: 'Closing', startAt: day(-5), endAt: day(10) });
      const eventId = await ranked(closing);
      await executeTrustedSql(
        `update public.leagues set status = 'closed', closed_at = end_at, closed_reason = 'fixed_end_reached'
        where id = ${sqlText(closing)}`
      );
      expect((await edit(eventId, { notes: 'Bring balls' })).data).toMatchObject({
        change_kind: 'minor'
      });
      expect((await edit(eventId, { starts_at: at(6) })).data).toMatchObject({
        change_kind: 'major'
      });
      expect(await eventRow(eventId)).toMatchObject({ league_id: closing });
      expect((await edit(eventId, { starts_at: at(30) })).error?.message).toBe(
        'MATCH_MANAGEMENT_LEAGUE_OUT_OF_PERIOD'
      );
    });

    it('still blocks direct league_id updates outside the edit command', async () => {
      const eventId = await unranked();
      await expect(
        executeTrustedSql(
          `update public.match_events set league_id = ${sqlText(leagueA)}, version = version + 1 where id = ${sqlText(eventId)}`
        )
      ).rejects.toThrow('Invalid match event mutation');
      const tamper = await owner.client
        .from('match_events')
        .update({ league_id: leagueA })
        .eq('id', eventId);
      expect(tamper.error).not.toBeNull();
      expect((await eventRow(eventId))['league_id']).toBeNull();
    });

    describe('AC13 provisional automatic carry-over', () => {
      it('carries provisional players atomically, pauses registered players, and audits the system carry', async () => {
        const eventId = await unranked();
        expect((await join(world.member, eventId)).error).toBeNull();
        await acceptTarget(eventId, world.provisional.id);
        const before = await registrations(eventId);
        const provisionalBefore = before.find((row) => row['user_id'] === world.provisional.id)!;
        const result = await edit(eventId, { league_id: leagueA });
        expect(result.data).toMatchObject({
          change_kind: 'major',
          reconfirmation_generation: 1,
          carried_count: 1
        });
        const after = await registrations(eventId);
        const carried = after.find((row) => row['user_id'] === world.provisional.id)!;
        expect(carried).toMatchObject({
          required: 1,
          confirmed: 1,
          attempt_required: 1,
          attempt_confirmed: 1,
          reconfirmed_at: null,
          attempt_reconfirmed_at: null
        });
        // Queue identity is untouched: order, attempt, acceptance instant.
        expect(carried['accepted_order']).toBe(provisionalBefore['accepted_order']);
        expect(carried['attempt']).toBe(provisionalBefore['attempt']);
        expect(carried['accepted_at']).toEqual(provisionalBefore['accepted_at']);
        expect(carried['participation']).not.toBeNull();
        for (const registered of after.filter((row) => row['user_id'] !== world.provisional.id))
          expect(registered).toMatchObject({ required: 1, confirmed: 0, participation: null });
        const [system] = await audit(eventId, 'reconfirmation_carried');
        expect(system).toMatchObject({
          target: world.provisional.id,
          reason: 'provisional_system_carry'
        });
        expect(system?.['after_data']).toMatchObject({
          required_generation: 1,
          confirmed_generation: 1
        });
        // No impossible reconfirmation notification for the provisional player.
        expect((await consentNotices(eventId)).map((row) => row['recipient'])).not.toContain(
          world.provisional.id
        );
        expect(
          (
            await sqlRows(
              `select reconfirmation_required_count::int as n from public.match_registration_counts(${sqlText(eventId)})`
            )
          )[0]
        ).toEqual({ n: 2 });
        // Provisional restrictions are untouched by the carry.
        expect(
          (
            await sqlRows(
              `select is_provisional from public.player_profiles where user_id = ${sqlText(world.provisional.id)}`
            )
          )[0]
        ).toEqual({ is_provisional: true });
      });

      it('mixed quartet: claimed players reconfirm normally, unclaimed carry, and a later claim adds no debt', async () => {
        const claimedBefore = await newProvisional('claimed-before');
        const claimedAfter = await newProvisional('claimed-after');
        const eventId = await unranked();
        expect((await join(world.member, eventId)).error).toBeNull();
        await acceptTarget(eventId, claimedBefore.id);
        await acceptTarget(eventId, claimedAfter.id);
        // Claimed before the edit: registered, so ordinary consent applies.
        await claim(claimedBefore);
        const first = await edit(eventId, { league_id: leagueA });
        expect(first.data).toMatchObject({ reconfirmation_generation: 1, carried_count: 1 });
        const by = async (user: string) =>
          (await registrations(eventId)).find((row) => row['user_id'] === user)!;
        expect(await by(claimedAfter.id)).toMatchObject({ required: 1, confirmed: 1 });
        expect(await by(claimedBefore.id)).toMatchObject({
          required: 1,
          confirmed: 0,
          participation: null
        });
        // Claim between generation creation and reconfirmation: no counter reset, no consent debt.
        await claim(claimedAfter);
        expect(await by(claimedAfter.id)).toMatchObject({
          required: 1,
          confirmed: 1,
          accepted_order: (await by(claimedAfter.id))['accepted_order']
        });
        expect((await reconfirm(eventId, world.member, 1)).error).toBeNull();
        expect((await consentNotices(eventId)).map((row) => row['recipient'])).not.toContain(
          claimedAfter.id
        );
        // Once claimed, a later major edit requires ordinary consent from that player too.
        const second = await edit(eventId, { league_id: leagueB });
        expect(second.data).toMatchObject({ reconfirmation_generation: 2, carried_count: 0 });
        expect(await by(claimedAfter.id)).toMatchObject({
          required: 2,
          confirmed: 1,
          participation: null
        });
      });

      it('carry then cutoff: registered players expire, provisional players keep their place', async () => {
        const eventId = await unranked();
        expect((await join(world.member, eventId)).error).toBeNull();
        await acceptTarget(eventId, world.provisional.id);
        expect((await edit(eventId, { league_id: leagueA })).error).toBeNull();
        await sleepUntilCutoff(eventId);
        const rows = await registrations(eventId);
        expect(rows.find((row) => row['user_id'] === world.member.id)).toMatchObject({
          lifecycle: 'expired'
        });
        expect(rows.find((row) => row['user_id'] === world.provisional.id)).toMatchObject({
          lifecycle: 'accepted',
          required: 1,
          confirmed: 1
        });
        expect(
          (await audit(eventId, 'reconfirmation_excluded')).map((row) => row['target'])
        ).toContain(world.member.id);
      });
    });

    it('stale generation cannot reconfirm after a newer Ranked change', async () => {
      const eventId = await unranked();
      await join(world.member, eventId);
      expect((await edit(eventId, { league_id: leagueA })).error).toBeNull();
      expect((await edit(eventId, { league_id: leagueB })).error).toBeNull();
      expect((await reconfirm(eventId, world.member, 1)).error?.message).toBe(
        'MATCH_MANAGEMENT_STALE_GENERATION'
      );
      expect((await reconfirm(eventId, world.member, 2)).error).toBeNull();
      expect(
        (await registrations(eventId)).find((row) => row['user_id'] === world.member.id)
      ).toMatchObject({ confirmed: 2, required: 2 });
    });

    it('serializes concurrent guest approval against the Ranked switch under the event lock', async () => {
      for (let round = 0; round < 3; round += 1) {
        const eventId = await unranked();
        expect((await join(world.outsider, eventId)).error).toBeNull();
        const attempt = await pendingAttempt(eventId, world.outsider.id);
        const [approval, switched] = await Promise.all([
          owner.client.rpc('decide_match_registration', {
            p_match_event_id: eventId,
            p_attempt_id: attempt,
            p_decision: 'approve'
          }),
          edit(eventId, { league_id: leagueA })
        ]);
        const [guest] = (await registrations(eventId)).filter(
          (row) => row['user_id'] === world.outsider.id
        );
        const leagueId = (await eventRow(eventId))['league_id'];
        // Never a Ranked event with an accepted nonmember created by this race.
        expect(leagueId !== null && guest?.['lifecycle'] === 'accepted').toBe(false);
        expect(approval.error === null || switched.error === null).toBe(true);
        expect([null, 'MATCH_MANAGEMENT_RANKED_NONMEMBERS_ACCEPTED']).toContain(
          switched.error?.message ?? null
        );
        expect(guest?.['lifecycle']).toBe(approval.error ? 'pending' : 'accepted');
      }
    });

    it('serializes concurrent membership removal against the Ranked switch without deadlock', async () => {
      const racer = world.former;
      for (let round = 0; round < 2; round += 1) {
        await executeTrustedSql(
          `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
           values (${sqlText(world.communityId)},${sqlText(racer.id)},'member','active',now()-interval '1 day',now()-interval '1 day')`
        );
        const eventId = await unranked();
        expect((await join(racer, eventId)).error).toBeNull();
        const membership = String(
          (
            await sqlRows(
              `select id::text as id from public.community_members
              where community_id = ${sqlText(world.communityId)} and user_id = ${sqlText(racer.id)} and valid_until is null`
            )
          )[0]?.['id']
        );
        const [removal, switched] = await Promise.all([
          world.admin.client.rpc('govern_community_member', {
            p_community_id: world.communityId,
            p_membership_id: membership,
            p_action: 'remove'
          }),
          edit(eventId, { league_id: leagueA })
        ]);
        expect(removal.error).toBeNull();
        // Removal won the lock: the nonmember is accepted, so the typed rejection leaves nothing
        // changed. Otherwise the switch won and the later removal is ordinary history.
        expect([null, 'MATCH_MANAGEMENT_RANKED_NONMEMBERS_ACCEPTED']).toContain(
          switched.error?.message ?? null
        );
        expect(await eventRow(eventId)).toMatchObject(
          switched.error
            ? { league_id: null, generation: 0 }
            : { league_id: leagueA, generation: 1 }
        );
      }
    });
  }
);
