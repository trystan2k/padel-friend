import { beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  activateRatingProjection,
  confirmedGroup,
  currentCalculations,
  eventCountFor,
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
  toOracleGroup,
  type PendingGroup,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv();

async function confirmationCount(): Promise<number> {
  const [row] = await sqlRows(
    'select count(*)::int as count from public.match_event_result_confirmations'
  );
  return Number(row!['count']);
}

describe('rating activation and backfill of confirmed history', { timeout: 180_000 }, () => {
  let world: RatingWorld;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'backfill');
  });

  async function pool(count: number, label: string): Promise<string[]> {
    const levels = [3, 4, 4.5, 5, 3.5, 5.5, 2.5, 4.2];
    const players = await Promise.all(
      Array.from({ length: count }, (_, i) => world.player(`${label}${i}`, levels[i % 8]!))
    );
    return players.map((player) => player.id);
  }

  it.skipIf(!environment.env)(
    'projects predecessor confirmed groups without resubmission, equal to the sorted oracle',
    async () => {
      const players = await pool(8, 'bf');
      const instant = new Date(Date.now() - 86_400_000 * 9).toISOString();
      const later = new Date(Date.now() - 86_400_000 * 8).toISOString();
      const other = await world.newCommunity();
      const specs: {
        eventCommunity?: string;
        admin: string;
        players: Quartet;
        playedAt: string;
        classification: 'team_a' | 'team_b' | 'draw';
      }[] = [
        {
          admin: world.admin.id,
          players: [players[0]!, players[1]!, players[2]!, players[3]!],
          playedAt: later,
          classification: 'team_b'
        },
        // Equal instants across communities: the proposal UUID breaks the tie.
        {
          admin: world.admin.id,
          players: [players[0]!, players[4]!, players[5]!, players[6]!],
          playedAt: instant,
          classification: 'team_a'
        },
        {
          eventCommunity: other.communityId,
          admin: other.adminId,
          players: [players[1]!, players[4]!, players[2]!, players[7]!],
          playedAt: instant,
          classification: 'draw'
        },
        {
          admin: world.admin.id,
          players: [players[3]!, players[5]!, players[0]!, players[7]!],
          playedAt: later,
          classification: 'team_a'
        }
      ];

      await setRatingProjectionActive(false);
      const groups: PendingGroup[] = [];
      try {
        // Confirmed in scrambled order while the projection is dormant (predecessor data).
        for (const spec of [specs[3]!, specs[0]!, specs[2]!, specs[1]!])
          groups.push(
            await confirmedGroup({
              eventId: await world.newEvent(spec.eventCommunity),
              players: spec.players,
              playedAt: spec.playedAt,
              submittedBy: spec.admin,
              classification: spec.classification
            })
          );
        expect(await eventCountFor(groups.map((g) => g.proposalId))).toBe(0);
        expect(Object.values(await ratingStates(players)).every((s) => s.groups === 0)).toBe(true);

        const confirmations = await confirmationCount();
        const result = await activateRatingProjection();
        // Activation never resubmits or touches the official result facts.
        expect(await confirmationCount()).toBe(confirmations);
        expect(result.changed).toBe(true);
      } finally {
        await setRatingProjectionActive(true);
      }

      const ids = groups.map((g) => g.proposalId);
      expect(await eventCountFor(ids)).toBe(16);
      const oracle = await oracleReplay(groups.map(toOracleGroup), await initialLevels(players));
      expect(stripRevision(await ratingStates(players))).toEqual(oracle.states);
      const ledger = await ledgerOf(ids);
      expect(ledger.every((entry) => entry.calculations.length === 1)).toBe(true);
      for (const current of currentCalculations(ledger)) {
        const step = oracle.steps.get(current.groupId)![current.userId]!;
        expect(current.beforeMu).toBe(step.before);
        expect(current.afterMu).toBe(step.after);
      }
      // One backfill revision for the whole stream, watermark at the latest sorted key.
      const control = await ratingProjectionControl();
      expect(control['activation_enabled']).toBe(true);
      const newest = [...groups]
        .map((g) => ({ id: g.proposalId, at: Date.parse(g.playedAt) }))
        .sort((l, r) => l.at - r.at || (l.id < r.id ? -1 : 1))
        .at(-1)!;
      const [watermark] = await sqlRows(
        `select (last_processed_played_at, last_processed_game_group_id) >= ('${new Date(newest.at).toISOString()}'::timestamptz, '${newest.id}'::uuid) as ahead
           from public.player_rating_projection_control`
      );
      expect(watermark!['ahead']).toBe(true);

      // Re-running activation or the projector is a no-op: nothing appended, no revision.
      const fingerprint = await ledgerFingerprint(players);
      const states = await ratingStates(players);
      const again = await activateRatingProjection();
      expect(again.changed).toBe(false);
      for (const id of ids) await sqlRows(`select public.project_confirmed_rating_group('${id}')`);
      expect(await ledgerFingerprint(players)).toBe(fingerprint);
      expect(await ratingStates(players)).toEqual(states);
      expect(await ratingProjectionControl()).toEqual(control);
    }
  );

  it.skipIf(!environment.env)(
    'a live confirmation after activation appends and converges with the backfilled history',
    async () => {
      const players = await pool(6, 'live');
      const old = await confirmedGroup({
        eventId: await world.newEvent(),
        players: [players[0]!, players[1]!, players[2]!, players[3]!],
        playedAt: new Date(Date.now() - 86_400_000 * 20).toISOString(),
        submittedBy: world.admin.id
      });
      const before = Number((await ratingProjectionControl())['revision']);
      const next = await confirmedGroup({
        eventId: await world.newEvent(),
        players: [players[0]!, players[4]!, players[2]!, players[5]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification: 'draw'
      });
      expect((await ratingProjectionControl())['revision']).toBe(before + 1);
      const oracle = await oracleReplay(
        [old, next].map(toOracleGroup),
        await initialLevels(players)
      );
      expect(stripRevision(await ratingStates(players))).toEqual(oracle.states);
    }
  );

  it.skipIf(!environment.env)(
    'a ratable confirmation on a cancelled event aborts activation without partial effects',
    async () => {
      const players = await pool(4, 'cx');
      const eventId = await world.newEvent();
      await setRatingProjectionActive(false);
      let group: PendingGroup | undefined;
      try {
        group = await confirmedGroup({
          eventId,
          players: [players[0]!, players[1]!, players[2]!, players[3]!],
          playedAt: new Date(Date.now() - 86_400_000 * 30).toISOString(),
          submittedBy: world.admin.id
        });
        await fixtureSql(`do $$ begin
          alter table public.match_events disable trigger match_event_immutable;
          update public.match_events set status = 'cancelled', cancelled_at = now(),
            cancelled_by = '${world.admin.id}', cancel_reason = 'fixture anomaly' where id = '${eventId}';
          alter table public.match_events enable trigger match_event_immutable;
        end $$;`);
        const control = await ratingProjectionControl();
        const states = await ratingStates(players);
        await expect(
          queryTrustedSql('select public.activate_global_rating_projection()')
        ).rejects.toSatisfy((error) => sqlErrorMessage(error).includes('cancelled events'));
        expect(await ratingProjectionControl()).toEqual(control);
        expect(await ratingStates(players)).toEqual(states);
        expect(await eventCountFor([group.proposalId])).toBe(0);
      } finally {
        await fixtureSql(`do $$ begin
          alter table public.match_events disable trigger match_event_immutable;
          update public.match_events set status = 'open', cancelled_at = null, cancelled_by = null,
            cancel_reason = null where id = '${eventId}';
          alter table public.match_events enable trigger match_event_immutable;
        end $$;`);
        await setRatingProjectionActive(true);
      }
      // With the anomaly gone the same backfill succeeds and ledgers the group.
      await activateRatingProjection();
      expect(await eventCountFor([group.proposalId])).toBe(4);
    }
  );
});
