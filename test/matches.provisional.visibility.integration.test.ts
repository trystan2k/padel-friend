import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import { createMatchResultReviewFixtures } from './helpers/match-result-review-fixtures';
import {
  ensureProvisionalMembership,
  insertAcceptedRegistration,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText,
  type ProvisionalFixtureActor
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const PRIVATE_KEYS = /email|invited_by|invited_at|estimated_level|source_match_event_id|added_by/;

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          typeof item === 'object' && item !== null && !Array.isArray(item)
      )
    : [];
}

async function canRead(actor: ProvisionalFixtureActor, eventId: string): Promise<boolean> {
  const result = await actor.client.rpc('can_read_match_event', { p_event_id: eventId });
  expect(result.error).toBeNull();
  return result.data === true;
}

describe('provisional player visibility and projections', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'grants accepted/played participants history access independent of membership while denying outsiders',
    async () => {
      const env = environment.env!;
      const [organizer, formerPlayer, formerMember, stranger, invited, provisional] =
        await Promise.all([
          signUpFixtureActor(env, 'vis-organizer', { displayName: 'Vis Organizer', level: 4 }),
          signUpFixtureActor(env, 'vis-former-player', { displayName: 'Former Player', level: 3 }),
          signUpFixtureActor(env, 'vis-former-member', { displayName: 'Former Member', level: 3 }),
          signUpFixtureActor(env, 'vis-stranger', { displayName: 'Stranger', level: 3 }),
          signUpFixtureActor(env, 'vis-invited', { displayName: 'Invited', level: 3 }),
          signUpFixtureActor(env, 'vis-provisional')
        ]);
      const communityId = crypto.randomUUID();
      const pastEventId = crypto.randomUUID();
      const inviteOnlyEventId = crypto.randomUUID();
      await insertFixtureCommunity({
        id: communityId,
        visibility: 'private',
        adminId: organizer.id,
        memberIds: [formerPlayer.id, formerMember.id, invited.id]
      });
      await insertFixtureEvent({
        id: pastEventId,
        communityId,
        creatorId: organizer.id,
        visibility: 'community_open',
        past: true
      });
      await insertFixtureEvent({
        id: inviteOnlyEventId,
        communityId,
        creatorId: organizer.id,
        visibility: 'invite_only'
      });
      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Provisional Vic',
        estimatedLevel: 3.3,
        invitedBy: organizer.id,
        sourceEventId: pastEventId
      });
      await ensureProvisionalMembership({
        communityId,
        userId: provisional.id,
        addedBy: organizer.id,
        sourceEventId: pastEventId
      });
      await insertAcceptedRegistration(pastEventId, formerPlayer.id);
      await insertAcceptedRegistration(pastEventId, provisional.id);
      await insertAcceptedRegistration(inviteOnlyEventId, provisional.id);

      // Members still in the community read the closed private event.
      expect(await canRead(formerPlayer, pastEventId)).toBe(true);
      expect(await canRead(formerMember, pastEventId)).toBe(true);
      // Memberships end: only accepted/played participation keeps the history.
      await executeTrustedSql(`update public.community_members set status='inactive', valid_until=clock_timestamp()
        where community_id=${sqlText(communityId)} and user_id in (${[formerPlayer.id, formerMember.id, provisional.id].map(sqlText).join(',')})`);
      expect(await canRead(formerPlayer, pastEventId)).toBe(true);
      expect(await canRead(formerMember, pastEventId)).toBe(false);
      expect(await canRead(stranger, pastEventId)).toBe(false);
      // Invite-only stays private to non-participant members.
      expect(await canRead(invited, inviteOnlyEventId)).toBe(false);

      // The provisional session itself cannot browse before claim.
      expect(await canRead(provisional, pastEventId)).toBe(false);
      expect(await canRead(provisional, inviteOnlyEventId)).toBe(false);
      // Claim (marker cleared, same UUID) reveals past and future private events.
      await executeTrustedSql(
        `update public.player_profiles set is_provisional=false where user_id=${sqlText(provisional.id)}`
      );
      expect(await canRead(provisional, pastEventId)).toBe(true);
      expect(await canRead(provisional, inviteOnlyEventId)).toBe(true);
      const past = await provisional.client.rpc('list_match_events', {
        p_entry: 'past',
        p_community_id: communityId,
        p_cursor: '',
        p_limit: 20,
        p_as_of: new Date().toISOString()
      });
      expect(past.error).toBeNull();
      expect(records(past.data).map((row) => row.event_id)).toEqual([pastEventId]);

      const anonymous = createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const anonymousRead = await anonymous.rpc('can_read_match_event', {
        p_event_id: pastEventId
      });
      expect(anonymousRead.data === true).toBe(false);
    }
  );

  it.skipIf(!environment.env)(
    'exposes the provisional badge flag on roster, management, request and result team projections without private provenance',
    async () => {
      const f = await createMatchResultReviewFixtures(environment.env!);
      const onboard = await f.creator.client.rpc('onboard_player', {
        p_display_name: 'Result Organizer',
        p_preferred_side: 'EITHER',
        p_initial_level: 4
      });
      expect(onboard.error).toBeNull();
      const eventId = await f.protectedEvent();
      const provisional = f.players[1]!;
      const teammate = f.players[2]!;
      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Provisional Pia',
        estimatedLevel: 3.4,
        invitedBy: f.creator.id,
        sourceEventId: eventId
      });

      const roster = await teammate.client.rpc('list_match_event_registrations', {
        p_match_event_id: eventId
      });
      expect(roster.error).toBeNull();
      const rosterRows = records(roster.data);
      expect(rosterRows.filter((row) => row.is_provisional)).toEqual([
        expect.objectContaining({ display_name: 'Provisional Pia', is_provisional: true })
      ]);
      expect(rosterRows.every((row) => typeof row.is_provisional === 'boolean')).toBe(true);
      expect(JSON.stringify(roster.data)).not.toMatch(PRIVATE_KEYS);

      const management = await f.creator.client.rpc('list_match_event_management_participants', {
        p_match_event_id: eventId
      });
      expect(management.error).toBeNull();
      expect(
        Object.fromEntries(
          records(management.data).map((row) => [String(row.user_id), row.is_provisional])
        )
      ).toEqual(
        Object.fromEntries(f.players.map((player) => [player.id, player.id === provisional.id]))
      );
      expect(JSON.stringify(management.data)).not.toMatch(PRIVATE_KEYS);

      const submitted = await f.submit(eventId);
      expect(submitted.error).toBeNull();
      const proposals = await teammate.client.rpc('get_match_event_result_proposals', {
        p_match_event_id: eventId
      });
      expect(proposals.error).toBeNull();
      const [proposal] = records(proposals.data);
      const teams = records([proposal?.teams])[0] ?? {};
      const teamPlayers = [...records(teams.team_a), ...records(teams.team_b)];
      expect(
        Object.fromEntries(
          teamPlayers.map((player) => [String(player.user_id), player.is_provisional])
        )
      ).toEqual(
        Object.fromEntries(
          f.players.slice(0, 4).map((player) => [player.id, player.id === provisional.id])
        )
      );
      expect(JSON.stringify(proposals.data)).not.toMatch(PRIVATE_KEYS);

      // Pending request queue for an open event carries the same flag.
      const openEvent = await f.event({ restricted: true });
      await executeTrustedSql(`do $$ begin
        insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source)
          values (${sqlText(openEvent.id)},${sqlText(provisional.id)},'pending',now(),'member');
        insert into public.match_event_registration_attempts(registration_id,match_event_id,user_id,requested_at,outcome,registration_source)
          select id,match_event_id,user_id,requested_at,'pending',registration_source from public.match_event_registrations
          where match_event_id=${sqlText(openEvent.id)} and user_id=${sqlText(provisional.id)};
        update public.match_event_registrations r set current_attempt_id=a.id from public.match_event_registration_attempts a
          where a.registration_id=r.id and r.match_event_id=${sqlText(openEvent.id)} and r.user_id=${sqlText(provisional.id)};
      end $$;`);
      const queue = await f.creator.client.rpc('list_match_event_registration_requests', {
        p_match_event_id: openEvent.id
      });
      expect(queue.error).toBeNull();
      const [queueRow] = records(queue.data);
      expect(queueRow?.requests).toEqual([
        expect.objectContaining({ user_id: provisional.id, is_provisional: true })
      ]);
      expect(JSON.stringify(queue.data)).not.toMatch(PRIVATE_KEYS);
    }
  );
});
