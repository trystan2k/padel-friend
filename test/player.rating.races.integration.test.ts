import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows, waitForRows, withDeadline } from './helpers/match-registration-sql';
import {
  addInvitedPlayer,
  CLAIM_PROFILE,
  claimScenario,
  verifyInvitation,
  type ClaimScenario
} from './helpers/provisional-claim-fixtures';
import { insertFixtureEvent, signUpFixtureActor } from './helpers/provisional-player-fixtures';
import {
  activateRatingProjection,
  confirmedGroup,
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
  setRatingProjectionActive,
  stripRevision,
  submitPendingGroup,
  toOracleGroup,
  type PendingGroup,
  toQuartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import {
  openDedicatedSqlConnection,
  sqlErrorMessage,
  type DedicatedSqlConnection
} from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

/** Bounded wait for every contender: a lock-graph deadlock must fail, never hang. */
const BOUND_MS = 30_000;

const advisoryWaitersSql = `select count(*)::int as waiters from pg_catalog.pg_locks l
  where l.locktype = 'advisory' and not l.granted
    and ((l.classid::bigint << 32) | l.objid::bigint)
      = pg_catalog.hashtextextended('padel-friend:app-wide-rating-projection', 0)`;

async function waitForRatingLockWaiters(count: number): Promise<void> {
  await waitForRows(
    advisoryWaitersSql,
    (rows) => Number(rows[0]?.['waiters']) >= count,
    `${count} backend(s) waiting for the app-wide rating lock`,
    BOUND_MS
  );
}

/** A backend (by pid, or by a fragment of its running statement) is blocked on any lock. */
async function waitForBlockedBackend(
  match: { pid: number } | { statement: string }
): Promise<void> {
  const predicate =
    'pid' in match
      ? `a.pid = ${match.pid}`
      : `a.query like '%${match.statement}%' and a.pid <> pg_catalog.pg_backend_pid()`;
  await waitForRows(
    `select 1 from pg_catalog.pg_stat_activity a where ${predicate} and a.wait_event_type = 'Lock'`,
    (rows) => rows.length >= 1,
    'a backend blocked on a lock',
    BOUND_MS
  );
}

describe('rating projection races (real separate connections)', { timeout: 240_000 }, () => {
  let world: RatingWorld;
  const open: DedicatedSqlConnection[] = [];

  async function connection(): Promise<DedicatedSqlConnection> {
    const created = await openDedicatedSqlConnection();
    open.push(created);
    return created;
  }

  /** A session that owns the app-wide rating lock until it commits. */
  async function ratingLockHolder() {
    const holder = await connection();
    await holder.query('begin');
    await holder.query('select public.lock_global_rating_projection()');
    return {
      release: async () => {
        await holder.query('commit');
      }
    };
  }

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'races');
  });

  afterEach(async () => {
    await setRatingProjectionActive(true);
    await Promise.all(open.splice(0).map((c) => c.close()));
  });

  async function pool(count: number, label: string): Promise<string[]> {
    const levels = [3, 4, 4.5, 5, 3.5, 5.5, 2.5, 4.2];
    const players = await Promise.all(
      Array.from({ length: count }, (_, i) => world.player(`${label}${i}`, levels[i % 8]!))
    );
    return players.map((player) => player.id);
  }

  async function expectOracle(groups: readonly PendingGroup[], everyone: readonly string[]) {
    const oracle = await oracleReplay(groups.map(toOracleGroup), await initialLevels(everyone));
    expect(stripRevision(await ratingStates(Object.keys(oracle.states)))).toEqual(oracle.states);
    const ledger = currentCalculations(await ledgerOf(groups.map((g) => g.proposalId)));
    expect(ledger).toHaveLength(groups.length * 4);
    for (const entry of ledger)
      expect(entry.afterMu).toBe(oracle.steps.get(entry.groupId)![entry.userId]!.after);
    return oracle;
  }

  it.skipIf(!environment.env)(
    'the same confirmation raced by many retries yields one confirmation and four logical events',
    async () => {
      const players = await pool(4, 'same');
      const group = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: toQuartet(players),
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const before = Number((await ratingProjectionControl())['revision']);
      const connections = await Promise.all(Array.from({ length: 6 }, () => connection()));
      const results = await withDeadline(
        Promise.all(connections.map((c) => c.query(finalizeSql(group.proposalId, 'AUTO_48H')))),
        BOUND_MS,
        'raced retries'
      );
      const confirmationIds = new Set(results.map((result) => result.rows[0]!['id']));
      expect(confirmationIds.size).toBe(1);
      const [confirmations] = await sqlRows(
        `select count(*)::int as count from public.match_event_result_confirmations where proposal_id = '${group.proposalId}'`
      );
      expect(confirmations!['count']).toBe(1);
      expect(await eventCountFor([group.proposalId])).toBe(4);
      const ledger = await ledgerOf([group.proposalId]);
      expect(ledger.every((entry) => entry.calculations.length === 1)).toBe(true);
      expect((await ratingProjectionControl())['revision']).toBe(before + 1);
      for (const state of Object.values(await ratingStates(players))) expect(state.groups).toBe(1);
      await expectOracle([group], players);
    }
  );

  it.skipIf(!environment.env)(
    'MANUAL, AUTO_48H and retries of one proposal produce exactly one projection',
    async () => {
      const players = await pool(4, 'mix');
      const group = await submitPendingGroup(
        {
          eventId: await world.newEvent(),
          players: toQuartet(players),
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id
        },
        1
      );
      for (const reviewer of [players[0], players[2]])
        await fixtureSql(`insert into public.match_event_result_reviews(
          proposal_id, proposal_version, reviewer_user_id, decision, request_id
        ) values ('${group.proposalId}', 1, '${reviewer}', 'approve', '${crypto.randomUUID()}')`);
      const connections = await Promise.all(Array.from({ length: 4 }, () => connection()));
      const outcomes = await withDeadline(
        Promise.all([
          connections[0]!.query(finalizeSql(group.proposalId, 'MANUAL', players[0])),
          connections[1]!.query(finalizeSql(group.proposalId, 'AUTO_48H')),
          connections[2]!.query(finalizeSql(group.proposalId, 'MANUAL', players[0])),
          connections[3]!.query(finalizeSql(group.proposalId, 'MANUAL', players[2]))
        ]),
        BOUND_MS,
        'manual versus automatic'
      );
      const ids = outcomes.map((result) => result.rows[0]!['id']);
      // AUTO_48H is not due: null if it ran first, otherwise the idempotent retry of the
      // manual confirmation. Every caller that succeeded sees the same confirmation.
      expect(new Set([ids[0], ids[2], ids[3]]).size).toBe(1);
      expect(ids[0]).not.toBeNull();
      expect([null, ids[0]]).toContain(ids[1]);
      expect(await eventCountFor([group.proposalId])).toBe(4);
      await expectOracle([group], players);
    }
  );

  it.skipIf(!environment.env)(
    'overlapping groups of different communities confirmed together lose no update',
    async () => {
      const other = await world.newCommunity();
      for (let round = 0; round < 3; round += 1) {
        const players = await pool(6, `ovl${round}`);
        const base = Date.parse(await nextTailPlayedAt());
        const first = await submitPendingGroup({
          eventId: await world.newEvent(),
          players: [players[0]!, players[1]!, players[2]!, players[3]!],
          playedAt: new Date(base + (round % 2) * 3_600_000).toISOString(),
          submittedBy: world.admin.id,
          classification: 'team_a'
        });
        const second = await submitPendingGroup({
          eventId: await world.newEvent(other.communityId),
          players: [players[0]!, players[1]!, players[4]!, players[5]!],
          playedAt: new Date(base + ((round + 1) % 2) * 3_600_000).toISOString(),
          submittedBy: other.adminId,
          classification: 'team_b'
        });
        // Both reach the rating lock together, in an order the database decides.
        const holder = await ratingLockHolder();
        const [one, two] = await Promise.all([connection(), connection()]);
        const running = Promise.all([
          one.query(finalizeSql(first.proposalId, 'AUTO_48H')),
          two.query(finalizeSql(second.proposalId, 'AUTO_48H'))
        ]);
        await waitForRatingLockWaiters(2);
        await holder.release();
        await withDeadline(running, BOUND_MS, 'overlapping confirmations');
        await expectOracle([first, second], players);
        expect(await eventCountFor([first.proposalId, second.proposalId])).toBe(8);
      }
    }
  );

  it.skipIf(!environment.env)(
    'a newer group and an older group confirmed concurrently converge to the chronological oracle',
    async () => {
      for (let round = 0; round < 3; round += 1) {
        const players = await pool(6, `late${round}`);
        const base = Date.parse(await nextTailPlayedAt());
        const older = await submitPendingGroup({
          eventId: await world.newEvent(),
          players: [players[0]!, players[1]!, players[2]!, players[3]!],
          playedAt: new Date(base).toISOString(),
          submittedBy: world.admin.id,
          classification: 'team_a'
        });
        const newer = await submitPendingGroup({
          eventId: await world.newEvent(),
          players: [players[0]!, players[2]!, players[4]!, players[5]!],
          playedAt: new Date(base + 7_200_000).toISOString(),
          submittedBy: world.admin.id,
          classification: 'draw'
        });
        const [one, two] = await Promise.all([connection(), connection()]);
        // Free race, alternating which side is issued first.
        const issue = round % 2 === 0 ? [newer, older] : [older, newer];
        await withDeadline(
          Promise.all([
            one.query(finalizeSql(issue[0]!.proposalId, 'AUTO_48H')),
            two.query(finalizeSql(issue[1]!.proposalId, 'AUTO_48H'))
          ]),
          BOUND_MS,
          'late insertion race'
        );
        await expectOracle([older, newer], players);
        const fingerprint = await ledgerFingerprint(players);
        expect((await activateRatingProjection()).changed).toBe(false);
        expect(await ledgerFingerprint(players)).toBe(fingerprint);
      }
    }
  );

  it.skipIf(!environment.env)(
    'backfill versus live confirmation converges in either lock order',
    async () => {
      for (const activationFirst of [true, false]) {
        const players = await pool(8, `bf${activationFirst}`);
        const stamp = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
        await setRatingProjectionActive(false);
        const predecessors = [
          await confirmedGroup({
            eventId: await world.newEvent(),
            players: [players[0]!, players[1]!, players[2]!, players[3]!],
            playedAt: stamp(60),
            submittedBy: world.admin.id,
            classification: 'team_a'
          }),
          await confirmedGroup({
            eventId: await world.newEvent(),
            players: [players[0]!, players[4]!, players[2]!, players[5]!],
            playedAt: stamp(59),
            submittedBy: world.admin.id,
            classification: 'team_b'
          })
        ];
        const live = await submitPendingGroup({
          eventId: await world.newEvent(),
          players: [players[1]!, players[4]!, players[6]!, players[7]!],
          playedAt: stamp(61),
          submittedBy: world.admin.id,
          classification: 'draw'
        });
        const holder = await ratingLockHolder();
        const [activator, confirmer] = await Promise.all([connection(), connection()]);
        const startActivation = () =>
          activator.query('select public.activate_global_rating_projection()::text as result');
        const startConfirmation = () => confirmer.query(finalizeSql(live.proposalId, 'AUTO_48H'));
        // Observed, not assumed: the first contender queues before the second one starts.
        const first = activationFirst ? startActivation() : startConfirmation();
        await waitForRatingLockWaiters(1);
        const second = activationFirst ? startConfirmation() : startActivation();
        await waitForRatingLockWaiters(2);
        await holder.release();
        await withDeadline(Promise.all([first, second]), BOUND_MS, 'backfill race');
        // The live group is older than both predecessors: whichever won, history converges.
        await expectOracle([...predecessors, live], players);
        expect((await activateRatingProjection()).changed).toBe(false);
      }
    }
  );

  describe('claim versus the first rated group', () => {
    let scenario: ClaimScenario;

    beforeAll(async () => {
      if (!environment.env) return;
      scenario = await claimScenario(environment.env, 'race-claim');
    });

    async function preparePlayer(label: string) {
      const invited = await addInvitedPlayer(scenario, {
        displayName: `Race ${label}`,
        level: 5,
        label: `race-${label}`
      });
      const others = await Promise.all(
        [4, 4.5, 3.5].map((level, i) =>
          signUpFixtureActor(scenario.env, `race-${label}-${i}`, {
            displayName: `Race other ${i}`,
            level
          })
        )
      );
      const eventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: eventId,
        communityId: scenario.communityId,
        creatorId: scenario.owner.id,
        visibility: 'community_open',
        past: true
      });
      const group = await submitPendingGroup({
        eventId,
        players: [invited.id, others[0]!.id, others[1]!.id, others[2]!.id],
        playedAt: await nextTailPlayedAt(),
        submittedBy: scenario.owner.id
      });
      const session = (await verifyInvitation(scenario.env, invited.tokenHash)).data.session!;
      const rawClaim = async (level: number) => {
        const response = await fetch(`${scenario.env.url}/rest/v1/rpc/claim_provisional_player`, {
          method: 'POST',
          headers: {
            apikey: scenario.env.key,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ ...CLAIM_PROFILE, p_initial_level: level })
        });
        return { ok: response.ok, body: await response.text() };
      };
      return {
        invited,
        group,
        rawClaim,
        everyone: [invited.id, others[0]!.id, others[1]!.id, others[2]!.id]
      };
    }

    it.skipIf(!environment.env)(
      'the confirmation that wins the lock first locks the level edit',
      async () => {
        const { invited, group, rawClaim } = await preparePlayer('confirm-first');
        const holder = await ratingLockHolder();
        const confirmer = await connection();
        const confirmation = confirmer.query(finalizeSql(group.proposalId, 'AUTO_48H'));
        await waitForRatingLockWaiters(1);
        // The claim queues behind the confirmation's community lock, never inside the rating lock.
        const claim = rawClaim(6);
        await waitForBlockedBackend({ statement: 'claim_provisional_player' });
        await holder.release();
        await withDeadline(confirmation, BOUND_MS, 'confirmation');
        const result = await withDeadline(claim, BOUND_MS, 'claim');
        expect(result.ok).toBe(false);
        expect(result.body).toContain('PROVISIONAL_CLAIM_LEVEL_LOCKED');
        expect((await initialLevels([invited.id]))[invited.id]).toBe(5);
        const [entry] = currentCalculations(await ledgerOf([group.proposalId])).filter(
          (calculation) => calculation.userId === invited.id
        );
        expect(entry!.beforeMu).toBe(5);
      }
    );

    it.skipIf(!environment.env)(
      'a claim edit that wins the lock first feeds the first projection',
      async () => {
        const { invited, group, rawClaim, everyone } = await preparePlayer('claim-first');
        const holder = await ratingLockHolder();
        const claim = rawClaim(6);
        await waitForRatingLockWaiters(1);
        const confirmer = await connection();
        const confirmation = confirmer.query(finalizeSql(group.proposalId, 'AUTO_48H'));
        // The confirmation queues behind the claim's key-share hold on the community row.
        await waitForBlockedBackend({ pid: confirmer.backendPid });
        await holder.release();
        const result = await withDeadline(claim, BOUND_MS, 'claim');
        await withDeadline(confirmation, BOUND_MS, 'confirmation');
        expect({ ok: result.ok, body: result.body }).toMatchObject({ ok: true });
        expect((await initialLevels([invited.id]))[invited.id]).toBe(6);
        const [entry] = currentCalculations(await ledgerOf([group.proposalId])).filter(
          (calculation) => calculation.userId === invited.id
        );
        expect(entry!.beforeMu).toBe(6);
        await expectOracle([group], everyone);
      }
    );
  });

  describe('rollback and cancellation', () => {
    async function installSleepOnStateWrite(userId: string) {
      const suffix = crypto.randomUUID().replaceAll('-', '');
      await fixtureSql(`create function public.paf_rating_sleep_${suffix}() returns trigger
        language plpgsql set search_path = '' as $$
        begin perform pg_catalog.pg_sleep(30); return new; end $$;
        create trigger paf_rating_sleep_trigger_${suffix} before update on public.global_player_ratings
          for each row when (new.user_id = '${userId}'::uuid) execute function public.paf_rating_sleep_${suffix}();`);
      return () =>
        fixtureSql(`drop trigger paf_rating_sleep_trigger_${suffix} on public.global_player_ratings;
          drop function public.paf_rating_sleep_${suffix}();`);
    }

    async function expectNothingPersisted(
      group: PendingGroup,
      players: readonly string[],
      states: unknown
    ) {
      const [proposal] = await sqlRows(
        `select status,
                (select count(*)::int from public.match_event_result_confirmations where proposal_id = p.id) as confirmations
           from public.match_event_result_proposals p where p.id = '${group.proposalId}'`
      );
      expect(proposal).toEqual({ status: 'pending', confirmations: 0 });
      expect(await eventCountFor([group.proposalId])).toBe(0);
      expect(await ratingStates(players)).toEqual(states);
    }

    it.skipIf(!environment.env)(
      'cancelling a confirmation queued behind the rating lock rolls it back completely',
      async () => {
        const players = await pool(4, 'cancel');
        const group = await submitPendingGroup({
          eventId: await world.newEvent(),
          players: toQuartet(players),
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id
        });
        const states = await ratingStates(players);
        const holder = await ratingLockHolder();
        const confirmer = await connection();
        const running = confirmer.query(finalizeSql(group.proposalId, 'AUTO_48H'));
        const settled = running.then(
          () => 'completed',
          (error: unknown) => sqlErrorMessage(error)
        );
        await waitForRatingLockWaiters(1);
        expect(await confirmer.cancel()).toBe(true);
        expect(await withDeadline(settled, BOUND_MS, 'cancelled query')).toContain(
          'canceling statement'
        );
        await holder.release();
        await expectNothingPersisted(group, players, states);
        // The cancelled attempt left no lock behind: a retry projects normally.
        await withDeadline(
          (await connection()).query(finalizeSql(group.proposalId, 'AUTO_48H')),
          BOUND_MS,
          'retry after cancellation'
        );
        expect(await eventCountFor([group.proposalId])).toBe(4);
        await expectOracle([group], players);
      }
    );

    it.skipIf(!environment.env)(
      'cancelling or killing a confirmation after the ledger rows are written but before the state commits leaves nothing',
      async () => {
        for (const mode of ['cancel', 'terminate'] as const) {
          const players = await pool(4, `mid-${mode}`);
          const group = await submitPendingGroup({
            eventId: await world.newEvent(),
            players: toQuartet(players),
            playedAt: await nextTailPlayedAt(),
            submittedBy: world.admin.id
          });
          const states = await ratingStates(players);
          const control = await ratingProjectionControl();
          const drop = await installSleepOnStateWrite(players[3]!);
          try {
            const confirmer = await connection();
            const running = confirmer.query(finalizeSql(group.proposalId, 'AUTO_48H'));
            const settled = running.then(
              () => 'completed',
              (error: unknown) => sqlErrorMessage(error)
            );
            // Events and calculations are already inserted inside the open transaction.
            await waitForRows(
              `select 1 from pg_catalog.pg_stat_activity where pid = ${confirmer.backendPid} and wait_event = 'PgSleep'`,
              (rows) => rows.length === 1,
              'the confirmation sleeping before its final state write',
              BOUND_MS
            );
            expect(mode === 'cancel' ? await confirmer.cancel() : await confirmer.terminate()).toBe(
              true
            );
            expect(await withDeadline(settled, BOUND_MS, `${mode} mid-flight`)).not.toBe(
              'completed'
            );
          } finally {
            await drop();
          }
          await waitForRows(
            advisoryWaitersSql,
            (rows) => Number(rows[0]?.['waiters']) === 0,
            'no waiter on the rating lock',
            BOUND_MS
          );
          await expectNothingPersisted(group, players, states);
          expect(await ratingProjectionControl()).toEqual(control);
          const retry = await connection();
          await withDeadline(
            retry.query(finalizeSql(group.proposalId, 'AUTO_48H')),
            BOUND_MS,
            'retry'
          );
          await expectOracle([group], players);
        }
      }
    );
  });
});
