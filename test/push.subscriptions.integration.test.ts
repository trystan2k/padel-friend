import { randomBytes, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { ratingEvidenceCleanupSql } from './helpers/fixture-cleanup';
import {
  executeTrustedSql,
  openDedicatedSqlConnection,
  queryTrustedSql
} from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
const password = 'Password123!';
const p256dh = () => Buffer.concat([Buffer.from([4]), randomBytes(64)]).toString('base64url');
const authSecret = () => randomBytes(16).toString('base64url');
const endpointFor = () => `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;

describe.skipIf(!environment.env)('push subscription registry (real local Supabase JWTs)', () => {
  function env(): Env {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }

  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const signup = await anonymous.auth.signUp({
      email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomUUID()}@example.test`,
      password
    });
    expect(signup.error).toBeNull();
    const token = signup.data.session?.access_token;
    expect(token).toBeTruthy();
    return {
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      }),
      id: signup.data.user!.id
    };
  }

  const code = (error: unknown) =>
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const message = (error: unknown) =>
    error && typeof error === 'object' && 'message' in error ? error.message : undefined;
  const register = (
    client: SupabaseClient,
    endpoint: string,
    overrides: Record<string, unknown> = {}
  ) =>
    client.rpc('register_my_push_subscription', {
      p_endpoint: endpoint,
      p_p256dh: p256dh(),
      p_auth: authSecret(),
      p_vapid_key_id: 'key-1',
      p_locale: 'en',
      ...overrides
    });
  const devices = async (client: SupabaseClient, endpoint: string | null = null) => {
    const result = await client.rpc('reconcile_my_push_devices', {
      p_current_endpoint: endpoint,
      p_locale: null
    });
    expect(result.error).toBeNull();
    const rows: {
      device_id: string;
      is_current: boolean;
      device_retired_at: string | null;
      device_retired_reason: string | null;
      device_locale: string;
    }[] = result.data ?? [];
    return rows;
  };
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const stored = async (endpoint: string) =>
    (
      await queryTrustedSql(
        `select user_id, retired_at, retired_reason, created_at from public.push_subscriptions where endpoint = ${literal(endpoint)}`
      )
    ).rows[0];

  it('keeps two devices of one user side by side and retires exactly one', async () => {
    const owner = await actor('Push Owner');
    const phone = endpointFor();
    const laptop = endpointFor();
    try {
      expect((await register(owner.client, phone)).error).toBeNull();
      expect((await register(owner.client, laptop, { p_locale: 'pt-BR' })).error).toBeNull();

      const list = await devices(owner.client, phone);
      expect(list).toHaveLength(2);
      expect(list.filter((row) => row.is_current)).toHaveLength(1);
      expect(Object.keys(list[0]!).join()).not.toMatch(/endpoint|p256dh|auth\b/);

      const retired = await owner.client.rpc('retire_my_push_subscription', {
        p_endpoint: phone,
        p_reason: 'user_disabled'
      });
      expect(retired.data).toBe(true);
      expect(
        (
          await owner.client.rpc('retire_my_push_subscription', {
            p_endpoint: phone,
            p_reason: 'logout'
          })
        ).data
      ).toBe(false);
      const after = await devices(owner.client, laptop);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        is_current: true,
        device_retired_at: null,
        device_locale: 'pt-BR'
      });
      // The retired current device is still reported to its own browser so it can reconcile.
      const retiredView = await devices(owner.client, phone);
      expect(retiredView.find((row) => row.is_current)).toMatchObject({
        device_retired_reason: 'user_disabled'
      });
    } finally {
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
      );
    }
  }, 30000);

  it('is idempotent for the same endpoint and updates locale on reconcile without resubscribing', async () => {
    const owner = await actor('Push Idempotent');
    const endpoint = endpointFor();
    try {
      const first = await register(owner.client, endpoint);
      const second = await register(owner.client, endpoint, { p_locale: 'es' });
      expect(first.error).toBeNull();
      expect(second.data).toBe(first.data);
      expect(await devices(owner.client)).toHaveLength(1);
      await owner.client.rpc('reconcile_my_push_devices', {
        p_current_endpoint: endpoint,
        p_locale: 'pt-BR'
      });
      expect((await devices(owner.client, endpoint))[0]?.device_locale).toBe('pt-BR');
    } finally {
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
      );
    }
  }, 30000);

  it('blocks endpoint theft by another active owner until the owner retires it', async () => {
    const first = await actor('Push First');
    const second = await actor('Push Second');
    const shared = endpointFor();
    try {
      expect((await register(first.client, shared)).error).toBeNull();
      const stolen = await register(second.client, shared);
      expect(message(stolen.error)).toBe('PUSH_ENDPOINT_CONFLICT');
      expect((await stored(shared))?.user_id).toBe(first.id);
      expect(await devices(second.client, shared)).toEqual([]);
      // A foreign retire attempt is a no-op.
      expect(
        (
          await second.client.rpc('retire_my_push_subscription', {
            p_endpoint: shared,
            p_reason: 'logout'
          })
        ).data
      ).toBe(false);
      expect((await stored(shared))?.retired_at).toBeNull();

      await first.client.rpc('retire_my_push_subscription', {
        p_endpoint: shared,
        p_reason: 'logout'
      });
      const before = (await stored(shared))?.created_at;
      expect((await register(second.client, shared)).error).toBeNull();
      const row = await stored(shared);
      expect(row).toMatchObject({ user_id: second.id, retired_at: null });
      expect(new Date(String(row!.created_at)).getTime()).toBeGreaterThanOrEqual(
        new Date(String(before)).getTime()
      );
      expect(await devices(first.client)).toEqual([]);
    } finally {
      const ids = [first.id, second.id].map((id) => `${literal(id)}::uuid`).join(',');
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(ids)} delete from auth.users where id in (${ids})`
      );
    }
  }, 30000);

  it('validates endpoint, key lengths, decoded key material, locale and the device cap', async () => {
    const owner = await actor('Push Validation');
    try {
      const invalid: Record<string, unknown>[] = [
        { p_endpoint: 'http://push.example/insecure-endpoint' },
        { p_endpoint: 'https://user@push.example/credentialed' },
        { p_endpoint: `https://push.example/${'x'.repeat(2100)}` },
        { p_p256dh: p256dh().slice(0, 86) },
        { p_auth: authSecret().slice(0, 21) },
        { p_p256dh: 'A'.repeat(87) },
        { p_locale: 'fr' },
        { p_vapid_key_id: '' },
        { p_vapid_key_id: 'k'.repeat(65) },
        { p_locale: null }
      ];
      for (const override of invalid) {
        const result = await register(owner.client, endpointFor(), override);
        expect(code(result.error)).toBe('22023');
      }
      expect(await devices(owner.client)).toEqual([]);
      for (let index = 0; index < 25; index += 1)
        expect((await register(owner.client, endpointFor())).error).toBeNull();
      expect(message((await register(owner.client, endpointFor())).error)).toBe(
        'PUSH_DEVICE_LIMIT'
      );
      expect(
        (
          await owner.client.rpc('retire_my_push_subscription', {
            p_endpoint: 'x',
            p_reason: 'bogus'
          })
        ).error
      ).not.toBeNull();
    } finally {
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
      );
    }
  }, 60000);

  it('serializes concurrent enrolments per user so the 25-device cap holds at the boundary', async () => {
    const owner = await actor('Push Concurrent Cap');
    const first = await openDedicatedSqlConnection();
    const second = await openDedicatedSqlConnection();
    const enrol = async (connection: typeof first, endpoint: string) => {
      await connection.query(
        `select set_config('request.jwt.claims', '{"sub":"${owner.id}","role":"authenticated"}', true)`
      );
      await connection.query('set local role authenticated');
      await connection.query(
        `select public.register_my_push_subscription(${literal(endpoint)}, ${literal(p256dh())}, ${literal(authSecret())}, 'key-1', 'en')`
      );
    };
    try {
      for (let index = 0; index < 24; index += 1)
        expect((await register(owner.client, endpointFor())).error).toBeNull();
      // Two open transactions for different endpoints at 24 of 25: the second must wait for the first.
      await first.query('begin');
      await second.query('begin');
      await enrol(first, endpointFor());
      const racing = enrol(second, endpointFor()).then(
        () => 'registered',
        (error: unknown) => (error instanceof Error ? error.message : 'failed')
      );
      const early = await Promise.race([
        racing,
        new Promise<string>((resolve) => setTimeout(() => resolve('waiting'), 750))
      ]);
      expect(early).toBe('waiting');
      await first.query('commit');
      expect(await racing).toContain('PUSH_DEVICE_LIMIT');
      expect(
        (await devices(owner.client)).filter((row) => row.device_retired_at === null)
      ).toHaveLength(25);
    } finally {
      await first.close();
      await second.close();
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
      );
    }
  }, 60000);

  it('rejects anonymous callers and denies every direct table access', async () => {
    const owner = await actor('Push Direct');
    const { url, key } = env();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const endpoint = endpointFor();
    try {
      expect((await register(owner.client, endpoint)).error).toBeNull();
      expect(code((await register(anonymous, endpointFor())).error)).toMatch(/^(28000|42501)$/);
      expect(
        (
          await anonymous.rpc('reconcile_my_push_devices', {
            p_current_endpoint: null,
            p_locale: null
          })
        ).error
      ).not.toBeNull();
      expect(
        (
          await anonymous.rpc('retire_my_push_subscription', {
            p_endpoint: endpoint,
            p_reason: 'logout'
          })
        ).error
      ).not.toBeNull();

      for (const client of [owner.client, anonymous]) {
        expect((await client.from('push_subscriptions').select('*')).error).not.toBeNull();
        expect(
          (
            await client
              .from('push_subscriptions')
              .update({ user_id: owner.id })
              .eq('endpoint', endpoint)
          ).error
        ).not.toBeNull();
        expect(
          (await client.from('push_subscriptions').delete().eq('endpoint', endpoint)).error
        ).not.toBeNull();
        expect(
          (
            await client
              .from('push_subscriptions')
              .insert({ user_id: owner.id, endpoint: endpointFor() })
          ).error
        ).not.toBeNull();
      }
      const [privileges] = (
        await queryTrustedSql(
          `select c.relrowsecurity,
            has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_any,
            has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as auth_any
           from pg_class c where c.oid = 'public.push_subscriptions'::regclass`
        )
      ).rows;
      expect(privileges).toEqual({ relrowsecurity: true, anon_any: false, auth_any: false });
      expect((await stored(endpoint))?.retired_at).toBeNull();
    } finally {
      await executeTrustedSql(
        `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
      );
    }
  }, 30000);

  it('cascades registry rows when the account is deleted and leaves preferences untouched by devices', async () => {
    const owner = await actor('Push Cascade');
    const endpoint = endpointFor();
    expect((await register(owner.client, endpoint)).error).toBeNull();
    const prefs = await owner.client.rpc('set_my_notification_preferences', {
      p_push_enabled: false,
      p_push_community: false,
      p_push_matches: true,
      p_push_results: true,
      p_push_rankings: true,
      p_push_leagues: true
    });
    expect(prefs.error).toBeNull();
    // Registering or retiring a device never flips saved intent or the always-on in-app flag.
    await owner.client.rpc('retire_my_push_subscription', {
      p_endpoint: endpoint,
      p_reason: 'user_disabled'
    });
    const row = (await owner.client.from('notification_preferences').select('*').single()).data;
    expect(row).toMatchObject({
      push_enabled: false,
      push_community: false,
      critical_in_app_enabled: true
    });
    await executeTrustedSql(
      `${ratingEvidenceCleanupSql(`${literal(owner.id)}::uuid`)} delete from auth.users where id = ${literal(owner.id)}::uuid`
    );
    expect(await stored(endpoint)).toBeUndefined();
  }, 30000);
});
