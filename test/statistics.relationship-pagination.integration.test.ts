import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe.skipIf(!environment.env)('relationship meeting pagination', { timeout: 600_000 }, () => {
  it('walks every pair and opponent meeting exactly once', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    const [a, b, c] = kit.players;
    try {
      for (let index = 0; index < 21; index += 1) {
        const event = await kit.event(null, 'friendly');
        const submitted = await kit.submit(event, playedAt(1800 - index * 30).played);
        if (submitted.error) throw submitted.error;
        const proposal = String(asRecord(submitted.data)['proposal_id']);
        const approved = await kit.approve(proposal);
        if (approved.error) throw approved.error;
      }
      for (const [fn, other, key] of [
        ['get_pair_statistics', b!, 'p_partner_id'],
        ['get_opponent_statistics', c!, 'p_opponent_id']
      ] as const) {
        const args = { p_player_id: a!.id, [key]: other.id, p_community_id: kit.communityId };
        const ids: string[] = [];
        for (let offset = 0; ; offset += 20) {
          const response = await kit.rpc(a!, fn, { ...args, p_recent_offset: offset });
          expect(response.error).toBeNull();
          const page = asRecord(response.data);
          expect(page['recentOffset']).toBe(offset);
          const items = page['recent'];
          if (!Array.isArray(items)) throw new Error('Expected meeting array');
          const entries: unknown[] = items;
          ids.push(...entries.map((entry) => String(asRecord(entry)['groupId'])));
          if (entries.length < 20) break;
        }
        expect(ids).toHaveLength(21);
        expect(new Set(ids).size).toBe(21);
        const invalid = await kit.rpc(a!, fn, { ...args, p_recent_offset: -1 });
        expect(invalid.error?.message).toContain('STATISTICS_INVALID_INPUT');
      }
    } finally {
      const players = kit.players.map((player) => sqlText(player.id)).join(',');
      await fixtureSql(
        `delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)}; delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`
      );
      await kit.cleanup();
    }
  });
});
