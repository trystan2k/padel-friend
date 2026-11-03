import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import type { ManagementActor } from './helpers/match-management-fixtures';
import { buildCommunityWorld, type CommunityWorld } from './helpers/community-statistics-world';
import { setMembershipHistory } from './helpers/ranked-result-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const READER = 'get_community_statistics(uuid,uuid,text,date,date)';
const HELPERS = [
  'statistics_community_top(jsonb,integer,integer,text)',
  'statistics_community_relation_top(jsonb,text)',
  'statistics_community_league_groups(uuid[],uuid[],text,date,date)'
];
const TABLES = [
  'statistics_scope_summaries',
  'statistics_daily_buckets',
  'statistics_group_facts',
  'statistics_participant_facts',
  'statistics_pair_facts',
  'statistics_opponent_facts',
  'statistics_config',
  'statistics_projection_control'
] as const;

describe.skipIf(!environment.env)(
  'community statistics authorization',
  { timeout: 900_000 },
  () => {
    let world: CommunityWorld;
    let a: ManagementActor;
    let b: ManagementActor;
    beforeAll(async () => {
      world = await buildCommunityWorld(environment.env!);
      a = world.players[0]!;
      b = world.players[1]!;
    });
    afterAll(async () => {
      await world?.cleanup();
    });

    const read = (actor: ManagementActor, args: Record<string, unknown>) =>
      world.main.rpc(actor, 'get_community_statistics', args);
    const played = (data: unknown) => asRecord(asRecord(data)['matches'])['played'];

    it('projects all-community player history by actual participation, not community membership', async () => {
      const [row] =
        await sqlRows(`select confirmed_groups, relations ? 'players' as has_community_players
        from public.statistics_scope_summaries
        where subject_kind = 'player' and subject_a = ${sqlText(a.id)}
          and scope_kind = 'all' and match_type = 'all'`);
      expect(row?.['confirmed_groups']).toBe(7);
      expect(row?.['has_community_players']).toBe(false);
      const [community] = await sqlRows(`select count(*)::integer as n
        from public.statistics_scope_summaries
        where subject_kind = 'community' and scope_kind = 'all'`);
      expect(community?.['n']).toBe(0);
    });

    it('limits subject-wide player statistics to the subject while retaining shared community navigation', async () => {
      const own = await world.main.rpc(a, 'get_player_statistics', { p_player_id: a.id });
      expect(own.error).toBeNull();
      expect(asRecord(asRecord(own.data)['matches'])['played']).toBe(7);
      const other = await world.main.rpc(b, 'get_player_statistics', { p_player_id: a.id });
      expect(other.error).not.toBeNull();
      const scoped = await world.main.rpc(b, 'get_player_statistics', {
        p_player_id: a.id,
        p_community_id: world.main.communityId
      });
      expect(scoped.error).toBeNull();
    });

    it('rejects all-community scope for community insights', async () => {
      for (const actor of [world.outsider, a, b]) {
        const result = await read(actor, {});
        expect(result.error?.message).toContain('STATISTICS_INVALID_INPUT');
        expect(result.data).toBeNull();
      }
    });

    it('denies a never-member the community scope exactly like an unknown community', async () => {
      const outsider = await read(world.outsider, { p_community_id: world.main.communityId });
      const unknown = await read(world.outsider, { p_community_id: crypto.randomUUID() });
      expect(outsider.error?.message).toContain('STATISTICS_NOT_FOUND');
      expect(unknown.error?.message).toBe(outsider.error?.message);
      expect(outsider.data).toBeNull();
    });

    it('rejects a League of another community and a League without a community', async () => {
      const foreign = await read(a, {
        p_community_id: world.other.communityId,
        p_league_id: world.leagues.active
      });
      expect(foreign.error?.message).toContain('STATISTICS_INVALID_INPUT');
      const bare = await read(a, { p_league_id: world.leagues.active });
      expect(bare.error?.message).toContain('STATISTICS_INVALID_INPUT');
    });

    it('stops serving a member whose membership ended, in every scope', async () => {
      const former = world.players[7]!;
      const before = await read(former, { p_community_id: world.main.communityId });
      expect(before.error).toBeNull();
      const since = new Date(Date.now() - 86_400_000 * 2).toISOString();
      await setMembershipHistory(world.main.communityId, former.id, [
        { activatedAt: since, validUntil: new Date(Date.now() - 3_600_000).toISOString() }
      ]);
      const community = await read(former, { p_community_id: world.main.communityId });
      expect(community.error?.message).toContain('STATISTICS_NOT_FOUND');
      const everything = await read(former, {});
      expect(everything.error?.message).toContain('STATISTICS_INVALID_INPUT');
      // The facts they played stay in the community for everyone who still belongs.
      expect(played((await read(a, { p_community_id: world.main.communityId })).data)).toBe(9);
    });

    it('exposes no email, invitation secret or note in the DTO', async () => {
      const { data } = await read(a, { p_community_id: world.main.communityId });
      const text = JSON.stringify(data);
      expect(text).not.toMatch(/@|email|secret|token|"notes?"|rejection/i);
    });

    it('denies unauthenticated, anonymous-key and non-granted access', async () => {
      const anon = createClient(environment.env!.url, environment.env!.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const denied = await anon.rpc('get_community_statistics', {});
      expect(denied.error).not.toBeNull();
      expect(denied.data).toBeNull();
      // Authenticated clients cannot run internal helpers or rebuild, nor read the projection tables.
      const helperResults = await Promise.all([
        a.client.rpc('statistics_community_top', {
          p_rows: [],
          p_observed: 0,
          p_required: 1,
          p_reason: 'x'
        }),
        a.client.rpc('statistics_community_relation_top', { p_relations: {}, p_key: 'pairs' }),
        a.client.rpc('rebuild_statistics', {})
      ]);
      for (const result of helperResults) expect(result.error).not.toBeNull();
      for (const table of TABLES) {
        const result = await a.client.from(table).select('*').limit(1);
        expect(result.error).not.toBeNull();
      }
    });

    it('keeps grants whitelisted and the reader free of official-source and rebuild calls', async () => {
      const [grants] = await sqlRows(
        `select has_function_privilege('anon', 'public.${READER}', 'execute') as anon,
        has_function_privilege('service_role', 'public.${READER}', 'execute') as service,
        has_function_privilege('authenticated', 'public.${READER}', 'execute') as authenticated`
      );
      expect(grants).toMatchObject({ anon: false, service: false, authenticated: true });
      for (const helper of HELPERS) {
        const [row] = await sqlRows(
          `select has_function_privilege('authenticated', 'public.${helper}', 'execute') as authenticated,
          has_function_privilege('anon', 'public.${helper}', 'execute') as anon,
          has_function_privilege('service_role', 'public.${helper}', 'execute') as service`
        );
        expect(row).toMatchObject({ authenticated: false, anon: false, service: false });
      }
      for (const table of TABLES) {
        const [row] = await sqlRows(
          `select has_table_privilege('authenticated', 'public.${table}', 'select') as authenticated,
          has_table_privilege('anon', 'public.${table}', 'select') as anon,
          has_table_privilege('service_role', 'public.${table}', 'select') as service`
        );
        expect(row).toMatchObject({ authenticated: false, anon: false, service: false });
      }
      const [definition] = await sqlRows(
        `select pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'get_community_statistics'`
      );
      const text = String(definition?.['definition']);
      expect(text).not.toMatch(/statistics_official_|rebuild_statistics/);
      expect(text).toContain('assert_actor_not_provisional');
      // The scope is authorized (membership checked, NOT_FOUND raised) before any summary is read.
      expect(text.indexOf('STATISTICS_NOT_FOUND')).toBeGreaterThan(0);
      expect(text.indexOf('STATISTICS_NOT_FOUND')).toBeLessThan(
        text.indexOf('statistics_scope_summaries')
      );
      expect(text).toMatch(/SET search_path TO ''/);
    });

    it('keeps summaries of a private community out of the visible one by construction', async () => {
      const [row] = await sqlRows(
        `select count(*)::int as n from public.statistics_scope_summaries
        where subject_kind = 'community' and scope_kind = 'community' and match_type = 'all'
          and scope_id = ${sqlText(world.main.communityId)} and subject_a <> scope_id`
      );
      expect(row?.['n']).toBe(0);
    });
  }
);
