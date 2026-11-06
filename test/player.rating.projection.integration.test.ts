import { beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  activateRatingProjection,
  confirmAuto,
  confirmedGroup,
  confirmManual,
  currentCalculations,
  eventCountFor,
  finalizeSql,
  initialLevels,
  ledgerFingerprint,
  ledgerOf,
  nextTailPlayedAt,
  oracleReplay,
  ratingProjectionControl,
  ratingStates,
  ratingWorld,
  setEventType,
  setRatingProjectionActive,
  stripRevision,
  submitPendingGroup,
  toOracleGroup,
  toQuartet,
  type LedgerCalculation,
  type PendingGroup,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import {
  insertAcceptedRegistration,
  insertFixtureEvent
} from './helpers/provisional-player-fixtures';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt
} from './helpers/match-result-review-fixtures';
import {
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';
import { asRecord } from './helpers/match-registration-sql';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('rating projection of confirmed results', { timeout: 180_000 }, () => {
  let world: RatingWorld;
  const levels = [3, 4, 4.5, 5, 3.5, 4.2, 5.5, 2.5, 4.8, 3.2, 6, 1.5];
  let ids: string[];

  beforeAll(async () => {
    if (!environment.env) return;
    // A suite that switches the projector off and fails before reactivating would leak a dormant
    // projector into this file; every test here needs it active.
    await setRatingProjectionActive(true);
    world = await ratingWorld(environment.env, 'proj');
    const players = await Promise.all(levels.map((level, i) => world.player(`p${i}`, level)));
    ids = players.map((p) => p.id);
  });

  const quartet = (...indexes: [number, number, number, number]): Quartet =>
    toQuartet(indexes.map((i) => ids[i]!));

  it.skipIf(!environment.env)(
    'AUTO_48H confirmation writes four logical events, one count per played participant',
    async () => {
      const before = await ratingProjectionControl();
      const players = quartet(0, 1, 2, 3);
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      expect(await eventCountFor([group.proposalId])).toBe(4);
      const ledger = await ledgerOf([group.proposalId]);
      expect(ledger).toHaveLength(4);
      expect(ledger.every((entry) => entry.calculations.length === 1)).toBe(true);

      const expected = await oracleReplay([toOracleGroup(group)], await initialLevels(players));
      expect(stripRevision(await ratingStates(players))).toEqual(expected.states);
      const states = await ratingStates(players);
      for (const id of players) expect(states[id]!.groups).toBe(1);
      for (const entry of currentCalculations(ledger))
        expect(entry.afterMu).toBe(expected.steps.get(group.proposalId)![entry.userId]!.after);

      // Bystanders are untouched; the watermark and revision moved exactly once.
      expect((await ratingStates([ids[4]!]))[ids[4]!]).toMatchObject({ groups: 0, revision: 0 });
      const after = await ratingProjectionControl();
      expect(after['revision']).toBe(Number(before['revision']) + 1);
      expect(after['watermark_group']).toBe(group.proposalId);
      for (const entry of ledger) expect(entry.calculations[0]!.revision).toBe(after['revision']);
    }
  );

  it.skipIf(!environment.env)(
    'MANUAL confirmation produces the same projection as the oracle',
    async () => {
      const players = quartet(4, 5, 6, 7);
      const group = await submitPendingGroup(
        {
          eventId: await world.newEvent(),
          players,
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id,
          classification: 'team_b'
        },
        1
      );
      const confirmationId = await confirmManual(group);
      const [source] = await sqlRows(
        `select source from public.match_event_result_confirmations where id = '${confirmationId}'`
      );
      expect(source!['source']).toBe('MANUAL');
      const expected = await oracleReplay([toOracleGroup(group)], await initialLevels(players));
      expect(stripRevision(await ratingStates(players))).toEqual(expected.states);
      expect(await eventCountFor([group.proposalId])).toBe(4);
    }
  );

  it.skipIf(!environment.env)(
    'retries and repeated projection append nothing and change no state',
    async () => {
      const players = quartet(8, 9, 10, 11);
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const fingerprint = await ledgerFingerprint(players);
      const states = await ratingStates(players);
      const control = await ratingProjectionControl();

      const [retry] = await sqlRows(finalizeSql(group.proposalId, 'AUTO_48H'));
      expect(retry!['id']).toBe(group.confirmationId);
      await sqlRows(`select public.project_confirmed_rating_group('${group.proposalId}')`);
      const rerun = await activateRatingProjection();
      expect(rerun.changed).toBe(false);

      expect(await ledgerFingerprint(players)).toBe(fingerprint);
      expect(await ratingStates(players)).toEqual(states);
      expect(await ratingProjectionControl()).toEqual(control);
      expect(await eventCountFor([group.proposalId])).toBe(4);
    }
  );

  it.skipIf(!environment.env)(
    'friendly, incomplete, pending, disputed and reserve inputs have zero rating effect',
    async () => {
      const players = quartet(0, 1, 2, 3);
      const reserve = (await world.player('reserve', 4)).id;
      const snapshot = async () => ({
        states: await ratingStates([...players, reserve]),
        control: await ratingProjectionControl(),
        events: Number(
          (await sqlRows('select count(*)::int as count from public.player_rating_events'))[0]![
            'count'
          ]
        )
      });
      const before = await snapshot();

      const friendlyEvent = await world.newEvent();
      await setEventType(friendlyEvent, 'friendly');
      await confirmedGroup({
        eventId: friendlyEvent,
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      await confirmedGroup({
        eventId: await world.newEvent(),
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification: 'incomplete'
      });
      // Pending: never confirmed. Disputed: a rejected version cannot confirm. Both stay
      // inside their review window so the shared scheduler never picks them up.
      await submitPendingGroup(
        {
          eventId: await world.newEvent(),
          players,
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id
        },
        1
      );
      const disputed = await submitPendingGroup(
        {
          eventId: await world.newEvent(),
          players,
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id
        },
        1
      );
      await fixtureSql(`insert into public.match_event_result_reviews(
        proposal_id, proposal_version, reviewer_user_id, decision, reason_code, request_id
      ) values ('${disputed.proposalId}', 1, '${players[2]}', 'reject', 'WRONG_SCORE', '${crypto.randomUUID()}')`);
      await fixtureSql(`insert into public.match_event_result_reviews(
        proposal_id, proposal_version, reviewer_user_id, decision, request_id
      ) values ('${disputed.proposalId}', 1, '${players[0]}', 'approve', '${crypto.randomUUID()}')`);
      const [refused] = await sqlRows(finalizeSql(disputed.proposalId, 'MANUAL', players[0]));
      expect(refused!['id']).toBeNull();

      expect(await snapshot()).toEqual(before);

      // A reserve registered on a rated event is not one of the four played team IDs.
      const rated = await world.newEvent();
      await insertAcceptedRegistration(rated, reserve);
      const group = await confirmedGroup({
        eventId: rated,
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      expect(await eventCountFor([group.proposalId])).toBe(4);
      expect((await ratingStates([reserve]))[reserve]).toEqual(before.states[reserve]);
      const reserveEvents = await sqlRows(
        `select count(*)::int as count from public.player_rating_events where user_id = '${reserve}'`
      );
      expect(reserveEvents[0]!['count']).toBe(0);
    }
  );

  // Production seam evidence: cancellation is only legal before the event starts and before any
  // result exists (assert_match_management_action_locked: MATCH_MANAGEMENT_STARTED /
  // MATCH_MANAGEMENT_RESULT_PROTECTED), and submit_match_event_result refuses cancelled events
  // (MATCH_RESULT_CANCELLED) while taking protection on the first proposal. A cancelled event can
  // therefore never hold a ratable proposal in either order; both directions are exercised through
  // the real RPCs and the rating state must stay bit-for-bit unchanged.
  it.skipIf(!environment.env)(
    'cancelled events and cancellation attempts on rated events never change any rating state',
    async () => {
      const players = quartet(0, 1, 2, 3);
      const asAdmin = (statement: string) =>
        queryTrustedSql(`do $$ begin
          perform set_config('request.jwt.claim.sub','${world.admin.id}',true);
          ${statement}
          set constraints all immediate;
        end $$;`);
      const snapshot = async () => ({
        states: await ratingStates(players),
        control: await ratingProjectionControl(),
        ledger: await ledgerFingerprint(players),
        events: Number(
          (await sqlRows('select count(*)::int as count from public.player_rating_events'))[0]![
            'count'
          ]
        )
      });

      // Direction 1: cancel first (real RPC), then results are refused.
      const futureEvent = crypto.randomUUID();
      await insertFixtureEvent({
        id: futureEvent,
        communityId: world.communityId,
        creatorId: world.admin.id,
        visibility: 'community_open'
      });
      const before = await snapshot();
      await asAdmin(
        `perform public.cancel_match_event('${futureEvent}','Weather',1,'${crypto.randomUUID()}');`
      );
      const [cancelled] = await sqlRows(
        `select status from public.match_events where id = '${futureEvent}'`
      );
      expect(cancelled!['status']).toBe('cancelled');
      await expect(
        asAdmin(`perform public.submit_match_event_result('${futureEvent}', 1,
          jsonb_build_object('team_a', jsonb_build_array('${players[0]}','${players[1]}'),
            'team_b', jsonb_build_array('${players[2]}','${players[3]}')),
          '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb,
          jsonb_build_object('date','2026-10-01','time','18:00'), 'Court 1', '${crypto.randomUUID()}');`)
      ).rejects.toSatisfy((error) => sqlErrorMessage(error).includes('MATCH_RESULT_CANCELLED'));
      const [proposals] = await sqlRows(
        `select count(*)::int as count from public.match_event_result_proposals where match_event_id = '${futureEvent}'`
      );
      expect(proposals!['count']).toBe(0);
      expect(await snapshot()).toEqual(before);
      // Re-activation (backfill) skips the cancelled event too; the shared watermark may move
      // with unrelated groups, so only the rating facts are compared.
      await activateRatingProjection();
      const { control: _control, ...afterFacts } = await snapshot();
      const { control: _before, ...beforeFacts } = before;
      expect(afterFacts).toEqual(beforeFacts);

      // Direction 2: results first, then cancellation is refused and nothing moves.
      const ratedEvent = await world.newEvent();
      const group = await confirmedGroup({
        eventId: ratedEvent,
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      expect(await eventCountFor([group.proposalId])).toBe(4);
      const rated = await snapshot();
      await expect(
        asAdmin(
          `perform public.cancel_match_event('${ratedEvent}','Weather',1,'${crypto.randomUUID()}');`
        )
      ).rejects.toSatisfy((error) =>
        /MATCH_MANAGEMENT_(STARTED|RESULT_PROTECTED)/.test(sqlErrorMessage(error))
      );
      const [open] = await sqlRows(
        `select status from public.match_events where id = '${ratedEvent}'`
      );
      expect(open!['status']).toBe('open');
      const [retry] = await sqlRows(finalizeSql(group.proposalId, 'AUTO_48H'));
      expect(retry!['id']).toBe(group.confirmationId);
      expect(await snapshot()).toEqual(rated);
    }
  );

  it.skipIf(!environment.env)(
    'a failure after calculation and before the final state leaves nothing behind, then a retry succeeds',
    async () => {
      const players = quartet(0, 1, 5, 6);
      const group = await submitPendingGroup({
        eventId: await world.newEvent(),
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const suffix = crypto.randomUUID().replaceAll('-', '');
      await fixtureSql(`create function public.paf_rating_fail_${suffix}() returns trigger
        language plpgsql set search_path = '' as $$
        begin raise exception using errcode = 'P0001', message = 'FIXTURE_RATING_STATE_FAILURE'; end $$;
        create trigger paf_rating_fail_trigger_${suffix} before update on public.global_player_ratings
          for each row when (new.user_id = '${players[2]}'::uuid) execute function public.paf_rating_fail_${suffix}();`);
      const states = await ratingStates(players);
      const control = await ratingProjectionControl();
      const fingerprint = await ledgerFingerprint(players);
      try {
        await expect(queryTrustedSql(finalizeSql(group.proposalId, 'AUTO_48H'))).rejects.toSatisfy(
          (error) => sqlErrorMessage(error).includes('FIXTURE_RATING_STATE_FAILURE')
        );
        const [proposal] = await sqlRows(
          `select status, (select count(*)::int from public.match_event_result_confirmations where proposal_id = p.id) as confirmations,
                  (select count(*)::int from public.match_event_audit_log where after_data ->> 'proposal_id' = p.id::text and action = 'result_confirmed') as audits
             from public.match_event_result_proposals p where p.id = '${group.proposalId}'`
        );
        expect(proposal).toEqual({ status: 'pending', confirmations: 0, audits: 0 });
        expect(await eventCountFor([group.proposalId])).toBe(0);
        expect(await ratingStates(players)).toEqual(states);
        expect(await ratingProjectionControl()).toEqual(control);
        expect(await ledgerFingerprint(players)).toBe(fingerprint);
      } finally {
        await fixtureSql(`drop trigger paf_rating_fail_trigger_${suffix} on public.global_player_ratings;
          drop function public.paf_rating_fail_${suffix}();`);
      }
      await confirmAuto(group);
      expect(await eventCountFor([group.proposalId])).toBe(4);
    }
  );

  async function freshQuartetPool(count: number, label: string): Promise<string[]> {
    const players = await Promise.all(
      Array.from({ length: count }, (_, i) =>
        world.player(`${label}${i}`, [3, 4, 4.5, 5, 3.5, 5.5, 2.5][i % 7]!)
      )
    );
    return players.map((p) => p.id);
  }

  async function expectOracle(groups: readonly PendingGroup[], everyone: readonly string[]) {
    const oracle = await oracleReplay(groups.map(toOracleGroup), await initialLevels(everyone));
    expect(stripRevision(await ratingStates(Object.keys(oracle.states)))).toEqual(oracle.states);
    return oracle;
  }

  it.skipIf(!environment.env)(
    'reverse ingestion converges to the chronological oracle and keeps every original calculation',
    async () => {
      const pool = await freshQuartetPool(7, 'rev');
      const at = (i: number) => pool[i]!;
      const base = Date.parse(await nextTailPlayedAt());
      const stamp = (hours: number) => new Date(base + hours * 3_600_000).toISOString();
      const specs = [
        {
          players: toQuartet([at(0), at(1), at(2), at(3)]),
          playedAt: stamp(0),
          classification: 'team_a' as const
        },
        {
          players: toQuartet([at(0), at(2), at(4), at(5)]),
          playedAt: stamp(1),
          classification: 'team_b' as const
        },
        {
          players: toQuartet([at(1), at(3), at(4), at(6)]),
          playedAt: stamp(2),
          classification: 'draw' as const
        }
      ];
      const pending: PendingGroup[] = [];
      for (const spec of specs)
        pending.push(
          await submitPendingGroup({
            ...spec,
            eventId: await world.newEvent(),
            submittedBy: world.admin.id
          })
        );

      // Newest first, oldest last: the last two confirmations are late insertions.
      const confirmed: PendingGroup[] = [];
      let newestFirstRevision: LedgerCalculation | undefined;
      for (const group of [...pending].reverse()) {
        await confirmAuto(group);
        confirmed.push(group);
        await expectOracle(confirmed, pool);
        if (group === pending[2]) {
          const [entry] = await ledgerOf([group.proposalId]);
          newestFirstRevision = entry!.calculations[0]!;
        }
      }

      const ledger = await ledgerOf(pending.map((g) => g.proposalId));
      expect(ledger).toHaveLength(12);
      // Exact credits: one per distinct group, whatever the number of revisions.
      const final = await ratingStates(pool);
      for (const id of pool)
        expect(final[id]!.groups).toBe(ledger.filter((entry) => entry.userId === id).length);
      // The newest group was confirmed first: its first calculation survives unchanged and
      // later revisions append beside it, strictly increasing.
      const newestEntries = ledger.filter((entry) => entry.groupId === pending[2]!.proposalId);
      expect(newestEntries.some((entry) => entry.calculations.length >= 2)).toBe(true);
      const firstEntry = (await ledgerOf([pending[2]!.proposalId]))[0]!;
      expect(firstEntry.calculations[0]).toEqual(newestFirstRevision);
      for (const entry of ledger) {
        const revisions = entry.calculations.map((c) => c.revision);
        expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
        expect(new Set(revisions).size).toBe(revisions.length);
      }
      // Current readers see the latest calculation, equal to the clean sorted replay.
      const oracle = await oracleReplay(pending.map(toOracleGroup), await initialLevels(pool));
      for (const current of currentCalculations(ledger))
        expect(current.afterMu).toBe(oracle.steps.get(current.groupId)![current.userId]!.after);
      // Repeating the projection after the replay appends nothing.
      const fingerprint = await ledgerFingerprint(pool);
      expect((await activateRatingProjection()).changed).toBe(false);
      expect(await ledgerFingerprint(pool)).toBe(fingerprint);
    }
  );

  it.skipIf(!environment.env)(
    'equal timestamps are ordered by proposal UUID in either confirmation order',
    async () => {
      for (const reverse of [false, true]) {
        const pool = await freshQuartetPool(6, reverse ? 'tie-r' : 'tie-f');
        const instant = await nextTailPlayedAt();
        const pending = [
          await submitPendingGroup({
            eventId: await world.newEvent(),
            players: [pool[0]!, pool[1]!, pool[2]!, pool[3]!],
            playedAt: instant,
            submittedBy: world.admin.id,
            classification: 'team_a'
          }),
          await submitPendingGroup({
            eventId: await world.newEvent(),
            players: [pool[0]!, pool[4]!, pool[2]!, pool[5]!],
            playedAt: instant,
            submittedBy: world.admin.id,
            classification: 'team_b'
          })
        ];
        for (const group of reverse ? [...pending].reverse() : pending) await confirmAuto(group);
        const oracle = await expectOracle(pending, pool);
        const [first, second] = [...pending].sort((l, r) => (l.proposalId < r.proposalId ? -1 : 1));
        // The smaller UUID is processed first: the second group starts from its result.
        expect(oracle.steps.get(first!.proposalId)![pool[0]!]!.before).toBeLessThanOrEqual(7);
        expect(oracle.steps.get(second!.proposalId)![pool[0]!]!.before).toBe(
          oracle.steps.get(first!.proposalId)![pool[0]!]!.after
        );
        const current = currentCalculations(await ledgerOf(pending.map((g) => g.proposalId)));
        const secondShared = current.find(
          (c) => c.groupId === second!.proposalId && c.userId === pool[0]
        )!;
        const firstShared = current.find(
          (c) => c.groupId === first!.proposalId && c.userId === pool[0]
        )!;
        expect(secondShared.beforeMu).toBe(firstShared.afterMu);
        expect(secondShared.beforeGroups).toBe(1);
      }
    }
  );

  it.skipIf(!environment.env)(
    'groups from different communities share one app-wide state per player',
    async () => {
      const other = await world.newCommunity();
      const pool = await freshQuartetPool(6, 'xc');
      const first = await confirmedGroup({
        eventId: await world.newEvent(),
        players: [pool[0]!, pool[1]!, pool[2]!, pool[3]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const second = await confirmedGroup({
        eventId: await world.newEvent(other.communityId),
        players: [pool[0]!, pool[1]!, pool[4]!, pool[5]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: other.adminId
      });
      const rows = await queryTrustedSql(
        'select count(*)::int as count from public.global_player_ratings where user_id = any($1::uuid[])',
        { values: [pool] }
      );
      expect(rows.rows[0]!['count']).toBe(pool.length);
      await expectOracle([first, second], pool);
      const ledger = currentCalculations(await ledgerOf([first.proposalId, second.proposalId]));
      const before = ledger.find((e) => e.userId === pool[0] && e.groupId === second.proposalId)!;
      const after = ledger.find((e) => e.userId === pool[0] && e.groupId === first.proposalId)!;
      // The second community's group starts where the first community's group ended.
      expect(before.beforeMu).toBe(after.afterMu);
      expect(before.beforeGroups).toBe(after.afterGroups);
    }
  );
});

// A single completed set classifies as incomplete; two won sets decide the group.
const decisiveSets = [
  { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];

describe(
  'rating projection through the production confirmation commands',
  { timeout: 180_000 },
  () => {
    it.skipIf(!environment.env)(
      'the review RPC (PostgREST session) and the scheduler each project four events, late-ordered',
      async () => {
        const f = await createMatchResultReviewFixtures(environment.env!);
        try {
          const group = f.teamsForGroup(1);
          const players = toQuartet([...group.team_a, ...group.team_b]);
          for (const [index, id] of players.entries()) {
            const player = f.players.find((candidate) => candidate.id === id)!;
            const onboarded = await player.client.rpc('onboard_player', {
              p_display_name: `Command ${index}`,
              p_preferred_side: 'EITHER',
              p_initial_level: [3, 4.5, 4, 5.5][index]!
            });
            expect(onboarded.error).toBeNull();
          }
          const levels = await initialLevels(players);

          // Manual: an opposing-team approval through the authenticated review command.
          const manualEvent = await f.protectedEvent({ competitive: true });
          const manualSubmit = await f.submit(manualEvent, { sets: decisiveSets });
          expect(manualSubmit.error).toBeNull();
          const manualId = String(asRecord(manualSubmit.data).proposal_id);
          const approver = f.players.find((candidate) => candidate.id === group.team_b[0])!;
          const approved = await f.rpc(approver, 'review_match_event_result', {
            p_proposal_id: manualId,
            p_expected_version: 1,
            p_decision: 'approve',
            p_reason_code: null,
            p_reason_note: null,
            p_request_id: crypto.randomUUID()
          });
          expect(approved.error).toBeNull();
          const [manual] = await sqlRows(
            `select source from public.match_event_result_confirmations where proposal_id = '${manualId}'`
          );
          expect(manual!['source']).toBe('MANUAL');
          expect(await eventCountFor([manualId])).toBe(4);

          // Automatic: the real scheduler confirms once the review deadline has passed.
          const autoEvent = await f.protectedEvent({ competitive: true });
          const autoSubmit = await f.submit(autoEvent, { sets: decisiveSets });
          expect(autoSubmit.error).toBeNull();
          const autoId = String(asRecord(autoSubmit.data).proposal_id);
          await setResultReviewDeadlineOffset(autoId, 1, -60);
          const processed = await processDueMatchEventResults();
          expect(processed).toMatchObject({ confirmed: 1, failed: 0 });
          const [auto] = await sqlRows(
            `select source from public.match_event_result_confirmations where proposal_id = '${autoId}'`
          );
          expect(auto!['source']).toBe('AUTO_48H');
          expect(await eventCountFor([autoId])).toBe(4);

          const oracle = await oracleReplay(
            [manualId, autoId].map((id) => ({
              id,
              playedAt: reviewResultPlayedAt.instant,
              classification: 'team_a' as const,
              players
            })),
            levels
          );
          expect(stripRevision(await ratingStates(players))).toEqual(oracle.states);
          for (const state of Object.values(await ratingStates(players)))
            expect(state.groups).toBe(2);
        } finally {
          await f.cleanup();
        }
      }
    );
  }
);
