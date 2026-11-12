import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  adjustmentFingerprint,
  adjustmentStates,
  approveOk,
  drainDueRegistrationCutoffs,
  platformAdminPlayer,
  ratingRow,
  submitExact,
  type LevelReviewActor,
  type ReliabilityArgs
} from './helpers/level-review-fixtures';
import { asRecord, sqlRows, waitForRows, withDeadline } from './helpers/match-registration-sql';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import {
  confirmedGroup,
  nextTailPlayedAt,
  eventCountFor,
  initialLevels,
  ledgerFingerprint,
  ledgerOf,
  oracleReplay,
  ratingStates,
  ratingWorld,
  stripRevision,
  toQuartet,
  type OracleGroup,
  type PendingGroup,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import {
  activeQuartet,
  claimRepair,
  committedRevisionNumber,
  effectiveSources,
  queueCorrection,
  repairAttempts,
  repairJob,
  repairNow,
  replayWouldChange,
  requeueJob,
  sourceFingerprint,
  withNoopPublication,
  type CorrectionFacts
} from './helpers/result-replay-fixtures';

const environment = localSupabaseEnv();

type Player = Awaited<ReturnType<RatingWorld['player']>>;
type Confirmed = PendingGroup & { confirmationId: string };

/**
 * Global chronological fixture: three communities A/B/C share players, a later group's
 * opponent (p10, p11) only meets the corrected players transitively.
 *
 *   G1 A  03-01  p1 p2 | p3 p4  team_a      <- the group under correction
 *   G2 B  03-02  p3 p5 | p6 p7  team_b
 *   G3 C  03-03  p1 p6 | p8 p9  draw
 *   G4 A  03-04  p2 p5 | p7 p10 team_a
 *   G5 B  03-05  p10 p4 | p9 p11 team_a
 */
describe('deterministic global replay of corrected results', { timeout: 300_000 }, () => {
  let world: RatingWorld;
  let communityB: string;
  let communityC: string;
  let players: Player[] = [];

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'replay');
    communityB = (await world.newCommunity()).communityId;
    communityC = (await world.newCommunity()).communityId;
  });

  const p = (index: number) => players[index - 1]!.id;
  const quartet = (...indexes: number[]): Quartet => toQuartet(indexes.map(p));

  async function buildStream(label: string) {
    const levels = [4, 4.5, 5, 3.5, 4, 4.5, 5, 3.5, 4, 4.5, 3.5];
    players = await Promise.all(levels.map((level, i) => world.player(`${label}${i + 1}`, level)));
    const base = (day: number) => `2026-03-0${day}T10:00:00.000Z`;
    const make = async (
      community: string | undefined,
      day: number,
      indexes: number[],
      classification: 'team_a' | 'team_b' | 'draw'
    ) =>
      confirmedGroup({
        eventId: await world.newEvent(community),
        players: quartet(...indexes),
        playedAt: base(day),
        submittedBy: world.admin.id,
        classification
      });
    const g1 = await make(undefined, 1, [1, 2, 3, 4], 'team_a');
    const g2 = await make(communityB, 2, [3, 5, 6, 7], 'team_b');
    const g3 = await make(communityC, 3, [1, 6, 8, 9], 'draw');
    const g4 = await make(undefined, 4, [2, 5, 7, 10], 'team_a');
    const g5 = await make(communityB, 5, [10, 4, 9, 11], 'team_a');
    return { groups: [g1, g2, g3, g4, g5] as const, all: players.map((x) => x.id) };
  }

  function oracleGroups(
    groups: readonly Confirmed[],
    overrides: Map<string, CorrectionFacts> = new Map()
  ) {
    return groups.flatMap((g): OracleGroup[] => {
      const facts = overrides.get(g.proposalId);
      const classification = facts?.classification ?? g.classification;
      if (classification === 'incomplete') return [];
      return [
        {
          id: g.proposalId,
          playedAt: facts?.playedAt ?? g.playedAt,
          classification,
          players: facts?.players ?? g.players
        }
      ];
    });
  }

  async function expectMatchesOracle(
    groups: readonly Confirmed[],
    all: string[],
    overrides: Map<string, CorrectionFacts> = new Map()
  ) {
    const expected = await oracleReplay(oracleGroups(groups, overrides), await initialLevels(all));
    const observed = stripRevision(await ratingStates(all));
    for (const id of all) {
      const state = expected.states[id];
      expect(observed[id]).toEqual(
        state ?? {
          mu: (await initialLevels([id]))[id],
          groups: 0,
          reliability: 10,
          highest: (await initialLevels([id]))[id]
        }
      );
    }
  }

  it.skipIf(!environment.env)(
    'measures one representative multi-community replay including bounded lock contention',
    async () => {
      const { groups, all } = await buildStream('measure');
      const job = await queueCorrection(groups[0], { facts: { classification: 'team_b' } });
      const claim = await claimRepair(job.jobId);
      if (!claim.fence_token) throw new Error('Missing fence token');
      const boundMs = 30_000;
      await withNoopPublication(async () => {
        const gate = await openDedicatedSqlConnection();
        const worker = await openDedicatedSqlConnection();
        try {
          await gate.query('begin');
          await gate.query('select public.lock_global_rating_projection()');
          await worker.query('begin');
          await worker.query("set local lock_timeout = '30s'");
          await worker.query("set local statement_timeout = '30s'");
          const started = performance.now();
          const execution = worker.query(
            `select public.execute_result_repair('${job.jobId}', '${claim.fence_token}') as result`
          );
          const waits = await waitForRows(
            `select extract(epoch from (clock_timestamp() - query_start)) * 1000 as wait_upper_ms
          from pg_stat_activity where pid = ${worker.backendPid} and wait_event_type = 'Lock'
            and ${gate.backendPid} = any(pg_blocking_pids(pid))`,
            (rows) => rows.length === 1,
            'representative replay waits for global lock',
            boundMs
          );
          await gate.query('commit');
          const lockWaitUpperMs = performance.now() - started;
          const result = await withDeadline(execution, boundMs, 'representative replay');
          expect(asRecord(result.rows[0]?.['result'])['outcome']).toBe('succeeded');
          const measurement =
            await worker.query(`select a.groups_replayed, a.events_total, a.sources_total,
            a.duration_ms as max_attempt_ms,
            (select count(distinct user_id)::int from public.player_rating_events) as users_total,
            (select count(distinct e.community_id)::int from public.rating_projection_eligible_groups() g
              join public.match_events e on e.id = g.match_event_id) as communities_total,
            (select count(*)::int from public.rating_projection_eligible_groups()) as groups_total,
            extract(epoch from (clock_timestamp() - s.xact_start)) * 1000 as transaction_ms
          from public.result_repair_attempts a cross join pg_stat_activity s
          where a.job_id = '${job.jobId}' and a.attempt_number = ${claim.attempt_number}
            and s.pid = pg_backend_pid()`);
          await worker.query('commit');
          const wallMs = performance.now() - started;
          const metrics = measurement.rows[0]!;
          expect(Number(metrics['communities_total'])).toBeGreaterThanOrEqual(3);
          expect(Number(metrics['groups_total'])).toBeGreaterThanOrEqual(5);
          expect(Number(metrics['groups_replayed'])).toBe(Number(metrics['groups_total']));
          expect(Number(metrics['users_total'])).toBeGreaterThanOrEqual(all.length);
          expect(Number(metrics['events_total'])).toBeGreaterThanOrEqual(20);
          expect(Number(metrics['sources_total'])).toBeGreaterThanOrEqual(
            Number(metrics['events_total'])
          );
          for (const duration of [
            wallMs,
            lockWaitUpperMs,
            Number(metrics['transaction_ms']),
            Number(metrics['max_attempt_ms'])
          ]) {
            // Generous CI bound, not a machine-specific performance SLA.
            expect(duration).toBeGreaterThanOrEqual(0);
            expect(duration).toBeLessThan(boundMs);
          }
          console.info(
            'Representative replay measurement',
            JSON.stringify({
              ...metrics,
              wall_ms: wallMs,
              observed_blocked_query_ms: Number(waits[0]?.['wait_upper_ms']),
              lock_wait_upper_ms: lockWaitUpperMs,
              transaction_bound_ms: boundMs,
              lock_wait_bound_ms: boundMs,
              fixture_communities: 3,
              fixture_groups: groups.length,
              fixture_users: all.length
            })
          );
        } finally {
          await Promise.all([gate.close(), worker.close()]);
        }
      });
    }
  );
  it.skipIf(!environment.env)(
    'replaces the earliest group across communities; every downstream rating equals an independent clean replay',
    async () => {
      const { groups, all } = await buildStream('swap');
      const [g1] = groups;
      const groupIds = groups.map((g) => g.proposalId);
      await expectMatchesOracle(groups, all);
      const eventsBefore = await eventCountFor(groupIds);
      const identitiesBefore = (await ledgerOf(groupIds)).map((e) => `${e.groupId}:${e.userId}`);
      const fingerprintBefore = await ledgerFingerprint(all);
      const revisionBefore = await committedRevisionNumber();

      const facts: CorrectionFacts = {
        players: quartet(1, 3, 2, 4),
        classification: 'team_b'
      };
      const job = await queueCorrection(g1, { facts });
      const receipt = await withNoopPublication(() => repairNow(job.jobId));

      expect(receipt.outcome).toBe('succeeded');
      // Exactly one committed revision for the whole repair.
      expect(await committedRevisionNumber()).toBe(revisionBefore + 1);
      expect(receipt.revision).toBe(revisionBefore + 1);
      // Same logical events, same identities; nothing was deleted or re-keyed.
      expect(await eventCountFor(groupIds)).toBe(eventsBefore);
      expect((await ledgerOf(groupIds)).map((e) => `${e.groupId}:${e.userId}`)).toEqual(
        identitiesBefore
      );
      // Earlier calculation revisions are byte-preserved (new rows only append).
      const after = await ledgerFingerprint(all);
      expect(after).not.toBe(fingerprintBefore);
      const preserved: unknown = JSON.parse(fingerprintBefore);
      if (!Array.isArray(preserved)) throw new Error('Invalid ledger fingerprint');
      const current: unknown = JSON.parse(after);
      if (!Array.isArray(current)) throw new Error('Invalid ledger fingerprint');
      for (const row of preserved) {
        expect(current).toContainEqual(row);
      }
      await expectMatchesOracle(groups, all, new Map([[g1.proposalId, facts]]));
      // The downstream groups were really recomputed (new revisions), not only the corrected one.
      const downstream = await ledgerOf(groups.slice(1).map((g) => g.proposalId));
      expect(downstream.some((e) => e.calculations.length > 1)).toBe(true);

      // A second replay of unchanged inputs writes nothing: deterministic and idempotent.
      expect(await replayWouldChange()).toMatchObject({ changed: false });

      const job2 = await repairJob(job.jobId);
      expect(job2).toMatchObject({ status: 'succeeded', attempt_count: 1 });
      const [attempt] = await repairAttempts(job.jobId);
      expect(attempt).toMatchObject({ status: 'succeeded', stage: 'complete' });
      expect(Number(attempt!['result_revision'])).toBe(revisionBefore + 1);
      const [state] = await sqlRows(
        `select current_version::int as version, official_revision::int as official_revision
           from public.match_event_result_official_state where proposal_id = '${g1.proposalId}'`
      );
      expect(state).toMatchObject({ version: 2, official_revision: 2 });
      const [proposal] = await sqlRows(
        `select active_version::int as version, status from public.match_event_result_proposals where id = '${g1.proposalId}'`
      );
      expect(proposal).toEqual({ version: 2, status: 'confirmed' });
      expect(
        (await effectiveSources([g1.proposalId])).every(
          (s) => s.active && s.revision === revisionBefore + 1
        )
      ).toBe(true);
      expect((await activeQuartet(g1.proposalId)).sort()).toEqual([1, 2, 3, 4].map(p).sort());
      expect(await sourceFingerprint(groupIds)).toContain('corrected');
    }
  );

  async function removeUnsupportedStamps() {
    await sqlRows(
      `do $t$ begin
          alter table public.player_rating_event_calculations disable trigger player_rating_calculations_immutable;
          delete from public.player_rating_event_calculations where rating_engine_version = '9.9.9';
          alter table public.player_rating_event_calculations enable trigger player_rating_calculations_immutable;
        end $t$`
    );
  }

  async function playerRating(userId: string) {
    return ratingRow(userId);
  }

  it.skipIf(!environment.env)(
    'orders equal played_at by stable group UUID, independent of confirmation order, before and after a correction',
    async () => {
      players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, i) => world.player(`tie${i}`, level))
      );
      const all = players.map((x) => x.id);
      const playedAt = '2026-04-01T09:00:00.000Z';
      const make = async (indexes: number[], classification: 'team_a' | 'team_b' | 'draw') => ({
        ...(await confirmedGroup({
          eventId: await world.newEvent(),
          players: quartet(...indexes),
          playedAt,
          submittedBy: world.admin.id,
          classification
        }))
      });
      // Confirmed in the order Y, X: confirmation time must never decide the tie.
      const y = await make([1, 3, 2, 4], 'team_b');
      const x = await make([1, 2, 3, 4], 'team_a');
      await expectMatchesOracle([x, y], all);
      const facts: CorrectionFacts = { classification: 'draw' };
      const job = await queueCorrection(x, { facts });
      expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');
      // X's amended confirmation is now the newest, yet the order is still (played_at, UUID).
      await expectMatchesOracle([x, y], all, new Map([[x.proposalId, facts]]));
    }
  );

  it.skipIf(!environment.env)(
    'replays two groups of the same event and keeps a moved group on its stable id and event identity',
    async () => {
      const { groups, all } = await buildStream('moved');
      const eventId = await world.newEvent();
      const extraA = await confirmedGroup({
        eventId,
        groupNumber: 1,
        players: quartet(1, 2, 5, 6),
        playedAt: '2026-03-06T10:00:00.000Z',
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      const extraB = await confirmedGroup({
        eventId,
        groupNumber: 2,
        players: quartet(3, 4, 7, 8),
        playedAt: '2026-03-06T11:00:00.000Z',
        submittedBy: world.admin.id,
        classification: 'team_a'
      });
      const everything = [...groups, extraA, extraB];
      await expectMatchesOracle(everything, all);
      const [g1] = groups;
      const birthBefore = await sqlRows(
        `select played_at::text from public.player_rating_events where game_group_id = '${g1.proposalId}' order by user_id`
      );
      // Move G1 after G4 (and flip its winner): same group UUID, new place in the stream.
      const facts: CorrectionFacts = {
        playedAt: '2026-03-04T12:00:00.000Z',
        classification: 'team_b'
      };
      const job = await queueCorrection(g1, { facts });
      expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');
      await expectMatchesOracle(everything, all, new Map([[g1.proposalId, facts]]));
      // Birth evidence is immutable; the effective source carries the corrected time.
      expect(
        await sqlRows(
          `select played_at::text from public.player_rating_events where game_group_id = '${g1.proposalId}' order by user_id`
        )
      ).toEqual(birthBefore);
      const sources = await effectiveSources([g1.proposalId]);
      expect(new Set(sources.map((row) => row.playedAt))).toEqual(
        new Set(['2026-03-04T12:00:00.000000Z'])
      );
      expect(await eventCountFor(everything.map((g) => g.proposalId))).toBe(28);
      expect(await replayWouldChange()).toMatchObject({ changed: false });
    }
  );

  it.skipIf(!environment.env)(
    'a corrected quartet adds one birth event, deactivates the removed player and later re-adds them on the same logical event',
    async () => {
      const { groups, all } = await buildStream('quartet');
      const [g1] = groups;
      const newcomer = await world.player('newcomer', 4);
      const everyone = [...all, newcomer.id];
      const first: CorrectionFacts = { players: toQuartet([p(1), p(2), p(3), newcomer.id]) };
      const job1 = await queueCorrection(g1, { facts: first });
      expect((await withNoopPublication(() => repairNow(job1.jobId))).outcome).toBe('succeeded');
      await expectMatchesOracle(groups, everyone, new Map([[g1.proposalId, first]]));

      // Five logical events for the group: the four birth events and the newcomer's one.
      expect(await eventCountFor([g1.proposalId])).toBe(5);
      const removed = (await effectiveSources([g1.proposalId])).find((row) => row.userId === p(4))!;
      expect(removed.active).toBe(false);
      expect(await activeQuartet(g1.proposalId)).toEqual([p(1), p(2), p(3), newcomer.id].sort());
      // The removed player keeps the other active game, the newcomer has exactly one.
      expect(await playerRating(p(4))).toMatchObject({ groups: 1 });
      expect(await playerRating(newcomer.id)).toMatchObject({ groups: 1 });
      const birthEvents = await ledgerOf([g1.proposalId]);

      // Re-add the removed player: the same logical event is reused, the newcomer is reset.
      const job2 = await queueCorrection(g1, { facts: { players: g1.players } });
      expect((await withNoopPublication(() => repairNow(job2.jobId))).outcome).toBe('succeeded');
      expect(await eventCountFor([g1.proposalId])).toBe(5);
      const restored = (await effectiveSources([g1.proposalId])).find(
        (row) => row.userId === p(4)
      )!;
      expect(restored.active).toBe(true);
      expect(restored.eventId).toBe(removed.eventId);
      expect(birthEvents.map((e) => e.userId).sort()).toEqual(
        (await ledgerOf([g1.proposalId])).map((e) => e.userId).sort()
      );
      await expectMatchesOracle(groups, everyone);
      expect(await playerRating(newcomer.id)).toMatchObject({
        groups: 0,
        reliability: 10,
        last_rating_at: null
      });
      expect(await replayWouldChange()).toMatchObject({ changed: false });
    }
  );

  it.skipIf(!environment.env)(
    'an incomplete correction creates no active competitive effect and the stream equals a replay without it',
    async () => {
      const { groups, all } = await buildStream('incomplete');
      const [g1] = groups;
      const facts: CorrectionFacts = { classification: 'incomplete' };
      const job = await queueCorrection(g1, { facts });
      expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');
      await expectMatchesOracle(groups, all, new Map([[g1.proposalId, facts]]));
      expect((await effectiveSources([g1.proposalId])).every((row) => !row.active)).toBe(true);
      expect(await eventCountFor([g1.proposalId])).toBe(4);
      const [state] = await sqlRows(
        `select current_version::int as version, is_void from public.match_event_result_official_state
          where proposal_id = '${g1.proposalId}'`
      );
      expect(state).toEqual({ version: 2, is_void: false });
    }
  );

  it.skipIf(!environment.env)(
    'a void clears the official pointer, deactivates the events and resets a player left without active games',
    async () => {
      const { groups, all } = await buildStream('void');
      const [g1, , , , g5] = groups;
      const job = await queueCorrection(g5, { kind: 'void', adminId: world.admin.id });
      expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');
      await expectMatchesOracle(groups.slice(0, 4), all);
      // p11 only ever played the voided last group: back to initialization.
      expect(await playerRating(p(11))).toMatchObject({
        groups: 0,
        reliability: 10,
        mu: 3.5,
        highest: 3.5,
        last_rating_at: null
      });
      const [state] = await sqlRows(
        `select current_confirmation_id, is_void, void_decision_id is not null as decided
           from public.match_event_result_official_state where proposal_id = '${g5.proposalId}'`
      );
      expect(state).toEqual({ current_confirmation_id: null, is_void: true, decided: true });
      expect(await eventCountFor([g5.proposalId])).toBe(4);
      expect((await effectiveSources([g5.proposalId])).every((row) => !row.active)).toBe(true);
      // The voided confirmation stays as audit evidence.
      const [kept] = await sqlRows(
        `select count(*)::int as count from public.match_event_result_confirmations where proposal_id = '${g5.proposalId}'`
      );
      expect(kept!['count']).toBe(1);
      expect(g1.proposalId).not.toBe(g5.proposalId);
    }
  );

  describe('T14 checkpoints survive a correction byte-for-byte', () => {
    let admin: LevelReviewActor;
    beforeAll(async () => {
      if (!environment.env) return;
      admin = await platformAdminPlayer(world, 'replay-padmin');
    });
    afterAll(async () => {
      if (environment.env) await drainDueRegistrationCutoffs();
    });

    const approvals: Array<{ index: number; target: number; reliability: ReliabilityArgs }> = [
      { index: 3, target: 5.5, reliability: { mode: 'preserve' } },
      {
        index: 2,
        target: 4.8,
        reliability: { mode: 'reset', justification: 'Level review reset' }
      },
      {
        index: 5,
        target: 3.9,
        reliability: { mode: 'reduce', target: 16, justification: 'Level review reduction' }
      }
    ];

    async function scenario(label: string, corrected: boolean) {
      const table = await Promise.all(
        [4, 4.5, 5, 3.5, 4, 4.5].map((level, i) => world.player(`${label}${i + 1}`, level))
      );
      const q = (...indexes: number[]): Quartet => toQuartet(indexes.map((i) => table[i - 1]!.id));
      const t0 = Date.parse(await nextTailPlayedAt());
      const at = (hours: number) => new Date(t0 + hours * 3_600_000).toISOString();
      const original = { players: q(1, 2, 3, 4), classification: 'team_a' as const };
      const fixed = { players: q(1, 3, 2, 5), classification: 'team_b' as const };
      const play = async (
        spec: { players: Quartet; classification: 'team_a' | 'team_b' | 'draw' },
        playedAt: string
      ) =>
        confirmedGroup({
          eventId: await world.newEvent(),
          players: spec.players,
          playedAt,
          submittedBy: world.admin.id,
          classification: spec.classification
        });
      const g1 = await play(corrected ? fixed : original, at(1));
      const g2 = await play({ players: q(3, 5, 6, 1), classification: 'team_b' }, at(2));
      const g3 = await play({ players: q(2, 4, 5, 6), classification: 'draw' }, at(3));
      // Three checkpoints at the SAME stored boundary (the match watermark).
      for (const approval of approvals) {
        await approveOk(admin, await submitExact(table[approval.index - 1]!, approval.target), {
          target: approval.target,
          reliability: approval.reliability
        });
      }
      const g4 = await play({ players: q(1, 3, 5, 6), classification: 'team_a' }, at(4));
      const g5 = await play({ players: q(2, 4, 1, 6), classification: 'team_b' }, at(5));
      return { table, groups: [g1, g2, g3, g4, g5] as const, spec: { original, fixed } };
    }

    async function fingerprints(ids: string[]) {
      return Promise.all(ids.map((id) => adjustmentFingerprint(id)));
    }

    function checkpointStates(rows: Array<Record<string, unknown>>) {
      const latest = new Map<string, Record<string, unknown>>();
      for (const row of rows) latest.set(String(row['adjustment_id']), row);
      return [...latest.values()].map((row) => ({
        mu: Number(row['mu']),
        sigma: Number(row['sigma']),
        display_level: Number(row['display_level']),
        reliability_percent: Number(row['reliability_percent']),
        confirmed_groups: Number(row['confirmed_groups']),
        highest_display_level: Number(row['highest_display_level'])
      }));
    }

    it.skipIf(!environment.env)(
      'mid-sequence preserve/reset/reduce checkpoints keep their rows, targets and boundary; the result equals a clean build',
      async () => {
        const repaired = await scenario('cpA', false);
        const clean = await scenario('cpB', true);
        const ids = repaired.table.map((x) => x.id);
        const adjustedBefore = await fingerprints(ids);
        const stateRowsBefore = await Promise.all(ids.map((id) => adjustmentStates(id)));
        const [g1] = repaired.groups;
        const job = await queueCorrection(g1, { facts: repaired.spec.fixed });
        expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');

        // Original administrative rows are untouched (decided_at / effective_at / boundary / audit).
        expect(await fingerprints(ids)).toEqual(adjustedBefore);
        // Checkpoint states are appended, never rewritten: every earlier row is still there.
        const stateRowsAfter = await Promise.all(ids.map((id) => adjustmentStates(id)));
        stateRowsBefore.forEach((rows, i) => {
          for (const row of rows) expect(stateRowsAfter[i]).toContainEqual(row);
        });
        expect(stateRowsAfter.flat().length).toBeGreaterThan(stateRowsBefore.flat().length);

        // Equals the authoritative rebuild where the corrected result was confirmed first.
        for (let i = 0; i < ids.length; i += 1) {
          const left = await playerRating(ids[i]!);
          const right = await playerRating(clean.table[i]!.id);
          for (const key of [
            'mu',
            'sigma',
            'display_level',
            'reliability',
            'groups',
            'highest',
            'version'
          ]) {
            expect(left[key], `player ${i + 1} ${key}`).toEqual(right[key]);
          }
        }
        expect(checkpointStates(stateRowsAfter.flat())).toEqual(
          checkpointStates(
            (await Promise.all(clean.table.map((x) => adjustmentStates(x.id)))).flat()
          )
        );
        // Preserve keeps reliability flowing; reset/reduce apply the recorded target and the exception stamp.
        expect(await playerRating(ids[2]!)).toMatchObject({ version: '1.1.0' });
        expect(await replayWouldChange()).toMatchObject({ changed: false });
      }
    );

    it.skipIf(!environment.env)(
      'a group corrected to play before an exception does not retain the exception kernel stamp',
      async () => {
        const table = await Promise.all(
          [4, 4.5, 5, 3.5].map((level, i) => world.player(`stamp${i}`, level))
        );
        const q = toQuartet(table.map((x) => x.id));
        const t0 = Date.parse(await nextTailPlayedAt());
        const at = (hours: number) => new Date(t0 + hours * 3_600_000).toISOString();
        const play = async (playedAt: string, classification: 'team_a' | 'team_b') =>
          confirmedGroup({
            eventId: await world.newEvent(),
            players: q,
            playedAt,
            submittedBy: world.admin.id,
            classification
          });
        await play(at(1), 'team_a');
        await play(at(2), 'team_b');
        await approveOk(admin, await submitExact(table[0]!, 5), {
          target: 5,
          reliability: { mode: 'reset', justification: 'Level review reset' }
        });
        const late = await play(at(3), 'team_a');
        const versionsOf = async (groupId: string) =>
          sqlRows(
            `select distinct c.rating_engine_version as version from public.player_rating_events e
               cross join lateral (select k.* from public.player_rating_event_calculations k
                   where k.rating_event_id = e.id order by k.projection_revision desc limit 1) c
              where e.game_group_id = '${groupId}'`
          );
        expect(await versionsOf(late.proposalId)).toEqual([{ version: '1.1.0' }]);
        // Move the late group before the first group, i.e. before the exception checkpoint.
        const job = await queueCorrection(late, { facts: { playedAt: at(0) } });
        expect((await withNoopPublication(() => repairNow(job.jobId))).outcome).toBe('succeeded');
        expect(await versionsOf(late.proposalId)).toEqual([{ version: '1.0.0' }]);
        expect(await replayWouldChange()).toMatchObject({ changed: false });
      }
    );
  });

  describe('recorded and frozen configuration fail closed', () => {
    it.skipIf(!environment.env)(
      'an unsupported recorded config stops the repair, keeps the old facts and is not retried automatically',
      async () => {
        const { groups, all } = await buildStream('badconfig');
        const [g1, g2] = groups;
        // A recorded stamp the engine does not support (never a change to the frozen kernel).
        await sqlRows(
          `insert into public.player_rating_event_calculations
              (rating_event_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
               before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups,
               before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent,
               after_confirmed_groups, after_highest_display_level, last_rating_at, inputs, explanation, source_revision)
            select k.rating_event_id, c.committed_revision, 'app-wide-level', '9.9.9', 1,
                   k.before_mu, k.before_sigma, k.before_display_level, k.before_reliability_percent, k.before_confirmed_groups,
                   k.before_highest_display_level, k.after_mu, k.after_sigma, k.after_display_level, k.after_reliability_percent,
                   k.after_confirmed_groups, k.after_highest_display_level, k.last_rating_at, k.inputs, k.explanation, k.source_revision
              from public.player_rating_events e
              join lateral (select * from public.player_rating_event_calculations x where x.rating_event_id = e.id
                             order by x.projection_revision desc limit 1) k on true
              cross join public.player_rating_projection_control c
             where e.game_group_id = '${g2.proposalId}' and k.projection_revision < c.committed_revision
             returning 1`
        );
        try {
          const before = await ratingStates(all);
          const revision = await committedRevisionNumber();
          const job = await queueCorrection(g1, { facts: { classification: 'team_b' } });
          const receipt = await withNoopPublication(() => repairNow(job.jobId));
          expect(receipt).toMatchObject({
            outcome: 'failed',
            failure_code: 'CONFIG_UNSUPPORTED',
            failure_stage: 'replay'
          });
          expect(await ratingStates(all)).toEqual(before);
          expect(await committedRevisionNumber()).toBe(revision);
          // Official pointer, proposal pointer and sources are exactly as before (full rollback).
          expect(
            await sqlRows(
              `select current_version::int as version from public.match_event_result_official_state where proposal_id = '${g1.proposalId}'`
            )
          ).toEqual([{ version: 1 }]);
          expect(
            (await effectiveSources([g1.proposalId])).every(
              (row) => row.active && row.revision < revision + 1
            )
          ).toBe(true);
          // Non-retryable: operator-visible failed state without an automatic retry time.
          expect(await repairJob(job.jobId)).toMatchObject({
            status: 'failed',
            failure_code: 'CONFIG_UNSUPPORTED',
            failure_stage: 'replay',
            next_attempt_at: null
          });
        } finally {
          // The replay is global: never leave an unsupported stamp behind for other suites.
          await removeUnsupportedStamps();
        }
      }
    );

    it.skipIf(!environment.env)(
      'a newly ratable group takes the config frozen on the job, never the execution default',
      async () => {
        players = await Promise.all(
          [4, 4.5, 5, 3.5].map((level, i) => world.player(`frozen${i}`, level))
        );
        const group = await confirmedGroup({
          eventId: await world.newEvent(),
          players: quartet(1, 2, 3, 4),
          playedAt: '2026-04-02T09:00:00.000Z',
          submittedBy: world.admin.id,
          classification: 'incomplete'
        });
        expect(await eventCountFor([group.proposalId])).toBe(0);
        const job = await queueCorrection(group, { facts: { classification: 'team_a' } });
        // The frozen stamp is persisted on the job at acceptance (column defaults), before processing.
        expect(await repairJob(job.jobId)).toMatchObject({
          frozen_rating_engine: 'app-wide-level',
          frozen_rating_engine_version: '1.0.0',
          frozen_rating_config_version: 1
        });
        // A job frozen with a config the engine does not know fails closed instead of using a default.
        await sqlRows(
          `do $t$ begin
              alter table public.result_repair_jobs disable trigger result_repair_job_guard;
              update public.result_repair_jobs set frozen_rating_config_version = 7 where id = '${job.jobId}';
              alter table public.result_repair_jobs enable trigger result_repair_job_guard;
            end $t$`
        );
        const failed = await withNoopPublication(() => repairNow(job.jobId));
        expect(failed).toMatchObject({ outcome: 'failed', failure_code: 'CONFIG_UNSUPPORTED' });
        expect(await eventCountFor([group.proposalId])).toBe(0);
        await sqlRows(
          `do $t$ begin
              alter table public.result_repair_jobs disable trigger result_repair_job_guard;
              update public.result_repair_jobs set frozen_rating_config_version = 1 where id = '${job.jobId}';
              alter table public.result_repair_jobs enable trigger result_repair_job_guard;
            end $t$`
        );
        await requeueJob(job.jobId);
        const ok = await withNoopPublication(() => repairNow(job.jobId));
        expect(ok.outcome).toBe('succeeded');
        expect(await eventCountFor([group.proposalId])).toBe(4);
        expect(await replayWouldChange()).toMatchObject({ changed: false });
      }
    );
  });
});
