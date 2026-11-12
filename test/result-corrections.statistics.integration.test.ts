import { afterAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  createMatchFixtureCleanupRegistry,
  registerMatchCommunityFixtureRows,
  sqlRows
} from './helpers/match-registration-sql';
import {
  sqlText,
  insertFixtureCommunity,
  insertFixtureEvent
} from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import {
  confirmAuto,
  setEventType,
  submitPendingGroup,
  toQuartet,
  type Classification,
  type Quartet
} from './helpers/rating-fixtures';
import {
  backdateMemberships,
  closeLeague,
  confirmRankedGroup,
  dayAt,
  type ConfirmedGroup
} from './helpers/result-correction-fixtures';
import {
  diffStatistics,
  expectedStatistics,
  observedStatistics,
  ratingFactMismatches,
  rankMismatches,
  type StatGroup
} from './helpers/result-correction-statistics';
import { queueCorrection, repairNow } from './helpers/result-replay-fixtures';

const environment = localSupabaseEnv();

type Tracked = { confirmed: ConfirmedGroup; stat: StatGroup };

/**
 * PAF-14 / T15.4: statistics are replaced exactly once per correction. Every expectation below is
 * computed by the oracle from the facts, then compared with the production projection; rating and
 * rank fields are compared with the ledger, including facts of OTHER communities whose ratings the
 * replay changed.
 */
describe.skipIf(!environment.env)('corrected statistics', { timeout: 600_000 }, () => {
  const anchor = new Date(Date.now() - 40 * 86_400_000);
  let kit: RankedResultKit;
  let communityB: string;
  let leagueId: string;
  const tracked: Tracked[] = [];
  // The second community is created by trusted SQL, so it gets its own cleanup registry (events are
  // discovered through the community); the kit's registry then removes the shared players.
  const cleanupB = createMatchFixtureCleanupRegistry('result-corrections-b');

  afterAll(async () => {
    await cleanupB.cleanup();
    if (kit) await kit.cleanup();
  });

  const ids = () => kit.players.map((player) => player.id);
  const quartet = (...indexes: number[]): Quartet => toQuartet(indexes.map((i) => ids()[i]!));

  async function inCommunityB(options: {
    day: number;
    players: Quartet;
    classification: Classification;
    friendly?: boolean;
  }): Promise<ConfirmedGroup> {
    const eventId = crypto.randomUUID();
    await insertFixtureEvent({
      id: eventId,
      communityId: communityB,
      creatorId: kit.creator.id,
      visibility: 'community_open',
      past: true
    });
    if (options.friendly) await setEventType(eventId, 'friendly');
    const pending = await submitPendingGroup({
      eventId,
      players: options.players,
      playedAt: dayAt(anchor, options.day),
      submittedBy: kit.creator.id,
      classification: options.classification
    });
    return { ...pending, confirmationId: await confirmAuto(pending) };
  }

  function track(
    confirmed: ConfirmedGroup,
    communityId: string,
    matchType: 'competitive' | 'friendly',
    league: string | null
  ) {
    tracked.push({
      confirmed,
      stat: {
        id: confirmed.proposalId,
        communityId,
        leagueId: league,
        matchType,
        playedAt: confirmed.playedAt,
        players: confirmed.players,
        classification: confirmed.classification
      }
    });
    return tracked.at(-1)!;
  }

  async function expectConsistent() {
    const players = ids();
    expect(
      diffStatistics(
        expectedStatistics(tracked.map((entry) => entry.stat)),
        await observedStatistics(players, [kit.communityId, communityB])
      )
    ).toEqual([]);
    expect(await ratingFactMismatches(players)).toEqual([]);
    expect(await rankMismatches(kit.communityId)).toEqual([]);
    expect(await rankMismatches(communityB)).toEqual([]);
  }

  const dump = async () => {
    const [row] = await sqlRows(
      "select (select md5(coalesce(string_agg(to_jsonb(s)::text, '' order by subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type), '')) " +
        'from public.statistics_scope_summaries s where subject_players && array[' +
        ids().map(sqlText).join(',') +
        ']::uuid[]) as summaries, ' +
        "(select md5(coalesce(string_agg(to_jsonb(f)::text, '' order by game_group_id), '')) from public.statistics_group_facts f " +
        'where game_group_id = any (array[' +
        tracked.map((t) => sqlText(t.confirmed.proposalId)).join(',') +
        ']::uuid[])) as groups, ' +
        '(select revision::int from public.statistics_projection_control) as revision, ' +
        '(select count(*)::int from public.statistics_rank_transitions where community_id in (' +
        sqlText(kit.communityId) +
        ', ' +
        sqlText(communityB) +
        ')) as rank_rows'
    );
    return row!;
  };

  async function correct(
    entry: Tracked,
    options: Parameters<typeof queueCorrection>[1] & { classification?: Classification } = {}
  ) {
    const job = await queueCorrection(entry.confirmed, options);
    const receipt = await repairNow(job.jobId);
    expect(receipt.outcome).toBe('succeeded');
    if (options.kind === 'void') {
      tracked.splice(tracked.indexOf(entry), 1);
    } else {
      if (options.facts?.players) {
        entry.confirmed.players = options.facts.players;
        entry.stat.players = options.facts.players;
      }
      if (options.facts?.classification) {
        entry.confirmed.classification = options.facts.classification;
        entry.stat.classification = options.facts.classification;
      }
      if (options.facts?.classification === 'incomplete') entry.stat.leagueId = null;
    }
    return { job, receipt };
  }

  const groupFacts = async (groupId: string) =>
    sqlRows(
      'select user_id::text as user_id, rating_calc_revision::int as revision, rating_delta::float8 as delta, after_level::float8 as level ' +
        'from public.statistics_participant_facts where game_group_id = ' +
        sqlText(groupId) +
        ' order by user_id'
    );

  it('replaces statistics, ratings and ranks exactly once across communities for amend, void, incomplete and friendly corrections', async () => {
    kit = await createRankedResultFixtures(environment.env!, {
      levels: [7, 6, 5, 4, 4, 4, 3.5, 3.5]
    });
    await backdateMemberships(kit, new Date(Date.now() - 90 * 86_400_000).toISOString());
    communityB = crypto.randomUUID();
    registerMatchCommunityFixtureRows(cleanupB, communityB);
    await insertFixtureCommunity({
      id: communityB,
      visibility: 'private',
      adminId: kit.creator.id,
      memberIds: ids().slice(1)
    });
    for (const id of ids())
      await setMembershipHistory(communityB, id, [
        { activatedAt: new Date(Date.now() - 90 * 86_400_000).toISOString() }
      ]);
    leagueId = await kit.league({
      status: 'active',
      endMode: 'manual',
      endAt: null,
      startAt: dayAt(anchor, 0)
    });

    const g1 = track(
      await confirmRankedGroup(kit, {
        eventId: await kit.event(leagueId),
        playedAt: dayAt(anchor, 2),
        classification: 'team_a'
      }),
      kit.communityId,
      'competitive',
      leagueId
    );
    const g2 = track(
      await confirmRankedGroup(kit, {
        eventId: await kit.event(leagueId),
        playedAt: dayAt(anchor, 10),
        classification: 'team_b',
        groupNumber: 2
      }),
      kit.communityId,
      'competitive',
      leagueId
    );
    const g3 = track(
      await inCommunityB({ day: 15, players: quartet(3, 4, 0, 5), classification: 'team_a' }),
      communityB,
      'competitive',
      null
    );
    const g4 = track(
      await inCommunityB({
        day: 20,
        players: quartet(0, 1, 6, 7),
        classification: 'team_b',
        friendly: true
      }),
      communityB,
      'friendly',
      null
    );
    track(
      await confirmRankedGroup(kit, {
        eventId: await kit.event(leagueId),
        playedAt: dayAt(anchor, 25),
        classification: 'incomplete'
      }),
      kit.communityId,
      'competitive',
      null
    );
    track(
      await confirmRankedGroup(kit, {
        eventId: await kit.event(leagueId),
        playedAt: dayAt(anchor, 30),
        classification: 'draw'
      }),
      kit.communityId,
      'competitive',
      leagueId
    );
    // The oracle agrees with the production incremental path before any correction.
    await expectConsistent();
    await closeLeague(kit, leagueId);

    // 1. Amendment: replaced quartet member and flipped winner. G3 (another community) shares two
    // players and happens later, so its ratings, rank inputs and statistics must follow the replay.
    const g3Before = await groupFacts(g3.confirmed.proposalId);
    const first = await correct(g1, {
      facts: { players: quartet(0, 6, 2, 3), classification: 'team_b' }
    });
    await expectConsistent();
    const g3After = await groupFacts(g3.confirmed.proposalId);
    expect(g3After).not.toEqual(g3Before);

    // Retry idempotency: the publication and the statistics projection are no-ops the second time.
    const settled = await dump();
    const revision = await sqlRows(
      'select committed_revision::int as r from public.player_rating_projection_control'
    );
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await sqlRows(
        'select public.result_repair_publish_derived(' +
          sqlText(first.job.jobId) +
          ', ' +
          String(revision[0]!['r']) +
          ')'
      );
      const [projected] = await sqlRows(
        'select public.statistics_project_source(array[' +
          sqlText(g1.confirmed.proposalId) +
          ']::uuid[]) as changed'
      );
      expect(projected!['changed']).toBe(0);
    }
    expect(await dump()).toEqual(settled);
    await expectConsistent();

    // 2. Void of a community-B fact removes its official sporting contribution everywhere.
    await correct(g3, { kind: 'void', adminId: kit.creator.id });
    expect(
      (
        await sqlRows(
          'select 1 from public.statistics_group_facts where game_group_id = ' +
            sqlText(g3.confirmed.proposalId)
        )
      ).length
    ).toBe(0);
    await expectConsistent();

    // 3. Competitive -> Incomplete: no W/L/D and no rating, recorded games are kept, League final drops it.
    await correct(g2, { facts: { classification: 'incomplete' } });
    await expectConsistent();

    // 4. A friendly fact still contributes (no rating); correcting it changes statistics only.
    await correct(g4, { facts: { classification: 'team_a' } });
    await expectConsistent();
  });
});
