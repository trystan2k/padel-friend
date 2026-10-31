import { describe, expect, it } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  ensureProvisionalMembership,
  insertAcceptedRegistration,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

// SQL-language readers gate every row on these provisional-aware predicates,
// so they need no injected statement of their own.
const PREDICATE_GATED_READERS = [
  'can_read_community',
  'can_read_match_event',
  'get_match_creation_options',
  'get_match_event',
  'is_community_admin',
  'is_community_member',
  'is_provisional_actor',
  'list_match_events',
  'search_match_invitees'
];

async function scenario() {
  const env = environment.env!;
  const [organizer, provisional, regular] = await Promise.all([
    signUpFixtureActor(env, 'authz-organizer', { displayName: 'Authz Organizer', level: 4 }),
    signUpFixtureActor(env, 'authz-provisional'),
    signUpFixtureActor(env, 'authz-regular', { displayName: 'Authz Regular', level: 3.5 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'public',
    adminId: organizer.id,
    memberIds: [regular.id]
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
  await ensureProvisionalMembership({
    communityId,
    userId: provisional.id,
    addedBy: organizer.id,
    sourceEventId: eventId
  });
  await insertAcceptedRegistration(eventId, provisional.id);
  await insertAcceptedRegistration(eventId, regular.id);
  return { organizer, provisional, regular, communityId, eventId };
}

function expectRestricted(result: { error: { code: string; message: string } | null }): void {
  expect(result.error).toMatchObject({
    code: '42501',
    message: 'PROVISIONAL_PLAYER_RESTRICTED'
  });
}

describe('provisional actor authorization', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'rejects every action and read from a provisional session in SQL while regular members keep access',
    async () => {
      const { organizer, provisional, regular, communityId, eventId } = await scenario();
      const requestId = crypto.randomUUID();
      const attempt = await queryTrustedSql(
        `select id from public.match_event_registration_attempts where match_event_id = $1 and user_id = $2`,
        { values: [eventId, provisional.id] }
      );
      const attemptId = String(attempt.rows[0]?.id);

      expectRestricted(
        await provisional.client.rpc('submit_match_registration', {
          p_match_event_id: eventId
        })
      );
      expectRestricted(
        await provisional.client.rpc('withdraw_match_registration', {
          p_match_event_id: eventId,
          p_attempt_id: attemptId,
          p_request_id: requestId
        })
      );
      expectRestricted(
        await provisional.client.rpc('onboard_player', {
          p_display_name: 'Self Claim',
          p_preferred_side: 'LEFT',
          p_initial_level: 6
        })
      );
      expectRestricted(
        await provisional.client.rpc('create_community', {
          p_name: 'Provisional community',
          p_visibility: 'public',
          p_join_policy: 'instant'
        })
      );
      expectRestricted(
        await provisional.client.rpc('leave_community', { p_community_id: communityId })
      );
      expectRestricted(await provisional.client.rpc('count_my_unread_notifications'));
      expectRestricted(
        await provisional.client.rpc('get_my_match_registration', {
          p_match_event_id: eventId
        })
      );
      expectRestricted(
        await provisional.client.rpc('list_match_event_registrations', {
          p_match_event_id: eventId
        })
      );
      expectRestricted(
        await provisional.client.rpc('get_match_event_result_proposals', {
          p_match_event_id: eventId
        })
      );

      // Predicate-gated readers and direct table access see nothing.
      const predicates = await Promise.all([
        provisional.client.rpc('is_community_member', { p_community_id: communityId }),
        provisional.client.rpc('can_read_community', { p_community_id: communityId }),
        provisional.client.rpc('can_read_match_event', { p_event_id: eventId })
      ]);
      expect(predicates.map(({ data, error }) => ({ data, error }))).toEqual(
        Array.from({ length: 3 }, () => ({ data: false, error: null }))
      );
      const list = await provisional.client.rpc('list_match_events', {
        p_entry: 'my',
        p_community_id: communityId,
        p_cursor: '',
        p_limit: 20,
        p_as_of: new Date().toISOString()
      });
      expect(list.error).toBeNull();
      expect(list.data).toEqual([]);
      for (const [table, column] of [
        ['player_profiles', 'user_id'],
        ['global_player_ratings', 'user_id'],
        ['community_members', 'id'],
        ['communities', 'id']
      ] as const) {
        const rows = await provisional.client.from(table).select(column);
        expect({ table, data: rows.data, error: rows.error }).toEqual({
          table,
          data: [],
          error: null
        });
      }
      const update = await provisional.client
        .from('player_profiles')
        .update({ display_name: 'Hijacked' })
        .eq('user_id', provisional.id)
        .select('display_name');
      expect(update.data ?? []).toEqual([]);
      const avatar = await provisional.client.storage
        .from('player-avatars')
        .upload(
          `${provisional.id}/${crypto.randomUUID()}.webp`,
          new Blob(['x'], { type: 'image/webp' }),
          {
            contentType: 'image/webp'
          }
        );
      expect(avatar.error).not.toBeNull();
      const stored = await queryTrustedSql(
        `select display_name from public.player_profiles where user_id = $1`,
        { values: [provisional.id] }
      );
      expect(stored.rows).toEqual([{ display_name: 'Restricted Rae' }]);

      // Regular members and the organizer are unaffected and still see the provisional target.
      const regularCount = await regular.client.rpc('count_my_unread_notifications');
      expect(regularCount.error).toBeNull();
      const regularMember = await regular.client.rpc('is_community_member', {
        p_community_id: communityId
      });
      expect(regularMember.data).toBe(true);
      const regularUpdate = await regular.client
        .from('player_profiles')
        .update({ bio: 'Still allowed' })
        .eq('user_id', regular.id)
        .select('bio');
      expect(regularUpdate.data).toEqual([{ bio: 'Still allowed' }]);
      const regularAvatar = await regular.client.storage
        .from('player-avatars')
        .upload(
          `${regular.id}/${crypto.randomUUID()}.webp`,
          new Blob(['x'], { type: 'image/webp' }),
          {
            contentType: 'image/webp'
          }
        );
      expect(regularAvatar.error).toBeNull();
      const roster = await organizer.client.rpc('list_match_event_management_participants', {
        p_match_event_id: eventId
      });
      expect(roster.error).toBeNull();
      expect(roster.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: provisional.id, is_provisional: true })
        ])
      );
    }
  );

  it.skipIf(!environment.env)(
    'never transfers event ownership to a provisional participant',
    async () => {
      const { organizer, provisional, regular, eventId } = await scenario();
      const toProvisional = await organizer.client.rpc('transfer_match_event_ownership', {
        p_match_event_id: eventId,
        p_target_user_id: provisional.id,
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(toProvisional.error?.message).toBe('MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED');
      const toRegular = await organizer.client.rpc('transfer_match_event_ownership', {
        p_match_event_id: eventId,
        p_target_user_id: regular.id,
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(toRegular.error).toBeNull();
      expect(toRegular.data).toMatchObject({ owner_id: regular.id, changed: true });
    }
  );

  it.skipIf(!environment.env)(
    'guards every authenticated SECURITY DEFINER entry point against provisional actors',
    async () => {
      const inventory = await queryTrustedSql(
        `select p.proname,
           position('assert_actor_not_provisional' in pg_get_functiondef(p.oid)) > 0 as guarded
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.prosecdef and p.provolatile <> 'i' and p.prokind = 'f'
           and p.prorettype <> 'trigger'::regtype
           and has_function_privilege('authenticated', p.oid, 'EXECUTE')
         order by 1`
      );
      const unguarded = inventory.rows
        .filter((row) => !row.guarded)
        .map((row) => String(row.proname));
      expect(unguarded).toEqual(PREDICATE_GATED_READERS);
      expect(inventory.rows.length).toBeGreaterThan(PREDICATE_GATED_READERS.length);

      const tables = await queryTrustedSql(
        `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
           and (has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
             or has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE'))
           and not exists (select 1 from pg_policies p where p.schemaname = 'public'
             and p.tablename = c.relname and p.policyname = 'provisional actor restricted'
             and p.permissive = 'RESTRICTIVE')`
      );
      expect(tables.rows).toEqual([]);
    }
  );
});
