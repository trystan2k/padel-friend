import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { assertLocalSupabaseEnvInCi, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import {
  openDedicatedSqlConnection,
  queryTrustedSql,
  type DedicatedSqlConnection
} from './helpers/sql-transport';

const environment = localSupabaseEnv();

const AUTH_REQUIRED = '28000: Authentication required';

const PROFILE = {
  p_display_name: 'Onboard Probe',
  p_preferred_side: 'LEFT',
  p_initial_level: 3.5
} as const;

type EntryPoint = {
  name: 'onboard_player' | 'onboard_player_with_availability';
  sql: (displayName: string) => string;
  call: (
    client: ReturnType<typeof createClient<Database>>,
    displayName: string,
    availability?: { days: string[]; times: string[] }
  ) => PromiseLike<{ error: { code: string; message: string } | null }>;
};

const ENTRY_POINTS: EntryPoint[] = [
  {
    name: 'onboard_player',
    sql: (displayName) => `select public.onboard_player('${displayName}', 'LEFT', 3.5)`,
    call: (client, displayName) =>
      client.rpc('onboard_player', { ...PROFILE, p_display_name: displayName })
  },
  {
    name: 'onboard_player_with_availability',
    sql: (displayName) =>
      `select public.onboard_player_with_availability('${displayName}', 'LEFT', 3.5, null, null, array['MON']::text[], array['EVENING']::text[])`,
    call: (client, displayName, availability = { days: ['MON'], times: ['EVENING'] }) =>
      client.rpc('onboard_player_with_availability', {
        ...PROFILE,
        p_display_name: displayName,
        p_preferred_playing_days: availability.days,
        p_preferred_playing_times: availability.times
      })
  }
];

const STATE_SQL = `select
  (select count(*) from public.player_profiles where user_id = $1)::int as profiles,
  (select count(*) from public.global_player_ratings where user_id = $1)::int as ratings,
  (select count(*) from public.player_rating_initializations where user_id = $1)::int as initializations,
  (select to_jsonb(p) from public.player_profiles p where p.user_id = $1) as profile,
  (select to_jsonb(r) from public.global_player_ratings r where r.user_id = $1) as rating,
  (select coalesce(jsonb_agg(to_jsonb(i) order by i.sequence), '[]'::jsonb)
     from public.player_rating_initializations i where i.user_id = $1) as initialization_rows`;

async function stateOf(userId: string) {
  return (await queryTrustedSql(STATE_SQL, { values: [userId] })).rows[0];
}

async function stateOn(connection: DedicatedSqlConnection, userId: string) {
  return (await connection.query(STATE_SQL, { values: [userId] })).rows[0];
}

type Claims = Record<string, unknown>;

type SimulatedAttempt = {
  error: string | null;
  before: unknown;
  after: unknown;
  /** Null when the whole transaction, including the failed call, assigned no transaction ID. */
  writeXid: unknown;
};

/**
 * SIMULATED JWT claims, not a real Auth session: the local test stack disables the anonymous
 * provider, so a dedicated transaction takes the authenticated role and sets transaction-local
 * request.jwt.claims. The expected failure is caught by an exception block (an implicit
 * savepoint) so the same connection can inspect state before the outer rollback. A rolled-back
 * savepoint also undoes any write, so the proof of rejection-before-writes is that PostgreSQL
 * assigned no transaction ID: any insert or update, even in a rolled-back subtransaction,
 * assigns one to the enclosing transaction.
 */
async function simulatedAttempt(
  sql: string,
  claims: Claims,
  userId: string
): Promise<SimulatedAttempt> {
  const connection = await openDedicatedSqlConnection();
  try {
    await connection.query('begin');
    const before = await stateOn(connection, userId);
    await connection.query('set local role authenticated');
    await connection.query("select set_config('request.jwt.claims', $1, true)", {
      values: [JSON.stringify(claims)]
    });
    // The dedicated connection issues a SET before every statement, which a failed transaction
    // refuses, so the savepoint is an in-database exception block rather than client-side SQL.
    await connection.query(
      `do $probe$ begin
        begin execute $q$${sql}$q$;
        exception when others then
          perform set_config('test.attempt_error', sqlstate || ': ' || sqlerrm, true);
        end;
      end $probe$`
    );
    await connection.query('reset role');
    await connection.query("select set_config('request.jwt.claims', '', true)");
    const after = await stateOn(connection, userId);
    const outcome = await connection.query(
      `select nullif(current_setting('test.attempt_error', true), '') as error,
        pg_current_xact_id_if_assigned()::text as write_xid`
    );
    return {
      error: typeof outcome.rows[0]?.['error'] === 'string' ? outcome.rows[0]['error'] : null,
      before,
      after,
      writeXid: outcome.rows[0]?.['write_xid']
    };
  } finally {
    await connection.query('rollback').catch(() => undefined);
    await connection.close();
  }
}

const claimsFor = (userId: string, extra: Claims = {}): Claims => ({
  sub: userId,
  role: 'authenticated',
  aud: 'authenticated',
  ...extra
});

const ANONYMOUS_FORMS: [string, Claims][] = [
  ['JSON boolean', { is_anonymous: true }],
  ['text representation', { is_anonymous: 'true' }]
];

function expectRejectedWithoutWrites(attempt: SimulatedAttempt): void {
  expect(attempt.error).toBe(AUTH_REQUIRED);
  expect(attempt.after).toEqual(attempt.before);
  expect(attempt.writeXid).toBeNull();
}

async function newActor(label: string) {
  return signUpFixtureActor(environment.env!, label);
}

describe('onboarding actor authorization', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'keeps both onboarding entry points on their intended security configuration',
    async () => {
      const result = await queryTrustedSql(
        `select p.proname, p.prosecdef, p.proconfig,
          has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
          has_function_privilege('anon', p.oid, 'execute') as anon
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('onboard_player', 'onboard_player_with_availability') order by 1`
      );
      expect(result.rows).toEqual([
        {
          proname: 'onboard_player',
          prosecdef: true,
          proconfig: ['search_path=""'],
          authenticated: true,
          anon: false
        },
        {
          proname: 'onboard_player_with_availability',
          prosecdef: false,
          proconfig: ['search_path=""'],
          authenticated: true,
          anon: false
        }
      ]);
    }
  );

  describe('simulated authenticated-role anonymous claims (not a real anonymous session)', () => {
    for (const entry of ENTRY_POINTS) {
      for (const [form, extra] of ANONYMOUS_FORMS) {
        it.skipIf(!environment.env)(
          `${entry.name} rejects ${form} anonymous claims before any write`,
          async () => {
            const actor = await newActor('onboard-anon');
            const attempt = await simulatedAttempt(
              entry.sql('Anon Probe'),
              claimsFor(actor.id, extra),
              actor.id
            );
            expect(attempt.before).toMatchObject({ profiles: 0, ratings: 0, initializations: 0 });
            expectRejectedWithoutWrites(attempt);
            expect(await stateOf(actor.id)).toMatchObject({
              profiles: 0,
              ratings: 0,
              initializations: 0
            });
          }
        );

        it.skipIf(!environment.env)(
          `${entry.name} does not replay success for an onboarded actor with ${form} anonymous claims`,
          async () => {
            const actor = await newActor('onboard-anon-replay');
            const onboarded = await ENTRY_POINTS[1]!.call(actor.client, 'Original Name', {
              days: ['TUE'],
              times: ['MORNING']
            });
            expect(onboarded.error).toBeNull();
            const attempt = await simulatedAttempt(
              entry.sql('Replacement Name'),
              claimsFor(actor.id, extra),
              actor.id
            );
            expect(attempt.before).toMatchObject({ profiles: 1, ratings: 1, initializations: 1 });
            expectRejectedWithoutWrites(attempt);
            expect(await stateOf(actor.id)).toEqual(attempt.before);
          }
        );
      }

      it.skipIf(!environment.env)(`${entry.name} rejects claims without a user ID`, async () => {
        const actor = await newActor('onboard-no-uid');
        const attempt = await simulatedAttempt(
          entry.sql('No Uid'),
          { role: 'authenticated', aud: 'authenticated' },
          actor.id
        );
        expectRejectedWithoutWrites(attempt);
        expect(await stateOf(actor.id)).toMatchObject({ profiles: 0, ratings: 0 });
      });

      it.skipIf(!environment.env)(
        `${entry.name} still onboards simulated non-anonymous claims exactly once`,
        async () => {
          for (const extra of [{}, { is_anonymous: false }, { is_anonymous: 'false' }]) {
            const actor = await newActor('onboard-sim-control');
            const first = await simulatedAttempt(
              entry.sql('Sim Control'),
              claimsFor(actor.id, extra),
              actor.id
            );
            expect(first.error).toBeNull();
            expect(first.after).toMatchObject({ profiles: 1, ratings: 1, initializations: 1 });
            expect(first.writeXid).not.toBeNull();
          }
        }
      );

      it.skipIf(!environment.env)(
        `${entry.name} denies a request without any session`,
        async () => {
          const env = environment.env!;
          const actor = await newActor('onboard-no-session');
          const noSession = createClient<Database>(env.url, env.key, {
            auth: { persistSession: false, autoRefreshToken: false }
          });
          const result = await entry.call(noSession, 'No Session');
          expect(result.error).toMatchObject({ code: '42501' });
          expect(await stateOf(actor.id)).toMatchObject({
            profiles: 0,
            ratings: 0,
            initializations: 0
          });
        }
      );

      it.skipIf(!environment.env)(`${entry.name} keeps denying provisional actors`, async () => {
        const env = environment.env!;
        const [organizer, provisional] = await Promise.all([
          signUpFixtureActor(env, 'onboard-prov-org', { displayName: 'Prov Organizer', level: 4 }),
          newActor('onboard-prov')
        ]);
        const communityId = crypto.randomUUID();
        const eventId = crypto.randomUUID();
        await insertFixtureCommunity({
          id: communityId,
          visibility: 'private',
          adminId: organizer.id,
          memberIds: []
        });
        await insertFixtureEvent({
          id: eventId,
          communityId,
          creatorId: organizer.id,
          visibility: 'community_open'
        });
        await provisionProvisionalPlayer({
          userId: provisional.id,
          displayName: 'Restricted Rae',
          estimatedLevel: 3.5,
          invitedBy: organizer.id,
          sourceEventId: eventId
        });
        const before = await stateOf(provisional.id);
        const result = await entry.call(provisional.client, 'Self Claim');
        expect(result.error).toMatchObject({
          code: '42501',
          message: 'PROVISIONAL_PLAYER_RESTRICTED'
        });
        expect(await stateOf(provisional.id)).toEqual(before);
      });
    }
  });

  describe('real authenticated sessions', () => {
    it.skipIf(!environment.env)(
      'documents that the fixed local stack cannot mint a real anonymous session',
      async () => {
        const env = environment.env!;
        const result = await createClient(env.url, env.key, {
          auth: { persistSession: false, autoRefreshToken: false }
        }).auth.signInAnonymously();
        // Real-anonymous RPC coverage is unavailable until a separately authorized, isolated
        // stack enables the provider; the simulated-claims cases above are the delivered coverage.
        expect(result.error?.code).toBe('anonymous_provider_disabled');
        expect(result.data.session).toBeNull();
      }
    );

    it.skipIf(!environment.env)(
      'onboard_player creates exactly one profile, rating and initialization, and replays idempotently',
      async () => {
        const actor = await newActor('onboard-base');
        const first = await ENTRY_POINTS[0]!.call(actor.client, 'First Name');
        expect(first.error).toBeNull();
        const created = await stateOf(actor.id);
        expect(created).toMatchObject({ profiles: 1, ratings: 1, initializations: 1 });

        const replay = await ENTRY_POINTS[0]!.call(actor.client, 'Second Name');
        expect(replay.error).toBeNull();
        expect(await stateOf(actor.id)).toEqual(created);
      }
    );

    it.skipIf(!environment.env)(
      'onboard_player_with_availability stores availability atomically and never overwrites it on replay',
      async () => {
        const actor = await newActor('onboard-wrapper');
        const wrapper = ENTRY_POINTS[1]!;
        const first = await wrapper.call(actor.client, 'Wrapper Name', {
          days: ['MON', 'WED'],
          times: ['EVENING']
        });
        expect(first.error).toBeNull();
        const created = await stateOf(actor.id);
        expect(created).toMatchObject({ profiles: 1, ratings: 1, initializations: 1 });
        expect(created?.['profile']).toMatchObject({
          display_name: 'Wrapper Name',
          preferred_playing_days: ['MON', 'WED'],
          preferred_playing_times: ['EVENING']
        });

        const replay = await wrapper.call(actor.client, 'Other Name', {
          days: ['SUN'],
          times: ['MORNING']
        });
        expect(replay.error).toBeNull();
        expect(await stateOf(actor.id)).toEqual(created);
      }
    );

    it.skipIf(!environment.env)(
      'rolls the whole first onboarding back when availability is invalid',
      async () => {
        const actor = await newActor('onboard-invalid-availability');
        const wrapper = ENTRY_POINTS[1]!;
        const invalid = await wrapper.call(actor.client, 'Invalid Availability', {
          days: ['FUNDAY'],
          times: ['EVENING']
        });
        expect(invalid.error).not.toBeNull();
        expect(await stateOf(actor.id)).toMatchObject({
          profiles: 0,
          ratings: 0,
          initializations: 0
        });

        const retry = await wrapper.call(actor.client, 'Valid Availability');
        expect(retry.error).toBeNull();
        expect(await stateOf(actor.id)).toMatchObject({
          profiles: 1,
          ratings: 1,
          initializations: 1
        });
      }
    );
  });
});
