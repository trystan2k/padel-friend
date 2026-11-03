import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodePlayerRankHistory } from '../src/features/statistics/statistics-player.server';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  setMembershipHistory,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const T = sqlText;

type Latest = {
  status: string;
  rank: number | null;
  members: number | null;
  complete: boolean;
  revision: number | null;
  source: string | null;
  established: boolean | null;
};

/** PAF-13 U3: historical community skill rank and best League position materialization. */
describe.skipIf(!environment.env)('player statistics rank history', { timeout: 600_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    // p2/p3 start above p0/p1; p4..p7 tie. A rated win by p0/p1 must overtake p2/p3.
    kit = await createRankedResultFixtures(environment.env!, {
      levels: [4.0, 4.0, 4.1, 4.1, 3.0, 3.0, 3.0, 3.0]
    });
  });
  afterAll(async () => {
    if (!kit) return;
    const players = kit.players.map((player) => T(player.id)).join(',');
    await fixtureSql(
      'delete from public.statistics_rank_dirty where community_id = ' +
        T(kit.communityId) +
        ';' +
        'delete from public.statistics_league_positions where community_id = ' +
        T(kit.communityId) +
        ';' +
        'delete from public.statistics_scope_summaries where subject_players && array[' +
        players +
        ']::uuid[] or subject_a = ' +
        T(kit.communityId) +
        ';' +
        'delete from public.statistics_daily_buckets where subject_players && array[' +
        players +
        ']::uuid[] or subject_a = ' +
        T(kit.communityId) +
        ';'
    );
    await kit.cleanup();
  });

  const id = (index: number) => kit.players[index]!.id;
  const indexOf = (userId: string) => kit.players.findIndex((player) => player.id === userId);

  /** Latest stored transition of every player of the fixture community. */
  async function latest(): Promise<Map<number, Latest>> {
    const rows = await sqlRows(
      "select distinct on (player_id) player_id::text as player, status, skill_rank, ranked_members, complete, rating_revision, established, provenance #>> '{evidence,source}' as source " +
        'from public.statistics_rank_transitions where community_id = ' +
        T(kit.communityId) +
        ' order by player_id, effective_from desc'
    );
    return new Map(
      rows.map((row) => [
        indexOf(String(row['player'])),
        {
          status: String(row['status']),
          rank: row['skill_rank'] === null ? null : Number(row['skill_rank']),
          members: row['ranked_members'] === null ? null : Number(row['ranked_members']),
          complete: row['complete'] === true,
          revision: row['rating_revision'] === null ? null : Number(row['rating_revision']),
          established: row['established'] === null ? null : row['established'] === true,
          source: typeof row['source'] === 'string' ? row['source'] : null
        }
      ])
    );
  }

  /** Independent oracle: established first, then level, equal keys share a position. */
  async function oracle(active: number[]): Promise<Map<number, number>> {
    const entries: { index: number; established: boolean; level: number }[] = [];
    for (const index of active) {
      const [row] = await sqlRows(
        'select public.rating_summary_at(' +
          T(id(index)) +
          '::uuid, (select committed_revision from public.player_rating_projection_control)) as summary'
      );
      const summary = asRecord(row?.['summary']);
      entries.push({
        index,
        established: Number(summary['reliability_percent']) >= 100,
        level: Number(summary['display_level'])
      });
    }
    const better = (a: (typeof entries)[number], b: (typeof entries)[number]) =>
      a.established !== b.established ? a.established : a.level > b.level;
    return new Map(
      entries.map((entry) => [
        entry.index,
        1 + entries.filter((other) => better(other, entry)).length
      ])
    );
  }
  const ranksOf = (state: Map<number, Latest>) =>
    new Map(
      [...state]
        .filter(([, value]) => value.status === 'ranked')
        .map(([key, value]) => [key, value.rank])
    );

  async function confirmedGroup(eventId: string, secondsAgo: number) {
    const played = playedAt(secondsAgo);
    const submitted = await kit.submit(eventId, played.played);
    expect(submitted.error).toBeNull();
    const group = String(asRecord(submitted.data)['proposal_id']);
    expect((await kit.approve(group)).error).toBeNull();
    return group;
  }
  const rank = async (index: number, args: Record<string, unknown> = {}) => {
    const result = await kit.rpc(kit.players[index]!, 'get_player_statistics', {
      p_player_id: id(index),
      p_community_id: kit.communityId,
      ...args
    });
    expect(result.error).toBeNull();
    return asRecord(asRecord(result.data)['rating']);
  };
  const committedRevision = async () =>
    Number(
      (
        await sqlRows(
          'select committed_revision::int as r from public.player_rating_projection_control'
        )
      )[0]!['r']
    );
  const dirtyCount = async () =>
    Number(
      (
        await sqlRows(
          'select count(*)::int as n from public.statistics_rank_dirty where community_id = ' +
            T(kit.communityId)
        )
      )[0]!['n']
    );

  it('ranks active members from initialization evidence, with equal levels sharing a position', async () => {
    const state = await latest();
    expect([...state.values()].every((entry) => entry.status === 'ranked' && entry.complete)).toBe(
      true
    );
    expect([...state.values()].every((entry) => entry.source === 'initialization')).toBe(true);
    expect(ranksOf(state)).toEqual(await oracle([0, 1, 2, 3, 4, 5, 6, 7]));
    // Competition ranking: 4.1 x2 -> 1, 4.0 x2 -> 3, 3.0 x4 -> 5.
    expect([...ranksOf(state).values()].sort((a, b) => Number(a) - Number(b))).toEqual([
      1, 1, 3, 3, 5, 5, 5, 5
    ]);
    // Evidence started after the membership interval: the early periods are a coverage boundary.
    const unrated = await sqlRows(
      'select count(*)::int as n from public.statistics_rank_transitions where community_id = ' +
        T(kit.communityId) +
        " and status = 'unrated'"
    );
    expect(Number(unrated[0]!['n'])).toBeGreaterThan(0);
    const stats = await rank(0);
    expect(stats).toMatchObject({
      communitySkillRank: { state: 'ready', value: { position: 3, provenance: 'reconstructed' } },
      bestCommunitySkillRank: {
        best: { state: 'ready', value: { position: 3 } },
        coverageComplete: false,
        coverageReason: 'missing_rating_evidence'
      }
    });
  });

  it('adds ledger transitions at the committed revision boundary and keeps the earlier history', async () => {
    const before = (await latest()).get(0)!;
    expect(before.rank).toBe(3);
    await confirmedGroup(await kit.event(), 500);
    const revision = await committedRevision();
    const state = await latest();
    expect(ranksOf(state)).toEqual(await oracle([0, 1, 2, 3, 4, 5, 6, 7]));
    // The winners overtook the pair that started above them; the others did not move.
    expect(state.get(0)).toMatchObject({ rank: 1, source: 'ledger', revision });
    expect(state.get(2)!.rank).toBe(3);
    expect(state.get(4)).toMatchObject({ rank: 5, source: 'initialization' });
    const [boundary] = await sqlRows(
      'select (select t.effective_from from public.statistics_rank_transitions t where t.community_id = ' +
        T(kit.communityId) +
        ' and t.player_id = ' +
        T(id(0)) +
        ' order by t.effective_from desc limit 1) = (select max(k.calculated_at) from public.player_rating_event_calculations k where k.projection_revision = ' +
        revision +
        ') as exact'
    );
    expect(boundary?.['exact']).toBe(true);
    const history = await sqlRows(
      'select skill_rank from public.statistics_rank_transitions where community_id = ' +
        T(kit.communityId) +
        ' and player_id = ' +
        T(id(0)) +
        " and status = 'ranked' and complete order by effective_from"
    );
    expect(history.map((row) => Number(row['skill_rank']))).toEqual([3, 1]);
    // Best rank is the proven historical minimum; the previous rank stays queryable.
    expect(await rank(0)).toMatchObject({
      communitySkillRank: { state: 'ready', value: { position: 1, ratingRevision: revision } },
      bestCommunitySkillRank: { best: { state: 'ready', value: { position: 1 } } }
    });
    const loser = await rank(2);
    expect(loser).toMatchObject({
      communitySkillRank: { value: { position: 3 } },
      bestCommunitySkillRank: { best: { value: { position: 1 } } }
    });
  });

  it('marks affected players on a membership change and drains them in the same transaction', async () => {
    const connection = await openDedicatedSqlConnection();
    try {
      await connection.query('begin');
      await connection.query(
        'alter table public.community_members disable trigger community_member_guard; ' +
          "update public.community_members set activated_at = activated_at - interval '1 second' where community_id = " +
          T(kit.communityId) +
          ' and user_id = ' +
          T(id(6)) +
          ' and valid_until is null; ' +
          'alter table public.community_members enable trigger community_member_guard;'
      );
      // The change marked its player inside the transaction; nothing is recomputed before commit.
      const marked = await connection.query(
        'select player_id::text as player, cause from public.statistics_rank_dirty where community_id = ' +
          T(kit.communityId)
      );
      expect(marked.rows).toEqual([{ player: id(6), cause: 'membership' }]);
      await connection.query('commit');
    } finally {
      await connection.query('rollback').catch(() => undefined);
      await connection.close();
    }
    // The deferred drain consumed the mark when that transaction committed.
    expect(await dirtyCount()).toBe(0);

    const endedAt = new Date().toISOString();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    await setMembershipHistory(kit.communityId, id(7), [
      { activatedAt: since, validUntil: endedAt }
    ]);
    expect(await dirtyCount()).toBe(0);
    const state = await latest();
    expect(state.get(7)).toMatchObject({ status: 'not_member', rank: null });
    const [end] = await sqlRows(
      'select effective_from = ' +
        T(endedAt) +
        '::timestamptz as exact from public.statistics_rank_transitions where community_id = ' +
        T(kit.communityId) +
        ' and player_id = ' +
        T(id(7)) +
        ' order by effective_from desc limit 1'
    );
    expect(end?.['exact']).toBe(true);
    // The remaining members were recomputed without the leaver.
    for (const index of [0, 1, 2, 3, 4, 5, 6]) expect(state.get(index)!.members).toBe(7);
    expect(ranksOf(state)).toEqual(await oracle([0, 1, 2, 3, 4, 5, 6]));
    expect(state.get(4)!.rank).toBe(5);

    const own = await rank(7);
    expect(own).toMatchObject({
      communitySkillRank: { state: 'insufficient', reason: 'not_ranked' },
      bestCommunitySkillRank: { best: { state: 'ready' } }
    });
    const bestCoverage = asRecord(own['bestCommunitySkillRank']);
    expect(Date.parse(String(bestCoverage['coverageUntil']))).toBe(Date.parse(endedAt));
    // History is kept up to the membership end.
    const rows = await sqlRows(
      'select status from public.statistics_rank_transitions where community_id = ' +
        T(kit.communityId) +
        ' and player_id = ' +
        T(id(7)) +
        ' order by effective_from desc limit 2'
    );
    expect(rows.map((row) => row['status'])).toEqual(['not_member', 'ranked']);
    // Rejoining restores a rank from that boundary on.
    await setMembershipHistory(kit.communityId, id(7), [{ activatedAt: since }]);
    expect((await latest()).get(7)).toMatchObject({ status: 'ranked', rank: 5 });
  });

  it('exposes a coverage boundary instead of a League position until standings are published', async () => {
    const leagueId = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    const live = await rank(0, { p_league_id: leagueId });
    expect(live).toMatchObject({
      bestLeaguePosition: {
        best: { state: 'unavailable', value: null, reason: 'rank_coverage_boundary' },
        coverageComplete: false,
        coverageReason: 'unpublished_league'
      }
    });
    expect(
      await sqlRows(
        'select 1 from public.statistics_league_positions where league_id = ' + T(leagueId)
      )
    ).toHaveLength(0);

    await confirmedGroup(await kit.event(leagueId), 300);
    const closed = await kit.rpc(kit.creator, 'close_league', {
      p_league_id: leagueId,
      p_expected_version: 1
    });
    expect(closed.error).toBeNull();
    // League close marked the League and the same transaction materialized its positions.
    expect(await dirtyCount()).toBe(0);
    const positions = await sqlRows(
      'select player_id::text as player, league_position, standings_version, basis from public.statistics_league_positions where league_id = ' +
        T(leagueId) +
        ' order by league_position, player_id'
    );
    expect(positions).toHaveLength(4);
    expect(
      positions
        .slice(0, 2)
        .map((row) => indexOf(String(row['player'])))
        .sort((a, b) => a - b)
    ).toEqual([0, 1]);
    expect(positions.map((row) => Number(row['league_position']))).toEqual([1, 1, 3, 3]);

    const winner = await rank(0, { p_league_id: leagueId });
    expect(winner).toMatchObject({
      bestLeaguePosition: {
        best: {
          state: 'ready',
          value: { position: 1, provenance: 'published', standingsVersion: 1, leagueId }
        },
        coverageComplete: true,
        coverageReason: null
      },
      activeLeaguePosition: { state: 'ready', value: { position: 1, standingsVersion: 1 } }
    });
    expect(await rank(2, { p_league_id: leagueId })).toMatchObject({
      bestLeaguePosition: { best: { value: { position: 3 } } }
    });
    // A member who did not play is not fabricated into the final standings.
    expect(await rank(5, { p_league_id: leagueId })).toMatchObject({
      bestLeaguePosition: { best: { state: 'insufficient', reason: 'not_in_league' } },
      activeLeaguePosition: { state: 'insufficient', reason: 'not_in_league' }
    });
    // Community scope aggregates over the community's Leagues.
    expect(await rank(0)).toMatchObject({
      bestLeaguePosition: { best: { value: { position: 1, leagueId } } }
    });
  });

  it('serves the rank history page with evidence and decodes it', async () => {
    const result = await kit.rpc(kit.players[0]!, 'get_player_statistics_rank_history', {
      p_player_id: id(0),
      p_community_id: kit.communityId
    });
    expect(result.error).toBeNull();
    const page = decodePlayerRankHistory(result.data);
    expect(page.transitions[0]).toMatchObject({ status: 'ranked', position: 1, source: 'ledger' });
    expect(page.transitions.map((row) => row.effectiveFrom)).toEqual(
      [...page.transitions.map((row) => row.effectiveFrom)].sort().reverse()
    );
    expect(page.leaguePositions).toHaveLength(1);
    const limited = await kit.rpc(kit.players[0]!, 'get_player_statistics_rank_history', {
      p_player_id: id(0),
      p_community_id: kit.communityId,
      p_limit: 1
    });
    expect(decodePlayerRankHistory(limited.data)).toMatchObject({ truncated: true });
    // A teammate in the same community may read it; an outsider and a bad limit are refused.
    expect(
      (
        await kit.players[1]!.client.rpc('get_player_statistics_rank_history', {
          p_player_id: id(0),
          p_community_id: kit.communityId
        })
      ).error
    ).toBeNull();
    expect(
      (
        await kit.players[1]!.client.rpc('get_player_statistics_rank_history', {
          p_player_id: id(0)
        })
      ).error?.message
    ).toContain('STATISTICS_NOT_FOUND');
    expect(
      (
        await kit.players[0]!.client.rpc('get_player_statistics_rank_history', {
          p_player_id: id(0),
          p_limit: 500
        })
      ).error?.message
    ).toContain('STATISTICS_INVALID_INPUT');
  });

  it('rebuilds deterministically: a repeated repair rewrites nothing', async () => {
    const snapshot = () =>
      sqlRows(
        'select player_id::text, effective_from::text, status, skill_rank, ranked_members, complete, rating_revision, provenance::text from public.statistics_rank_transitions where community_id = ' +
          T(kit.communityId) +
          ' order by player_id, effective_from'
      );
    const before = await snapshot();
    const [result] = await sqlRows(
      'select public.statistics_rank_rebuild(' + T(kit.communityId) + ') as r'
    );
    expect(asRecord(result?.['r'])).toMatchObject({ changed: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it('ranks established members before unestablished ones and refreshes on a committed rating revision', async () => {
    const revision = (await committedRevision()) + 1;
    // Trusted seam: a replay appends a calculation revision; p0 becomes established at a lower level.
    await fixtureSql(
      'insert into public.player_rating_event_calculations (rating_event_id, projection_revision, rating_engine, rating_engine_version, rating_config_version, before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups, before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent, after_confirmed_groups, after_highest_display_level, last_rating_at, inputs, explanation) ' +
        'select c.rating_event_id, ' +
        revision +
        ', c.rating_engine, c.rating_engine_version, c.rating_config_version, c.before_mu, c.before_sigma, c.before_display_level, 94, 14, c.before_highest_display_level, c.after_mu, c.after_sigma, 3.50, 100, 15, greatest(c.after_highest_display_level, 3.50), c.last_rating_at, c.inputs, c.explanation ' +
        'from public.player_rating_events e cross join lateral (select k.* from public.player_rating_event_calculations k where k.rating_event_id = e.id order by k.projection_revision desc limit 1) c ' +
        'where e.user_id = ' +
        T(id(0)) +
        ' order by e.played_at desc, e.game_group_id desc limit 1;' +
        'update public.player_rating_projection_control set committed_revision = ' +
        revision +
        ';'
    );
    expect(await dirtyCount()).toBe(0);
    await fixtureSql('select public.statistics_rank_refresh();');
    const state = await latest();
    expect(state.get(0)).toMatchObject({
      status: 'ranked',
      rank: 1,
      established: true,
      source: 'ledger',
      revision
    });
    expect(ranksOf(state)).toEqual(await oracle([0, 1, 2, 3, 4, 5, 6, 7]));
    // Established p0 (3.50) ranks ahead of every unestablished member, including the 4.x levels.
    expect(state.get(1)!.rank).toBeGreaterThan(1);
    const [control] = await sqlRows(
      'select rating_revision::int as r from public.statistics_rank_control'
    );
    expect(Number(control?.['r'])).toBe(revision);
    // Align the statistics projection with the seam revision for any later reader.
    await fixtureSql('select public.statistics_publish();');
  });

  it('reports the best League position over every published version with the earliest achieving version', async () => {
    const leagueId = await kit.league({ status: 'active', endMode: 'manual', endAt: null });
    await confirmedGroup(await kit.event(leagueId), 250);
    const closed = await kit.rpc(kit.creator, 'close_league', {
      p_league_id: leagueId,
      p_expected_version: 1
    });
    expect(closed.error).toBeNull();
    // Version 2 (a published repair): the version 1 leader finishes fourth.
    await fixtureSql(
      'insert into public.league_standings_snapshots(league_id, community_id, standings_version, cause, basis, minimum_matches_for_final_award, period_start_at, effective_end_at, included_confirmation_ids, entries) ' +
        "select league_id, community_id, 2, 'repair', 'published', minimum_matches_for_final_award, period_start_at, effective_end_at, included_confirmation_ids, " +
        "(select pg_catalog.jsonb_agg(case when x.entry ->> 'user_id' = " +
        T(id(0)) +
        " then pg_catalog.jsonb_set(x.entry, '{position}', '4') else x.entry end) from pg_catalog.jsonb_array_elements(entries) x(entry) where x.entry ->> 'user_id' <> " +
        T(id(1)) +
        ') ' +
        'from public.league_standings_snapshots where league_id = ' +
        T(leagueId) +
        ' and standings_version = 1; ' +
        'select public.statistics_rank_refresh_league(' +
        T(leagueId) +
        '::uuid);'
    );
    expect(
      await sqlRows(
        'select standings_version, league_position from public.statistics_league_positions where player_id = ' +
          T(id(0)) +
          ' and league_id = ' +
          T(leagueId) +
          ' order by standings_version'
      )
    ).toEqual([
      { standings_version: 1, league_position: 1 },
      { standings_version: 2, league_position: 4 }
    ]);
    expect(await rank(0, { p_league_id: leagueId })).toMatchObject({
      bestLeaguePosition: {
        best: {
          state: 'ready',
          value: { position: 1, provenance: 'published', standingsVersion: 1, leagueId }
        }
      },
      activeLeaguePosition: { state: 'ready', value: { position: 4, standingsVersion: 2 } }
    });
    expect(await rank(1, { p_league_id: leagueId })).toMatchObject({
      bestLeaguePosition: { best: { state: 'ready', value: { position: 1, standingsVersion: 1 } } },
      activeLeaguePosition: { state: 'insufficient', value: null, reason: 'not_in_league' }
    });
  });

  it('denies the new reader to anon and service_role and keeps every internal away from them', async () => {
    const anon = createClient(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    expect(
      (await anon.rpc('get_player_statistics_rank_history', { p_player_id: id(0) })).error
    ).not.toBeNull();
    const [grants] = await sqlRows(
      "select has_function_privilege('anon', 'public.get_player_statistics_rank_history(uuid,uuid,integer)', 'execute') as anon, " +
        "has_function_privilege('service_role', 'public.get_player_statistics_rank_history(uuid,uuid,integer)', 'execute') as service, " +
        "has_function_privilege('authenticated', 'public.get_player_statistics_rank_history(uuid,uuid,integer)', 'execute') as authenticated"
    );
    expect(grants).toEqual({ anon: false, service: false, authenticated: true });
    const internals = await sqlRows(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname ~ '^statistics_rank_' " +
        "and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))"
    );
    expect(internals).toEqual([]);
    const tables = await sqlRows(
      "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('statistics_rank_transitions', 'statistics_league_positions', 'statistics_rank_control', 'statistics_rank_dirty') " +
        "and (not c.relrowsecurity or has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('service_role', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))"
    );
    expect(tables).toEqual([]);
  });
});
