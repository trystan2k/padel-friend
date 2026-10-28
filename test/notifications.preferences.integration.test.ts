import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
const password = 'Password123!';
describe.skipIf(!environment.env)('notification preferences (real local Supabase JWTs)', () => {
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
      email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}@example.test`,
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

  const sql = (statement: string) => executeTrustedSql(statement);
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const code = (error: unknown) =>
    error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const save = (
    client: SupabaseClient,
    values: [
      boolean | null,
      boolean | null,
      boolean | null,
      boolean | null,
      boolean | null,
      boolean | null
    ]
  ) =>
    client.rpc('set_my_notification_preferences', {
      p_push_enabled: values[0],
      p_push_community: values[1],
      p_push_matches: values[2],
      p_push_results: values[3],
      p_push_rankings: values[4],
      p_push_leagues: values[5]
    });

  it('stores private last-write-wins push preferences and enforces critical in-app invariant', async () => {
    const owner = await actor('Preference Owner');
    const other = await actor('Preference Other');
    const anonymous = createClient(env().url, env().key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const userIds = [owner.id, other.id];
    try {
      expect((await owner.client.from('notification_preferences').select('*')).data).toEqual([]);
      expect((await other.client.from('notification_preferences').select('*')).data).toEqual([]);
      await sql(
        `insert into public.notification_preferences (user_id) values (${literal(other.id)}::uuid)`
      );
      expect(
        (
          await other.client
            .from('notification_preferences')
            .select(
              'push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled'
            )
            .eq('user_id', other.id)
            .single()
        ).data
      ).toEqual({
        push_enabled: false,
        push_community: true,
        push_matches: true,
        push_results: true,
        push_rankings: true,
        push_leagues: true,
        critical_in_app_enabled: true
      });

      const firstValues: [boolean, boolean, boolean, boolean, boolean, boolean] = [
        true,
        false,
        true,
        false,
        true,
        false
      ];
      const firstSave = await save(owner.client, firstValues);
      expect(firstSave.error).toBeNull();
      expect(firstSave.data).toMatchObject({
        user_id: owner.id,
        push_enabled: true,
        push_community: false,
        push_matches: true,
        push_results: false,
        push_rankings: true,
        push_leagues: false,
        critical_in_app_enabled: true
      });
      expect(
        (await owner.client.from('notification_preferences').select('*').eq('user_id', other.id))
          .data
      ).toEqual([]);
      const anonymousRead = await anonymous.from('notification_preferences').select('*');
      expect(anonymousRead.error || anonymousRead.data?.length === 0).toBeTruthy();
      expect((await other.client.from('notification_preferences').select('user_id')).data).toEqual([
        { user_id: other.id }
      ]);
      expect((await owner.client.from('notification_preferences').select('*')).data).toHaveLength(
        1
      );

      const columns =
        'user_id,push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled,updated_at';
      const storedFirst = (
        await owner.client
          .from('notification_preferences')
          .select(columns)
          .eq('user_id', owner.id)
          .single()
      ).data!;
      expect(storedFirst).toMatchObject({
        user_id: owner.id,
        ...Object.fromEntries(
          [
            'push_enabled',
            'push_community',
            'push_matches',
            'push_results',
            'push_rankings',
            'push_leagues'
          ].map((key, index) => [key, firstValues[index]])
        ),
        critical_in_app_enabled: true
      });

      for (const [value, errorCode] of [
        ['false', '23514'],
        ['null', '23502']
      ] as const) {
        await expect(
          sql(
            `update public.notification_preferences set critical_in_app_enabled = ${value} where user_id = ${literal(owner.id)}::uuid`
          )
        ).rejects.toMatchObject({ code: errorCode });
      }
      const forbiddenUpdate = await owner.client
        .from('notification_preferences')
        .update({ critical_in_app_enabled: false })
        .eq('user_id', owner.id);
      expect(forbiddenUpdate.error).not.toBeNull();
      expect(
        (
          await owner.client
            .from('notification_preferences')
            .select('critical_in_app_enabled')
            .eq('user_id', owner.id)
            .single()
        ).data
      ).toEqual({ critical_in_app_enabled: true });
      const extraPreferenceArgument = {
        p_push_enabled: false,
        p_push_community: false,
        p_push_matches: false,
        p_push_results: false,
        p_push_rankings: false,
        p_push_leagues: false,
        p_critical_in_app_enabled: false
      };
      expect(
        (await owner.client.rpc('set_my_notification_preferences', extraPreferenceArgument)).error
      ).not.toBeNull();
      expect(code((await save(owner.client, [true, null, true, true, true, true])).error)).toBe(
        '22004'
      );

      const secondValues: [boolean, boolean, boolean, boolean, boolean, boolean] = [
        false,
        true,
        false,
        true,
        false,
        true
      ];
      const secondSave = await save(owner.client, secondValues);
      expect(secondSave.error).toBeNull();
      expect(secondSave.data).toMatchObject({
        push_enabled: false,
        push_community: true,
        push_matches: false,
        push_results: true,
        push_rankings: false,
        push_leagues: true,
        critical_in_app_enabled: true
      });
      const storedSecond = (
        await owner.client
          .from('notification_preferences')
          .select(columns)
          .eq('user_id', owner.id)
          .single()
      ).data!;
      expect(storedSecond.updated_at).not.toBe(storedFirst.updated_at);
      expect(Date.parse(storedSecond.updated_at)).toBeGreaterThan(
        Date.parse(storedFirst.updated_at)
      );
      expect(storedSecond).toMatchObject({
        push_enabled: false,
        push_community: true,
        push_matches: false,
        push_results: true,
        push_rankings: false,
        push_leagues: true,
        critical_in_app_enabled: true
      });
      expect(
        code(
          (
            await anonymous.rpc('set_my_notification_preferences', {
              p_push_enabled: true,
              p_push_community: true,
              p_push_matches: true,
              p_push_results: true,
              p_push_rankings: true,
              p_push_leagues: true
            })
          ).error
        )
      ).toMatch(/^(28000|42501)$/);
    } finally {
      await sql(
        `delete from auth.users where id in (${userIds.map((id) => `${literal(id)}::uuid`).join(',')})`
      );
    }
  }, 30000);
});
