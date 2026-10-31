import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  ensureProvisionalMembership,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql, sqlErrorMessage } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function sqlRejection(sql: string, values?: unknown[]): Promise<string> {
  try {
    await queryTrustedSql(sql, { values });
  } catch (error) {
    return sqlErrorMessage(error);
  }
  throw new Error(`Expected SQL rejection: ${sql}`);
}

async function fixture() {
  const env = environment.env!;
  const [organizer, provisional, regular] = await Promise.all([
    signUpFixtureActor(env, 'schema-organizer', { displayName: 'Schema Organizer', level: 4.2 }),
    signUpFixtureActor(env, 'schema-provisional'),
    signUpFixtureActor(env, 'schema-regular', { displayName: 'Schema Regular', level: 3.1 })
  ]);
  const communityId = crypto.randomUUID();
  const otherCommunityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  const otherEventId = crypto.randomUUID();
  await insertFixtureCommunity({ id: communityId, visibility: 'private', adminId: organizer.id });
  await insertFixtureCommunity({
    id: otherCommunityId,
    visibility: 'public',
    adminId: organizer.id
  });
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: organizer.id,
    visibility: 'community_open'
  });
  await insertFixtureEvent({
    id: otherEventId,
    communityId: otherCommunityId,
    creatorId: organizer.id,
    visibility: 'community_open'
  });
  return {
    organizer,
    provisional,
    regular,
    communityId,
    otherCommunityId,
    eventId,
    otherEventId
  };
}

describe('provisional player identity schema', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'provisions a permanent-UUID profile and rating from the creator estimate without overwriting existing players',
    async () => {
      const { organizer, provisional, regular, eventId } = await fixture();

      expect(
        await provisionProvisionalPlayer({
          userId: provisional.id,
          displayName: 'Pending Pat',
          estimatedLevel: 3.7,
          invitedBy: organizer.id,
          sourceEventId: eventId
        })
      ).toBe(true);
      const profile = await queryTrustedSql(
        `select p.user_id, p.display_name, p.preferred_side, p.is_provisional, p.rating_input_source,
           p.estimated_level::text, p.invited_by, p.invited_at is not null as invited, p.source_match_event_id,
           g.initial_display_level::text, g.mu::text, g.sigma::text, g.display_level::text,
           g.reliability_percent, g.confirmed_competitive_game_groups, g.rating_engine, g.rating_engine_version
         from public.player_profiles p join public.global_player_ratings g using (user_id)
         where p.user_id = $1`,
        { values: [provisional.id] }
      );
      expect(profile.rows).toEqual([
        {
          user_id: provisional.id,
          display_name: 'Pending Pat',
          preferred_side: 'EITHER',
          is_provisional: true,
          rating_input_source: 'creator_estimated',
          estimated_level: '3.7',
          invited_by: organizer.id,
          invited: true,
          source_match_event_id: eventId,
          initial_display_level: '3.7',
          mu: '3.70',
          sigma: '1.00',
          display_level: '3.70',
          reliability_percent: 10,
          confirmed_competitive_game_groups: 0,
          rating_engine: 'app-wide-level',
          rating_engine_version: '1.0.0'
        }
      ]);

      // Repeat adds and registered players are never overwritten.
      expect(
        await provisionProvisionalPlayer({
          userId: provisional.id,
          displayName: 'Renamed',
          estimatedLevel: 6,
          invitedBy: organizer.id,
          sourceEventId: eventId
        })
      ).toBe(false);
      expect(
        await provisionProvisionalPlayer({
          userId: regular.id,
          displayName: 'Hijack',
          estimatedLevel: 1,
          invitedBy: organizer.id,
          sourceEventId: eventId
        })
      ).toBe(false);
      const unchanged = await queryTrustedSql(
        `select user_id, display_name, is_provisional, rating_input_source, estimated_level
         from public.player_profiles where user_id = any($1::uuid[]) order by display_name`,
        { values: [[provisional.id, regular.id]] }
      );
      expect(unchanged.rows).toEqual([
        {
          user_id: provisional.id,
          display_name: 'Pending Pat',
          is_provisional: true,
          rating_input_source: 'creator_estimated',
          estimated_level: '3.7'
        },
        {
          user_id: regular.id,
          display_name: 'Schema Regular',
          is_provisional: false,
          rating_input_source: 'self_declared',
          estimated_level: null
        }
      ]);
    }
  );

  it.skipIf(!environment.env)(
    'rejects invalid estimates, provisional inviters and provenance tampering while allowing the claim transition',
    async () => {
      const { organizer, provisional, eventId } = await fixture();
      const provision = (level: unknown, name = 'Valid Name', inviter = organizer.id) =>
        sqlRejection('select public.provision_provisional_player_locked($1, $2, $3, $4, $5)', [
          provisional.id,
          name,
          level,
          inviter,
          eventId
        ]);
      for (const level of [-0.1, 7.1, 3.55, null])
        expect(await provision(level)).toContain('Invalid provisional player input');
      expect(await provision(3, ' padded ')).toContain('Invalid provisional player input');
      expect(await provision(3, 'Self', provisional.id)).toContain(
        'Invalid provisional player input'
      );

      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Tamper Target',
        estimatedLevel: 2,
        invitedBy: organizer.id,
        sourceEventId: eventId
      });
      // A provisional identity can never invite another provisional player.
      const second = await signUpFixtureActor(environment.env!, 'schema-second');
      expect(
        await sqlRejection(
          'select public.provision_provisional_player_locked($1, $2, $3, $4, $5)',
          [second.id, 'Second', 2, provisional.id, eventId]
        )
      ).toContain('PROVISIONAL_PLAYER_RESTRICTED');

      for (const assignment of [
        'estimated_level = 5',
        "rating_input_source = 'self_declared'",
        `invited_by = ${sqlText(second.id)}`,
        'invited_at = now()',
        'source_match_event_id = null'
      ])
        expect(
          await sqlRejection(
            `update public.player_profiles set ${assignment} where user_id = ${sqlText(provisional.id)}`
          )
        ).toMatch(/Invalid provisional profile transition|player_profile_provenance/);

      // Claim clears only the marker: same UUID, provenance retained.
      await executeTrustedSql(
        `update public.player_profiles set is_provisional = false where user_id = ${sqlText(provisional.id)}`
      );
      expect(
        await sqlRejection(
          `update public.player_profiles set is_provisional = true where user_id = ${sqlText(provisional.id)}`
        )
      ).toContain('Invalid provisional profile transition');
      const claimed = await queryTrustedSql(
        `select is_provisional, rating_input_source, estimated_level, invited_by
         from public.player_profiles where user_id = $1`,
        { values: [provisional.id] }
      );
      expect(claimed.rows).toEqual([
        {
          is_provisional: false,
          rating_input_source: 'creator_estimated',
          estimated_level: '2.0',
          invited_by: organizer.id
        }
      ]);
      // A self-declared profile cannot carry provenance or be provisional.
      expect(
        await sqlRejection(
          `insert into public.player_profiles(user_id,display_name,preferred_side,is_provisional)
           values (${sqlText(second.id)},'Forged','EITHER',true)`
        )
      ).toContain('player_profile_provenance');
    }
  );

  it.skipIf(!environment.env)(
    'creates one active provisional membership per community with provenance and satisfies the members-only rule',
    async () => {
      const {
        organizer,
        provisional,
        regular,
        communityId,
        otherCommunityId,
        eventId,
        otherEventId
      } = await fixture();
      expect(
        await sqlRejection(
          'select public.ensure_provisional_community_membership_locked($1,$2,$3,$4)',
          [communityId, regular.id, organizer.id, eventId]
        )
      ).toContain('PROVISIONAL_PLAYER_REQUIRED');

      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Member Max',
        estimatedLevel: 4,
        invitedBy: organizer.id,
        sourceEventId: eventId
      });
      const first = await ensureProvisionalMembership({
        communityId,
        userId: provisional.id,
        addedBy: organizer.id,
        sourceEventId: eventId
      });
      // Repeated adds reuse the open interval; cross-community adds open a second one.
      expect(
        await ensureProvisionalMembership({
          communityId,
          userId: provisional.id,
          addedBy: organizer.id,
          sourceEventId: eventId
        })
      ).toBe(first);
      const cross = await ensureProvisionalMembership({
        communityId: otherCommunityId,
        userId: provisional.id,
        addedBy: organizer.id,
        sourceEventId: otherEventId
      });
      expect(cross).not.toBe(first);

      const memberships = await queryTrustedSql(
        `select community_id, role, status, valid_until, activated_at is not null as activated,
           added_by, source_match_event_id,
           public.match_registration_is_member(community_id, user_id) as counts_as_member
         from public.community_members where user_id = $1 order by source_match_event_id = $2 desc`,
        { values: [provisional.id, eventId] }
      );
      expect(memberships.rows).toEqual([
        {
          community_id: communityId,
          role: 'member',
          status: 'active',
          valid_until: null,
          activated: true,
          added_by: organizer.id,
          source_match_event_id: eventId,
          counts_as_member: true
        },
        {
          community_id: otherCommunityId,
          role: 'member',
          status: 'active',
          valid_until: null,
          activated: true,
          added_by: organizer.id,
          source_match_event_id: otherEventId,
          counts_as_member: true
        }
      ]);

      // Provisional players never hold management roles.
      expect(
        await sqlRejection(
          `update public.community_members set role = 'admin' where id = ${sqlText(first)}`
        )
      ).toContain('PROVISIONAL_PLAYER_RESTRICTED');
      // Provenance is all-or-nothing.
      expect(
        await sqlRejection(
          `update public.community_members set source_match_event_id = null where id = ${sqlText(first)}`
        )
      ).toContain('membership_add_provenance');

      // A removed membership is never silently reactivated by a later add.
      await executeTrustedSql(
        `update public.community_members set status = 'inactive', valid_until = clock_timestamp() where id = ${sqlText(first)}`
      );
      expect(
        await sqlRejection(
          'select public.ensure_provisional_community_membership_locked($1,$2,$3,$4)',
          [communityId, provisional.id, organizer.id, eventId]
        )
      ).toContain('PROVISIONAL_MEMBERSHIP_CONFLICT');
      const open = await queryTrustedSql(
        `select count(*)::integer as open from public.community_members
         where community_id = $1 and user_id = $2 and valid_until is null`,
        { values: [communityId, provisional.id] }
      );
      expect(open.rows).toEqual([{ open: 0 }]);
    }
  );

  it.skipIf(!environment.env)(
    'keeps provisioning primitives internal and existing players self-declared',
    async () => {
      const { organizer } = await fixture();
      const grants = await queryTrustedSql(
        `select p.proname, r.rolname,
           has_function_privilege(r.rolname, p.oid, 'EXECUTE') as can_execute
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
         where n.nspname = 'public' and p.proname in (
           'provision_provisional_player_locked', 'ensure_provisional_community_membership_locked',
           'initialize_global_player_rating_locked', 'is_provisional_player', 'is_match_event_participant')
           and has_function_privilege(r.rolname, p.oid, 'EXECUTE')
         order by 1, 2`
      );
      // Browser roles never reach the primitives; trusted server code composes them.
      expect(
        grants.rows.filter((row) => row.rolname !== 'service_role'),
        'no browser role may execute provisioning primitives'
      ).toEqual([]);
      const authenticatedColumns = await queryTrustedSql(
        `select column_name from information_schema.column_privileges
         where table_schema = 'public' and table_name in ('player_profiles', 'community_members')
           and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')
           and column_name in ('is_provisional', 'rating_input_source', 'estimated_level', 'invited_by',
             'invited_at', 'source_match_event_id', 'added_by')`
      );
      expect(authenticatedColumns.rows).toEqual([]);
      const organizerProfile = await queryTrustedSql(
        `select is_provisional, rating_input_source, estimated_level from public.player_profiles where user_id = $1`,
        { values: [organizer.id] }
      );
      expect(organizerProfile.rows).toEqual([
        { is_provisional: false, rating_input_source: 'self_declared', estimated_level: null }
      ]);
    }
  );
});
