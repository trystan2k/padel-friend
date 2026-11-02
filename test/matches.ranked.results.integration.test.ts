import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';
import { leagueRow } from './helpers/league-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  shiftInstant,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const dayAgo = () => new Date(Date.now() - 86_400_000).toISOString();

/**
 * U4 / AC6, AC11, AC15 + U4.3/U4.4: Ranked result eligibility is judged from the ACTUAL quartet's
 * historical membership intervals and the League's effective window, on submission, correction
 * and the first official confirmation; Unranked groups never consult League state.
 */
describe.skipIf(!environment.env)('Ranked result eligibility', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });
  afterEach(async () => {
    for (const player of kit.players)
      await setMembershipHistory(kit.communityId, player.id, [{ activatedAt: dayAgo() }]);
  });

  const target = () => kit.players[3]!;
  const resultError = (response: { error: { message?: string | null } | null }) =>
    response.error?.message;
  const setWindow = (leagueId: string, startAt: string, endAt: string) =>
    fixtureSql(
      `update public.leagues set start_at=${sqlText(startAt)}::timestamptz, end_at=${sqlText(endAt)}::timestamptz where id=${sqlText(leagueId)};`
    );
  const rankedEvent = async (leagueSeed: Parameters<RankedResultKit['league']>[0] = {}) => {
    const leagueId = await kit.league(leagueSeed);
    return { leagueId, eventId: await kit.event(leagueId) };
  };
  const proposalsOf = async (eventId: string, actor = kit.players[0]!) => {
    const response = await kit.rpc(actor, 'get_match_event_result_proposals', {
      p_match_event_id: eventId
    });
    expect(response.error).toBeNull();
    return Array.isArray(response.data) ? response.data.map(asRecord) : [];
  };

  it('confirms an eligible Ranked group exactly once with official provenance and rating', async () => {
    const { eventId } = await rankedEvent();
    const at = playedAt(120);
    const submitted = await kit.submit(eventId, at.played);
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);

    const confirmed = await kit.approve(proposalId);
    expect(confirmed.error).toBeNull();
    expect(confirmed.data).toMatchObject({ status: 'confirmed', version: 1 });
    const replay = await kit.approve(proposalId);
    expect(replay.error?.message).toBe('MATCH_RESULT_REVIEW_CONFLICT');
    expect(await kit.sideEffects(eventId)).toMatchObject({
      proposals: 1,
      confirmations: 1,
      rating_events: 4
    });
    const [confirmation] = await sqlRows(
      `select source, ratable_eligible from public.match_event_result_confirmations where match_event_id=${sqlText(eventId)}`
    );
    expect(confirmation).toMatchObject({ source: 'MANUAL', ratable_eligible: true });
  });

  describe('historical membership of every actual participant', () => {
    it.each([0, 1, 2, 3])(
      'rejects a Ranked submission when player %i was removed before play',
      async (index) => {
        const { eventId } = await rankedEvent();
        const at = playedAt(120);
        const baseline = await kit.sideEffects(eventId);
        const player = kit.players[index]!;
        await setMembershipHistory(kit.communityId, player.id, [
          { activatedAt: dayAgo(), validUntil: await shiftInstant(at.iso, -1) }
        ]);
        const rejected = await kit.submit(eventId, at.played);
        expect(resultError(rejected)).toBe('MATCH_RESULT_RANKED_MEMBERSHIP');
        // Group-level gate: nothing was written for the other three players either.
        expect(await kit.sideEffects(eventId)).toEqual(baseline);
      }
    );

    it('treats activation as inclusive and removal as exclusive, to the microsecond', async () => {
      const at = playedAt(120);
      const cases: [string, Parameters<typeof setMembershipHistory>[2], boolean][] = [
        ['removed exactly at play', [{ activatedAt: dayAgo(), validUntil: at.iso }], false],
        [
          'removed 1µs after play',
          [{ activatedAt: dayAgo(), validUntil: await shiftInstant(at.iso, 1) }],
          true
        ],
        ['activated exactly at play', [{ activatedAt: at.iso }], true],
        ['activated 1µs after play', [{ activatedAt: await shiftInstant(at.iso, 1) }], false]
      ];
      for (const [label, history, eligible] of cases) {
        await setMembershipHistory(kit.communityId, target().id, [{ activatedAt: dayAgo() }]);
        const { eventId } = await rankedEvent();
        await setMembershipHistory(kit.communityId, target().id, history);
        const response = await kit.submit(eventId, at.played);
        expect({ label, error: resultError(response) ?? null }).toEqual({
          label,
          error: eligible ? null : 'MATCH_RESULT_RANKED_MEMBERSHIP'
        });
      }
    });

    it('keeps removal after play eligible and counts only intervals that had activated', async () => {
      const at = playedAt(120);
      const [removedAfter, pendingOnly, rejoinGap] = [
        await rankedEvent(),
        await rankedEvent(),
        await rankedEvent()
      ];
      await setMembershipHistory(kit.communityId, target().id, [
        { activatedAt: dayAgo(), validUntil: await shiftInstant(at.iso, 1) }
      ]);
      expect((await kit.submit(removedAfter.eventId, at.played)).error).toBeNull();

      await setMembershipHistory(kit.communityId, target().id, [{ activatedAt: null }]);
      expect(resultError(await kit.submit(pendingOnly.eventId, at.played))).toBe(
        'MATCH_RESULT_RANKED_MEMBERSHIP'
      );

      await setMembershipHistory(kit.communityId, target().id, [
        {
          activatedAt: dayAgo(),
          validUntil: new Date(Date.parse(at.iso) - 3_600_000).toISOString()
        },
        { activatedAt: new Date(Date.parse(at.iso) + 5_000).toISOString() }
      ]);
      expect(resultError(await kit.submit(rejoinGap.eventId, at.played))).toBe(
        'MATCH_RESULT_RANKED_MEMBERSHIP'
      );
    });

    it('never admits a player with no membership history (hidden guest)', async () => {
      const { eventId } = await rankedEvent();
      await setMembershipHistory(kit.communityId, target().id, []);
      expect(resultError(await kit.submit(eventId, playedAt(120).played))).toBe(
        'MATCH_RESULT_RANKED_MEMBERSHIP'
      );
    });
  });

  describe('League effective window', () => {
    it('is inclusive at both Fixed ends to the microsecond', async () => {
      const { leagueId, eventId } = await rankedEvent();
      const at = playedAt(120);
      const far = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const before = new Date(Date.now() - 2 * 86_400_000).toISOString();

      await setWindow(leagueId, await shiftInstant(at.iso, 1), far);
      expect(resultError(await kit.submit(eventId, at.played))).toBe(
        'MATCH_RESULT_RANKED_OUT_OF_PERIOD'
      );
      await setWindow(leagueId, before, await shiftInstant(at.iso, -1));
      expect(resultError(await kit.submit(eventId, at.played))).toBe(
        'MATCH_RESULT_RANKED_OUT_OF_PERIOD'
      );
      expect((await kit.sideEffects(eventId))['proposals']).toBe(0);
    });

    it('accepts play exactly at the start and at the end instant', async () => {
      const at = playedAt(120);
      const far = new Date(Date.now() + 2 * 86_400_000).toISOString();
      const atStart = await rankedEvent();
      await setWindow(atStart.leagueId, at.iso, far);
      expect((await kit.submit(atStart.eventId, at.played)).error).toBeNull();

      const atEnd = await rankedEvent();
      await setWindow(atEnd.leagueId, new Date(Date.now() - 2 * 86_400_000).toISOString(), at.iso);
      expect((await kit.submit(atEnd.eventId, at.played)).error).toBeNull();
    });

    it('treats an open Manual League as unbounded and a closed one as inclusive of its close instant', async () => {
      const at = playedAt(120);
      const open = await rankedEvent({ endMode: 'manual', endAt: null });
      expect((await kit.submit(open.eventId, at.played)).error).toBeNull();

      const closedAtPlay = await rankedEvent({
        endMode: 'manual',
        endAt: null,
        status: 'closed',
        closedAt: at.iso,
        closedBy: kit.creator.id
      });
      expect((await kit.submit(closedAtPlay.eventId, at.played)).error).toBeNull();

      const closedBefore = await rankedEvent({
        endMode: 'manual',
        endAt: null,
        status: 'closed',
        closedAt: await shiftInstant(at.iso, -1),
        closedBy: kit.creator.id
      });
      expect(resultError(await kit.submit(closedBefore.eventId, at.played))).toBe(
        'MATCH_RESULT_RANKED_OUT_OF_PERIOD'
      );
    });

    it('keeps in-period play eligible when the League is closed after the proposal', async () => {
      const { leagueId, eventId } = await rankedEvent({
        endMode: 'manual',
        endAt: null,
        status: 'active'
      });
      const at = playedAt(120);
      const submitted = await kit.submit(eventId, at.played);
      expect(submitted.error).toBeNull();
      const row = await leagueRow(leagueId);
      const closed = await kit.rpc(kit.creator, 'close_league', {
        p_league_id: leagueId,
        p_expected_version: Number(row['version'])
      });
      expect(closed.error).toBeNull();
      const confirmed = await kit.approve(String(asRecord(submitted.data)['proposal_id']));
      expect(confirmed.data).toMatchObject({ status: 'confirmed' });
    });
  });

  describe('Unranked groups and retroactive binding', () => {
    it('never applies League or membership checks to an Unranked Competitive group, and still rates it once', async () => {
      await kit.league();
      const eventId = await kit.event(null);
      await setMembershipHistory(kit.communityId, target().id, [
        { activatedAt: dayAgo(), validUntil: new Date(Date.now() - 3_600_000).toISOString() }
      ]);
      const submitted = await kit.submit(eventId, playedAt(120).played);
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      expect((await kit.approve(proposalId)).data).toMatchObject({ status: 'confirmed' });
      expect(await kit.sideEffects(eventId)).toMatchObject({ confirmations: 1, rating_events: 4 });
      // An Active League covering the period never claimed the event at result time.
      const [event] = await sqlRows(
        `select league_id from public.match_events where id=${sqlText(eventId)}`
      );
      expect(event?.['league_id']).toBeNull();
    });
  });

  describe('first official confirmation recheck and resolution', () => {
    it('blocks a tampered pending group visibly, leaves no side effects, and resolves by correction', async () => {
      const { eventId } = await rankedEvent();
      const at = playedAt(120);
      const submitted = await kit.submit(eventId, at.played);
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      const baseline = await kit.sideEffects(eventId);

      // The player is retroactively marked as removed at the played instant.
      await setMembershipHistory(kit.communityId, target().id, [
        { activatedAt: dayAgo(), validUntil: at.iso }
      ]);

      const [asOrganizer] = await proposalsOf(eventId);
      expect(asOrganizer).toMatchObject({
        status: 'pending',
        ranked_blocked: { reason: 'membership', user_ids: [target().id] },
        can_correct: true
      });
      const [asOpponent] = await proposalsOf(eventId, kit.players[2]);
      expect(asOpponent).toMatchObject({ can_approve: false });

      const blocked = await kit.approve(proposalId);
      expect(resultError(blocked)).toBe('MATCH_RESULT_RANKED_MEMBERSHIP');
      expect(await kit.sideEffects(eventId)).toEqual(baseline);

      // Past the deadline the scheduler records typed evidence instead of vanishing, and the
      // overdue Ranked proposal stays correctable rather than being pre-empted by finalization.
      await setResultReviewDeadlineOffset(proposalId, 1, -60);
      const run = await processDueMatchEventResults();
      expect(run).toMatchObject({ blocked: 1, failed: 0, confirmed: 0 });
      expect(run['blocked_items']).toEqual([
        expect.objectContaining({ proposal_id: proposalId, code: 'MATCH_RESULT_RANKED_MEMBERSHIP' })
      ]);
      const [state] = await sqlRows(
        `select last_failure_code, failure_count::int as failures from public.match_event_result_processing_state where proposal_id=${sqlText(proposalId)}`
      );
      expect(state).toMatchObject({
        last_failure_code: 'MATCH_RESULT_RANKED_MEMBERSHIP',
        failures: 1
      });
      expect((await kit.sideEffects(eventId))['confirmations']).toBe(0);
      expect((await proposalsOf(eventId))[0]).toMatchObject({ can_correct: true });

      // Truthful played_at correction (player was a member an hour earlier) enters Ranked.
      const earlier = playedAt(3_600);
      const corrected = await kit.correct(proposalId, 1, earlier.played);
      expect(corrected.data).toMatchObject({
        version: 2,
        status: 'pending',
        confirmation_id: null
      });
      expect((await kit.approve(proposalId, 2)).data).toMatchObject({
        status: 'confirmed',
        version: 2
      });
      expect(await kit.sideEffects(eventId)).toMatchObject({ confirmations: 1, rating_events: 4 });
    });

    it('rejects a correction that moves play outside the League window', async () => {
      const { leagueId, eventId } = await rankedEvent();
      const at = playedAt(120);
      const submitted = await kit.submit(eventId, at.played);
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      await setWindow(leagueId, new Date(Date.now() - 2 * 86_400_000).toISOString(), at.iso);
      const later = playedAt(60);
      expect(resultError(await kit.correct(proposalId, 1, later.played))).toBe(
        'MATCH_RESULT_RANKED_OUT_OF_PERIOD'
      );
      const [version] = await sqlRows(
        `select active_version::int as v from public.match_event_result_proposals where id=${sqlText(proposalId)}`
      );
      expect(version?.['v']).toBe(1);
    });

    it('leaves an overdue eligible Ranked proposal on the existing auto-confirm path', async () => {
      const { eventId } = await rankedEvent();
      const submitted = await kit.submit(eventId, playedAt(120).played);
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      await setResultReviewDeadlineOffset(proposalId, 1, -60);
      expect(await processDueMatchEventResults()).toMatchObject({ confirmed: 1, blocked: 0 });
      expect(await kit.sideEffects(eventId)).toMatchObject({ confirmations: 1, rating_events: 4 });
      const [confirmation] = await sqlRows(
        `select source from public.match_event_result_confirmations where proposal_id=${sqlText(proposalId)}`
      );
      expect(confirmation?.['source']).toBe('AUTO_48H');
    });
  });

  describe('concurrency and the global rating lock graph', () => {
    it('confirms Ranked and Unranked groups concurrently without deadlock and rates each exactly once', async () => {
      const ranked = await Promise.all([rankedEvent(), rankedEvent()]);
      const unranked = await kit.event(null);
      const eventIds = [...ranked.map((entry) => entry.eventId), unranked];
      const proposals: string[] = [];
      for (const eventId of eventIds) {
        const submitted = await kit.submit(eventId, playedAt(120).played);
        expect(submitted.error).toBeNull();
        proposals.push(String(asRecord(submitted.data)['proposal_id']));
      }
      // Duplicate approvals from both opponents race each other as well.
      const results = await Promise.all([
        ...proposals.map((id) => kit.approve(id, 1, kit.players[2])),
        ...proposals.map((id) => kit.approve(id, 1, kit.players[3]))
      ]);
      for (const result of results)
        expect(result.error?.message ?? '').not.toMatch(/deadlock|40P01|RATING_/i);
      for (const eventId of eventIds)
        expect(await kit.sideEffects(eventId)).toMatchObject({
          confirmations: 1,
          rating_events: 4
        });
    });

    it('lets removal and confirmation race without partial credit: removal after play stays eligible', async () => {
      const { eventId } = await rankedEvent();
      const submitted = await kit.submit(eventId, playedAt(120).played);
      const proposalId = String(asRecord(submitted.data)['proposal_id']);
      const [membership] = await sqlRows(
        `select id::text from public.community_members where community_id=${sqlText(kit.communityId)} and user_id=${sqlText(target().id)} and valid_until is null`
      );
      const [approval, removal] = await Promise.all([
        kit.approve(proposalId),
        kit.rpc(kit.creator, 'govern_community_member', {
          p_community_id: kit.communityId,
          p_membership_id: String(membership?.['id']),
          p_action: 'remove'
        })
      ]);
      expect(removal.error).toBeNull();
      expect(approval.data).toMatchObject({ status: 'confirmed' });
      expect(await kit.sideEffects(eventId)).toMatchObject({ confirmations: 1, rating_events: 4 });
    });
  });
});
