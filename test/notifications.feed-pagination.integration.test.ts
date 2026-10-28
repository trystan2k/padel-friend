import { readFile } from 'node:fs/promises';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  createFixtureCleanupRegistry,
  type FixtureCleanupRegistry
} from './helpers/fixture-cleanup';
import {
  executeTrustedSqlBatch,
  queryTrustedSql,
  registerSqlTransportCleanup
} from './helpers/sql-transport';

const serverClient = { current: null as SupabaseClient | null };
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => {
    if (!serverClient.current) throw new Error('Missing integration client');
    return { client: serverClient.current };
  }
}));
import { listMyNotifications } from '../src/features/notifications/notifications.functions';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const password = 'Password123!';
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
type FeedItem = { id: string; sequence: number; category: string; created_at: string };
type FeedDto = Pick<FeedItem, 'id' | 'category' | 'created_at'>;

describe.skipIf(!environment.env)('notification feed pagination (local Supabase)', () => {
  let cleanup: FixtureCleanupRegistry | undefined;

  function env(): Env {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }

  async function actor(registry: FixtureCleanupRegistry): Promise<Actor> {
    const { url, key } = env();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const email = `notification-feed-${registry.namespace}@example.test`;
    registry.register('auth.users', { email });
    const signup = await anonymous.auth.signUp({ email, password });
    expect(signup.error).toBeNull();
    const token = signup.data.session?.access_token;
    expect(token).toBeTruthy();
    const id = signup.data.user!.id;
    registry.register('public.notifications', { recipient_user_id: id });
    registry.register('auth.users', { id });
    return {
      id,
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
    };
  }

  afterEach(async () => {
    try {
      await cleanup?.cleanup();
    } finally {
      cleanup = undefined;
      serverClient.current = null;
    }
  });

  it('backfills historical sequence in legacy feed order despite physical insert order', async () => {
    const migration = await readFile(
      new URL(
        '../supabase/migrations/20261028140423_match_notification_fifo_order.sql',
        import.meta.url
      ),
      'utf8'
    );
    const backfill = migration.match(
      /-- backfill: legacy chronological order \(test anchor\)\s*([\s\S]*?;)/
    )?.[1];
    expect(backfill).toBeTruthy();
    const fixtureTable = `notification_sequence_backfill_${crypto.randomUUID().replaceAll('-', '')}`;
    const rewrittenBackfill = backfill!.replaceAll(
      'public.notifications',
      `public.${fixtureTable}`
    );
    expect(rewrittenBackfill).not.toBe(backfill);
    registerSqlTransportCleanup(() =>
      queryTrustedSql(`drop table if exists public.${fixtureTable}`).then(() => undefined)
    );

    // Run the migration's own UPDATE against a pre-migration-shaped table with
    // deliberately out-of-order physical rows, including an unrecoverable tie.
    const result = await queryTrustedSql(`
      create table public.${fixtureTable} (
        id uuid primary key,
        created_at timestamptz not null,
        sequence bigint
      );
      insert into public.${fixtureTable} (id, created_at) values
        ('00000000-0000-0000-0000-000000000003', '2026-10-26T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000002', '2026-10-24T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000001', '2026-10-24T08:00:00Z'),
        ('00000000-0000-0000-0000-000000000004', '2026-10-20T08:00:00Z');
      ${rewrittenBackfill}
      alter table public.${fixtureTable}
        alter column sequence set not null;
      do $migration$
      declare
        next_sequence bigint;
      begin
        select coalesce(max(sequence), 0) + 1
        into next_sequence
        from public.${fixtureTable};

        execute format(
          'alter table public.${fixtureTable} alter column sequence add generated always as identity (start with %s)',
          next_sequence
        );
      end
      $migration$;
      insert into public.${fixtureTable} (id, created_at)
      values ('00000000-0000-0000-0000-000000000005', '2026-10-19T08:00:00Z');
      select
        array_agg(id::text order by sequence desc)
          filter (where id <> '00000000-0000-0000-0000-000000000005') as sequence_feed,
        array_agg(id::text order by created_at desc, id desc)
          filter (where id <> '00000000-0000-0000-0000-000000000005') as historical_feed,
        max(sequence) filter (where id <> '00000000-0000-0000-0000-000000000005') as historical_max,
        max(sequence) filter (where id = '00000000-0000-0000-0000-000000000005') as next_sequence
      from public.${fixtureTable};
    `);

    expect(result.rows[0]?.sequence_feed).toEqual(result.rows[0]?.historical_feed);
    expect(result.rows[0]?.sequence_feed).toEqual([
      '00000000-0000-0000-0000-000000000003',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000004'
    ]);
    expect(result.rows[0]?.next_sequence).toBe(Number(result.rows[0]?.historical_max) + 1);
  });

  it('traverses sequence keyset pages without gaps and filters categories in feed order', async () => {
    cleanup = createFixtureCleanupRegistry('notification-feed-pagination');
    const recipient = await actor(cleanup);
    serverClient.current = recipient.client;

    const fixtures = [
      { id: crypto.randomUUID(), category: 'community', at: '2026-10-20T08:00:00Z' },
      { id: crypto.randomUUID(), category: 'results', at: '2026-10-21T08:00:00Z' },
      { id: crypto.randomUUID(), category: 'matches', at: '2026-10-23T08:00:00Z' },
      { id: crypto.randomUUID(), category: 'community', at: '2026-10-24T08:00:00Z' },
      { id: crypto.randomUUID(), category: 'community', at: '2026-10-22T08:00:00Z', tied: true },
      { id: crypto.randomUUID(), category: 'community', at: '2026-10-22T08:00:00Z', tied: true },
      { id: crypto.randomUUID(), category: 'leagues', at: '2026-10-25T08:00:00Z' },
      { id: crypto.randomUUID(), category: 'community', at: '2026-10-26T08:00:00Z' }
    ];

    // Batch INSERTs share one transaction; tied rows use the same transaction-stable now().
    await executeTrustedSqlBatch(
      fixtures.map((fixture) => ({
        sql: fixture.tied
          ? `insert into public.notifications
              (id, recipient_user_id, event_key, kind, category, target_type, target_id)
             values ('${fixture.id}', '${recipient.id}', 'feed:${fixture.id}', 'feed_test', '${fixture.category}', 'feed_test', '${crypto.randomUUID()}')`
          : `insert into public.notifications
              (id, recipient_user_id, event_key, kind, category, target_type, target_id, created_at)
             values ('${fixture.id}', '${recipient.id}', 'feed:${fixture.id}', 'feed_test', '${fixture.category}', 'feed_test', '${crypto.randomUUID()}', '${fixture.at}'::timestamptz)`
      }))
    );

    const expectedResult = await recipient.client
      .from('notifications')
      .select('id,sequence,category,created_at')
      .eq('recipient_user_id', recipient.id)
      .order('sequence', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    expect(expectedResult.error).toBeNull();
    const expected = (expectedResult.data ?? []) as FeedItem[];
    expect(expected).toHaveLength(fixtures.length);

    const collectPages = async (category: 'all' | 'community', limit: number) => {
      const pages: FeedDto[][] = [];
      let cursor: { sequence: number; createdAt: string; id: string } | undefined;
      do {
        const page = await listMyNotifications({ data: { category, cursor, limit } });
        pages.push(page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return pages;
    };

    const pages = await collectPages('all', 3);
    expect(pages.map((page) => page.length)).toEqual([3, 3, 2]);
    const traversed = pages.flat();
    expect(traversed.map(({ id }) => id)).toEqual(expected.map(({ id }) => id));
    expect(new Set(traversed.map(({ id }) => id)).size).toBe(fixtures.length);

    const sameTransaction: string[] = fixtures.slice(4, 6).map(({ id }) => id);
    expect(expected.find(({ id }) => id === sameTransaction[0])?.created_at).toBe(
      expected.find(({ id }) => id === sameTransaction[1])?.created_at
    );
    expect(pages[0]?.at(-1)?.id).toBe(sameTransaction[1]);
    expect(pages[1]?.[0]?.id).toBe(sameTransaction[0]);

    const communityPages = await collectPages('community', 2);
    const expectedCommunity = expected.filter(({ category }) => category === 'community');
    const traversedCommunity = communityPages.flat();
    expect(communityPages.map((page) => page.length)).toEqual([2, 2, 1]);
    expect(traversedCommunity.map(({ id }) => id)).toEqual(expectedCommunity.map(({ id }) => id));
    expect(traversedCommunity.every(({ category }) => category === 'community')).toBe(true);
  }, 30000);
});
