import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { assertLocalSupabaseEnvInCi, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  addInvitedPlayer,
  claimAudits,
  claimScenario,
  profileState,
  sessionClient,
  verifyInvitation
} from './helpers/provisional-claim-fixtures';
import { signUpFixtureActor } from './helpers/provisional-player-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv();

const PROFILE = {
  p_display_name: 'Avail Player',
  p_preferred_side: 'LEFT',
  p_initial_level: 3.5
} as const;

async function availabilityOf(userId: string) {
  const result = await queryTrustedSql(
    'select preferred_playing_days, preferred_playing_times from public.player_profiles where user_id = $1',
    { values: [userId] }
  );
  return result.rows[0];
}

async function rejection(sql: string, values: unknown[] = []): Promise<string> {
  try {
    await queryTrustedSql(sql, { values });
  } catch (error) {
    return sqlErrorMessage(error);
  }
  throw new Error(`Expected SQL rejection: ${sql}`);
}

const SET_DAYS =
  'update public.player_profiles set preferred_playing_days = $2::text[] where user_id = $1';
const SET_TIMES =
  'update public.player_profiles set preferred_playing_times = $2::text[] where user_id = $1';

describe('player availability schema and contracts', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'enforces each CHECK on raw writes, including empty and NULL',
    async () => {
      const actor = await signUpFixtureActor(environment.env!, 'avail-checks', {
        displayName: 'Checks',
        level: 3
      });
      const days = 'player_profiles_preferred_playing_days_valid';
      const times = 'player_profiles_preferred_playing_times_valid';
      const eight = '{MON,TUE,WED,THU,FRI,SAT,SUN,MON}';
      for (const bad of ['{FUNDAY}', '{mon}', '{MON,NULL}', '{{MON},{TUE}}', '{MORNING}', eight])
        expect(await rejection(SET_DAYS, [actor.id, bad])).toContain(days);
      for (const bad of [
        '{NOON}',
        '{morning}',
        '{MORNING,NULL}',
        '{{MORNING},{EVENING}}',
        '{MON}',
        '{MORNING,AFTERNOON,EVENING,MORNING}'
      ])
        expect(await rejection(SET_TIMES, [actor.id, bad])).toContain(times);

      for (const good of ['{}', '{MON,SUN}', '{MON,TUE,WED,THU,FRI,SAT,SUN}', null])
        await queryTrustedSql(SET_DAYS, { values: [actor.id, good] });
      for (const good of ['{}', '{EVENING}', '{MORNING,AFTERNOON,EVENING}', null])
        await queryTrustedSql(SET_TIMES, { values: [actor.id, good] });
      expect(await availabilityOf(actor.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: null
      });
    }
  );

  it.skipIf(!environment.env)(
    'grants authenticated UPDATE on exactly the intended columns',
    async () => {
      const columns = await queryTrustedSql(
        `select column_name from information_schema.column_privileges
        where table_schema = 'public' and table_name = 'player_profiles'
          and grantee = 'authenticated' and privilege_type = 'UPDATE' order by 1`
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'avatar_url',
        'bio',
        'display_name',
        'dominant_hand',
        'preferred_playing_days',
        'preferred_playing_times',
        'preferred_side'
      ]);
      const privileges = await queryTrustedSql(
        `select p.proname, p.prosecdef, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
          has_function_privilege('anon', p.oid, 'execute') as anon,
          has_function_privilege('service_role', p.oid, 'execute') as service_role
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname in
          ('onboard_player_with_availability', 'claim_provisional_player_with_availability',
           'onboard_player', 'claim_provisional_player')
        order by p.proname`
      );
      expect(
        privileges.rows.map((row) => [
          row.proname,
          row.prosecdef,
          row.authenticated,
          row.anon,
          // Originals predate the service_role revoke convention; only the wrappers are pinned.
          String(row.proname).endsWith('_with_availability') ? row.service_role : 'n/a'
        ])
      ).toEqual([
        ['claim_provisional_player', true, true, false, 'n/a'],
        ['claim_provisional_player_with_availability', false, true, false, false],
        ['onboard_player', true, true, false, 'n/a'],
        ['onboard_player_with_availability', false, true, false, false]
      ]);
      for (const row of privileges.rows.filter((entry) =>
        String(entry.proname).endsWith('_with_availability')
      ))
        expect(row.proconfig).toEqual(['search_path=""']);
    }
  );

  it('adds no policies, storage changes or table-wide grants in the migration', () => {
    const sql = readFileSync(
      new URL('../supabase/migrations/20261112090000_player_availability.sql', import.meta.url),
      'utf8'
    );
    expect(sql).not.toMatch(/\b(create|alter|drop)\s+policy\b/i);
    expect(sql).not.toMatch(/storage\./i);
    expect(sql).not.toMatch(/\bdisable\s+row\s+level\s+security\b/i);
    const grants = [...sql.matchAll(/\bgrant\s+([a-z]+)[^;]*?on\s+public\.player_profiles/gi)];
    expect(grants.map((match) => match[0].replace(/\s+/g, ' '))).toEqual([
      'grant update (preferred_playing_days, preferred_playing_times) on public.player_profiles'
    ]);
  });

  it.skipIf(!environment.env)(
    'lets the owner write and read availability; others and anon are denied',
    async () => {
      const env = environment.env!;
      const [owner, other] = await Promise.all([
        signUpFixtureActor(env, 'avail-owner', { displayName: 'Owner', level: 3 }),
        signUpFixtureActor(env, 'avail-other', { displayName: 'Other', level: 3 })
      ]);
      const written = await owner.client
        .from('player_profiles')
        .update({ preferred_playing_days: ['MON', 'SUN'], preferred_playing_times: ['EVENING'] })
        .eq('user_id', owner.id)
        .select('preferred_playing_days, preferred_playing_times');
      expect(written.error).toBeNull();
      expect(written.data).toEqual([
        { preferred_playing_days: ['MON', 'SUN'], preferred_playing_times: ['EVENING'] }
      ]);
      const own = await owner.client
        .from('player_profiles')
        .select('preferred_playing_days')
        .eq('user_id', owner.id);
      expect(own.data).toEqual([{ preferred_playing_days: ['MON', 'SUN'] }]);

      // Owner-only SELECT policy is unchanged: a second player sees no row and updates nothing.
      const seen = await other.client
        .from('player_profiles')
        .select('preferred_playing_days')
        .eq('user_id', owner.id);
      expect(seen.error).toBeNull();
      expect(seen.data).toEqual([]);
      const foreign = await other.client
        .from('player_profiles')
        .update({ preferred_playing_days: ['TUE'] })
        .eq('user_id', owner.id)
        .select('user_id');
      expect(foreign.data ?? []).toEqual([]);
      expect(await availabilityOf(owner.id)).toMatchObject({
        preferred_playing_days: ['MON', 'SUN']
      });

      const anon = createClient<Database>(env.url, env.key, { auth: { persistSession: false } });
      expect(
        (await anon.from('player_profiles').select('preferred_playing_days')).error?.code
      ).toBe('42501');
      expect((await anon.rpc('onboard_player_with_availability', PROFILE)).error?.code).toBe(
        '42501'
      );
      expect(
        (await anon.rpc('claim_provisional_player_with_availability', PROFILE)).error?.code
      ).toBe('42501');

      // Constraints also bind direct authenticated writes; protected columns stay locked.
      const invalid = await owner.client
        .from('player_profiles')
        .update({ preferred_playing_times: ['NOON'] })
        .eq('user_id', owner.id);
      expect(invalid.error?.code).toBe('23514');
      for (const column of [
        { is_provisional: true },
        { rating_input_source: 'creator_estimated' },
        { estimated_level: 1 },
        { created_at: '2020-01-01T00:00:00Z' },
        { updated_at: '2020-01-01T00:00:00Z' }
      ] as const)
        expect(
          (await owner.client.from('player_profiles').update(column).eq('user_id', owner.id)).error
            ?.code
        ).toBe('42501');
    }
  );

  it.skipIf(!environment.env)(
    'keeps the original onboarding RPC working without availability',
    async () => {
      const actor = await signUpFixtureActor(environment.env!, 'avail-legacy');
      expect((await actor.client.rpc('onboard_player', PROFILE)).error).toBeNull();
      expect(await availabilityOf(actor.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: null
      });
    }
  );

  it.skipIf(!environment.env)(
    'onboards atomically with, without and partial availability',
    async () => {
      const env = environment.env!;
      const [both, none, partial, empty] = await Promise.all(
        ['both', 'none', 'partial', 'empty'].map((label) =>
          signUpFixtureActor(env, `avail-${label}`)
        )
      );
      expect(
        (
          await both!.client.rpc('onboard_player_with_availability', {
            ...PROFILE,
            p_preferred_playing_days: ['SAT', 'SUN'],
            p_preferred_playing_times: ['MORNING', 'AFTERNOON']
          })
        ).error
      ).toBeNull();
      expect(await availabilityOf(both!.id)).toEqual({
        preferred_playing_days: ['SAT', 'SUN'],
        preferred_playing_times: ['MORNING', 'AFTERNOON']
      });
      expect(
        (await none!.client.rpc('onboard_player_with_availability', PROFILE)).error
      ).toBeNull();
      expect(await availabilityOf(none!.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: null
      });
      expect(
        (
          await partial!.client.rpc('onboard_player_with_availability', {
            ...PROFILE,
            p_preferred_playing_times: ['EVENING']
          })
        ).error
      ).toBeNull();
      expect(await availabilityOf(partial!.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: ['EVENING']
      });
      expect(
        (
          await empty!.client.rpc('onboard_player_with_availability', {
            ...PROFILE,
            p_preferred_playing_days: [],
            p_preferred_playing_times: []
          })
        ).error
      ).toBeNull();
      expect(await availabilityOf(empty!.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: null
      });
      // Profile and rating exist exactly once for the happy path.
      expect((await profileState(both!.id))?.initial_level).toBe(3.5);
    }
  );

  it.skipIf(!environment.env)(
    'does not overwrite saved availability when a direct onboarding replays',
    async () => {
      const actor = await signUpFixtureActor(environment.env!, 'avail-replay');
      await actor.client.rpc('onboard_player_with_availability', {
        ...PROFILE,
        p_preferred_playing_days: ['MON']
      });
      const replay = await actor.client.rpc('onboard_player_with_availability', {
        ...PROFILE,
        p_preferred_playing_days: ['FRI'],
        p_preferred_playing_times: ['EVENING']
      });
      expect(replay.error).toBeNull();
      expect(await availabilityOf(actor.id)).toEqual({
        preferred_playing_days: ['MON'],
        preferred_playing_times: null
      });
      const bare = await actor.client.rpc('onboard_player_with_availability', PROFILE);
      expect(bare.error).toBeNull();
      expect(await availabilityOf(actor.id)).toMatchObject({ preferred_playing_days: ['MON'] });
    }
  );

  it.skipIf(!environment.env)(
    'rolls the whole onboarding back when availability violates a constraint',
    async () => {
      const actor = await signUpFixtureActor(environment.env!, 'avail-rollback');
      for (const args of [
        { p_preferred_playing_days: ['FUNDAY'] },
        { p_preferred_playing_times: ['NOON'] },
        { p_preferred_playing_days: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN', 'MON'] }
      ]) {
        const failed = await actor.client.rpc('onboard_player_with_availability', {
          ...PROFILE,
          ...args
        });
        expect(failed.error?.code).toBe('23514');
        expect(await profileState(actor.id)).toBeUndefined();
        const rating = await queryTrustedSql(
          'select 1 from public.global_player_ratings where user_id = $1',
          {
            values: [actor.id]
          }
        );
        expect(rating.rows).toHaveLength(0);
      }
      expect(
        (await actor.client.rpc('onboard_player_with_availability', PROFILE)).error
      ).toBeNull();
      expect(await profileState(actor.id)).toMatchObject({ is_provisional: false });
    }
  );

  it.skipIf(!environment.env)(
    'claims atomically with availability and rolls back on a violation',
    async () => {
      const env = environment.env!;
      const scenario = await claimScenario(env, 'avail-claim');
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Claim Avail',
        level: 3.5,
        label: 'avail-invite'
      });
      const verified = await verifyInvitation(env, player.tokenHash);
      expect(verified.error).toBeNull();
      const client = sessionClient(env, verified.data.session!);
      const claim = { ...PROFILE, p_initial_level: 3.5 };

      const failed = await client.rpc('claim_provisional_player_with_availability', {
        ...claim,
        p_preferred_playing_days: ['MON'],
        p_preferred_playing_times: ['NOON']
      });
      expect(failed.error?.code).toBe('23514');
      expect(await profileState(player.id)).toMatchObject({
        is_provisional: true,
        display_name: 'Claim Avail'
      });
      expect(await claimAudits(player.id)).toHaveLength(0);
      expect(await availabilityOf(player.id)).toEqual({
        preferred_playing_days: null,
        preferred_playing_times: null
      });

      const claimed = await client.rpc('claim_provisional_player_with_availability', {
        ...claim,
        p_preferred_playing_days: ['TUE', 'THU'],
        p_preferred_playing_times: ['EVENING']
      });
      expect(claimed.error).toBeNull();
      expect(await profileState(player.id)).toMatchObject({
        is_provisional: false,
        display_name: 'Avail Player',
        initial_level: 3.5
      });
      expect(await claimAudits(player.id)).toHaveLength(1);
      expect(await availabilityOf(player.id)).toEqual({
        preferred_playing_days: ['TUE', 'THU'],
        preferred_playing_times: ['EVENING']
      });
      const password = await queryTrustedSql(
        'select encrypted_password from auth.users where id = $1',
        {
          values: [player.id]
        }
      );
      expect(password.rows[0]?.encrypted_password).toBe('');

      // A replayed claim is rejected and never touches the saved availability.
      const replay = await client.rpc('claim_provisional_player_with_availability', {
        ...claim,
        p_preferred_playing_days: ['SUN']
      });
      expect(replay.error?.message).toBe('PROVISIONAL_CLAIM_NOT_PENDING');
      expect(await availabilityOf(player.id)).toMatchObject({
        preferred_playing_days: ['TUE', 'THU']
      });
    }
  );
});
