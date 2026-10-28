import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { waitForRows } from './helpers/match-registration-sql';
import {
  executeTrustedSql,
  openDedicatedSqlConnection,
  queryTrustedSql
} from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
const password = 'Password123!';

describe.skipIf(!environment.env)('notification store (real local Supabase JWTs)', () => {
  function env(): Env {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }

  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const signup = await anonymous.auth.signUp({
      email: `${slug}-${crypto.randomUUID()}@example.test`,
      password
    });
    expect(signup.error).toBeNull();
    const token = signup.data.session?.access_token;
    expect(token).toBeTruthy();
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    expect(
      (
        await client.rpc('onboard_player', {
          p_display_name: label,
          p_preferred_side: 'EITHER',
          p_initial_level: 3.2
        })
      ).error
    ).toBeNull();
    return { client, id: signup.data.user!.id };
  }

  const sql = (statement: string) => executeTrustedSql(statement);
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const persistSql = (
    recipient: string,
    event: string,
    kind = 'community_invitation',
    target = crypto.randomUUID()
  ) =>
    `select public.persist_notification(${literal(recipient)}::uuid, ${literal(event)}, ${literal(kind)}, 'community', 'community_invitation', ${literal(target)}::uuid, null)`;
  const persistedNotificationId = async (statement: string): Promise<string> => {
    const result = await queryTrustedSql(statement);
    const id = Object.values(result.rows[0] ?? {})[0];
    if (typeof id !== 'string') throw new Error('persist_notification returned no notification id');
    return id;
  };
  const code = (error: unknown) =>
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;

  it('keeps category feeds recipient-scoped and paginates timestamp ties across read states', async () => {
    const recipient = await actor('Category Recipient');
    let outsider: Actor | undefined;
    const asOf = '2026-10-21T12:00:00.000Z';
    const tiedAt = '2026-10-21T10:00:00.000Z';
    const tieIds = [crypto.randomUUID(), crypto.randomUUID()].sort().reverse();
    const newest = crypto.randomUUID();
    const oldest = crypto.randomUUID();
    const otherCategory = crypto.randomUUID();
    const future = crypto.randomUUID();
    const outsiderId = crypto.randomUUID();
    const ids = [newest, ...tieIds, oldest, otherCategory, future, outsiderId];
    try {
      outsider = await actor('Category Outsider');
      const fixtures = [
        {
          id: newest,
          owner: recipient.id,
          category: 'community',
          at: '2026-10-21T11:00:00Z',
          read: false
        },
        { id: tieIds[0]!, owner: recipient.id, category: 'community', at: tiedAt, read: true },
        { id: tieIds[1]!, owner: recipient.id, category: 'community', at: tiedAt, read: false },
        {
          id: oldest,
          owner: recipient.id,
          category: 'community',
          at: '2026-10-21T09:00:00Z',
          read: false
        },
        {
          id: otherCategory,
          owner: recipient.id,
          category: 'matches',
          at: '2026-10-21T10:30:00Z',
          read: false
        },
        {
          id: future,
          owner: recipient.id,
          category: 'community',
          at: '2026-10-22T00:00:00Z',
          read: false
        },
        {
          id: outsiderId,
          owner: outsider.id,
          category: 'community',
          at: '2026-10-21T11:30:00Z',
          read: false
        }
      ];
      await sql(`insert into public.notifications
        (id, recipient_user_id, event_key, kind, category, target_type, target_id, created_at, read_at)
        values ${fixtures
          .map(
            (row) => `(${literal(row.id)}::uuid, ${literal(row.owner)}::uuid,
          ${literal(`category-feed:${row.id}`)}, 'community_invitation', ${literal(row.category)},
          'community_invitation', ${literal(crypto.randomUUID())}::uuid, ${literal(row.at)}::timestamptz,
          ${row.read ? `${literal(asOf)}::timestamptz` : 'null'})`
          )
          .join(',')};`);

      const feed = (category = 'community') => {
        let query = recipient.client
          .from('notifications')
          .select('id,kind,category,target_type,target_id,community_id,created_at,read_at')
          .lte('created_at', asOf);
        if (category !== 'all') query = query.eq('category', category);
        return query.order('created_at', { ascending: false }).order('id', { ascending: false });
      };
      const first = await feed().limit(3);
      expect(first.error).toBeNull();
      expect(first.data?.map((row) => row.id)).toEqual([newest, ...tieIds]);
      expect(first.data?.map((row) => row.category)).toEqual([
        'community',
        'community',
        'community'
      ]);
      expect(first.data?.map((row) => row.read_at !== null)).toEqual([false, true, false]);
      // Page size two plus lookahead; resume at the read row inside the timestamp tie.
      const boundary = first.data![1]!;
      const next = await feed()
        .or(
          `created_at.lt.${boundary.created_at},and(created_at.eq.${boundary.created_at},id.lt.${boundary.id})`
        )
        .limit(3);
      expect(next.error).toBeNull();
      expect(next.data?.map((row) => row.id)).toEqual([tieIds[1], oldest]);
      expect([...first.data!.slice(0, 2), ...next.data!].map((row) => row.id)).toEqual([
        newest,
        ...tieIds,
        oldest
      ]);
      const empty = await feed('rankings').limit(3);
      expect(empty.error).toBeNull();
      expect(empty.data).toEqual([]);
      const all = await feed('all').limit(21);
      expect(all.error).toBeNull();
      expect(all.data?.map((row) => row.id)).toEqual([newest, otherCategory, ...tieIds, oldest]);
      const unread = await recipient.client.rpc('count_my_unread_notifications');
      expect(unread.error).toBeNull();
      // Includes matches and post-cutoff rows; excludes the read row and outsider.
      expect(unread.data).toBe(5);
    } finally {
      await sql(`do $cleanup$ begin
        delete from public.notifications where id = any(array[${ids.map((id) => `${literal(id)}::uuid`).join(',')}]);
        delete from auth.users where id in (${[recipient.id, ...(outsider ? [outsider.id] : [])].map((id) => `${literal(id)}::uuid`).join(',')});
      end $cleanup$;`);
    }
  }, 30000);

  it('retains valid complete category ordering and the existing unread index', async () => {
    const { rows } = await queryTrustedSql(
      `select i.indisvalid as valid, i.indpred is null as nonpartial,
      am.amname as method, i.indnkeyatts as key_count, i.indnatts as attribute_count,
      array(select pg_get_indexdef(i.indexrelid, position, true)
        from generate_series(1, i.indnkeyatts) position order by position) as keys,
      i.indoption::text as options,
      exists(select 1 from pg_index old where old.indexrelid =
        to_regclass('public.notifications_recipient_unread_idx')
        and old.indrelid = 'public.notifications'::regclass and old.indisvalid) as unread_present
      from pg_index i join pg_class c on c.oid = i.indexrelid
      join pg_am am on am.oid = c.relam
      where i.indexrelid = to_regclass('public.notifications_recipient_category_created_idx')
        and i.indrelid = 'public.notifications'::regclass;`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      valid: true,
      nonpartial: true,
      method: 'btree',
      key_count: 4,
      attribute_count: 4,
      keys: ['recipient_user_id', 'category', 'created_at', 'id'],
      options: '0 0 3 3',
      unread_present: true
    });
  });

  it('enforces recipient access and read RPC semantics; helper is private and idempotent', async () => {
    const first = await actor('Notification Recipient');
    const second = await actor('Notification Outsider');
    const anonymous = createClient(env().url, env().key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    let notificationIds: string[] = [];
    try {
      const target = crypto.randomUUID();
      const event = `event:${crypto.randomUUID()}`;
      const id = await persistedNotificationId(
        persistSql(first.id, event, 'community_invitation', target)
      );
      notificationIds.push(id);
      expect((await first.client.from('notifications').select('*').eq('id', id)).data).toHaveLength(
        1
      );
      expect((await second.client.from('notifications').select('*').eq('id', id)).data).toEqual([]);
      expect(
        code((await second.client.rpc('mark_notification_read', { p_notification_id: id })).error)
      ).toBe('42501');
      expect(
        code(
          (
            await second.client.rpc('mark_notification_read', {
              p_notification_id: crypto.randomUUID()
            })
          ).error
        )
      ).toBe('42501');
      expect(
        (
          await first.client.from('notifications').insert({
            recipient_user_id: first.id,
            event_key: crypto.randomUUID(),
            kind: 'x',
            category: 'community',
            target_type: 'x',
            target_id: target
          })
        ).error
      ).not.toBeNull();
      expect(
        (
          await first.client
            .from('notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('id', id)
        ).error
      ).not.toBeNull();
      expect((await first.client.from('notifications').delete().eq('id', id)).error).not.toBeNull();
      expect(
        (
          await first.client.rpc('persist_notification', {
            p_recipient_user_id: first.id,
            p_event_key: event,
            p_kind: 'community_invitation',
            p_category: 'community',
            p_target_type: 'community_invitation',
            p_target_id: target,
            p_community_id: null
          })
        ).error
      ).not.toBeNull();
      const anonymousRows = await anonymous.from('notifications').select('*');
      expect(anonymousRows.error || anonymousRows.data?.length === 0).toBeTruthy();
      expect((await anonymous.rpc('count_my_unread_notifications')).error).not.toBeNull();

      const read = await first.client.rpc('mark_notification_read', { p_notification_id: id });
      expect(read.error).toBeNull();
      expect(
        (await first.client.rpc('mark_notification_read', { p_notification_id: id })).data
      ).toEqual(read.data);
      const persistedRead = (
        await first.client.from('notifications').select('read_at').eq('id', id).single()
      ).data!.read_at;
      expect(persistedRead).toBe(read.data);

      const before = new Date(Date.now() - 1000).toISOString();
      const oldOne = crypto.randomUUID();
      const oldTwo = crypto.randomUUID();
      const later = crypto.randomUUID();
      for (const key of [oldOne, oldTwo, later]) {
        notificationIds.push(await persistedNotificationId(persistSql(first.id, `event:${key}`)));
      }
      // Deterministic cutoff exercise: move one fixture before cutoff and one after it.
      await sql(
        `do $cutoff$ begin update public.notifications set created_at = ${literal(new Date(Date.now() - 5000).toISOString())}::timestamptz where event_key in ('event:${oldOne}', 'event:${oldTwo}'); update public.notifications set created_at = ${literal(new Date(Date.now() + 5000).toISOString())}::timestamptz where event_key = 'event:${later}'; end $cutoff$;`
      );
      const count = await first.client.rpc('count_my_unread_notifications');
      expect(count.data).toBe(3);
      expect((await first.client.from('notifications').select('id').range(0, 0)).data).toHaveLength(
        1
      );
      expect(
        (await first.client.rpc('mark_all_notifications_read', { p_before: before })).data
      ).toBe(2);
      expect((await first.client.rpc('count_my_unread_notifications')).data).toBe(1);

      const helperId = await persistedNotificationId(
        persistSql(first.id, event, 'community_invitation', target)
      );
      expect(helperId).toBe(id);
      const snapshot = (
        await first.client.from('notifications').select('created_at,read_at').eq('id', id).single()
      ).data!;
      expect(snapshot.read_at).toBe(persistedRead);
      expect(
        (
          await first.client
            .from('notifications')
            .select('created_at,read_at')
            .eq('id', id)
            .single()
        ).data
      ).toEqual(snapshot);
      await sql(`do $mismatch$ begin
        begin
          perform public.persist_notification(${literal(first.id)}::uuid, ${literal(event)}, 'different_kind', 'community', 'community_invitation', ${literal(target)}::uuid, null);
          raise exception 'expected notification conflict';
        exception when unique_violation then
          null;
        end;
      end $mismatch$;`);

      // F16: retain two dedicated PostgreSQL backends and observe both inside
      // pg_stat_activity while each is sleeping immediately before the competing
      // insert. This proves database overlap, not just overlapping CLI processes.
      const concurrentEvent = `event:${crypto.randomUUID()}`;
      const concurrentTarget = crypto.randomUUID();
      const marker = `notification-race-${crypto.randomUUID().replaceAll('-', '')}`;
      const statement = `with gate as materialized (select pg_catalog.pg_sleep(1))
        select pg_catalog.pg_backend_pid()::int as backend_pid,
          public.persist_notification(${literal(first.id)}::uuid, ${literal(concurrentEvent)},
            'community_invitation', 'community', 'community_invitation',
            ${literal(concurrentTarget)}::uuid, null) as notification_id
        from gate /* ${marker} */`;
      const [firstConnection, secondConnection] = await Promise.all([
        openDedicatedSqlConnection(),
        openDedicatedSqlConnection()
      ]);
      const backendPids = [firstConnection.backendPid, secondConnection.backendPid];
      expect(backendPids[0]).not.toBe(backendPids[1]);
      try {
        const firstCall = firstConnection.query(statement);
        const secondCall = secondConnection.query(statement);
        const observed = await waitForRows(
          `select pid::int as pid from pg_catalog.pg_stat_activity
            where query like '%${marker}%' and wait_event = 'PgSleep'
              and pid in (${backendPids.join(',')})`,
          (rows) => rows.length === 2,
          'both notification race backends to overlap in PostgreSQL',
          5000,
          25
        );
        expect(
          observed.map((row) => Number(row['pid'])).sort((left, right) => left - right)
        ).toEqual(backendPids.sort((left, right) => left - right));
        const [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
        const ids = [firstResult, secondResult].map((result) => {
          const notificationId = result.rows[0]?.['notification_id'];
          if (typeof notificationId !== 'string')
            throw new Error('persist_notification returned no id');
          return notificationId;
        });
        expect(ids[0]).toBe(ids[1]);
        notificationIds.push(ids[0]!);
      } finally {
        await Promise.all([firstConnection.close(), secondConnection.close()]);
      }
      expect(
        (await first.client.from('notifications').select('id').eq('event_key', concurrentEvent))
          .data
      ).toHaveLength(1);
    } finally {
      await sql(
        `do $cleanup$ begin delete from public.notifications where id = any(array[${notificationIds.map((id) => `${literal(id)}::uuid`).join(',')}]); delete from auth.users where id in (${literal(first.id)}::uuid, ${literal(second.id)}::uuid); end $cleanup$;`
      );
    }
  }, 30000);
});
