import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';

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

  const sql = (statement: string) =>
    execFileSync('pnpm', ['exec', 'supabase', 'db', 'query', '--local', statement], {
      encoding: 'utf8'
    });
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const persistSql = (
    recipient: string,
    event: string,
    kind = 'community_invitation',
    target = crypto.randomUUID()
  ) =>
    `select public.persist_notification(${literal(recipient)}::uuid, ${literal(event)}, ${literal(kind)}, 'community', 'community_invitation', ${literal(target)}::uuid, null)`;
  const code = (error: unknown) =>
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;

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
      const inserted = sql(persistSql(first.id, event, 'community_invitation', target));
      const match = inserted.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i);
      expect(match).toBeTruthy();
      const id = match![0];
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
          await first.client
            .from('notifications')
            .insert({
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
        const created = sql(persistSql(first.id, `event:${key}`));
        const found = created.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)!;
        notificationIds.push(found[0]);
      }
      // Deterministic cutoff exercise: move one fixture before cutoff and one after it.
      sql(
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

      const helperId = sql(persistSql(first.id, event, 'community_invitation', target)).match(
        /[0-9a-f]{8}-[0-9a-f-]{27,}/i
      )![0];
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
      sql(`do $mismatch$ begin
        begin
          perform public.persist_notification(${literal(first.id)}::uuid, ${literal(event)}, 'different_kind', 'community', 'community_invitation', ${literal(target)}::uuid, null);
          raise exception 'expected notification conflict';
        exception when unique_violation then
          null;
        end;
      end $mismatch$;`);

      const concurrentEvent = `event:${crypto.randomUUID()}`;
      const concurrentTarget = crypto.randomUUID();
      const calls = await Promise.all([
        Promise.resolve().then(() =>
          sql(persistSql(first.id, concurrentEvent, 'community_invitation', concurrentTarget))
        ),
        Promise.resolve().then(() =>
          sql(persistSql(first.id, concurrentEvent, 'community_invitation', concurrentTarget))
        )
      ]);
      const ids = calls.map((output) => output.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)![0]);
      expect(ids[0]).toBe(ids[1]);
      notificationIds.push(ids[0]!);
      expect(
        (await first.client.from('notifications').select('id').eq('event_key', concurrentEvent))
          .data
      ).toHaveLength(1);
    } finally {
      sql(
        `do $cleanup$ begin delete from public.notifications where id = any(array[${notificationIds.map((id) => `${literal(id)}::uuid`).join(',')}]); delete from auth.users where id in (${literal(first.id)}::uuid, ${literal(second.id)}::uuid); end $cleanup$;`
      );
    }
  }, 30000);
});
