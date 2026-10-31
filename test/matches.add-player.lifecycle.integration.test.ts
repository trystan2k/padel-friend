import { describe, expect, it } from 'vitest';
import { addPlayer, authUsersByEmail, uniqueEmail } from './helpers/match-add-player-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  signUpFixtureActor
} from './helpers/provisional-player-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

// Lifecycle commands operate on registration rows; a provisional registration
// created by the add command must behave exactly like any other one.
async function scenario() {
  const env = environment.env!;
  const [owner, regular] = await Promise.all([
    signUpFixtureActor(env, 'life-owner', { displayName: 'Life Owner', level: 4 }),
    signUpFixtureActor(env, 'life-regular', { displayName: 'Life Regular', level: 4 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'private',
    adminId: owner.id,
    memberIds: [regular.id]
  });
  await insertFixtureEvent({
    id: eventId,
    communityId,
    creatorId: owner.id,
    visibility: 'community_open'
  });
  expect(
    (await regular.client.rpc('submit_match_registration', { p_match_event_id: eventId })).error
  ).toBeNull();
  const email = uniqueEmail('life');
  const { result } = await addPlayer(env, owner, {
    eventId,
    displayName: 'Life Prov',
    email,
    level: 3
  });
  expect(result).toEqual({ status: 'ok' });
  const [user] = await authUsersByEmail(email);
  return { env, owner, regular, eventId, email, provisionalId: String(user!.id) };
}

async function lifecycle(eventId: string, userId: string) {
  const result = await queryTrustedSql(
    `select lifecycle from public.match_event_registrations where match_event_id = $1 and user_id = $2`,
    { values: [eventId, userId] }
  );
  return result.rows[0]?.lifecycle;
}

describe('lifecycle commands on provisional registrations', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'removes a provisional player and re-adds the same identity',
    async () => {
      const { env, owner, eventId, email, provisionalId } = await scenario();
      const participants = await owner.client.rpc('list_match_event_management_participants', {
        p_match_event_id: eventId
      });
      const rows: unknown[] = Array.isArray(participants.data) ? participants.data : [];
      const target = rows.find(
        (row) =>
          typeof row === 'object' && row !== null && Reflect.get(row, 'user_id') === provisionalId
      );
      expect(target).toMatchObject({ is_provisional: true, lifecycle: 'accepted' });
      const removal = await owner.client.rpc('remove_match_registration', {
        p_match_event_id: eventId,
        p_target_user_id: provisionalId,
        p_attempt_id: String(
          typeof target === 'object' && target !== null ? Reflect.get(target, 'attempt_id') : ''
        ),
        p_reason: 'Swapped player',
        p_request_id: crypto.randomUUID()
      });
      expect(removal.error).toBeNull();
      expect(await lifecycle(eventId, provisionalId)).toBe('removed_by_creator');

      const { result } = await addPlayer(env, owner, {
        eventId,
        displayName: 'Ignored Rename',
        email,
        level: 6
      });
      expect(result).toEqual({ status: 'ok' });
      expect(await authUsersByEmail(email)).toHaveLength(1);
      expect(await lifecycle(eventId, provisionalId)).toBe('accepted');
    }
  );

  it.skipIf(!environment.env)(
    'transfers ownership of a roster with a provisional player to a regular participant',
    async () => {
      const { env, owner, regular, eventId, provisionalId } = await scenario();
      const transfer = await owner.client.rpc('transfer_match_event_ownership', {
        p_match_event_id: eventId,
        p_target_user_id: regular.id,
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(transfer.error).toBeNull();
      expect(transfer.data).toMatchObject({ owner_id: regular.id, changed: true });
      expect(await lifecycle(eventId, provisionalId)).toBe('accepted');
      // The new owner manages additions; the provisional roster entry is untouched.
      const { result } = await addPlayer(env, regular, {
        eventId,
        displayName: 'After Transfer',
        email: uniqueEmail('life-transfer'),
        level: 2
      });
      expect(result).toEqual({ status: 'ok' });
    }
  );

  it.skipIf(!environment.env)(
    'cancels a match whose roster contains a provisional player',
    async () => {
      const { owner, eventId, provisionalId } = await scenario();
      const cancel = await owner.client.rpc('cancel_match_event', {
        p_match_event_id: eventId,
        p_reason: 'Court closed',
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(cancel.error).toBeNull();
      const state = await queryTrustedSql(`select status from public.match_events where id = $1`, {
        values: [eventId]
      });
      expect(state.rows).toEqual([{ status: 'cancelled' }]);
      const evidence = await queryTrustedSql(
        `select count(*)::int as count from public.match_event_registration_attempts
        where match_event_id = $1 and user_id = $2 and outcome = 'accepted'`,
        { values: [eventId, provisionalId] }
      );
      expect(evidence.rows).toEqual([{ count: 1 }]);
    }
  );
});
