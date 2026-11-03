import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { readPlayerStatistics } from '../src/features/statistics/statistics-player.server';
import { validateStatisticsPlayerInput } from '../src/features/statistics/statistics.validators';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
describe.skipIf(!environment.env)('player statistics SQL reader', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;
  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
  });
  afterAll(async () => {
    if (!kit) return;
    const players = kit.players.map((player) => sqlText(player.id)).join(',');
    await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`);
    await kit.cleanup();
  });
  it('reads projections without replaying authoritative sources or rebuilding', async () => {
    const rows = await sqlRows(
      "select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_player_statistics'"
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['definition'])).not.toMatch(/statistics_official_|rebuild_statistics/);
    const [grants] = await sqlRows(
      "select has_function_privilege('anon', 'public.get_player_statistics(uuid,uuid,uuid,text,date,date)', 'execute') as anon, has_function_privilege('service_role', 'public.get_player_statistics(uuid,uuid,uuid,text,date,date)', 'execute') as service, has_function_privilege('authenticated', 'public.get_player_statistics(uuid,uuid,uuid,text,date,date)', 'execute') as authenticated"
    );
    expect(grants).toMatchObject({ anon: false, service: false, authenticated: true });
  });
  it('returns true empty totals and an insufficient rate for an authenticated member', async () => {
    const result = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      p_player_id: kit.players[0]!.id,
      p_community_id: kit.communityId
    });
    expect(result.error).toBeNull();
    const page = asRecord(result.data);
    expect(page['config']).toBeTruthy();
    const decoded = await readPlayerStatistics(
      kit.players[0]!.client,
      validateStatisticsPlayerInput({ playerId: kit.players[0]!.id, communityId: kit.communityId })
    );
    expect(decoded).toMatchObject({
      status: 'ok',
      value: {
        rating: {
          currentLevel: { state: 'ready', value: 4 },
          lowestEstablishedLevel: { state: 'insufficient', reason: 'not_established' }
        }
      }
    });
    expect(page['rating']).toMatchObject({
      currentLevel: { state: 'ready', value: 4 },
      reliability: { state: 'ready', value: 10 },
      startingLevel: { state: 'ready', value: 4 },
      highestLevel: { state: 'insufficient', reason: 'not_established' },
      lowestEstablishedLevel: { state: 'insufficient', reason: 'not_established' }
    });
    expect(page['form']).toMatchObject({
      last5: { state: 'insufficient', reason: 'no_resolved_matches' },
      current: { kind: null, length: 0 },
      longestWins: 0
    });
    expect(page['advanced']).toMatchObject({
      cleanestWin: { state: 'insufficient', reason: 'no_applicable_result' }
    });
    expect(page['rating']).toMatchObject({
      communitySkillRank: { state: 'ready', value: { provenance: 'reconstructed' } },
      activeLeaguePosition: { state: 'insufficient', reason: 'not_in_league' },
      bestCommunitySkillRank: {
        best: { state: 'ready', value: { provenance: 'reconstructed' } },
        coverageComplete: false,
        coverageReason: 'missing_rating_evidence'
      },
      bestLeaguePosition: {
        best: { state: 'insufficient', reason: 'not_in_league' },
        coverageComplete: true
      }
    });
    expect(page['matches']).toMatchObject({
      played: 0,
      wins: 0,
      winRate: { state: 'insufficient', value: null, reason: 'no_denominator' }
    });
  });
  it('returns the same projected core counts for lifetime and matching day', async () => {
    const event = await kit.event();
    const played = playedAt(500);
    const submitted = await kit.submit(event, played.played);
    expect(submitted.error).toBeNull();
    const group = String(asRecord(submitted.data)['proposal_id']);
    expect((await kit.approve(group)).error).toBeNull();
    const args = { p_player_id: kit.players[0]!.id, p_community_id: kit.communityId };
    const lifetime = await kit.rpc(kit.players[0]!, 'get_player_statistics', args);
    const daily = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      ...args,
      p_from: played.iso.slice(0, 10),
      p_through: played.iso.slice(0, 10)
    });
    expect(lifetime.error).toBeNull();
    expect(daily.error).toBeNull();
    const a = asRecord(lifetime.data);
    const b = asRecord(daily.data);
    const decoded = await readPlayerStatistics(
      kit.players[0]!.client,
      validateStatisticsPlayerInput({ playerId: kit.players[0]!.id, communityId: kit.communityId })
    );
    const [authority] = await sqlRows(
      `select public.rating_summary_at(${sqlText(kit.players[0]!.id)}::uuid, (select committed_revision from public.player_rating_projection_control)) as rating`
    );
    const expected = asRecord(authority?.['rating']);
    expect(decoded).toMatchObject({
      status: 'ok',
      value: {
        rating: {
          currentLevel: { state: 'ready', value: Number(expected['display_level']) },
          reliability: { state: 'ready', value: Number(expected['reliability_percent']) },
          startingLevel: { state: 'ready', value: Number(expected['initial_display_level']) },
          bestLeaguePosition: { best: { state: 'insufficient', reason: 'not_in_league' } }
        }
      }
    });
    expect(a['matches']).toMatchObject({
      played: 1,
      wins: 1,
      winRate: { state: 'ready', value: 1 }
    });
    expect(b['matches']).toEqual(a['matches']);
    expect(a['relationships']).toMatchObject({
      uniquePartners: 1,
      uniqueOpponents: 2,
      uniqueQuartets: 1,
      mostFrequentPartners: [{ groups: 1 }],
      mostFrequentPartnerShare: { state: 'ready', value: 1 }
    });
    expect(b['relationships']).toEqual(a['relationships']);
    expect(decoded).toMatchObject({
      status: 'ok',
      value: { relationships: { uniquePartners: 1, uniqueOpponents: 2 } }
    });
    expect(b['sets']).toEqual(a['sets']);
    expect(b['games']).toEqual(a['games']);
    expect(b['form']).toEqual(a['form']);
    const day = played.iso.slice(0, 10);
    const shift = (n: number) =>
      new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
    const window = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      ...args,
      p_from: shift(-7),
      p_through: shift(7)
    });
    expect(window.error).toBeNull();
    const activity = asRecord(asRecord(window.data)['activity']);
    expect(activity).toMatchObject({
      fromDay: shift(-7),
      throughDay: shift(7),
      weeklyAverage: { state: 'ready', value: 7 / 15 }
    });
    const days = activity['days'];
    if (!Array.isArray(days)) throw new Error('Expected activity days');
    expect(days).toHaveLength(15);
    expect(days.filter((item: unknown) => asRecord(item)['groups'] === 0)).toHaveLength(14);
    expect(a['form']).toMatchObject({
      last5: { state: 'ready', value: { sampleSize: 1, capacity: 5, wins: 1 } },
      current: { kind: 'W', length: 1 },
      longestWins: 1
    });
    expect(a['advanced']).toMatchObject({
      cleanestWin: { state: 'ready', value: { v: 5 } },
      closestWin: { state: 'ready', value: { v: 5 } }
    });
    const outsider = await kit.actor();
    expect((await kit.rpc(outsider, 'get_player_statistics', args)).error?.message).toContain(
      'STATISTICS_NOT_FOUND'
    );
  });
  it('uses configured minimum opportunities for conversion rates at 0, 1, 2 and 3', async () => {
    const args = { p_player_id: kit.players[0]!.id, p_community_id: kit.communityId };
    const empty = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      ...args,
      p_from: '2000-01-01',
      p_through: '2000-01-01'
    });
    expect(asRecord(empty.data)['advanced']).toMatchObject({
      firstSetConversionRate: { state: 'insufficient', observed: 0, required: 3 }
    });
    for (let count = 1; count <= 3; count += 1) {
      if (count > 1) {
        const event = await kit.event();
        const submitted = await kit.submit(event, playedAt(500 - count).played);
        if (submitted.error) throw submitted.error;
        const approval = await kit.approve(String(asRecord(submitted.data)['proposal_id']));
        if (approval.error) throw approval.error;
      }
      const result = await kit.rpc(kit.players[0]!, 'get_player_statistics', args);
      expect(result.error).toBeNull();
      expect(asRecord(result.data)['advanced']).toMatchObject({
        firstSetConversionRate:
          count < 3
            ? {
                state: 'insufficient',
                observed: count,
                required: 3,
                reason: 'minimum_opportunities'
              }
            : { state: 'ready', value: 1, numerator: 3, denominator: 3 }
      });
      expect(asRecord(result.data)['typeRates']).toMatchObject({
        competitive: { winRate: { state: 'ready', value: 1 } },
        friendly: { winRate: { state: 'insufficient', reason: 'no_denominator' } }
      });
      const [ledger] =
        await sqlRows(`select coalesce(sum(rating_delta), 0) as delta, count(rating_delta)::int as n
        from public.statistics_participant_facts where user_id = ${sqlText(kit.players[0]!.id)}
          and community_id = ${sqlText(kit.communityId)}`);
      const movement = asRecord(asRecord(result.data)['filteredDelta']);
      expect(movement['state']).toBe('ready');
      expect(Number(movement['value'])).toBeCloseTo(Number(ledger?.['delta']), 8);
      expect(movement['denominator']).toBe(Number(ledger?.['n']));
    }
  });
  async function fixturePlayedWindow() {
    const [bounds] =
      await sqlRows(`select to_char(min(played_at) at time zone 'UTC', 'YYYY-MM-DD') as first,
      to_char(max(played_at) at time zone 'UTC', 'YYYY-MM-DD') as last
      from public.statistics_participant_facts where user_id = ${sqlText(kit.players[0]!.id)}
        and community_id = ${sqlText(kit.communityId)}`);
    if (typeof bounds?.['first'] !== 'string' || typeof bounds['last'] !== 'string')
      throw new Error('Missing fixture played window');
    return { from: bounds['first'], through: bounds['last'] };
  }
  it('breaks the streak at a draw and omits an incomplete result from form', async () => {
    const entries = [
      {
        age: 100,
        sets: [
          { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
          { position: 2, team_a_games: 3, team_b_games: 6, completed: true },
          { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
        ]
      },
      { age: 90, sets: [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }] }
    ];
    for (const entry of entries) {
      const event = await kit.event();
      const submitted = await kit.submit(event, playedAt(entry.age).played, { sets: entry.sets });
      if (submitted.error) throw submitted.error;
      const approved = await kit.approve(String(asRecord(submitted.data)['proposal_id']));
      if (approved.error) throw approved.error;
    }
    const args = { p_player_id: kit.players[0]!.id, p_community_id: kit.communityId };
    const all = await kit.rpc(kit.players[0]!, 'get_player_statistics', args);
    expect(all.error).toBeNull();
    expect(asRecord(all.data)['matches']).toMatchObject({ played: 5, draws: 1, incomplete: 1 });
    expect(asRecord(all.data)['form']).toMatchObject({
      current: { kind: null, length: 0 },
      longestWins: 3,
      last5: { state: 'ready', value: { sampleSize: 4, wins: 3, draws: 1 } }
    });
    const window = await fixturePlayedWindow();
    const ranged = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      ...args,
      p_from: window.from,
      p_through: window.through
    });
    expect(ranged.error).toBeNull();
    expect(asRecord(ranged.data)['form']).toEqual(asRecord(all.data)['form']);
  });
  it('orders tied played instants by group UUID consistently across scopes', async () => {
    const instant = playedAt(20);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const event = await kit.event();
      const submitted = await kit.submit(event, instant.played);
      if (submitted.error) throw submitted.error;
      const id = String(asRecord(submitted.data)['proposal_id']);
      const approved = await kit.approve(id);
      if (approved.error) throw approved.error;
      ids.push(id);
    }
    const args = { p_player_id: kit.players[0]!.id, p_community_id: kit.communityId };
    const all = await kit.rpc(kit.players[0]!, 'get_player_statistics', args);
    const window = await fixturePlayedWindow();
    const scoped = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
      ...args,
      p_from: window.from,
      p_through: window.through
    });
    expect(all.error).toBeNull();
    expect(scoped.error).toBeNull();
    const allForm = asRecord(asRecord(all.data)['form']);
    expect(asRecord(scoped.data)['form']).toEqual(allForm);
    const sample = asRecord(asRecord(allForm['last10'])['value']);
    const outcomes = sample['outcomes'];
    if (!Array.isArray(outcomes)) throw new Error('Expected form outcomes');
    expect(
      outcomes
        .map((item: unknown) => String(asRecord(item)['g']))
        .filter((id: string) => ids.includes(id))
    ).toEqual([...ids].sort());
  });
});
