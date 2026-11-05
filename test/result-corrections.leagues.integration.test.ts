import { afterAll, describe, expect, it } from 'vitest';
import { decodeLeagueStandings } from '../src/features/leagues/league-standings-decoders';
import { leagueRow } from './helpers/league-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  setMembershipHistory,
  shiftInstant,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import {
  confirmAuto,
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
  leagueCounters,
  leagueRevisionEvents,
  normalizeEntries,
  standingsOracle,
  standingsSnapshots
} from './helpers/result-correction-fixtures';
import {
  activeQuartet,
  claimRepair,
  effectiveSources,
  queueCorrection,
  repairNow
} from './helpers/result-replay-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Result = 'team_a' | 'team_b' | 'draw';

/**
 * PAF-14 / T15.4: closed League finals follow corrected facts. The expected tables come from the
 * oracle (facts alone), never from the production rebuild.
 */
describe.skipIf(!environment.env)('corrected League standings', { timeout: 300_000 }, () => {
  const anchor = new Date(Date.now() - 40 * 86_400_000);
  let kit: RankedResultKit;

  async function freshKit(levels = [7, 6, 5, 4, 4, 4, 4, 4]) {
    kit = await createRankedResultFixtures(environment.env!, { levels });
    await backdateMemberships(kit, new Date(Date.now() - 90 * 86_400_000).toISOString());
    kits.push(kit);
    return kit;
  }
  const manualLeague = (overrides: Parameters<RankedResultKit['league']>[0] = {}) =>
    kit.league({
      status: 'active',
      endMode: 'manual',
      endAt: null,
      startAt: dayAt(anchor, 0),
      ...overrides
    });
  const play = async (leagueId: string, day: number, classification: Result, groupNumber = 1) =>
    confirmRankedGroup(kit, {
      eventId: await kit.event(leagueId),
      playedAt: dayAt(anchor, day),
      classification,
      groupNumber
    });
  const asOracle = (
    groups: readonly { players: Quartet; classification: Classification }[],
    min = 1
  ) => standingsOracle(groups, min);
  const leagueTimes = async (leagueId: string) => {
    const [row] = await sqlRows(
      'select to_char(start_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') as start_at, ' +
        'to_char(closed_at at time zone \'UTC\', \'YYYY-MM-DD"T"HH24:MI:SS.US"Z"\') as closed_at ' +
        'from public.leagues where id = ' +
        sqlText(leagueId)
    );
    return { start: String(row!['start_at']), closed: String(row!['closed_at']) };
  };
  const finalEntries = async (leagueId: string, version: number) =>
    normalizeEntries(
      (await standingsSnapshots(leagueId)).find((s) => s['version'] === version)!['entries']
    );

  const kits: RankedResultKit[] = [];
  afterAll(async () => {
    for (const created of kits) await created.cleanup();
  });

  it('versions a closed final when October play is corrected after the December close', async () => {
    await freshKit();
    const leagueId = await manualLeague({ minimumMatches: 3 });
    const october = await play(leagueId, 2, 'team_a');
    const november = await play(leagueId, 12, 'team_a');
    const december = await play(leagueId, 28, 'team_b');
    await closeLeague(kit, leagueId);

    const before = await standingsSnapshots(leagueId);
    const leagueBefore = await leagueRow(leagueId);
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ cause: 'closed', included: 3 });
    expect(normalizeEntries(before[0]!['entries'])).toEqual(
      asOracle([october, november, december], 3)
    );

    // The correction happens AFTER the close and flips October's winner; same Game Group.
    const job = await queueCorrection(october, { facts: { classification: 'team_b' } });
    const receipt = await repairNow(job.jobId);
    expect(receipt.outcome).toBe('succeeded');

    const after = await standingsSnapshots(leagueId);
    expect(after).toHaveLength(2);
    // V1 is immutable evidence: byte-identical row, V2 links it.
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toMatchObject({
      version: 2,
      cause: 'result_amendment',
      basis: 'published',
      prior: 1,
      job: job.jobId,
      amendment: job.amendmentId,
      included: 3
    });
    expect(String(after[1]!['fingerprint'])).toMatch(/^[0-9a-f]{32}$/);
    // Rank, award and match counts: November and December in-period play still included.
    const corrected = { ...october, classification: 'team_b' as const };
    expect(normalizeEntries(after[1]!['entries'])).toEqual(
      asOracle([corrected, november, december], 3)
    );
    expect(await leagueCounters(leagueId)).toHaveLength(4);
    const counters = await leagueCounters(leagueId);
    const oracle = asOracle([corrected, november, december], 3);
    for (const row of oracle) {
      const counter = counters.find((c) => c['user_id'] === row.u)!;
      expect([counter['matches'], counter['wins'], counter['losses'], counter['sets_won']]).toEqual(
        [row.m, row.w, row.l, row.sw]
      );
    }

    // Same Game Group, new confirmation: V2 carries the corrected confirmation, not V1's.
    const [ids] = await sqlRows(
      'select (select c.id::text from public.match_event_official_confirmations() c where c.proposal_id = ' +
        sqlText(october.proposalId) +
        ' ) as current, ' +
        '(select included_confirmation_ids @> array[' +
        sqlText(october.confirmationId) +
        ']::uuid[] from public.league_standings_snapshots where league_id = ' +
        sqlText(leagueId) +
        ' and standings_version = 2) as keeps_old'
    );
    expect(ids!['keeps_old']).toBe(false);
    expect(String(ids!['current'])).not.toBe(october.confirmationId);

    // The League was never reopened and its close timestamp never moved.
    const leagueAfter = await leagueRow(leagueId);
    expect(leagueAfter).toMatchObject({ status: 'closed' });
    expect(leagueAfter['closed_at']).toEqual(leagueBefore['closed_at']);
    expect(leagueAfter['version']).toEqual(leagueBefore['version']);

    // Audit: one revision event naming old and new versions and the exact evidence delta.
    const revisions = await leagueRevisionEvents(leagueId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ actor: null, system_reason: 'result_amendment' });
    expect(revisions[0]!['details']).toMatchObject({
      old_standings_version: 1,
      standings_version: 2,
      provenance: 'result_correction'
    });

    // Readers: the member-facing contracts decode the new cause and still serve V1 unchanged.
    const latest = decodeLeagueStandings(
      (await kit.rpc(kit.creator, 'get_league_standings', { p_league_id: leagueId })).data
    );
    expect(latest).toMatchObject({ standings_version: 2, cause: 'result_amendment' });
    const original = decodeLeagueStandings(
      (
        await kit.rpc(kit.creator, 'get_league_standings', {
          p_league_id: leagueId,
          p_standings_version: 1
        })
      ).data
    );
    expect(original).toMatchObject({ standings_version: 1, cause: 'closed' });
  });

  it('repeats are idempotent and a correction that leaves the standings inputs unchanged appends nothing', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const october = await play(leagueId, 2, 'team_a');
    await play(leagueId, 12, 'team_b');
    await closeLeague(kit, leagueId);
    const baseline = await standingsSnapshots(leagueId);

    // Same facts, new confirmation: standings inputs are identical, so no new version.
    const same = await queueCorrection(october, { facts: {} });
    expect((await repairNow(same.jobId)).outcome).toBe('succeeded');
    expect(await standingsSnapshots(leagueId)).toEqual(baseline);
    expect(await leagueRevisionEvents(leagueId)).toHaveLength(0);

    // A real correction appends once; the publication function is idempotent per job.
    const flip = await queueCorrection(october, { facts: { classification: 'team_b' } });
    expect((await repairNow(flip.jobId)).outcome).toBe('succeeded');
    const afterFlip = await standingsSnapshots(leagueId);
    expect(afterFlip).toHaveLength(2);
    for (let i = 0; i < 2; i += 1) {
      const [again] = await sqlRows(
        'select public.league_publish_correction(' +
          sqlText(leagueId) +
          ', ' +
          sqlText(flip.jobId) +
          ') as v'
      );
      expect(again!['v']).toBe(2);
    }
    expect(await standingsSnapshots(leagueId)).toEqual(afterFlip);
    // The succeeded job is not claimable again.
    expect((await claimRepair(flip.jobId)).claimed).toBe(false);
    expect(await leagueRevisionEvents(leagueId)).toHaveLength(1);
  });

  it('versions the affected final as result_void when an included fact is voided', async () => {
    await freshKit();
    const leagueId = await manualLeague({ minimumMatches: 2 });
    const october = await play(leagueId, 2, 'team_a');
    const november = await play(leagueId, 12, 'team_a');
    await closeLeague(kit, leagueId);
    expect(await finalEntries(leagueId, 1)).toEqual(asOracle([october, november], 2));

    const job = await queueCorrection(october, { kind: 'void', adminId: kit.creator.id });
    expect((await repairNow(job.jobId)).outcome).toBe('succeeded');

    const snapshots = await standingsSnapshots(leagueId);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]).toMatchObject({ version: 2, cause: 'result_void', prior: 1, included: 1 });
    // Removal drops the minimum-match award for every player of the voided group.
    expect(await finalEntries(leagueId, 2)).toEqual(asOracle([november], 2));
    expect(normalizeEntries(snapshots[1]!['entries']).every((row) => !row.award)).toBe(true);
    const revisions = await leagueRevisionEvents(leagueId);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ actor: kit.creator.id });
    expect(revisions[0]!['details']).toMatchObject({ source: 'ADMIN_OVERRIDE' });
    // The void leaves no active official source for the group's four players.
    expect(await activeQuartet(october.proposalId)).toEqual([]);
  });

  it('applies the unchanged period predicate to the corrected PLAYED time, inclusive at both ends', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const target = await play(leagueId, 2, 'team_a');
    const stable = await play(leagueId, 12, 'team_b');
    await closeLeague(kit, leagueId);
    const { start, closed } = await leagueTimes(leagueId);
    const versionsAfter = async () => (await standingsSnapshots(leagueId)).length;

    const correct = async (playedAt: string) => {
      const job = await queueCorrection(target, { facts: { playedAt } });
      expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
    };
    const included = async () => {
      const latest = (await standingsSnapshots(leagueId)).at(-1)!;
      return Number(latest['included']);
    };

    // start_at is inclusive: V2 re-dates the fact but it stays included.
    await correct(start);
    expect(await versionsAfter()).toBe(2);
    expect(await included()).toBe(2);
    // One microsecond before start_at: excluded, so the final drops it (V3).
    await correct(await shiftInstant(start, -1));
    expect(await versionsAfter()).toBe(3);
    expect(await included()).toBe(1);
    expect(await finalEntries(leagueId, 3)).toEqual(asOracle([stable]));
    // One microsecond after closed_at: still excluded, nothing changes for the final (no V4).
    await correct(await shiftInstant(closed, 1));
    expect(await versionsAfter()).toBe(3);
    // closed_at is inclusive: back in the final (V4), and the close timestamp never moved.
    await correct(closed);
    expect(await versionsAfter()).toBe(4);
    expect(await included()).toBe(2);
    expect((await leagueTimes(leagueId)).closed).toBe(closed);
    expect(await finalEntries(leagueId, 4)).toEqual(
      asOracle([{ ...target, classification: 'team_a' as const }, stable])
    );
  });

  it('keeps confirmed play that is outside the period excluded after an unrelated repair', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const inPeriod = await play(leagueId, 12, 'team_a');
    // Pre-start play confirmed while the event was still unranked, bound to the League afterwards.
    const eventId = await kit.event(null);
    const preStart = await confirmRankedGroup(kit, {
      eventId,
      playedAt: dayAt(anchor, -3),
      classification: 'team_b',
      groupNumber: 2
    });
    await fixtureSql(
      'do $$ begin alter table public.match_events disable trigger match_event_immutable; ' +
        'alter table public.match_events disable trigger match_event_league_binding; ' +
        'update public.match_events set league_id = ' +
        sqlText(leagueId) +
        ' where id = ' +
        sqlText(eventId) +
        '; alter table public.match_events enable trigger match_event_league_binding; ' +
        'alter table public.match_events enable trigger match_event_immutable; end $$;'
    );
    await closeLeague(kit, leagueId);
    expect(await finalEntries(leagueId, 1)).toEqual(asOracle([inPeriod]));

    const job = await queueCorrection(inPeriod, { facts: { classification: 'team_b' } });
    expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
    const v2 = await finalEntries(leagueId, 2);
    // The repair happened later, but the pre-start group is still out of the standings.
    expect(v2).toEqual(asOracle([{ ...inPeriod, classification: 'team_b' as const }]));
    expect(
      v2.some((row) => [preStart.players[0], preStart.players[2]].includes(row.u) && row.m > 1)
    ).toBe(false);
  });

  it('rebuilds an open League without pretending a final exists', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const october = await play(leagueId, 2, 'team_a');
    const job = await queueCorrection(october, { facts: { classification: 'team_b' } });
    expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
    expect(await standingsSnapshots(leagueId)).toHaveLength(0);
    expect(await leagueRevisionEvents(leagueId)).toHaveLength(0);
    expect((await leagueRow(leagueId))['status']).toBe('active');
    const counters = await leagueCounters(leagueId);
    const oracle = asOracle([{ ...october, classification: 'team_b' as const }]);
    for (const row of oracle) {
      const counter = counters.find((c) => c['user_id'] === row.u)!;
      expect([counter['matches'], counter['wins'], counter['losses']]).toEqual([
        row.m,
        row.w,
        row.l
      ]);
    }
  });

  it('follows a new quartet and the membership intervals of the new players', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const october = await play(leagueId, 2, 'team_a');
    const stable = await play(leagueId, 12, 'team_b', 2);
    await closeLeague(kit, leagueId);
    const ids = kit.players.map((p) => p.id);

    // Player 5 replaces player 2 and is a member for the whole period: the final follows the quartet.
    const swapped = toQuartet([ids[0]!, ids[1]!, ids[4]!, ids[3]!]);
    const first = await queueCorrection(october, { facts: { players: swapped } });
    expect((await repairNow(first.jobId)).outcome).toBe('succeeded');
    expect(await finalEntries(leagueId, 2)).toEqual(
      asOracle([{ players: swapped, classification: 'team_a' }, stable])
    );
    expect(await activeQuartet(october.proposalId)).toEqual([...swapped].sort());

    // Player 6 only became a member AFTER the played instant: all-four eligibility fails, so the
    // group stays an official fact but leaves the standings (V3 removes it).
    await setMembershipHistory(kit.communityId, ids[5]!, [{ activatedAt: dayAt(anchor, 5) }]);
    const lateMember = toQuartet([ids[0]!, ids[1]!, ids[5]!, ids[3]!]);
    const second = await queueCorrection(
      { ...october, players: swapped },
      { facts: { players: lateMember } }
    );
    expect((await repairNow(second.jobId)).outcome).toBe('succeeded');
    expect(await finalEntries(leagueId, 3)).toEqual(asOracle([stable]));
    expect(await activeQuartet(october.proposalId)).toEqual([...lateMember].sort());
    const [fact] = await sqlRows(
      'select league_eligible from public.statistics_group_facts where game_group_id = ' +
        sqlText(october.proposalId)
    );
    expect(fact!['league_eligible']).toBe(false);
  });

  it('distinguishes a late first confirmation from an amendment of a prior official fact', async () => {
    await freshKit();
    const leagueId = await manualLeague();
    const october = await play(leagueId, 2, 'team_a');
    const december = await play(leagueId, 28, 'team_b');
    // A group that was submitted in period but never confirmed before the close.
    const pending = await submitPendingGroup({
      eventId: await kit.event(leagueId),
      groupNumber: 2,
      players: toQuartet(kit.group(2).map((p) => p.id)),
      playedAt: dayAt(anchor, 10),
      submittedBy: kit.creator.id,
      classification: 'team_a'
    });
    await closeLeague(kit, leagueId);
    const allGroups = [october, december];
    const inactive = async (groups: readonly { proposalId: string }[]) =>
      (await effectiveSources(groups.map((g) => g.proposalId))).filter((s) => !s.active).length;
    expect(await inactive(allGroups)).toBe(0);
    const [ratingBefore] = await sqlRows(
      'select count(*)::int as n from public.player_rating_event_calculations c join public.player_rating_events e on e.id = c.rating_event_id where e.game_group_id = ' +
        sqlText(december.proposalId)
    );

    // Branch 1: never previously confirmed -> late_first_confirmation. Downstream ratings may be
    // recomputed (December is later), but no prior official source is invalidated.
    await confirmAuto(pending);
    const afterLate = await standingsSnapshots(leagueId);
    expect(afterLate).toHaveLength(2);
    expect(afterLate[1]).toMatchObject({
      version: 2,
      cause: 'late_first_confirmation',
      job: null,
      prior: null
    });
    expect(await inactive(allGroups)).toBe(0);
    const [ratingAfter] = await sqlRows(
      'select count(*)::int as n from public.player_rating_event_calculations c join public.player_rating_events e on e.id = c.rating_event_id where e.game_group_id = ' +
        sqlText(december.proposalId)
    );
    expect(Number(ratingAfter!['n'])).toBeGreaterThanOrEqual(Number(ratingBefore!['n']));

    // Branch 2: previously confirmed -> result_amendment. The replaced quartet member loses the
    // active source (invalidation) and the final carries repair provenance.
    const ids = kit.players.map((p) => p.id);
    const swapped = toQuartet([ids[0]!, ids[1]!, ids[4]!, ids[3]!]);
    const job = await queueCorrection(october, { facts: { players: swapped } });
    expect((await repairNow(job.jobId)).outcome).toBe('succeeded');
    const afterAmendment = await standingsSnapshots(leagueId);
    expect(afterAmendment).toHaveLength(3);
    expect(afterAmendment[2]).toMatchObject({
      version: 3,
      cause: 'result_amendment',
      prior: 2,
      job: job.jobId
    });
    expect(await inactive([october])).toBe(1);
    // The first confirmation's version is untouched by the amendment.
    expect(afterAmendment[1]).toEqual(afterLate[1]);
    const causes = (await standingsSnapshots(leagueId)).map((s) => s['cause']);
    expect(causes).toEqual(['closed', 'late_first_confirmation', 'result_amendment']);
  });
});
