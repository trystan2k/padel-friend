import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { createMatchResultReviewFixtures } from './helpers/match-result-review-fixtures';
import { fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  calculationInputs,
  insertConfirmedGroup,
  type ConfirmedGroup
} from './helpers/rating-ledger-fixtures';
import {
  provisionProvisionalPlayer,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import { setRatingProjectionActive } from './helpers/rating-fixtures';
import { queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const LEDGER_TABLES = [
  'player_rating_projection_control',
  'player_rating_events',
  'player_rating_event_calculations',
  'player_rating_event_sources',
  'player_rating_initializations'
] as const;

/** Administrative level-review evidence (PAF-148): insert-only, DTO-only, restrictive. */
const ADJUSTMENT_TABLES = [
  'player_rating_admin_adjustments',
  'player_rating_adjustment_states'
] as const;

async function rejection(sql: string): Promise<string> {
  try {
    await queryTrustedSql(sql);
  } catch (error) {
    return sqlErrorMessage(error);
  }
  throw new Error(`Expected SQL to fail: ${sql}`);
}

function eventInsert(group: ConfirmedGroup, eventId: string, userId: string, playedAt?: string) {
  return `insert into public.player_rating_events
    (game_group_id, user_id, match_event_id, game_group_number, confirmation_id, proposal_version, played_at)
    select p.id, '${userId}', p.match_event_id, p.group_number, '${group.confirmationId}', ${group.version},
      '${playedAt ?? group.playedAt}'::timestamptz
    from public.match_event_result_proposals p where p.id = '${group.proposalId}' and p.match_event_id = '${eventId}'`;
}

function calculationInsert(
  eventRowId: string,
  group: ConfirmedGroup,
  revision: number,
  overrides: { inputs?: unknown; explanation?: unknown; sourceRevision?: number } = {}
) {
  const inputs = JSON.stringify(overrides.inputs ?? calculationInputs(group));
  const explanation = JSON.stringify(overrides.explanation ?? { expected_score: 0.5 });
  return `insert into public.player_rating_event_calculations
    (rating_event_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
     before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups, before_highest_display_level,
     after_mu, after_sigma, after_display_level, after_reliability_percent, after_confirmed_groups, after_highest_display_level,
     last_rating_at, inputs, explanation, source_revision)
    values ('${eventRowId}', ${revision}, 'app-wide-level', '1.0.0', 1,
      4, 1, 4, 10, 0, 4,
      4.1, 1, 4.1, 16, 1, 4.1,
      '${group.playedAt}', '${inputs}'::jsonb, '${explanation}'::jsonb, ${overrides.sourceRevision ?? 1})`;
}

describe('global rating ledger schema', { timeout: 120_000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;
  let group: ConfirmedGroup;
  let eventId: string;
  let playerIds: [string, string, string, string];

  beforeAll(async () => {
    if (!environment.env) return;
    // These tests write ledger rows by hand: the production projector must stay dormant.
    await setRatingProjectionActive(false);
    f = await createMatchResultReviewFixtures(environment.env);
    for (const player of f.players.slice(0, 4)) {
      const onboarded = await player.client.rpc('onboard_player', {
        p_display_name: `Ledger ${player.id.slice(0, 6)}`,
        p_preferred_side: 'EITHER',
        p_initial_level: 4
      });
      if (onboarded.error) throw new Error(`Fixture onboarding failed: ${onboarded.error.message}`);
    }
    eventId = await f.protectedEvent({ competitive: true });
    const [first, second, third, fourth] = f.players;
    playerIds = [first!.id, second!.id, third!.id, fourth!.id];
    group = await insertConfirmedGroup({
      eventId,
      submittedBy: f.creator.id,
      playerIds,
      groupNumber: 1
    });
  });

  afterAll(async () => {
    try {
      if (f) await f.cleanup();
    } finally {
      if (environment.env) await setRatingProjectionActive(true);
    }
  });

  it.skipIf(!environment.env)(
    'keeps one global state per permanent UUID and a single protected control row',
    async () => {
      const duplicate = await rejection(`insert into public.global_player_ratings
        (user_id, initial_display_level, mu, sigma, display_level, reliability_percent,
         confirmed_competitive_game_groups, highest_display_level, rating_engine, rating_engine_version)
        values ('${playerIds[0]}', 4, 4, 1, 4, 10, 0, 4, 'app-wide-level', '1.0.0')`);
      expect(duplicate).toContain('global_player_ratings_pkey');
      const control = await sqlRows(
        `select activation_enabled, committed_revision >= 0 as revision_valid,
                (last_processed_played_at is null) = (last_processed_game_group_id is null) as watermark_shape
           from public.player_rating_projection_control`
      );
      // Dormant only because this suite switched the projector off for hand-written rows.
      expect(control).toEqual([
        { activation_enabled: false, revision_valid: true, watermark_shape: true }
      ]);
      expect(
        await rejection(
          'insert into public.player_rating_projection_control (singleton) values (false)'
        )
      ).toContain('violates check constraint');
      expect(await rejection('delete from public.player_rating_projection_control')).toContain(
        'RATING_PROJECTION_CONTROL_PROTECTED'
      );
      expect(await rejection('truncate public.player_rating_projection_control')).toContain(
        'RATING_PROJECTION_CONTROL_PROTECTED'
      );
      expect(
        await rejection(
          'update public.player_rating_projection_control set committed_revision = -1'
        )
      ).toContain('RATING_PROJECTION_CONTROL_PROTECTED');
    }
  );

  it.skipIf(!environment.env)(
    'enforces V1 state consistency on the current-state rows',
    async () => {
      const state = (set: string) =>
        rejection(
          `update public.global_player_ratings set ${set} where user_id = '${playerIds[0]}'`
        );
      expect(await state('sigma = 0.50')).toContain('global_player_ratings_v1_state');
      expect(await state('confirmed_competitive_game_groups = 3')).toContain(
        'global_player_ratings_v1_state'
      );
      expect(await state('display_level = 4.5')).toContain('highest_not_below_current');
      const rows = await sqlRows(
        `select rating_config_version, projection_revision::int as revision
           from public.global_player_ratings where user_id = '${playerIds[0]}'`
      );
      expect(rows).toEqual([{ rating_config_version: 1, revision: 0 }]);
    }
  );

  it.skipIf(!environment.env)(
    'records one logical event per group and player with immutable calculation revisions',
    async () => {
      await fixtureSql(eventInsert(group, eventId, playerIds[0]));
      const stored = await sqlRows(
        `select id::text, game_group_id::text, played_at from public.player_rating_events
          where game_group_id = '${group.proposalId}'`
      );
      expect(stored).toHaveLength(1);
      const eventRowId = String(stored[0]!['id']);
      // Birth evidence is mirrored by the initial active effective source.
      await fixtureSql(`insert into public.player_rating_event_sources
        (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version, played_at, reason)
        select e.id, 1, e.game_group_id, true, e.confirmation_id, e.proposal_version, e.played_at, 'birth'
          from public.player_rating_events e where e.id = '${eventRowId}'`);

      // Duplicate group/player identity fails, even through a second confirmation pointer.
      expect(await rejection(eventInsert(group, eventId, playerIds[0]))).toContain(
        'player_rating_event_identity'
      );
      // The player must have played the exact confirmed version, at its instant.
      expect(await rejection(eventInsert(group, eventId, f.players[5]!.id))).toContain(
        'Rating event does not match its confirmed result facts'
      );
      expect(
        await rejection(eventInsert(group, eventId, playerIds[1], '2020-01-01T13:00:00.000Z'))
      ).toContain('Rating event does not match its confirmed result facts');

      await fixtureSql(calculationInsert(eventRowId, group, 1));
      // A replay appends a new revision of the same event; the first stays.
      await fixtureSql(calculationInsert(eventRowId, group, 2));
      expect(await rejection(calculationInsert(eventRowId, group, 2))).toContain(
        'player_rating_event_calculations_pkey'
      );
      const revisions = await sqlRows(
        `select projection_revision::int as revision from public.player_rating_event_calculations
          where rating_event_id = '${eventRowId}' order by 1`
      );
      expect(revisions).toEqual([{ revision: 1 }, { revision: 2 }]);

      // Frozen inputs carry only the four players' ids and numeric states.
      const inputs = calculationInputs(group);
      expect(
        await rejection(
          calculationInsert(eventRowId, group, 3, {
            inputs: { ...inputs, invited_by: playerIds[1] }
          })
        )
      ).toContain('player_rating_event_calculations_inputs_check');
      const leakedState = {
        ...inputs,
        states: {
          ...inputs.states,
          [playerIds[0]]: { ...inputs.states[playerIds[0]], email: 'a@b.c' }
        }
      };
      expect(
        await rejection(calculationInsert(eventRowId, group, 3, { inputs: leakedState }))
      ).toContain('player_rating_event_calculations_inputs_check');
      expect(
        await rejection(
          calculationInsert(eventRowId, group, 3, { explanation: { email: 'a@b.c' } })
        )
      ).toContain('player_rating_event_calculations_explanation_check');
    }
  );

  it.skipIf(!environment.env)(
    'rejects updates, deletes and truncates of every evidence table',
    async () => {
      const eventRowId = String(
        (await sqlRows(`select id::text from public.player_rating_events limit 1`))[0]!['id']
      );
      const statements = [
        `update public.player_rating_events set played_at = played_at where id = '${eventRowId}'`,
        `delete from public.player_rating_events where id = '${eventRowId}'`,
        'truncate public.player_rating_events cascade',
        `update public.player_rating_event_calculations set explanation = '{}'::jsonb where rating_event_id = '${eventRowId}'`,
        `delete from public.player_rating_event_calculations where rating_event_id = '${eventRowId}'`,
        'truncate public.player_rating_event_calculations',
        `update public.player_rating_event_sources set is_active = false where rating_event_id = '${eventRowId}'`,
        `delete from public.player_rating_event_sources where rating_event_id = '${eventRowId}'`,
        'truncate public.player_rating_event_sources cascade',
        `update public.player_rating_initializations set initial_level = 1 where user_id = '${playerIds[0]}'`,
        `delete from public.player_rating_initializations where user_id = '${playerIds[0]}'`,
        'truncate public.player_rating_initializations cascade'
      ];
      for (const statement of statements)
        expect(await rejection(statement)).toContain('RATING_EVIDENCE_IMMUTABLE');
    }
  );

  it.skipIf(!environment.env)(
    'adjustment evidence is RLS-protected, grant-free, restrictive for provisional actors and insert-only',
    async () => {
      for (const table of ADJUSTMENT_TABLES) {
        const [row] = await sqlRows(
          `select c.relrowsecurity as rls,
                  (select count(*)::int from information_schema.role_table_grants g
                    where g.table_schema = 'public' and g.table_name = '${table}'
                      and g.grantee in ('anon', 'authenticated', 'service_role')) as grants,
                  (select count(*)::int from pg_catalog.pg_policies p
                    where p.schemaname = 'public' and p.tablename = '${table}'
                      and p.permissive = 'RESTRICTIVE') as restrictive,
                  (select count(*)::int from pg_catalog.pg_trigger t
                    where t.tgrelid = c.oid and not t.tgisinternal
                      and (t.tgname like '%immutable' or t.tgname like '%no_truncate')) as guards
             from pg_catalog.pg_class c where c.oid = 'public.${table}'::regclass`
        );
        expect(row).toMatchObject({ rls: true, grants: 0, restrictive: 1 });
        expect(Number(row!['guards'])).toBeGreaterThanOrEqual(2);
      }
      // The adjustment event never carries match identity and the request link is unique.
      const columns = await sqlRows(
        `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = 'player_rating_admin_adjustments'
            and column_name in ('game_group_id', 'match_event_id', 'confirmation_id', 'proposal_version')`
      );
      expect(columns).toEqual([]);
      const [unique] = await sqlRows(
        `select count(*)::int as count from pg_catalog.pg_constraint
          where conrelid = 'public.player_rating_admin_adjustments'::regclass and contype = 'u'
            and pg_get_constraintdef(oid) like '%(level_review_request_id)%'`
      );
      expect(unique!['count']).toBe(1);
    }
  );

  it.skipIf(!environment.env)('has no cascading foreign key from sporting evidence', async () => {
    const constraints = await sqlRows(
      `select c.conrelid::regclass::text as table_name, c.conname, c.confdeltype::text as delete_action
         from pg_constraint c
        where c.contype = 'f' and c.conrelid = any(array[
          'public.player_rating_events'::regclass, 'public.player_rating_event_calculations'::regclass,
          'public.player_rating_event_sources'::regclass, 'public.player_rating_initializations'::regclass])
        order by 1, 2`
    );
    expect(constraints.length).toBeGreaterThanOrEqual(8);
    expect(constraints.filter((row) => row['delete_action'] !== 'r')).toEqual([]);
    // Source rows cannot be removed from under the evidence.
    expect(
      await rejection(`delete from public.player_profiles where user_id = '${playerIds[0]}'`)
    ).toMatch(/violates foreign key constraint|RATING_EVIDENCE_IMMUTABLE|Cascade/i);
  });

  it.skipIf(!environment.env)(
    'grants runtime roles no write privilege and only owner event reads',
    async () => {
      const privileges = await sqlRows(
        `select r.rolname, t.table_name, p.privilege
           from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
           cross join (values ${LEDGER_TABLES.map((name) => `('${name}')`).join(',')}) t(table_name)
           cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER'), ('SELECT')) p(privilege)
          where has_table_privilege(r.rolname, 'public.' || t.table_name, p.privilege)
          order by 1, 2, 3`
      );
      expect(privileges).toEqual([
        { rolname: 'authenticated', table_name: 'player_rating_events', privilege: 'SELECT' }
      ]);
      const functions = await sqlRows(
        `select p.proname, r.rolname
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           cross join (values ('public'), ('anon'), ('authenticated'), ('service_role')) r(rolname)
          where n.nspname = 'public' and p.proname in ('lock_global_rating_projection',
            'initialize_global_player_rating_locked', 'guard_player_rating_event_source',
            'guard_player_rating_evidence_immutable', 'guard_player_rating_control',
            'player_rating_calculation_inputs_valid', 'player_has_rated_history')
            and has_function_privilege(r.rolname, p.oid, 'EXECUTE') and r.rolname <> 'public'`
      );
      expect(functions).toEqual([]);
      const policies = await sqlRows(
        `select c.relname, count(*) filter (where not pol.polpermissive and pg_get_expr(pol.polqual, pol.polrelid) like '%is_provisional_actor%')::int as restrictive
           from pg_class c left join pg_policy pol on pol.polrelid = c.oid
          where c.oid = any(array[${LEDGER_TABLES.map((name) => `'public.${name}'::regclass`).join(',')}])
          group by 1 order by 1`
      );
      expect(policies.map((row) => row['restrictive'])).toEqual([1, 1, 1, 1, 1]);
    }
  );

  it.skipIf(!environment.env)(
    'denies non-owners and provisional actors the owner-only event pointers',
    async () => {
      const [owner, other] = f.players;
      const own = await owner!.client.from('player_rating_events').select('user_id');
      expect(own.error).toBeNull();
      expect(own.data).toEqual([{ user_id: owner!.id }]);
      const outsider = await other!.client.from('player_rating_events').select('user_id');
      expect(outsider.data).toEqual([]);
      for (const table of [
        'player_rating_event_calculations',
        'player_rating_event_sources',
        'player_rating_initializations',
        'player_rating_projection_control'
      ] as const) {
        const denied = await owner!.client.from(table).select('*');
        expect(denied.error?.code).toBe('42501');
      }

      // A provisional session reads nothing, even with its own (insertable) event pointers.
      const provisional = await signUpFixtureActor(environment.env!, 'ledger-provisional');
      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Ledger Provisional',
        estimatedLevel: 3.5,
        invitedBy: owner!.id,
        sourceEventId: eventId
      });
      const second = await insertConfirmedGroup({
        eventId,
        submittedBy: f.creator.id,
        playerIds: [provisional.id, f.players[4]!.id, f.players[5]!.id, f.players[6]!.id],
        groupNumber: 2
      });
      await fixtureSql(eventInsert(second, eventId, provisional.id));
      const stored = await sqlRows(
        `select user_id::text from public.player_rating_events where user_id = '${provisional.id}'`
      );
      expect(stored).toHaveLength(1);
      const hidden = await provisional.client.from('player_rating_events').select('user_id');
      expect(hidden.error).toBeNull();
      expect(hidden.data).toEqual([]);
    }
  );
});
