import { beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  addInvitedPlayer,
  CLAIM_PROFILE,
  claimScenario,
  profileState,
  sessionClient,
  verifyInvitation,
  type ClaimScenario
} from './helpers/provisional-claim-fixtures';
import {
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import {
  confirmAuto,
  confirmedGroup,
  currentCalculations,
  eventCountFor,
  initialLevels,
  ledgerFingerprint,
  ledgerOf,
  nextTailPlayedAt,
  oracleReplay,
  ratingStates,
  ratingWorld,
  stripRevision,
  submitPendingGroup,
  toOracleGroup,
  type PendingGroup,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { insertLeague } from './helpers/league-fixtures';
import { setMembershipHistory } from './helpers/ranked-result-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function initializationCount(userId: string): Promise<number> {
  const result = await queryTrustedSql(
    'select count(*)::int as count from public.player_rating_initializations where user_id = $1',
    { values: [userId] }
  );
  return Number(result.rows[0]!['count']);
}

describe('rating projection with provisional players', { timeout: 240_000 }, () => {
  let world: RatingWorld;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'prov');
  });

  it.skipIf(!environment.env)(
    'rates provisional participants on either side once, from the creator estimate',
    async () => {
      const [first, second] = await Promise.all([
        world.provisional('left', 3.5),
        world.provisional('right', 5.5)
      ]);
      const [regular1, regular2] = await Promise.all([
        world.player('r1', 4),
        world.player('r2', 4.5)
      ]);
      const players: Quartet = [first.id, regular1.id, second.id, regular2.id];
      const group = await confirmedGroup({
        eventId: await world.newEvent(),
        players,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      expect(await eventCountFor([group.proposalId])).toBe(4);
      const oracle = await oracleReplay([toOracleGroup(group)], await initialLevels(players));
      expect(stripRevision(await ratingStates(players))).toEqual(oracle.states);
      for (const state of Object.values(await ratingStates(players))) expect(state.groups).toBe(1);
      // The frozen input carries the creator's estimate, not any other value.
      const [input] = (
        await queryTrustedSql(
          `select (c.inputs -> 'states' -> '${first.id}' ->> 'mu')::float8 as mu
             from public.player_rating_events e
             join public.player_rating_event_calculations c on c.rating_event_id = e.id
            where e.game_group_id = '${group.proposalId}' and e.user_id = '${first.id}'`
        )
      ).rows;
      expect(input!['mu']).toBe(3.5);

      // First creator wins: a later add with another estimate is a no-op.
      const again = await provisionProvisionalPlayer({
        userId: first.id,
        displayName: 'Provisional again',
        estimatedLevel: 6.5,
        invitedBy: world.admin.id,
        sourceEventId: await world.newEvent()
      });
      expect(again).toBe(false);
      expect((await initialLevels([first.id]))[first.id]).toBe(3.5);
    }
  );

  it.skipIf(!environment.env)(
    'a provisional participant moves exactly like a regular player of the same level',
    async () => {
      const run = async (provisional: boolean) => {
        const subject = provisional
          ? await world.provisional(`eq-p`, 4)
          : await world.player(`eq-r`, 4);
        const rest = await Promise.all([
          world.player(`eq-a${provisional}`, 4),
          world.player(`eq-b${provisional}`, 5),
          world.player(`eq-c${provisional}`, 3.5)
        ]);
        const group = await confirmedGroup({
          eventId: await world.newEvent(),
          players: [subject.id, rest[0].id, rest[1].id, rest[2].id],
          playedAt: await nextTailPlayedAt(),
          submittedBy: world.admin.id
        });
        const [entry] = currentCalculations(await ledgerOf([group.proposalId])).filter(
          (calculation) => calculation.userId === subject.id
        );
        return entry!;
      };
      const [provisional, regular] = [await run(true), await run(false)];
      expect(provisional.afterMu).toBe(regular.afterMu);
      expect(provisional.beforeMu).toBe(regular.beforeMu);
    }
  );

  it.skipIf(!environment.env)(
    'rates a Ranked and an Unranked Competitive group once each, and never rates an ineligible Ranked group',
    async () => {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const players = await Promise.all(
        [4, 4.5, 5, 3.5].map((level, index) => world.player(`ranked-u4-${index}`, level))
      );
      const ids = players.map((player) => player.id);
      for (const id of ids)
        await setMembershipHistory(world.communityId, id, [{ activatedAt: since }]);
      const leagueId = await insertLeague({
        communityId: world.communityId,
        ownerId: world.admin.id,
        startAt: since,
        endAt: new Date(Date.now() + 2 * 86_400_000).toISOString()
      });
      const rankedEventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: rankedEventId,
        communityId: world.communityId,
        creatorId: world.admin.id,
        visibility: 'community_open',
        past: true,
        leagueId
      });
      const ranked = await confirmedGroup({
        eventId: rankedEventId,
        players: [ids[0]!, ids[1]!, ids[2]!, ids[3]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      const unranked = await confirmedGroup({
        eventId: await world.newEvent(),
        players: [ids[0]!, ids[1]!, ids[2]!, ids[3]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      // Ranked and Unranked ratable confirmations each reach the app-wide rating exactly once.
      expect(await eventCountFor([ranked.proposalId])).toBe(4);
      expect(await eventCountFor([unranked.proposalId])).toBe(4);
      expect((await ratingStates(ids))[ids[0]!]!.groups).toBe(2);

      // A Ranked group whose member lost eligibility never reaches the rating (and stays unconfirmed).
      const blockedEventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: blockedEventId,
        communityId: world.communityId,
        creatorId: world.admin.id,
        visibility: 'community_open',
        past: true,
        leagueId
      });
      const blocked = await submitPendingGroup({
        eventId: blockedEventId,
        players: [ids[0]!, ids[1]!, ids[2]!, ids[3]!],
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      await setMembershipHistory(world.communityId, ids[3]!, [
        { activatedAt: since, validUntil: new Date(Date.now() + 1_000).toISOString() }
      ]);
      await expect(confirmAuto(blocked)).rejects.toThrow(/MATCH_RESULT_RANKED_MEMBERSHIP/);
      expect(await eventCountFor([blocked.proposalId])).toBe(0);
      expect((await ratingStates(ids))[ids[0]!]!.groups).toBe(2);
    }
  );

  describe('claim', () => {
    let scenario: ClaimScenario;
    beforeAll(async () => {
      if (!environment.env) return;
      scenario = await claimScenario(environment.env, 'prov-claim');
    });

    async function pastEvent(): Promise<string> {
      const id = crypto.randomUUID();
      await insertFixtureEvent({
        id,
        communityId: scenario.communityId,
        creatorId: scenario.owner.id,
        visibility: 'community_open',
        past: true
      });
      return id;
    }

    async function claimClient(invited: { tokenHash: string }) {
      const session = (await verifyInvitation(scenario.env, invited.tokenHash)).data.session!;
      return sessionClient(scenario.env, session);
    }

    async function claimWith(invited: { tokenHash: string }, level: number) {
      return (await claimClient(invited)).rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_initial_level: level
      });
    }

    /** Subject + three regular players of fixed levels; two sequential groups around a pause. */
    async function twoGroupWorld(
      label: string,
      between?: (invited: { id: string; tokenHash: string }) => Promise<void>
    ) {
      const invited = await addInvitedPlayer(scenario, {
        displayName: `Claim ${label}`,
        level: 5,
        label: `prov-${label}`
      });
      const others = await Promise.all(
        [4, 4.5, 3.5].map((level, i) =>
          signUpFixtureActor(scenario.env, `claim-${label}-${i}`, {
            displayName: `Other ${label} ${i}`,
            level
          })
        )
      );
      const [x1, x2, x3] = [others[0]!.id, others[1]!.id, others[2]!.id];
      const first = await confirmedGroup({
        eventId: await pastEvent(),
        players: [invited.id, x1, x2, x3],
        playedAt: await nextTailPlayedAt(),
        submittedBy: scenario.owner.id,
        classification: 'team_a'
      });
      const everyone = [invited.id, x1, x2, x3];
      const beforeFingerprint = await ledgerFingerprint(everyone);
      await between?.(invited);
      const afterFingerprint = await ledgerFingerprint(everyone);
      const second = await confirmedGroup({
        eventId: await pastEvent(),
        players: [invited.id, x2, x1, x3],
        playedAt: new Date(Date.parse(first.playedAt) + 3_600_000).toISOString(),
        submittedBy: scenario.owner.id,
        classification: 'team_b'
      });
      return { invited, everyone, first, second, beforeFingerprint, afterFingerprint };
    }

    it.skipIf(!environment.env)(
      'a same-level claim between two groups leaves ledger rows untouched and the rating sequence identical',
      async () => {
        const claimed = await twoGroupWorld('with', async (invited) => {
          expect(await initializationCount(invited.id)).toBe(1);
          const result = await claimWith(invited, 5);
          expect(result.error).toBeNull();
        });
        // Claim changes account metadata only: same UUID, no re-keyed or rewritten ledger rows.
        expect(claimed.afterFingerprint).toBe(claimed.beforeFingerprint);
        expect(await initializationCount(claimed.invited.id)).toBe(1);
        expect((await profileState(claimed.invited.id))?.is_provisional).toBe(false);

        const unclaimed = await twoGroupWorld('without');
        expect((await profileState(unclaimed.invited.id))?.is_provisional).toBe(true);

        const sequence = async (w: typeof claimed) => {
          const ledger = currentCalculations(
            await ledgerOf([w.first.proposalId, w.second.proposalId])
          );
          const subject = (group: PendingGroup) =>
            ledger.find(
              (entry) => entry.groupId === group.proposalId && entry.userId === w.invited.id
            )!;
          const rows = [subject(w.first), subject(w.second)];
          return rows.map((row) => [row.beforeMu, row.afterMu, row.beforeGroups, row.afterGroups]);
        };
        expect(await sequence(claimed)).toEqual(await sequence(unclaimed));
        const oracle = await oracleReplay(
          [claimed.first, claimed.second].map(toOracleGroup),
          await initialLevels(claimed.everyone)
        );
        expect(stripRevision(await ratingStates(claimed.everyone))).toEqual(oracle.states);
      }
    );

    it.skipIf(!environment.env)(
      'a zero-history claim level edit is audited and the first projection starts from it',
      async () => {
        const invited = await addInvitedPlayer(scenario, {
          displayName: 'Claim edit',
          level: 5,
          label: 'prov-edit'
        });
        expect((await claimWith(invited, 6)).error).toBeNull();
        expect(await initializationCount(invited.id)).toBe(2);
        const others = await Promise.all(
          [4, 4.5, 3.5].map((level, i) =>
            signUpFixtureActor(scenario.env, `claim-edit-${i}`, {
              displayName: `Edit ${i}`,
              level
            })
          )
        );
        const players: Quartet = [invited.id, others[0]!.id, others[1]!.id, others[2]!.id];
        const group = await confirmedGroup({
          eventId: await pastEvent(),
          players,
          playedAt: await nextTailPlayedAt(),
          submittedBy: scenario.owner.id
        });
        const [entry] = currentCalculations(await ledgerOf([group.proposalId])).filter(
          (calculation) => calculation.userId === invited.id
        );
        expect(entry!.beforeMu).toBe(6);
        const oracle = await oracleReplay([toOracleGroup(group)], await initialLevels(players));
        expect(stripRevision(await ratingStates(players))).toEqual(oracle.states);
        // Still exactly one match event per participant and no claim pseudo-event.
        expect(await eventCountFor([group.proposalId])).toBe(4);
      }
    );

    it.skipIf(!environment.env)(
      'a rated group locks the claim level edit but a same-level claim still succeeds',
      async () => {
        const invited = await addInvitedPlayer(scenario, {
          displayName: 'Claim locked',
          level: 5,
          label: 'prov-locked'
        });
        const others = await Promise.all(
          [4, 4.5, 3.5].map((level, i) =>
            signUpFixtureActor(scenario.env, `claim-locked-${i}`, {
              displayName: `Locked ${i}`,
              level
            })
          )
        );
        const group = await confirmedGroup({
          eventId: await pastEvent(),
          players: [invited.id, others[0]!.id, others[1]!.id, others[2]!.id],
          playedAt: await nextTailPlayedAt(),
          submittedBy: scenario.owner.id
        });
        const fingerprint = await ledgerFingerprint([invited.id]);
        const client = await claimClient(invited);
        const refused = await client.rpc('claim_provisional_player', {
          ...CLAIM_PROFILE,
          p_initial_level: 6
        });
        expect(refused.error?.message).toBe('PROVISIONAL_CLAIM_LEVEL_LOCKED');
        expect(await initializationCount(invited.id)).toBe(1);
        const same = await client.rpc('claim_provisional_player', {
          ...CLAIM_PROFILE,
          p_initial_level: 5
        });
        expect(same.error).toBeNull();
        expect(await ledgerFingerprint([invited.id])).toBe(fingerprint);
        expect(await eventCountFor([group.proposalId])).toBe(4);
        expect((await ratingStates([invited.id]))[invited.id]!.groups).toBe(1);
      }
    );
  });
});
