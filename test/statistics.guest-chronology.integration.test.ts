import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { createRankedResultFixtures, playedAt, rankedSets } from './helpers/ranked-result-fixtures';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { GOLDEN_GUEST_LEAGUE } from './helpers/statistics-golden-fixtures';

const environment = localSupabaseEnv();

describe.skipIf(!environment.env)('subject history across communities', () => {
  it('includes public unranked guest play in global chronology without exposing it to another viewer', async () => {
    const home = await createRankedResultFixtures(environment.env!);
    const away = await createMatchManagementFixtures(environment.env!);
    try {
      const subject = home.players[0]!;
      const member1 = await away.member();
      const member2 = await away.member();
      const event = await away.event({ accepted: [subject, member1, member2] });
      const attempt = await away.latestAttemptId(event.id, subject.id);
      expect(attempt).not.toBeNull();
      const approved = await away.rpc(away.creator, 'decide_match_registration', {
        p_match_event_id: event.id,
        p_attempt_id: attempt,
        p_decision: 'approve'
      });
      if (approved.error) throw approved.error;
      const [registration] = await sqlRows(
        'select registration_source::text as source from public.match_event_registrations where match_event_id = ' +
          sqlText(event.id) +
          ' and user_id = ' +
          sqlText(subject.id)
      );
      expect(registration?.['source']).toBe('guest');
      await away.setCutoff(event.id, "now()-interval '1 minute'");
      await away.protectResults(event.id);
      const first = playedAt(3 * 86400);
      const middle = playedAt(2 * 86400);
      const last = playedAt(86400);
      async function homeWin(at: ReturnType<typeof playedAt>) {
        const id = await home.event(null, 'friendly');
        const submission = await home.submit(id, at.played);
        if (submission.error) throw submission.error;
        const result = await home.approve(String(asRecord(submission.data)['proposal_id']));
        if (result.error) throw result.error;
        return String(asRecord(submission.data)['proposal_id']);
      }
      const firstGroup = await homeWin(first);
      const submission = await away.rpc(away.creator, 'submit_match_event_result', {
        p_match_event_id: event.id,
        p_group_number: 1,
        p_teams: { team_a: [away.creator.id, subject.id], team_b: [member1.id, member2.id] },
        p_sets: rankedSets,
        p_played_local: middle.played,
        p_court_label: 'Court 1',
        p_request_id: crypto.randomUUID()
      });
      if (submission.error) throw submission.error;
      const reviewed = await away.rpc(member1, 'review_match_event_result', {
        p_proposal_id: String(asRecord(submission.data)['proposal_id']),
        p_expected_version: 1,
        p_decision: 'approve',
        p_request_id: crypto.randomUUID()
      });
      if (reviewed.error) throw reviewed.error;
      const lastGroup = await homeWin(last);
      const own = await home.rpc(subject, 'get_player_statistics', { p_player_id: subject.id });
      if (own.error) throw own.error;
      expect(asRecord(asRecord(own.data)['matches'])).toMatchObject({
        played: 3,
        friendly: 3,
        competitive: 0
      });
      const form = asRecord(asRecord(own.data)['form']);
      expect(form['current']).toMatchObject({ kind: 'W', length: 3 });
      const outcomes = asRecord(asRecord(form['last5'])['value'])['outcomes'];
      if (!Array.isArray(outcomes)) throw new Error('Expected form outcomes');
      expect(outcomes.map((item: unknown) => asRecord(item)['g'])).toEqual([
        firstGroup,
        String(asRecord(submission.data)['proposal_id']),
        lastGroup
      ]);
      const period = await home.rpc(subject, 'get_player_statistics', {
        p_player_id: subject.id,
        p_from: middle.iso.slice(0, 10),
        p_through: last.iso.slice(0, 10)
      });
      if (period.error) throw period.error;
      expect(asRecord(asRecord(period.data)['matches'])).toMatchObject({ played: 2, friendly: 2 });
      expect(asRecord(asRecord(period.data)['form'])['current']).toMatchObject({
        kind: 'W',
        length: 2
      });
      const outsider = await home.rpc(home.players[1]!, 'get_player_statistics', {
        p_player_id: subject.id
      });
      expect(outsider.error).not.toBeNull();
      const community = await home.rpc(subject, 'get_community_statistics', {
        p_community_id: home.communityId
      });
      if (community.error) throw community.error;
      expect(asRecord(asRecord(community.data)['matches'])['played']).toBe(2);
      const league = await home.league({ status: 'active', endMode: 'manual', endAt: null });
      for (const leagueId of [league, null]) {
        const competitiveEvent = await home.event(leagueId, 'competitive');
        const submitted = await home.submit(competitiveEvent, playedAt(30).played);
        if (submitted.error) throw submitted.error;
        const confirmation = await home.approve(String(asRecord(submitted.data)['proposal_id']));
        if (confirmation.error) throw confirmation.error;
      }
      const all = await home.rpc(subject, 'get_player_statistics', { p_player_id: subject.id });
      if (all.error) throw all.error;
      expect(asRecord(asRecord(all.data)['matches'])).toMatchObject(GOLDEN_GUEST_LEAGUE.allSubject);
      const scopedCommunity = await home.rpc(subject, 'get_community_statistics', {
        p_community_id: home.communityId
      });
      if (scopedCommunity.error) throw scopedCommunity.error;
      const page = asRecord(scopedCommunity.data);
      expect(asRecord(page['matches'])).toMatchObject(GOLDEN_GUEST_LEAGUE.homeCommunity);
      expect(asRecord(asRecord(page['rankingMatches'])['value'])['groups']).toBe(
        GOLDEN_GUEST_LEAGUE.activeRankingGroups
      );
      const scopedLeague = await home.rpc(subject, 'get_player_statistics', {
        p_player_id: subject.id,
        p_community_id: home.communityId,
        p_league_id: league
      });
      if (scopedLeague.error) throw scopedLeague.error;
      expect(asRecord(asRecord(scopedLeague.data)['matches'])).toMatchObject(
        GOLDEN_GUEST_LEAGUE.league
      );
    } finally {
      await away.cleanup();
      await home.cleanup();
    }
  }, 900000);
});
