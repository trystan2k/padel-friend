import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import {
  decodeGroupDetail,
  decodeHistoryPage
} from '../src/features/statistics/statistics-decoders';
import type {
  GroupDetail,
  HistoryItem
} from '../src/features/statistics/statistics-history-contracts';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  processDueMatchEventResults,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();

const set = (position: number, a: number, b: number, completed = true) => ({
  position,
  team_a_games: a,
  team_b_games: b,
  completed
});
const teamAWins = [set(1, 6, 4), set(2, 6, 3)];
const drawnUnfinishedThird = [set(1, 6, 4), set(2, 3, 6), set(3, 2, 1, false)];
const incompleteOneSet = [set(1, 6, 4)];
const PRIVATE_NOTE = 'PRIVATE-REJECTION-NOTE-7f3a';

/**
 * PAF-13 U2: the history reader combines projected confirmed groups with the bounded lifecycle
 * projections; the detail reader serves every PRD §37 fact without widening result-review rights.
 */
describe.skipIf(!environment.env)('Statistics history readers', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;
  let leagueId: string;
  const events: Record<string, string> = {};
  const proposals: Record<string, string> = {};
  const L = (id: string) => sqlText(id);
  const P = (index: number) => kit.players[index]!;
  const gKey = (name: string) => `g:${proposals[name]}`;

  async function confirm(eventId: string, sets: unknown, secondsAgo: number) {
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played, { sets });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    expect((await kit.approve(proposalId)).error).toBeNull();
    return proposalId;
  }
  async function submitOnly(eventId: string, secondsAgo: number) {
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played);
    expect(submitted.error).toBeNull();
    return String(asRecord(submitted.data)['proposal_id']);
  }
  const reject = (proposalId: string) =>
    kit.rpc(P(2), 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_reason_note: PRIVATE_NOTE,
      p_request_id: crypto.randomUUID()
    });
  async function history(
    actor: { client: RankedResultKit['creator']['client'] } = P(0),
    args: Record<string, unknown> = {}
  ) {
    const result = await actor.client.rpc('list_statistics_history', args);
    expect(result.error).toBeNull();
    return decodeHistoryPage(result.data);
  }
  async function detail(
    actor: { client: RankedResultKit['creator']['client'] },
    eventId: string,
    groupId: string
  ): Promise<GroupDetail> {
    const result = await actor.client.rpc('get_statistics_group_detail', {
      p_event_id: eventId,
      p_game_group_id: groupId
    });
    expect(result.error).toBeNull();
    return decodeGroupDetail(result.data);
  }
  const byKey = (items: HistoryItem[]) => new Map(items.map((item) => [item.key, item]));

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!, { levels: [4, 4, 4, 4, 4, 4, 4, 4] });
    leagueId = await kit.league();
    events.win = await kit.event();
    events.friendly = await kit.event(null, 'friendly');
    events.incomplete = await kit.event();
    events.pending = await kit.event();
    events.disputed = await kit.event();
    events.awaiting = await kit.event();
    events.canceled = await kit.event();
    events.reserve = await kit.event();
    events.league = await kit.event(leagueId);

    proposals.win = await confirm(events.win, teamAWins, 900);
    proposals.friendly = await confirm(events.friendly, drawnUnfinishedThird, 800);
    proposals.incomplete = await confirm(events.incomplete, incompleteOneSet, 700);
    proposals.pending = await submitOnly(events.pending, 600);
    proposals.disputed = await submitOnly(events.disputed, 500);
    const rejected = await reject(proposals.disputed);
    if (rejected.error) throw rejected.error;
    proposals.league = await confirm(events.league, teamAWins, 400);

    await kit.setStarted(events.awaiting);
    await kit.setStarted(events.reserve);
    await fixtureSql(
      `do $$ begin
        alter table public.match_events disable trigger match_event_immutable;
        update public.match_events set status = 'cancelled', cancelled_at = now(), cancelled_by = ${L(P(0).id)},
          cancel_reason = 'Court unavailable' where id = ${L(events.canceled)};
        alter table public.match_events enable trigger match_event_immutable;
        alter table public.match_event_registrations disable trigger match_registration_final_state;
        update public.match_event_registrations set participation_status = 'reserve_not_playing'
          where match_event_id = ${L(events.reserve)} and user_id = any (array[${[4, 5, 6, 7].map((i) => L(P(i).id)).join(',')}]::uuid[]);
        alter table public.match_event_registrations enable trigger match_registration_final_state;
      end $$;`
    );
  });
  afterAll(async () => {
    if (!kit) return;
    const players = kit.players.map((player) => L(player.id)).join(',');
    await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};`);
    await kit.cleanup();
  });

  it('reads the authorized subject rather than the caller and denies outsiders', async () => {
    const other = await history(P(0), {
      p_community_id: kit.communityId,
      p_subject_player_id: P(2).id
    });
    expect(byKey(other.items).get(gKey('win'))).toMatchObject({
      viewer_side: 'team_b',
      outcome: 'loss',
      opponents: ['Ranked Player 1', 'Ranked Player 2']
    });
    const reserve = await history(P(0), {
      p_community_id: kit.communityId,
      p_subject_player_id: P(7).id
    });
    expect(byKey(reserve.items).get(`e:${events.reserve}:0`)?.status).toBe('reserve_not_playing');
    expect(byKey(reserve.items).has(gKey('win'))).toBe(false);
    const outsider = await kit.actor();
    const denied = await outsider.client.rpc('list_statistics_history', {
      p_community_id: kit.communityId,
      p_subject_player_id: P(2).id
    });
    expect(denied.error?.message).toContain('STATISTICS_NOT_FOUND');
    const all = await P(0).client.rpc('list_statistics_history', { p_subject_player_id: P(2).id });
    expect(all.error?.message).toContain('STATISTICS_NOT_FOUND');
  });

  it('shows every lifecycle state once, separate from the match type', async () => {
    const page = await history();
    const items = byKey(page.items);
    const statusOf = (key: string) => items.get(key)?.status;
    expect(statusOf(gKey('win'))).toBe('played');
    expect(statusOf(gKey('friendly'))).toBe('played');
    expect(statusOf(gKey('incomplete'))).toBe('incomplete');
    expect(statusOf(gKey('pending'))).toBe('pending');
    expect(statusOf(gKey('disputed'))).toBe('disputed');
    expect(statusOf(gKey('league'))).toBe('played');
    expect(statusOf(`e:${events.awaiting}:1`)).toBe('awaiting_result');
    expect(statusOf(`e:${events.canceled}:0`)).toBe('canceled');
    // A reserve who did not play sees the event as Reserve Not Playing, never as a group.
    const reserve = byKey((await history(P(7))).items);
    expect(reserve.get(`e:${events.reserve}:0`)).toMatchObject({
      status: 'reserve_not_playing',
      kind: 'event',
      group_number: null
    });
    expect(
      [...reserve.values()].some(
        (item) => item.event_id === events.reserve && item.status === 'awaiting_result'
      )
    ).toBe(false);
    // Played may coexist with either type; the type is its own field.
    expect(items.get(gKey('win'))).toMatchObject({ match_type: 'competitive', status: 'played' });
    expect(items.get(gKey('friendly'))).toMatchObject({ match_type: 'friendly', status: 'played' });
    expect(new Set(page.items.map((item) => item.key)).size).toBe(page.items.length);
    expect(
      page.items.some((item) => item.event_id === events.win && item.status === 'awaiting_result')
    ).toBe(false);
  });

  it('never presents unresolved entries as played: no score, outcome or rating', async () => {
    const page = await history();
    const unresolved = page.items.filter(
      (entry) => !['played', 'incomplete'].includes(entry.status)
    );
    expect(unresolved.length).toBeGreaterThanOrEqual(5);
    for (const item of unresolved)
      expect(item).toMatchObject({
        outcome: null,
        classification: null,
        sets: null,
        sets_a: null,
        rating_delta: null
      });
    const pending = page.items.find((item) => item.status === 'pending');
    expect(pending).toMatchObject({ kind: 'group', viewer_side: 'team_a' });
    expect(JSON.stringify(page)).not.toContain(PRIVATE_NOTE);
  });

  it('serves the viewer-oriented result, games and rating of confirmed entries', async () => {
    const mine = byKey((await history(P(0))).items);
    expect(mine.get(gKey('win'))).toMatchObject({
      outcome: 'win',
      viewer_side: 'team_a',
      sets_a: 2,
      sets_b: 0,
      games_a: 12,
      games_b: 7,
      classification: 'team_a'
    });
    expect(mine.get(gKey('win'))?.rating_delta).not.toBeNull();
    expect(byKey((await history(P(2))).items).get(gKey('win'))).toMatchObject({
      outcome: 'loss',
      viewer_side: 'team_b'
    });
    expect(mine.get(gKey('friendly'))).toMatchObject({
      outcome: 'draw',
      sets_a: 1,
      sets_b: 1,
      games_a: 11,
      games_b: 11,
      rating_delta: null
    });
    expect(mine.get(gKey('incomplete'))).toMatchObject({
      outcome: null,
      classification: 'incomplete',
      games_a: 6,
      games_b: 4,
      rating_delta: null
    });
  });

  it('keeps one deterministic newest-first order and pages without gaps or repeats', async () => {
    // Tie one confirmed played instant with two unresolved scheduled instants.
    await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set starts_at = (
        select played_at from public.statistics_group_facts where game_group_id = ${L(proposals.win!)}
      ), registration_cutoff_at = (
        select played_at - interval '1 minute' from public.statistics_group_facts where game_group_id = ${L(proposals.win!)}
      ) where id in (${L(events.pending!)}, ${L(events.disputed!)});
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    const all = await history(P(0), { p_limit: 100 });
    const sorted = [...all.items].sort(
      (a, b) =>
        b.sort_at.localeCompare(a.sort_at) ||
        (a.key.slice(2, 38) < b.key.slice(2, 38)
          ? 1
          : a.key.slice(2, 38) > b.key.slice(2, 38)
            ? -1
            : 0)
    );
    expect(all.items.map((item) => item.key)).toEqual(sorted.map((item) => item.key));
    const tiedIds = [proposals.win!, proposals.pending!, proposals.disputed!];
    const tied = all.items.filter((item) => tiedIds.includes(item.key.slice(2)));
    expect(tied).toHaveLength(3);
    expect(new Set(tied.map((item) => item.sort_at)).size).toBe(1);
    const expectedTies = [...tiedIds]
      .sort()
      .reverse()
      .map((id) => 'g:' + id);
    expect(tied.map((item) => item.key)).toEqual(expectedTies);
    const walk = async () => {
      const keys: string[] = [];
      let cursor: { at: string; key: string } | null = null;
      for (let guard = 0; guard < 50; guard += 1) {
        const page: Awaited<ReturnType<typeof history>> = await history(P(0), {
          p_limit: 1,
          ...(cursor
            ? {
                p_cursor_at: cursor.at,
                p_cursor_key: cursor.key,
                p_revision: all.statistics_revision
              }
            : {})
        });
        keys.push(...page.items.map((item) => item.key));
        cursor = page.next_cursor;
        if (!cursor) break;
      }
      return keys;
    };
    expect(await walk()).toEqual(all.items.map((item) => item.key));
    expect(await walk()).toEqual(all.items.map((item) => item.key));
    expect(all.next_cursor).toBeNull();

    const seen: string[] = [];
    let cursor: { at: string; key: string } | null = null;
    for (let guard = 0; guard < 20; guard += 1) {
      const page: Awaited<ReturnType<typeof history>> = await history(P(0), {
        p_limit: 3,
        ...(cursor
          ? {
              p_cursor_at: cursor.at,
              p_cursor_key: cursor.key,
              p_revision: all.statistics_revision
            }
          : {})
      });
      expect(page.items.length).toBeLessThanOrEqual(3);
      seen.push(...page.items.map((item) => item.key));
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(seen).toEqual(all.items.map((item) => item.key));
  });

  it('clamps oversized page requests to 100', async () => {
    expect((await history(P(0), { p_limit: 1000 })).limit).toBe(100);
  });

  it('rejects a cursor pinned to another statistics revision and malformed paging input', async () => {
    const first = await history(P(0), { p_limit: 2 });
    const next = first.next_cursor!;
    const stale = await P(0).client.rpc('list_statistics_history', {
      p_limit: 2,
      p_cursor_at: next.at,
      p_cursor_key: next.key,
      p_revision: first.statistics_revision + 1
    });
    expect(stale.error?.message).toContain('STATISTICS_REVISION_STALE');
    for (const args of [
      { p_limit: 0 },
      { p_type: 'ranked' },
      { p_cursor_at: next.at },
      { p_from: '2030-02-02', p_through: '2030-02-01' },
      { p_league_id: leagueId }
    ]) {
      const result = await P(0).client.rpc('list_statistics_history', args);
      expect(result.error?.message).toContain('STATISTICS_INVALID_INPUT');
    }
    const foreign = await P(0).client.rpc('list_statistics_history', {
      p_community_id: crypto.randomUUID(),
      p_league_id: leagueId
    });
    expect(foreign.error?.message).toContain('STATISTICS_INVALID_INPUT');
  });

  it('filters by type, community, League and UTC played day', async () => {
    const friendly = await history(P(0), { p_type: 'friendly' });
    expect(friendly.items.length).toBeGreaterThan(0);
    expect(friendly.items.every((item) => item.match_type === 'friendly')).toBe(true);
    const competitive = await history(P(0), { p_type: 'competitive' });
    expect(competitive.items.every((item) => item.match_type === 'competitive')).toBe(true);
    expect((await history(P(0), { p_community_id: crypto.randomUUID() })).items).toEqual([]);
    const inCommunity = await history(P(0), { p_community_id: kit.communityId });
    expect(inCommunity.items.length).toBe((await history(P(0))).items.length);
    const league = await history(P(0), { p_community_id: kit.communityId, p_league_id: leagueId });
    expect(league.items.map((item) => item.key)).toEqual([gKey('league')]);
    expect(
      (
        await history(P(0), {
          p_community_id: kit.communityId,
          p_league_id: leagueId,
          p_type: 'friendly'
        })
      ).items
    ).toEqual([]);
    const day = playedAt(900).iso.slice(0, 10);
    const dayItems = await history(P(0), { p_from: day, p_through: day });
    expect(dayItems.items.some((item) => item.key === gKey('win'))).toBe(true);
    expect((await history(P(0), { p_from: '2001-01-01', p_through: '2001-01-02' })).items).toEqual(
      []
    );
  });

  it('finds eligible League groups after newer unrelated groups with a small page size', async () => {
    for (const age of [180, 160, 140]) {
      const eventId = await kit.event();
      await confirm(eventId, teamAWins, age);
    }
    const pendingLeagueEvent = await kit.event(leagueId);
    await submitOnly(pendingLeagueEvent, 100);
    const page = await history(P(0), {
      p_community_id: kit.communityId,
      p_league_id: leagueId,
      p_limit: 1
    });
    expect(page.items.map((item) => item.key)).toEqual([gKey('league')]);
    expect(page.next_cursor).not.toBeNull();
  });

  it('lists a partially resolved event once per group with the right lifecycle for each player', async () => {
    const eventId = await kit.event();
    const confirmed = await confirm(eventId, teamAWins, 300);
    await kit.setStarted(eventId);
    const first = byKey((await history(P(0), { p_limit: 100 })).items);
    expect(first.get(`g:${confirmed}`)?.status).toBe('played');
    expect([...first.values()].filter((item) => item.event_id === eventId)).toHaveLength(1);
    const second = byKey((await history(P(4), { p_limit: 100 })).items);
    expect(second.get(`e:${eventId}:2`)).toMatchObject({
      status: 'awaiting_result',
      group_number: 2,
      game_group_id: null
    });
    expect(second.has(`g:${confirmed}`)).toBe(false);
    expect([...second.values()].filter((item) => item.event_id === eventId)).toHaveLength(1);
  });

  it('excludes reserve registrations from the actual teams of a confirmed group', async () => {
    const view = await detail(P(0), events.win!, proposals.win!);
    const ids = [...view.teams.team_a, ...view.teams.team_b].map((player) => player.user_id).sort();
    expect(ids).toEqual(
      kit
        .group(1)
        .map((player) => player.id)
        .sort()
    );
    expect(ids).not.toContain(P(7).id);
  });

  it('exposes every §37 fact of a manually approved Competitive group', async () => {
    const view = await detail(P(1), events.win!, proposals.win!);
    const played = playedAt(900);
    expect(view).toMatchObject({
      event_id: events.win,
      game_group_id: proposals.win,
      group_number: 1,
      venue_name: 'Invitation court',
      court_label: 'Court 1',
      timezone: 'UTC',
      match_type: 'competitive',
      league: null,
      played_at_offset_seconds: 0,
      rating_state: 'applied',
      correction: { corrected: false, version: 1 },
      result: {
        classification: 'team_a',
        winner: 'team_a',
        sets_a: 2,
        sets_b: 0,
        games_a: 12,
        games_b: 7
      }
    });
    expect(view.matchup.reason).toBeNull();
    expect(view.matchup.team_a_strength).not.toBeNull();
    expect(view.matchup.team_b_strength).not.toBeNull();
    expect(view.matchup.team_a_expected).not.toBeNull();
    expect(view.matchup.team_b_expected).not.toBeNull();
    expect(typeof view.matchup.upset).toBe('boolean');
    expect(view.community.id).toBe(kit.communityId);
    expect(view.community.name).toBeTruthy();
    expect(view.result.sets).toEqual(teamAWins);
    expect(Math.abs(Date.parse(view.played_at) - Date.parse(played.iso))).toBeLessThan(10_000);
    expect(view.played_at_local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(view.teams.team_a.map((player) => player.user_id)).toEqual([P(0).id, P(1).id]);
    expect(view.teams.team_b.map((player) => player.user_id)).toEqual([P(2).id, P(3).id]);
    expect(Number.isFinite(Date.parse(view.confirmation.confirmed_at))).toBe(true);
    expect(view.teams.team_a.map((player) => player.display_name)).toEqual([
      'Ranked Player 1',
      'Ranked Player 2'
    ]);
    expect(view.teams.team_b.map((player) => player.display_name)).toEqual([
      'Ranked Player 3',
      'Ranked Player 4'
    ]);
    for (const player of [...view.teams.team_a, ...view.teams.team_b]) {
      expect(player.rating.state).toBe('applied');
      expect(player.rating.before_level).toBe(4);
      expect(player.rating.reason).toBeNull();
      expect(player.rating.after_level).not.toBeNull();
      expect(player.rating.delta).not.toBeNull();
      expect(player.rating.expected_score).not.toBeNull();
      expect(
        Math.abs(player.rating.after_level! - player.rating.before_level! - player.rating.delta!)
      ).toBeLessThan(0.011);
    }
    expect(view.teams.team_a[0]!.rating.delta!).toBeGreaterThan(0);
    expect(view.teams.team_b[0]!.rating.delta!).toBeLessThan(0);
    expect(view.confirmation).toMatchObject({ source: 'MANUAL', automatic: false });
    expect(view.confirmation.approver?.user_id).toBe(P(2).id);
    expect(view.confirmation.approver?.display_name).toBe('Ranked Player 3');
    expect(view.submitter).toMatchObject({ user_id: P(0).id, display_name: 'Ranked Player 1' });
    expect(view.timeline.map((entry) => entry.kind)).toEqual([
      'submitted',
      'approved',
      'confirmed'
    ]);
    expect(view.timeline[1]?.actor?.user_id).toBe(P(2).id);
    expect(view.timeline[2]).toMatchObject({ source: 'MANUAL' });
  });

  it('applies the configured upset threshold to the winning side', async () => {
    const initial = await detail(P(0), events.win!, proposals.win!);
    const expected = initial.matchup.team_a_expected;
    expect(expected).not.toBeNull();
    if (expected === null || expected <= 0 || expected >= 1)
      throw new Error('Expected a probability between zero and one');
    const [config] = await sqlRows(
      'select thresholds::text as thresholds from public.statistics_config where active'
    );
    try {
      await fixtureSql(
        `update public.statistics_config set thresholds = jsonb_set(thresholds, '{upset_expected_score_max}', to_jsonb(${expected}::numeric)) where active`
      );
      expect((await detail(P(0), events.win!, proposals.win!)).matchup.upset).toBe(true);
      await fixtureSql(
        `update public.statistics_config set thresholds = jsonb_set(thresholds, '{upset_expected_score_max}', to_jsonb((${expected}::numeric / 2))) where active`
      );
      expect((await detail(P(0), events.win!, proposals.win!)).matchup.upset).toBe(false);
    } finally {
      await fixtureSql(
        `update public.statistics_config set thresholds = ${L(String(config?.['thresholds']))}::jsonb where active`
      );
    }
  });

  it('shows the League and its eligibility for a Ranked group', async () => {
    const view = await detail(P(0), events.league!, proposals.league!);
    expect(view.league).toMatchObject({ id: leagueId, eligible: true });
    expect(view.league?.name).toBeTruthy();
  });

  it('states explicitly that Friendly and Incomplete groups carry no rating evidence', async () => {
    const friendly = await detail(P(0), events.friendly!, proposals.friendly!);
    expect(friendly.rating_state).toBe('friendly');
    expect(friendly.matchup).toEqual({
      team_a_strength: null,
      team_b_strength: null,
      team_a_expected: null,
      team_b_expected: null,
      upset: null,
      reason: 'friendly'
    });
    expect(friendly.result).toMatchObject({
      classification: 'draw',
      winner: 'draw',
      sets_a: 1,
      sets_b: 1,
      games_a: 11,
      games_b: 11
    });
    for (const player of [...friendly.teams.team_a, ...friendly.teams.team_b])
      expect(player.rating).toEqual({
        state: 'not_applied',
        reason: 'friendly',
        before_level: null,
        after_level: null,
        delta: null,
        before_reliability: null,
        after_reliability: null,
        expected_score: null
      });
    expect(friendly.result.sets).toEqual(drawnUnfinishedThird);
    const incomplete = await detail(P(0), events.incomplete!, proposals.incomplete!);
    expect(incomplete.result.sets).toEqual(incompleteOneSet);
    expect(incomplete.rating_state).toBe('incomplete');
    expect(incomplete.matchup).toEqual({
      team_a_strength: null,
      team_b_strength: null,
      team_a_expected: null,
      team_b_expected: null,
      upset: null,
      reason: 'incomplete'
    });
    expect(incomplete.result).toMatchObject({
      classification: 'incomplete',
      winner: null,
      games_a: 6,
      games_b: 4
    });
    for (const player of [...incomplete.teams.team_a, ...incomplete.teams.team_b])
      expect(player.rating).toMatchObject({
        state: 'not_applied',
        reason: 'incomplete',
        before_level: null,
        after_level: null,
        before_reliability: null,
        after_reliability: null,
        expected_score: null,
        delta: null
      });
  });

  it('words an automatic confirmation without an approver', async () => {
    const eventId = await kit.event();
    const proposalId = await submitOnly(eventId, 200);
    await setResultReviewDeadlineOffset(proposalId, 1, -60);
    await processDueMatchEventResults();
    const view = await detail(P(0), eventId, proposalId);
    expect(view.confirmation).toMatchObject({
      source: 'AUTO_48H',
      automatic: true,
      approver: null
    });
    expect(view.timeline.map((entry) => entry.kind)).toEqual(['submitted', 'confirmed']);
    expect(view.timeline[1]).toMatchObject({ source: 'AUTO_48H', actor: null });
  });

  it('adds a correction badge only with correction evidence and keeps private notes out', async () => {
    const eventId = await kit.event();
    const proposalId = await submitOnly(eventId, 150);
    expect((await reject(proposalId)).error).toBeNull();
    expect((await kit.correct(proposalId, 1, playedAt(140).played)).error).toBeNull();
    expect((await kit.approve(proposalId, 2)).error).toBeNull();
    const view = await detail(P(0), eventId, proposalId);
    expect(view.correction).toEqual({ corrected: true, version: 2 });
    expect(view.timeline.map((entry) => entry.kind)).toEqual([
      'submitted',
      'corrected',
      'approved',
      'confirmed'
    ]);
    expect(JSON.stringify(view)).not.toContain(PRIVATE_NOTE);
    expect(JSON.stringify(view).toLowerCase()).not.toContain('@test.local');
    const plain = await detail(P(0), events.win!, proposals.win!);
    expect(plain.correction.corrected).toBe(false);
    expect(plain.timeline.some((entry) => entry.kind === 'corrected')).toBe(false);
  });

  it('lets a non-playing community member read the detail but gives them no history entry', async () => {
    const watcher = await kit.member();
    expect((await history(watcher)).items).toEqual([]);
    const view = await detail(watcher, events.win!, proposals.win!);
    expect(view.game_group_id).toBe(proposals.win);
  });

  it('denies an outsider the detail identically to an unknown group and gives them an empty history', async () => {
    const outsider = await kit.actor();
    expect((await history(outsider)).items).toEqual([]);
    const denied = await outsider.client.rpc('get_statistics_group_detail', {
      p_event_id: events.win!,
      p_game_group_id: proposals.win!
    });
    const unknown = await outsider.client.rpc('get_statistics_group_detail', {
      p_event_id: events.win!,
      p_game_group_id: crypto.randomUUID()
    });
    expect(denied.error?.message).toContain('STATISTICS_NOT_FOUND');
    expect(unknown.error?.message).toContain('STATISTICS_NOT_FOUND');
    expect(denied.data).toBeNull();
    const pending = await P(0).client.rpc('get_statistics_group_detail', {
      p_event_id: events.pending!,
      p_game_group_id: proposals.pending!
    });
    expect(pending.error?.message).toContain('STATISTICS_NOT_FOUND');
    const crossed = await P(0).client.rpc('get_statistics_group_detail', {
      p_event_id: events.friendly!,
      p_game_group_id: proposals.win!
    });
    expect(crossed.error?.message).toContain('STATISTICS_NOT_FOUND');
  });

  it('fails unauthenticated callers with an error, never an empty result', async () => {
    const anon = createClient(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    expect((await anon.rpc('list_statistics_history')).error).not.toBeNull();
    expect(
      (
        await anon.rpc('get_statistics_group_detail', {
          p_event_id: events.win!,
          p_game_group_id: proposals.win!
        })
      ).error
    ).not.toBeNull();
  });

  it('fails retryably instead of mixing snapshots while rating-derived fields lag the committed revision', async () => {
    const [before] = await sqlRows(
      'select rating_revision::int as r from public.statistics_projection_control'
    );
    try {
      await fixtureSql(
        'update public.statistics_projection_control set rating_revision = rating_revision - 1 where singleton'
      );
      const list = await P(0).client.rpc('list_statistics_history');
      const one = await P(0).client.rpc('get_statistics_group_detail', {
        p_event_id: events.win!,
        p_game_group_id: proposals.win!
      });
      expect(list.error?.message).toContain('STATISTICS_STALE_REVISION');
      expect(one.error?.message).toContain('STATISTICS_STALE_REVISION');
    } finally {
      await fixtureSql(
        `update public.statistics_projection_control set rating_revision = ${Number(before?.['r'])} where singleton`
      );
    }
    expect((await P(0).client.rpc('list_statistics_history')).error).toBeNull();
  });

  it('reads only projections: no reader calls the official-source or rebuild functions', async () => {
    const rows = await sqlRows(
      `select p.proname, pg_get_functiondef(p.oid) as def from pg_proc p
        where p.proname in ('list_statistics_history', 'get_statistics_group_detail', 'statistics_can_view_event')`
    );
    expect(rows).toHaveLength(3);
    for (const row of rows)
      expect(String(row['def'])).not.toMatch(
        /statistics_official|rebuild_statistics|statistics_project_source|statistics_publish/
      );
  });
  it('walks interleaved confirmed and pending entries without gaps', async () => {
    for (let i = 0; i < 30; i += 1) {
      const event = await kit.event();
      if (i % 6 === 0) await submitOnly(event, 1000 + i);
      else await confirm(event, teamAWins, 1000 + i);
    }
    const all = await history(P(0), { p_limit: 100 });
    expect(all.items.filter((item) => item.status === 'played').length).toBeGreaterThanOrEqual(25);
    expect(all.items.filter((item) => item.status === 'pending').length).toBeGreaterThanOrEqual(5);
    const keys: string[] = [];
    let cursor: { at: string; key: string } | null = null;
    for (let i = 0; i < 20; i += 1) {
      const page: Awaited<ReturnType<typeof history>> = await history(P(0), {
        p_limit: 10,
        ...(cursor
          ? {
              p_cursor_at: cursor.at,
              p_cursor_key: cursor.key,
              p_revision: all.statistics_revision
            }
          : {})
      });
      keys.push(...page.items.map((item) => item.key));
      cursor = page.next_cursor;
      if (!cursor) break;
    }
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(all.items.map((item) => item.key));
    const sorted = [...all.items].sort(
      (a, b) =>
        b.sort_at.localeCompare(a.sort_at) || b.key.slice(2, 38).localeCompare(a.key.slice(2, 38))
    );
    expect(keys).toEqual(sorted.map((item) => item.key));
  });
});

describe.skipIf(!environment.env)('underdog matchup evidence', { timeout: 300_000 }, () => {
  it('identifies a lower-strength winner using projected pre-match evidence', async () => {
    const kit = await createRankedResultFixtures(environment.env!, {
      levels: [2, 2, 6, 6, 4, 4, 4, 4]
    });
    const L = sqlText;
    try {
      const eventId = await kit.event();
      const submitted = await kit.submit(eventId, playedAt(600).played, { sets: teamAWins });
      expect(submitted.error).toBeNull();
      const groupId = String(asRecord(submitted.data)['proposal_id']);
      expect((await kit.approve(groupId)).error).toBeNull();
      const response = await kit.players[0]!.client.rpc('get_statistics_group_detail', {
        p_event_id: eventId,
        p_game_group_id: groupId
      });
      expect(response.error).toBeNull();
      const view = decodeGroupDetail(response.data);
      expect(view.matchup.reason).toBeNull();
      expect(view.matchup.team_a_strength).toBeLessThan(view.matchup.team_b_strength!);
      expect(view.matchup.team_a_expected).toBeLessThanOrEqual(0.35);
      expect(view.matchup.upset).toBe(true);
      const favoriteEvent = await kit.event();
      const favorite = await kit.submit(favoriteEvent, playedAt(300).played, {
        sets: [set(1, 4, 6), set(2, 3, 6)]
      });
      expect(favorite.error).toBeNull();
      const favoriteId = String(asRecord(favorite.data)['proposal_id']);
      expect((await kit.approve(favoriteId)).error).toBeNull();
      const favoriteResponse = await kit.players[0]!.client.rpc('get_statistics_group_detail', {
        p_event_id: favoriteEvent,
        p_game_group_id: favoriteId
      });
      expect(favoriteResponse.error).toBeNull();
      const favoriteView = decodeGroupDetail(favoriteResponse.data);
      expect(favoriteView.matchup.team_b_strength).toBeGreaterThan(
        favoriteView.matchup.team_a_strength!
      );
      expect(favoriteView.result.winner).toBe('team_b');
      expect(favoriteView.matchup.upset).toBe(false);
    } finally {
      const players = kit.players.map((player) => L(player.id)).join(',');
      await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};
        delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${L(kit.communityId)};`);
      await kit.cleanup();
    }
  });
});
