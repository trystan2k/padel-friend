import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  authUsersByEmail,
  localAdminClient,
  mailFor,
  uniqueEmail
} from './helpers/match-add-player-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  addInvitedPlayer,
  authenticationMethods,
  CLAIM_PROFILE,
  claimAudits,
  claimScenario,
  profileState,
  recoverySession,
  sessionClient,
  verifyInvitation
} from './helpers/provisional-claim-fixtures';
import {
  insertAcceptedRegistration,
  insertFixtureEvent,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function memberships(userId: string) {
  const result = await queryTrustedSql(
    `select id, community_id, status, role, added_by, source_match_event_id, valid_until
       from public.community_members where user_id = $1 order by id`,
    { values: [userId] }
  );
  return result.rows;
}

async function registrations(userId: string) {
  const result = await queryTrustedSql(
    `select id, match_event_id, lifecycle from public.match_event_registrations
      where user_id = $1 order by match_event_id`,
    { values: [userId] }
  );
  return result.rows;
}

describe('provisional claim', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'invite link: verified session claims the same identity with prefill, audit and full history',
    async () => {
      const scenario = await claimScenario(environment.env!);
      const { env, owner, communityId, eventId } = scenario;
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Claim Carla',
        level: 3.5,
        label: 'invite'
      });
      // Past and future private events the player participates in, plus one they do not.
      const pastId = crypto.randomUUID();
      const futureId = crypto.randomUUID();
      const strangerEventId = crypto.randomUUID();
      await insertFixtureEvent({
        id: pastId,
        communityId,
        creatorId: owner.id,
        visibility: 'invite_only',
        past: true
      });
      await insertFixtureEvent({
        id: futureId,
        communityId,
        creatorId: owner.id,
        visibility: 'invite_only'
      });
      await insertFixtureEvent({
        id: strangerEventId,
        communityId,
        creatorId: owner.id,
        visibility: 'invite_only'
      });
      await insertAcceptedRegistration(pastId, player.id);
      await insertAcceptedRegistration(futureId, player.id);
      const membershipsBefore = await memberships(player.id);
      const registrationsBefore = await registrations(player.id);
      expect(membershipsBefore).toHaveLength(1);

      // The invitation hash verifies once and yields the provisional identity's own session.
      const verified = await verifyInvitation(env, player.tokenHash);
      expect(verified.error).toBeNull();
      expect(verified.data.user?.id).toBe(player.id);
      // Auth reports email-verified sign-ins (invite, recovery, magic link) as one-time-passcode proof.
      expect(authenticationMethods(verified.data.session!)).toContain('otp');
      const client = sessionClient(env, verified.data.session!);
      const replay = await verifyInvitation(env, player.tokenHash);
      expect(replay.error).not.toBeNull();
      expect(replay.data.session).toBeNull();

      // Restricted surface: prefill is readable, everything else stays blocked.
      expect((await client.rpc('get_provisional_claim_context')).data).toEqual({
        state: 'ready',
        display_name: 'Claim Carla',
        initial_level: 3.5,
        can_edit_level: true,
        match_count: 3
      });
      expect((await client.rpc('count_my_unread_notifications')).error?.message).toBe(
        'PROVISIONAL_PLAYER_RESTRICTED'
      );
      for (const id of [eventId, pastId, futureId])
        expect((await client.rpc('can_read_match_event', { p_event_id: id })).data).toBe(false);
      expect((await client.from('player_profiles').select('user_id')).data).toEqual([]);

      const claimed = await client.rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_dominant_hand: 'RIGHT',
        p_bio: 'Ready to play'
      });
      expect(claimed.error).toBeNull();

      // The claim leaves the invite-link claimant passwordless; the post-claim step sets one
      // from the surviving verified session and password sign-in then works.
      expect(
        (
          await createClient(env.url, env.key, {
            auth: { persistSession: false, autoRefreshToken: false }
          }).auth.signInWithPassword({ email: player.email, password: 'Claimed-Pass-1!' })
        ).error
      ).not.toBeNull();
      const browser = createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      expect(
        (
          await browser.auth.setSession({
            access_token: verified.data.session!.access_token,
            refresh_token: verified.data.session!.refresh_token
          })
        ).error
      ).toBeNull();
      expect((await browser.auth.updateUser({ password: 'Claimed-Pass-1!' })).error).toBeNull();
      const passwordLogin = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signInWithPassword({ email: player.email, password: 'Claimed-Pass-1!' });
      expect(passwordLogin.error).toBeNull();
      expect(passwordLogin.data.user?.id).toBe(player.id);

      // Same identity: marker cleared, level edited (unrated), provenance preserved.
      expect(await profileState(player.id)).toMatchObject({
        is_provisional: false,
        display_name: 'Claimed Carla',
        preferred_side: 'LEFT',
        rating_input_source: 'creator_estimated',
        estimated_level: 3.5,
        initial_level: 4.2,
        mu: 4.2,
        display_level: 4.2,
        highest_level: 4.2
      });
      expect((await authUsersByEmail(player.email)).map((user) => user.id)).toEqual([player.id]);
      // Memberships and registrations are the very same rows.
      expect(await memberships(player.id)).toEqual(membershipsBefore);
      expect(await registrations(player.id)).toEqual(registrationsBefore);
      // One audit anchor on the originating event, claimer as actor.
      expect(await claimAudits(player.id)).toEqual([
        expect.objectContaining({
          match_event_id: eventId,
          actor_id: player.id,
          community_id: communityId,
          after_data: { level_locked: false }
        })
      ]);

      // Full history is visible right away on the existing session; strangers' events are not.
      for (const id of [eventId, pastId, futureId])
        expect((await client.rpc('can_read_match_event', { p_event_id: id })).data).toBe(true);
      expect((await client.rpc('can_read_match_event', { p_event_id: strangerEventId })).data).toBe(
        false
      );
      expect((await client.from('player_profiles').select('display_name')).data).toEqual([
        { display_name: 'Claimed Carla' }
      ]);
      expect((await client.rpc('count_my_unread_notifications')).error).toBeNull();
      // Roster projections stop flagging the player.
      const roster = await owner.client.rpc('list_match_event_management_participants', {
        p_match_event_id: eventId
      });
      expect(roster.data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ user_id: player.id, is_provisional: false })
        ])
      );
      // The context endpoint reports nothing once claimed.
      expect((await client.rpc('get_provisional_claim_context')).data).toEqual({ state: 'none' });

      // Double claim is rejected without a second audit or any change.
      const again = await client.rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_display_name: 'Hijack'
      });
      expect(again.error?.message).toBe('PROVISIONAL_CLAIM_NOT_PENDING');
      expect((await profileState(player.id))?.display_name).toBe('Claimed Carla');
      expect(await claimAudits(player.id)).toHaveLength(1);
    }
  );

  it.skipIf(!environment.env)('concurrent claims serialize: exactly one wins', async () => {
    const scenario = await claimScenario(environment.env!, 'claim-race');
    const player = await addInvitedPlayer(scenario, {
      displayName: 'Race Rita',
      level: 3,
      label: 'race'
    });
    const verified = await verifyInvitation(scenario.env, player.tokenHash);
    const client = sessionClient(scenario.env, verified.data.session!);
    const results = await Promise.all(
      Array.from({ length: 4 }, () => client.rpc('claim_provisional_player', CLAIM_PROFILE))
    );
    expect(results.filter((result) => result.error === null)).toHaveLength(1);
    for (const result of results.filter((candidate) => candidate.error !== null))
      expect(result.error?.message).toBe('PROVISIONAL_CLAIM_NOT_PENDING');
    expect(await claimAudits(player.id)).toHaveLength(1);
  });

  it.skipIf(!environment.env)(
    'rated history locks the initial level while name and side stay editable',
    async () => {
      const scenario = await claimScenario(environment.env!, 'claim-rated');
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Rated Rui',
        level: 5,
        label: 'rated'
      });
      await executeTrustedSql(
        `update public.global_player_ratings set confirmed_competitive_game_groups = 2,
           last_rating_at = now(), mu = 5.4, display_level = 5.4, highest_display_level = 5.4
          where user_id = ${sqlText(player.id)}`
      );
      const client = sessionClient(
        scenario.env,
        (await verifyInvitation(scenario.env, player.tokenHash)).data.session!
      );
      expect((await client.rpc('get_provisional_claim_context')).data).toMatchObject({
        state: 'ready',
        initial_level: 5,
        can_edit_level: false
      });
      const locked = await client.rpc('claim_provisional_player', CLAIM_PROFILE);
      expect(locked.error?.message).toBe('PROVISIONAL_CLAIM_LEVEL_LOCKED');
      expect((await profileState(player.id))?.is_provisional).toBe(true);

      const ok = await client.rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_initial_level: 5
      });
      expect(ok.error).toBeNull();
      expect(await profileState(player.id)).toMatchObject({
        is_provisional: false,
        display_name: 'Claimed Carla',
        initial_level: 5,
        mu: 5.4,
        display_level: 5.4
      });
      expect(await claimAudits(player.id)).toEqual([
        expect.objectContaining({ after_data: { level_locked: true } })
      ]);
    }
  );

  it.skipIf(!environment.env)(
    'rejects claims without mailbox proof, for the wrong identity or on a changed address',
    async () => {
      const scenario = await claimScenario(environment.env!, 'claim-denied');
      const { env } = scenario;
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Denied Dan',
        level: 3,
        label: 'denied'
      });
      const other = await addInvitedPlayer(scenario, {
        displayName: 'Other Olga',
        level: 3,
        label: 'other'
      });

      // Unverified signup against the invited address: the stack hands back a session for
      // the same identity (local Auth autoconfirm), but a password session proves nothing.
      const squatter = createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const signup = await squatter.auth.signUp({ email: player.email, password: 'Squatter123!' });
      expect(signup.error).toBeNull();
      expect(signup.data.user?.id).toBe(player.id);
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      expect(authenticationMethods(signup.data.session!)).toEqual(['password']);
      const squatting = sessionClient(env, signup.data.session!);
      expect((await squatting.rpc('get_provisional_claim_context')).data).toEqual({
        state: 'unverified'
      });
      expect((await squatting.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message).toBe(
        'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED'
      );
      expect((await profileState(player.id))?.is_provisional).toBe(true);

      // A regular player and another provisional session can only ever act on themselves.
      const regular = await signUpFixtureActor(env, 'claim-regular', {
        displayName: 'Regular Rob',
        level: 3
      });
      expect(
        (await regular.client.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message
      ).toBe('PROVISIONAL_CLAIM_NOT_PENDING');
      expect((await regular.client.rpc('get_provisional_claim_context')).data).toEqual({
        state: 'none'
      });
      const otherClient = sessionClient(
        env,
        (await verifyInvitation(env, other.tokenHash)).data.session!
      );
      expect(
        (
          await otherClient.rpc('claim_provisional_player', {
            ...CLAIM_PROFILE,
            p_display_name: 'Only Olga'
          })
        ).error
      ).toBeNull();
      expect((await profileState(other.id))?.display_name).toBe('Only Olga');
      expect(await profileState(player.id)).toMatchObject({
        is_provisional: true,
        display_name: 'Denied Dan'
      });

      // Anonymous callers get nothing.
      const anonymous = createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      expect((await anonymous.rpc('get_provisional_claim_context')).error).not.toBeNull();
      expect((await anonymous.rpc('claim_provisional_player', CLAIM_PROFILE)).error).not.toBeNull();

      // Changing the address after the invite never transfers the claim to another mailbox.
      const mover = await addInvitedPlayer(scenario, {
        displayName: 'Mover Max',
        level: 3,
        label: 'mover'
      });
      const verified = await verifyInvitation(env, mover.tokenHash);
      const client = sessionClient(env, verified.data.session!);
      expect((await client.rpc('get_provisional_claim_context')).data).toMatchObject({
        state: 'ready'
      });
      const moved = uniqueEmail('moved');
      await executeTrustedSql(
        `update auth.users set email = ${sqlText(moved)} where id = ${sqlText(mover.id)}`
      );
      expect((await client.rpc('get_provisional_claim_context')).data).toEqual({
        state: 'unverified'
      });
      expect((await client.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message).toBe(
        'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED'
      );
      expect((await profileState(mover.id))?.is_provisional).toBe(true);
      expect(await claimAudits(mover.id)).toHaveLength(0);
    }
  );

  it.skipIf(!environment.env)(
    'claim drops pending email changes and revokes tokens captured before it',
    async () => {
      const scenario = await claimScenario(environment.env!, 'claim-revoke');
      const { env } = scenario;
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Revoke Rex',
        level: 3,
        label: 'revoke'
      });
      // Attacker session on the provisional identity (local autoconfirm signup) plus a
      // pending email change toward an address the claimant never proved.
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({ email: player.email, password: 'Squatter123!' });
      expect(signup.data.session).not.toBeNull();
      const stale = sessionClient(env, signup.data.session!);
      await executeTrustedSql(
        `update auth.users set email_change = 'attacker@test.local', email_change_token_new = ${sqlText(crypto.randomUUID())},
           email_change_sent_at = now() where id = ${sqlText(player.id)}`
      );
      expect((await stale.rpc('count_my_unread_notifications')).error?.message).toBe(
        'PROVISIONAL_PLAYER_RESTRICTED'
      );

      // The squatter's signup consumed the invite link; the owner proves the mailbox by recovery.
      const client = sessionClient(env, (await recoverySession(env, player.email)).session);
      expect((await client.rpc('claim_provisional_player', CLAIM_PROFILE)).error).toBeNull();

      const user = await queryTrustedSql(
        `select email_change, email_change_token_new from auth.users where id = $1`,
        { values: [player.id] }
      );
      expect(user.rows).toEqual([{ email_change: '', email_change_token_new: '' }]);

      // The stateless pre-claim token must not gain the claimed player's normal access.
      expect((await stale.rpc('count_my_unread_notifications')).error?.message).toBe(
        'PROVISIONAL_PLAYER_RESTRICTED'
      );
      expect((await stale.rpc('can_read_match_event', { p_event_id: scenario.eventId })).data).toBe(
        false
      );
      expect((await stale.from('player_profiles').select('user_id')).data).toEqual([]);
      // The claimant's own session keeps working.
      expect((await client.rpc('count_my_unread_notifications')).error).toBeNull();
      expect(
        (await client.rpc('can_read_match_event', { p_event_id: scenario.eventId })).data
      ).toBe(true);
    }
  );

  it.skipIf(!environment.env)(
    'rejects forged and replayed add capabilities when identities are created',
    async () => {
      const scenario = await claimScenario(environment.env!, 'claim-capability');
      const admin = localAdminClient(scenario.env);
      const forged = await admin.auth.admin.createUser({
        email: uniqueEmail('forged'),
        user_metadata: { padel_add_capability: 'forged-capability' }
      });
      expect(forged.error).not.toBeNull();

      // A real capability works once, only for its own address, and never again.
      const email = uniqueEmail('capability');
      const requestId = crypto.randomUUID();
      const added = await scenario.owner.client.rpc('add_match_player', {
        p_match_event_id: scenario.eventId,
        p_display_name: 'Capable Cy',
        p_email: email,
        p_estimated_level: 3,
        p_locale: 'en',
        p_request_id: requestId
      });
      expect(added.error).toBeNull();
      const dispatched = await admin.rpc('dispatch_match_player_add', {
        p_actor_id: scenario.owner.id,
        p_match_event_id: scenario.eventId,
        p_request_id: requestId
      });
      const capability = String(Reflect.get(Object(dispatched.data), 'capability'));
      expect(capability).toHaveLength(64);
      const wrongAddress = await admin.auth.admin.createUser({
        email: uniqueEmail('capability-other'),
        user_metadata: { padel_add_capability: capability }
      });
      expect(wrongAddress.error).not.toBeNull();
      const created = await admin.auth.admin.createUser({
        email,
        user_metadata: { padel_add_capability: capability }
      });
      expect(created.error).toBeNull();
      expect((await profileState(created.data.user!.id))?.is_provisional).toBe(true);
      const replayed = await admin.auth.admin.createUser({
        email: uniqueEmail('capability-replay'),
        user_metadata: { padel_add_capability: capability }
      });
      expect(replayed.error).not.toBeNull();
      // The capability was scrubbed from the identity and a plain signup never gets a profile.
      expect((await authUsersByEmail(email))[0]?.raw_user_meta_data).not.toHaveProperty(
        'padel_add_capability'
      );
    }
  );

  it.skipIf(!environment.env)(
    'email/password: signup against the invited address keeps one identity and claims only after recovery verification',
    async () => {
      const scenario = await claimScenario(environment.env!, 'claim-password');
      const { env } = scenario;
      const player = await addInvitedPlayer(scenario, {
        displayName: 'Pass Pia',
        level: 2.5,
        label: 'password'
      });

      const attacker = createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const signup = await attacker.auth.signUp({ email: player.email, password: 'Password123!' });
      expect(signup.error).toBeNull();
      expect(signup.data.user?.id).toBe(player.id);
      // The unverified session may set a password on the provisional identity.
      expect((await attacker.auth.updateUser({ password: 'Password123!' })).error).toBeNull();
      expect((await authUsersByEmail(player.email)).map((user) => user.id)).toEqual([player.id]);
      const unverified = sessionClient(env, signup.data.session!);
      expect((await unverified.rpc('claim_provisional_player', CLAIM_PROFILE)).error?.message).toBe(
        'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED'
      );

      // Recovery link from the mailbox verifies the address, sets the password, same identity.
      const recovered = await recoverySession(env, player.email);
      const session = recovered.session;
      expect(authenticationMethods(session)).toContain('otp');
      const client = sessionClient(env, session);
      expect((await client.rpc('get_provisional_claim_context')).data).toMatchObject({
        state: 'ready',
        display_name: 'Pass Pia',
        initial_level: 2.5
      });
      const claimed = await client.rpc('claim_provisional_player', {
        ...CLAIM_PROFILE,
        p_initial_level: 2.5
      });
      expect(claimed.error).toBeNull();
      expect(await claimAudits(player.id)).toHaveLength(1);

      // The password the unverified signup set is not proof of anything: it dies with the claim.
      const squatterLogin = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signInWithPassword({ email: player.email, password: 'Password123!' });
      expect(squatterLogin.error).not.toBeNull();
      expect(squatterLogin.data.session).toBeNull();

      const password = 'Recovered123!';
      const updated = await recovered.auth.updateUser({ password });
      expect(updated.error).toBeNull();
      const login = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signInWithPassword({ email: player.email, password });
      expect(login.error).toBeNull();
      expect(login.data.user?.id).toBe(player.id);
      // After the claim a plain password session has full normal access to the same profile.
      const normal = sessionClient(env, login.data.session!);
      expect((await normal.from('player_profiles').select('display_name')).data).toEqual([
        { display_name: 'Claimed Carla' }
      ]);
      expect(await mailFor(player.email)).toHaveLength(2);
    }
  );
});
