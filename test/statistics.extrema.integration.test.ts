import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeSummaryRow } from '../src/features/statistics/statistics-decoders';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv();
const NIL = '00000000-0000-0000-0000-000000000000';

const set = (position: number, a: number, b: number) => ({
  position,
  team_a_games: a,
  team_b_games: b,
  completed: true
});
// Game differential for team A: +12 and -3 (a win on sets with fewer games won than lost).
const wideWin = [set(1, 6, 0), set(2, 6, 0)];
const narrowWin = [set(1, 6, 4), set(2, 0, 6), set(3, 7, 6)];

/** The closest win compares the absolute game differential of wins, never the signed one. */
describe.skipIf(!environment.env)('Statistics extrema', { timeout: 300_000 }, () => {
  let kit: RankedResultKit;
  let wideProposal = '';
  let narrowProposal = '';

  async function confirm(sets: unknown, secondsAgo: number) {
    const eventId = await kit.event();
    const submitted = await kit.submit(eventId, playedAt(secondsAgo).played, { sets });
    expect(submitted.error).toBeNull();
    const proposalId = String(asRecord(submitted.data)['proposal_id']);
    expect((await kit.approve(proposalId)).error).toBeNull();
    return proposalId;
  }

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
    wideProposal = await confirm(wideWin, 200);
    narrowProposal = await confirm(narrowWin, 100);
  });
  afterAll(async () => {
    if (!kit) return;
    const players = kit.players.map((player) => sqlText(player.id)).join(',');
    await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`);
    await kit.cleanup();
  });

  it('picks the win with the smallest absolute game differential (-3 over +12)', async () => {
    const [row] = await sqlRows(
      `select to_jsonb(s) as r from public.statistics_scope_summaries s
        where subject_kind = 'player' and subject_a = ${sqlText(kit.players[0]!.id)} and subject_b = ${sqlText(NIL)}
          and scope_kind = 'all' and scope_id = ${sqlText(NIL)} and match_type = 'all'`
    );
    const summary = decodeSummaryRow(row?.['r']);
    expect(summary.wins).toBe(2);
    expect(summary.extrema.closest_win).toMatchObject({ k: 3, v: -3, g: narrowProposal });
    expect(summary.extrema.cleanest_win).toMatchObject({ v: 12, g: wideProposal });
  });
});
