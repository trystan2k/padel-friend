import { createClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  parseMatchEventRatingChanges,
  parseRatingGroupExplanation,
  parseRatingHistoryPage,
  parseRatingProgress,
  parseRatingSummaryResult
} from '../src/features/player/rating-contracts';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  addInvitedPlayer,
  CLAIM_PROFILE,
  claimScenario,
  sessionClient,
  verifyInvitation
} from './helpers/provisional-claim-fixtures';
import {
  insertFixtureCommunity,
  type ProvisionalFixtureActor
} from './helpers/provisional-player-fixtures';
import {
  confirmedGroup,
  currentCalculations,
  ledgerOf,
  nextTailPlayedAt,
  ratingStates,
  ratingWorld,
  toQuartet,
  type PendingGroup,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Actor = ProvisionalFixtureActor;

describe('rating readers: authorized sporting DTOs', { timeout: 300_000 }, () => {
  let world: RatingWorld;
  let me: Actor;
  let mate: Actor;
  let rivalA: Actor;
  let rivalB: Actor;
  let provisional: Actor;
  let outsider: Actor;
  let unrelatedAdmin: Actor;
  let newcomer: Actor;
  let privateCommunity: { communityId: string; adminId: string };
  let first: PendingGroup;
  let second: PendingGroup;
  let privateGroup: PendingGroup;
  let spare: Actor[];

  const quartet = (...ids: string[]): Quartet => toQuartet(ids);

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'read');
    [me, mate, rivalA, rivalB, outsider, unrelatedAdmin, newcomer, ...spare] = await Promise.all([
      world.player('me', 4),
      world.player('mate', 4.5),
      world.player('rivala', 3.5),
      world.player('rivalb', 5),
      world.player('outsider', 4),
      world.player('unrelated', 4),
      world.player('newcomer', 3),
      world.player('spare1', 4),
      world.player('spare2', 4),
      world.player('spare3', 4),
      world.player('spare4', 4)
    ]);
    provisional = await world.provisional('prov', 3.5);
    privateCommunity = await world.newCommunity();
    const unrelatedCommunityId = crypto.randomUUID();
    await insertFixtureCommunity({
      id: unrelatedCommunityId,
      visibility: 'private',
      adminId: unrelatedAdmin.id,
      memberIds: [outsider.id]
    });
    // Group 1 (world community, provisional on the opposing side) then group 2, then a
    // group in a PRIVATE community the world admin has no rights in.
    first = await confirmedGroup({
      eventId: await world.newEvent(),
      players: quartet(me.id, mate.id, provisional.id, rivalA.id),
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id,
      classification: 'team_a'
    });
    second = await confirmedGroup({
      eventId: await world.newEvent(),
      players: quartet(me.id, rivalB.id, mate.id, rivalA.id),
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id,
      classification: 'draw'
    });
    privateGroup = await confirmedGroup({
      eventId: await world.newEvent(privateCommunity.communityId),
      players: quartet(me.id, rivalA.id, rivalB.id, mate.id),
      playedAt: await nextTailPlayedAt(),
      submittedBy: privateCommunity.adminId,
      classification: 'team_b'
    });
  });

  it.skipIf(!environment.env)(
    'owner receives the complete cross-community history, newest first',
    async () => {
      const summary = parseRatingSummaryResult((await me.client.rpc('get_my_rating_summary')).data);
      expect(summary).toMatchObject({ state: 'ready' });
      const state = (await ratingStates([me.id]))[me.id]!;
      expect(summary!.summary).toMatchObject({
        initial_display_level: 4,
        confirmed_competitive_game_groups: 3,
        reliability_percent: state.reliability,
        highest_display_level: state.highest
      });
      expect(summary!.summary!.display_level).toBeCloseTo(state.mu, 2);

      const history = parseRatingHistoryPage((await me.client.rpc('get_my_rating_history')).data);
      expect(history).toMatchObject({ state: 'ready', total_events: 3, next_cursor: null });
      expect(history!.revision).toBe(summary!.revision);
      expect(history!.items.map((item) => item.game_group_id)).toEqual([
        privateGroup.proposalId,
        second.proposalId,
        first.proposalId
      ]);
      // Stored numbers equal the ledger's current calculation, not a recomputation.
      const ledger = currentCalculations(
        await ledgerOf([first.proposalId, second.proposalId, privateGroup.proposalId])
      ).filter((entry) => entry.userId === me.id);
      for (const item of history!.items) {
        const stored = ledger.find((entry) => entry.groupId === item.game_group_id)!;
        expect(item.after_display_level).toBeCloseTo(stored.afterMu, 2);
        expect(item.before_display_level).toBeCloseTo(stored.beforeMu, 2);
        expect(item.after_confirmed_groups).toBe(stored.afterGroups);
      }
      expect(history!.items.at(-1)).toMatchObject({ before_display_level: 4, recalculated: false });
    }
  );

  it.skipIf(!environment.env)(
    'progress is lifetime, chronological, baselined and discloses sampling',
    async () => {
      const progress = parseRatingProgress((await me.client.rpc('get_my_rating_progress')).data);
      expect(progress).toMatchObject({
        state: 'ready',
        scope: 'lifetime',
        resolution: 'event',
        abbreviated: false,
        total_events: 3,
        baseline: { display_level: 4 }
      });
      expect(progress!.points.map((point) => point.game_group_id)).toEqual([
        first.proposalId,
        second.proposalId,
        privateGroup.proposalId
      ]);
      expect(progress!.range).toEqual({
        from: progress!.points[0]!.played_at,
        to: progress!.points[2]!.played_at
      });

      const sampled = parseRatingProgress(
        (await me.client.rpc('get_my_rating_progress', { p_max_points: 2 })).data
      );
      expect(sampled).toMatchObject({ resolution: 'sampled', abbreviated: true, total_events: 3 });
      expect(sampled!.points.map((point) => point.game_group_id)).toEqual([
        first.proposalId,
        privateGroup.proposalId
      ]);
      expect(
        (await me.client.rpc('get_my_rating_progress', { p_max_points: 1 })).error?.message
      ).toBe('RATING_PROGRESS_INVALID_ARGUMENT');
    }
  );

  it.skipIf(!environment.env)(
    'a rated player without history gets an explicit empty state, not an error',
    async () => {
      const summary = parseRatingSummaryResult(
        (await newcomer.client.rpc('get_my_rating_summary')).data
      );
      expect(summary).toMatchObject({
        state: 'empty',
        summary: { display_level: 3, confirmed_competitive_game_groups: 0, reliability_percent: 10 }
      });
      expect(
        parseRatingHistoryPage((await newcomer.client.rpc('get_my_rating_history')).data)
      ).toMatchObject({ state: 'empty', total_events: 0, items: [], next_cursor: null });
      expect(
        parseRatingProgress((await newcomer.client.rpc('get_my_rating_progress')).data)
      ).toMatchObject({
        state: 'empty',
        points: [],
        range: null,
        baseline: { display_level: 3 }
      });
    }
  );

  it.skipIf(!environment.env)(
    'keyset pages never repeat or skip rows and bind to one revision',
    async () => {
      const page1 = (await me.client.rpc('get_my_rating_history', { p_limit: 2 })).data;
      const one = parseRatingHistoryPage(page1)!;
      expect(one.items).toHaveLength(2);
      expect(one.next_cursor).not.toBeNull();
      const page2 = parseRatingHistoryPage(
        (
          await me.client.rpc('get_my_rating_history', {
            p_limit: 2,
            p_revision: one.revision,
            p_before_played_at: one.next_cursor!.played_at,
            p_before_game_group_id: one.next_cursor!.game_group_id
          })
        ).data
      )!;
      expect(page2.items.map((item) => item.game_group_id)).toEqual([first.proposalId]);
      expect(page2.next_cursor).toBeNull();
      expect([...one.items, ...page2.items].map((item) => item.game_group_id)).toEqual([
        privateGroup.proposalId,
        second.proposalId,
        first.proposalId
      ]);

      // Cursor arguments must come as a complete, revision-bound set.
      for (const args of [
        { p_limit: 2, p_before_played_at: one.next_cursor!.played_at },
        { p_limit: 2, p_revision: one.revision, p_before_game_group_id: first.proposalId },
        {
          p_limit: 2,
          p_before_played_at: one.next_cursor!.played_at,
          p_before_game_group_id: first.proposalId
        },
        { p_limit: 0 },
        { p_limit: 51 }
      ])
        expect((await me.client.rpc('get_my_rating_history', args)).error?.message).toBe(
          'RATING_HISTORY_INVALID_ARGUMENT'
        );

      // A confirmation elsewhere bumps the committed revision: the old cursor is rejected.
      await confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet(spare[0]!.id, spare[1]!.id, spare[2]!.id, spare[3]!.id),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const stale = await me.client.rpc('get_my_rating_history', {
        p_limit: 2,
        p_revision: one.revision,
        p_before_played_at: one.next_cursor!.played_at,
        p_before_game_group_id: one.next_cursor!.game_group_id
      });
      expect(stale.data).toBeNull();
      expect(stale.error?.message).toBe('RATING_REVISION_STALE');
      const restarted = parseRatingHistoryPage(
        (await me.client.rpc('get_my_rating_history')).data
      )!;
      expect(restarted.revision).toBeGreaterThan(one.revision);
      expect(restarted.items).toHaveLength(3);
    }
  );

  it.skipIf(!environment.env)(
    'an eligible result viewer reads all four players, provisional included',
    async () => {
      const response = await world.admin.client.rpc('get_rating_group_explanation', {
        p_game_group_id: first.proposalId
      });
      expect(response.error).toBeNull();
      const explanation = parseRatingGroupExplanation(response.data)!;
      expect(explanation.players.map((player) => player.user_id).sort()).toEqual(
        [me.id, mate.id, provisional.id, rivalA.id].sort()
      );
      const marked = explanation.players.find((player) => player.user_id === provisional.id)!;
      expect(marked).toMatchObject({ display_name: 'Provisional prov', is_provisional: true });
      expect(explanation.players.filter((player) => player.is_provisional)).toHaveLength(1);
      // Stored values match the ledger's current calculation.
      const ledger = currentCalculations(await ledgerOf([first.proposalId]));
      for (const player of explanation.players) {
        const stored = ledger.find((entry) => entry.userId === player.user_id)!;
        expect(player.after_display_level).toBeCloseTo(stored.afterMu, 2);
        expect(player.before_display_level).toBeCloseTo(stored.beforeMu, 2);
      }
      // No inviter, e-mail or account data anywhere in the serialized answer.
      const serialized = JSON.stringify(response.data);
      for (const forbidden of [
        world.admin.id,
        'invited_by',
        'email',
        '@test.local',
        'bio',
        'claim',
        'source_match'
      ])
        expect(serialized).not.toContain(forbidden);
      const raw: unknown = response.data;
      const rawPlayers =
        typeof raw === 'object' && raw !== null && 'players' in raw && Array.isArray(raw.players)
          ? raw.players
          : [];
      expect(Object.keys(rawPlayers[0] ?? {}).sort()).toEqual(
        [
          'after_confirmed_groups',
          'after_display_level',
          'after_reliability_percent',
          'applied_delta',
          'before_confirmed_groups',
          'before_display_level',
          'before_reliability_percent',
          'calculation_revision',
          'clamped',
          'config_version',
          'display_name',
          'engine',
          'engine_version',
          'expected_score',
          'is_provisional',
          'opponent_team_strength',
          'outcome_value',
          'own_team_strength',
          'raw_delta',
          'recalculated',
          'reliability_factor',
          'rounded_delta',
          'team',
          'user_id'
        ].sort()
      );

      const changes = parseMatchEventRatingChanges(
        (
          await world.admin.client.rpc('get_match_event_rating_changes', {
            p_match_event_id: first.eventId
          })
        ).data
      );
      expect(changes!.groups).toHaveLength(1);
      expect(
        changes!.groups[0]!.players.find((player) => player.user_id === provisional.id)
      ).toMatchObject({
        is_provisional: true
      });
    }
  );

  it.skipIf(!environment.env)(
    'a player of the group reads it even from another community',
    async () => {
      const own = await me.client.rpc('get_rating_group_explanation', {
        p_game_group_id: privateGroup.proposalId
      });
      expect(own.error).toBeNull();
      expect(parseRatingGroupExplanation(own.data)!.players).toHaveLength(4);
    }
  );

  it.skipIf(!environment.env)(
    'ACL matrix: private cross-community context stays denied with guessed ids',
    async () => {
      const denied = 'RATING_EXPLANATION_FORBIDDEN';
      // World admin has rights over community-A events only: the private group is invisible.
      // Unknown group ids fail identically, so existence is not an oracle.
      const unknown = crypto.randomUUID();
      for (const [actor, groupId] of [
        [world.admin, privateGroup.proposalId],
        [world.admin, unknown],
        [outsider, first.proposalId],
        [outsider, privateGroup.proposalId],
        [unrelatedAdmin, first.proposalId],
        [newcomer, second.proposalId]
      ] as const) {
        const response = await actor.client.rpc('get_rating_group_explanation', {
          p_game_group_id: groupId
        });
        expect(response.data).toBeNull();
        expect(response.error?.message).toBe(denied);
      }
      for (const [actor, eventId] of [
        [world.admin, privateGroup.eventId],
        [outsider, first.eventId],
        [unrelatedAdmin, second.eventId]
      ] as const) {
        const response = await actor.client.rpc('get_match_event_rating_changes', {
          p_match_event_id: eventId
        });
        expect(response.data).toBeNull();
        expect(response.error?.message).toBe(denied);
      }
      // Another player's history is not reachable at all: readers are self-scoped.
      const adminHistory = parseRatingHistoryPage(
        (await world.admin.client.rpc('get_my_rating_history')).data
      )!;
      expect(adminHistory.items).toEqual([]);
    }
  );

  it.skipIf(!environment.env)('anonymous callers hold no execute privilege', async () => {
    const env = environment.env!;
    const anonymous = createClient<Database>(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const calls = await Promise.all([
      anonymous.rpc('get_my_rating_summary'),
      anonymous.rpc('get_my_rating_history'),
      anonymous.rpc('get_my_rating_progress'),
      anonymous.rpc('get_rating_group_explanation', { p_game_group_id: first.proposalId }),
      anonymous.rpc('get_match_event_rating_changes', { p_match_event_id: first.eventId })
    ]);
    for (const call of calls) {
      expect(call.data).toBeNull();
      expect(call.error?.code).toBe('42501');
    }
  });

  it.skipIf(!environment.env)('an unclaimed provisional actor is denied every reader', async () => {
    const calls = await Promise.all([
      provisional.client.rpc('get_my_rating_summary'),
      provisional.client.rpc('get_my_rating_history'),
      provisional.client.rpc('get_my_rating_progress'),
      provisional.client.rpc('get_rating_group_explanation', { p_game_group_id: first.proposalId }),
      provisional.client.rpc('get_match_event_rating_changes', { p_match_event_id: first.eventId })
    ]);
    for (const call of calls) {
      expect(call.data).toBeNull();
      expect(call.error?.message).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    }
  });

  it.skipIf(!environment.env)(
    'helpers and the raw ledger stay unreachable for signed-in users',
    async () => {
      const privileges = await queryTrustedSql(
        `select p.proname, has_function_privilege('authenticated', p.oid, 'EXECUTE') as callable
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname like 'rating\\_%' escape '\\'
           or p.proname in ('get_my_rating_summary', 'get_my_rating_history', 'get_my_rating_progress',
                            'get_rating_group_explanation', 'get_match_event_rating_changes')
        order by 1`
      );
      const callable = privileges.rows
        .filter((row) => row['callable'])
        .map((row) => row['proname']);
      expect(callable).toEqual([
        'get_match_event_rating_changes',
        'get_my_rating_history',
        'get_my_rating_progress',
        'get_my_rating_summary',
        'get_rating_group_explanation'
      ]);
      const calculations = await me.client
        .from('player_rating_event_calculations')
        .select('rating_event_id');
      expect(calculations.error).not.toBeNull();
      const initializations = await me.client.from('player_rating_initializations').select('id');
      expect(initializations.error).not.toBeNull();
    }
  );

  it.skipIf(!environment.env)(
    'a late older confirmation shows current values and marks the recalculation',
    async () => {
      const before = parseRatingHistoryPage((await me.client.rpc('get_my_rating_history')).data)!;
      const late = await confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet(me.id, spare[0]!.id, spare[1]!.id, spare[2]!.id),
        playedAt: '2020-01-01T00:00:00.000Z',
        submittedBy: world.admin.id
      });
      const after = parseRatingHistoryPage((await me.client.rpc('get_my_rating_history')).data)!;
      expect(after.revision).toBeGreaterThan(before.revision);
      expect(after.items.at(-1)!.game_group_id).toBe(late.proposalId);
      const oldest = after.items.find((item) => item.game_group_id === first.proposalId)!;
      expect(oldest).toMatchObject({
        before_display_level: expect.any(Number),
        recalculated: true
      });
      expect(oldest.calculation_revision).toBeGreaterThan(1);
      // The drill-down serves the same current calculation as the list.
      const detail = parseRatingGroupExplanation(
        (
          await world.admin.client.rpc('get_rating_group_explanation', {
            p_game_group_id: first.proposalId
          })
        ).data
      )!;
      const mine = detail.players.find((player) => player.user_id === me.id)!;
      expect(mine.after_display_level).toBe(oldest.after_display_level);
      expect(mine.calculation_revision).toBe(oldest.calculation_revision);
      expect(mine.recalculated).toBe(true);
      // The first calculation is retained as audit evidence, never served as current.
      const [row] = (
        await queryTrustedSql(
          `select count(*)::int as count from public.player_rating_event_calculations c
           join public.player_rating_events e on e.id = c.rating_event_id
          where e.game_group_id = $1 and e.user_id = $2`,
          { values: [first.proposalId, me.id] }
        )
      ).rows;
      expect(row!['count']).toBeGreaterThan(1);
      // A drill-down pinned to an older revision is rejected, not served stale.
      const stale = await world.admin.client.rpc('get_rating_group_explanation', {
        p_game_group_id: first.proposalId,
        p_revision: before.revision
      });
      expect(stale.error?.message).toBe('RATING_REVISION_STALE');
    }
  );

  it.skipIf(!environment.env)(
    'a claimed player whose session is gone is denied, not shown an empty history',
    async () => {
      const scenario = await claimScenario(environment.env!, 'read-revoked');
      const invited = await addInvitedPlayer(scenario, {
        displayName: 'Revoked Rita',
        level: 3,
        label: 'read-revoked'
      });
      const verified = await verifyInvitation(scenario.env, invited.tokenHash);
      const client = sessionClient(scenario.env, verified.data.session!);
      expect((await client.rpc('claim_provisional_player', CLAIM_PROFILE)).error).toBeNull();
      expect((await client.rpc('get_my_rating_summary')).error).toBeNull();
      await queryTrustedSql('delete from auth.sessions where user_id = $1', {
        values: [invited.id]
      });
      const denied = await client.rpc('get_my_rating_history');
      expect(denied.data).toBeNull();
      expect(denied.error?.message).toBe('PROVISIONAL_PLAYER_RESTRICTED');
    }
  );
});
