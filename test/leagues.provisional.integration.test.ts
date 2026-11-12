import { beforeAll, describe, expect, it } from 'vitest';
import { decodeLeagueCounters } from '../src/features/leagues/league-decoders';
import { insertLeague } from './helpers/league-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { sqlRows } from './helpers/match-registration-sql';
import {
  addInvitedPlayer,
  CLAIM_PROFILE,
  claimScenario,
  sessionClient,
  verifyInvitation,
  type ClaimScenario,
  type InvitedPlayer
} from './helpers/provisional-claim-fixtures';
import {
  insertFixtureEvent,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { setMembershipHistory } from './helpers/ranked-result-fixtures';
import {
  confirmAuto,
  finalizeSql,
  nextTailPlayedAt,
  submitPendingGroup,
  type PendingGroup
} from './helpers/rating-fixtures';

const environment = localSupabaseEnv();
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

/**
 * U4 / AC10-12, AC15: a provisional member is an ordinary League participant keyed by the same
 * permanent UUID before and after claim; historical membership decides Ranked eligibility for
 * provisional players exactly as for registered ones.
 */
describe.skipIf(!environment.env)(
  'League counters with provisional players',
  { timeout: 300_000 },
  () => {
    let scenario: ClaimScenario;
    let leagueId: string;
    let label = 0;

    beforeAll(async () => {
      scenario = await claimScenario(environment.env!, 'lg-prov');
      leagueId = await insertLeague({
        communityId: scenario.communityId,
        ownerId: scenario.owner.id,
        status: 'upcoming',
        startAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        endAt: new Date(Date.now() + 2 * 86_400_000).toISOString()
      });
    });

    async function invitedPlayer(name: string): Promise<InvitedPlayer> {
      label += 1;
      return addInvitedPlayer(scenario, {
        displayName: name,
        level: 5,
        label: `lg-prov-${label}`
      });
    }

    /** Invited provisional + three registered members, a Ranked event, a pending 49h-old group. */
    async function rankedGroup(invited: InvitedPlayer) {
      label += 1;
      const others = await Promise.all(
        [4, 4.5, 3.5].map((level, index) =>
          signUpFixtureActor(scenario.env, `lg-prov-${label}-${index}`, {
            displayName: `Registered ${label}-${index}`,
            level
          })
        )
      );
      for (const other of others)
        await setMembershipHistory(scenario.communityId, other.id, [{ activatedAt: dayAgo() }]);
      const eventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: eventId,
        communityId: scenario.communityId,
        creatorId: scenario.owner.id,
        visibility: 'community_open',
        past: true,
        leagueId
      });
      const group: PendingGroup = await submitPendingGroup({
        eventId,
        players: [invited.id, others[0]!.id, others[1]!.id, others[2]!.id],
        playedAt: await nextTailPlayedAt(),
        submittedBy: scenario.owner.id,
        classification: 'team_a'
      });
      return { group, others, eventId };
    }

    async function counters() {
      const response = await scenario.owner.client.rpc('get_league_counters', {
        p_league_id: leagueId
      });
      expect(response.error).toBeNull();
      return decodeLeagueCounters(response.data);
    }
    const entry = async (userId: string) =>
      (await counters()).participants.find((item) => item.user_id === userId);
    const claim = async (invited: InvitedPlayer) => {
      const session = (await verifyInvitation(scenario.env, invited.tokenHash)).data.session!;
      return sessionClient(scenario.env, session).rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_initial_level: 5
      });
    };
    const membershipIds = async (userId: string) =>
      sqlRows(
        `select id::text from public.community_members where community_id=${sqlText(scenario.communityId)}
         and user_id=${sqlText(userId)} order by valid_from`
      );
    const zero = {
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      sets_won: 0,
      sets_lost: 0,
      set_differential: 0
    };

    it('lists an active provisional member as an ordinary zero-based participant with a profile badge', async () => {
      const invited = await invitedPlayer('Provisional Zero');
      const row = await entry(invited.id);
      expect(row).toMatchObject({
        ...zero,
        is_provisional: true,
        display_name: 'Provisional Zero'
      });
      // The reader never exposes the inviter or the invitation address.
      expect(JSON.stringify(await counters())).not.toContain(invited.email);
      expect(Object.keys(row ?? {}).sort()).toEqual(
        [
          'display_name',
          'draws',
          'is_provisional',
          'losses',
          'matches',
          'set_differential',
          'sets_lost',
          'sets_won',
          'user_id',
          'wins'
        ].sort()
      );
    });

    it('keeps the same UUID, membership and counters when the player claims during an Active League', async () => {
      const invited = await invitedPlayer('Provisional Claimed');
      const { group } = await rankedGroup(invited);
      await confirmAuto(group);
      const before = await entry(invited.id);
      expect(before).toMatchObject({
        is_provisional: true,
        matches: 1,
        wins: 1,
        sets_won: 1,
        sets_lost: 0,
        set_differential: 1
      });
      const membershipBefore = await membershipIds(invited.id);

      expect((await claim(invited)).error).toBeNull();

      const after = await entry(invited.id);
      expect(after).toEqual({ ...before, is_provisional: false, display_name: 'Claimed Carla' });
      expect(await membershipIds(invited.id)).toEqual(membershipBefore);
      const all = await counters();
      expect(all.participants.filter((item) => item.user_id === invited.id)).toHaveLength(1);
      // A second confirmation after the claim keeps accumulating on the same row.
      const second = await rankedGroup({ ...invited });
      await confirmAuto(second.group);
      expect(await entry(invited.id)).toMatchObject({ matches: 2, wins: 2, is_provisional: false });
    });

    it('credits a player who claimed before the confirmation exactly like one who did not', async () => {
      const claimedFirst = await invitedPlayer('Claim First');
      expect((await claim(claimedFirst)).error).toBeNull();
      const unclaimed = await invitedPlayer('Never Claims');
      await confirmAuto((await rankedGroup(claimedFirst)).group);
      await confirmAuto((await rankedGroup(unclaimed)).group);
      const a = await entry(claimedFirst.id);
      const b = await entry(unclaimed.id);
      expect({ ...a, user_id: '', display_name: null, is_provisional: false }).toEqual({
        ...b,
        user_id: '',
        display_name: null,
        is_provisional: false
      });
      expect(a?.is_provisional).toBe(false);
      expect(b?.is_provisional).toBe(true);
    });

    it('rejects confirmation when the provisional player was removed before play and accepts removal after play', async () => {
      const removedBefore = await invitedPlayer('Removed Before');
      const before = await rankedGroup(removedBefore);
      await setMembershipHistory(scenario.communityId, removedBefore.id, [
        {
          activatedAt: dayAgo(),
          validUntil: new Date(Date.parse(before.group.playedAt) - 3_600_000).toISOString()
        }
      ]);
      await expect(sqlRows(finalizeSql(before.group.proposalId, 'AUTO_48H'))).rejects.toThrow(
        /MATCH_RESULT_RANKED_MEMBERSHIP/
      );
      expect(
        await sqlRows(
          `select count(*)::int as n from public.match_event_result_confirmations where proposal_id=${sqlText(before.group.proposalId)}`
        )
      ).toEqual([{ n: 0 }]);
      expect((await entry(removedBefore.id))?.matches ?? 0).toBe(0);

      const removedAfter = await invitedPlayer('Removed After');
      const after = await rankedGroup(removedAfter);
      await setMembershipHistory(scenario.communityId, removedAfter.id, [
        {
          activatedAt: dayAgo(),
          validUntil: new Date(Date.parse(after.group.playedAt) + 3_600_000).toISOString()
        }
      ]);
      await confirmAuto(after.group);
      // No longer an active member, but the earned entry stays visible.
      expect(await entry(removedAfter.id)).toMatchObject({
        matches: 1,
        wins: 1,
        is_provisional: true
      });
    });
  }
);
