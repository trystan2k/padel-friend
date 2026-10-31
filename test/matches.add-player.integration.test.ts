import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import { deliverMatchPlayerAdd } from '../src/features/matches/match-add-player.server';
import {
  addPlayer,
  addPlayerArgs,
  authUsersByEmail,
  failingInviteAdmin,
  localAdminClient,
  mailCount,
  operation,
  patchFixtureEvent,
  uniqueEmail,
  INVITE_ORIGIN
} from './helpers/match-add-player-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import {
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer,
  signUpFixtureActor,
  sqlText
} from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

async function scenario(visibility: 'community_open' | 'invite_only' = 'community_open') {
  const env = environment.env!;
  const [admin, owner, member] = await Promise.all([
    signUpFixtureActor(env, 'add-admin', { displayName: 'Add Admin', level: 4 }),
    signUpFixtureActor(env, 'add-owner', { displayName: 'Add Owner', level: 4 }),
    signUpFixtureActor(env, 'add-member', { displayName: 'Add Member', level: 3 })
  ]);
  const communityId = crypto.randomUUID();
  const eventId = crypto.randomUUID();
  await insertFixtureCommunity({
    id: communityId,
    visibility: 'private',
    adminId: admin.id,
    memberIds: [owner.id, member.id]
  });
  await insertFixtureEvent({ id: eventId, communityId, creatorId: owner.id, visibility });
  return { env, admin, owner, member, communityId, eventId };
}

async function registration(eventId: string, userId: string) {
  const result = await queryTrustedSql(
    `select lifecycle, registration_source from public.match_event_registrations
      where match_event_id = $1 and user_id = $2`,
    { values: [eventId, userId] }
  );
  return result.rows[0];
}

async function profile(userId: string) {
  const result = await queryTrustedSql(
    `select p.display_name, p.is_provisional, p.estimated_level::float8 as estimated_level,
            p.invited_by, p.source_match_event_id, g.initial_display_level::float8 as rating
       from public.player_profiles p join public.global_player_ratings g using (user_id)
      where p.user_id = $1`,
    { values: [userId] }
  );
  return result.rows[0];
}

describe('add match player by name and email', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'creates an unknown email atomically through the Auth bridge with one invite email',
    async () => {
      const { env, owner, communityId, eventId } = await scenario();
      const email = uniqueEmail('new');
      const requestId = crypto.randomUUID();
      const { command, result } = await addPlayer(env, owner, {
        eventId,
        displayName: '  New Nia ',
        email: `  ${email.toUpperCase()} `,
        level: 3.5,
        requestId
      });
      expect(command).toEqual({ status: 'ok', request_id: requestId });
      expect(result).toEqual({ status: 'ok' });

      const users = await authUsersByEmail(email);
      expect(users).toHaveLength(1);
      const userId = String(users[0]!.id);
      expect(users[0]!.raw_user_meta_data).not.toHaveProperty('padel_add_capability');
      expect(await profile(userId)).toEqual({
        display_name: 'New Nia',
        is_provisional: true,
        estimated_level: 3.5,
        invited_by: owner.id,
        source_match_event_id: eventId,
        rating: 3.5
      });
      const membership = await queryTrustedSql(
        `select role, status, added_by, source_match_event_id from public.community_members
          where community_id = $1 and user_id = $2`,
        { values: [communityId, userId] }
      );
      expect(membership.rows).toEqual([
        { role: 'member', status: 'active', added_by: owner.id, source_match_event_id: eventId }
      ]);
      expect(await registration(eventId, userId)).toEqual({
        lifecycle: 'accepted',
        registration_source: 'member'
      });
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'completed',
        branch: 'new',
        outcome: 'registered',
        target_user_id: userId,
        dispatch_state: 'sent',
        email
      });
      expect(await mailCount(email)).toBe(1);

      // Retrying the same request replays without a second identity, row or email.
      const replay = await addPlayer(env, owner, {
        eventId,
        displayName: 'New Nia',
        email,
        level: 3.5,
        requestId
      });
      expect(replay.result).toEqual({ status: 'ok' });
      expect(await authUsersByEmail(email)).toHaveLength(1);
      expect(await mailCount(email)).toBe(1);
      const audit = await queryTrustedSql(
        `select actor_id, target_user_id, after_data from public.match_event_audit_log
          where match_event_id = $1 and action = 'player_added'`,
        { values: [eventId] }
      );
      expect(audit.rows).toEqual([{ actor_id: owner.id, target_user_id: null, after_data: {} }]);
    }
  );

  it.skipIf(!environment.env)(
    'reuses an existing provisional identity without overwriting it and throttles the email',
    async () => {
      const first = await scenario();
      const second = await scenario('invite_only');
      const email = uniqueEmail('reuse');
      await addPlayer(first.env, first.owner, {
        eventId: first.eventId,
        displayName: 'Original Name',
        email,
        level: 2
      });
      const [user] = await authUsersByEmail(email);
      const requestId = crypto.randomUUID();
      const { result } = await addPlayer(second.env, second.admin, {
        eventId: second.eventId,
        displayName: 'Renamed By Other Adder',
        email,
        level: 6.5,
        requestId
      });
      expect(result).toEqual({ status: 'ok' });
      expect(await authUsersByEmail(email)).toHaveLength(1);
      const userId = String(user!.id);
      expect(await profile(userId)).toMatchObject({
        display_name: 'Original Name',
        estimated_level: 2,
        rating: 2
      });
      expect(await registration(second.eventId, userId)).toMatchObject({ lifecycle: 'accepted' });
      const invite = await queryTrustedSql(
        `select status from public.match_event_invites where match_event_id = $1 and invitee_user_id = $2`,
        { values: [second.eventId, userId] }
      );
      expect(invite.rows).toEqual([{ status: 'accepted' }]);
      expect(await operation(second.admin.id, second.eventId, requestId)).toMatchObject({
        branch: 'provisional',
        outcome: 'registered',
        dispatch_state: 'suppressed'
      });
      const hits = await queryTrustedSql(
        `select scope from public.match_player_add_throttle_hits where request_id = $1`,
        { values: [requestId] }
      );
      expect(hits.rows).toEqual([{ scope: 'recipient' }]);
      expect(await mailCount(email)).toBe(1);

      // Outside the recipient window the existing identity gets a re-sent invite.
      await executeTrustedSql(
        `update public.match_player_add_recipient_sends set sent_at = now() - interval '16 minutes'
          where email_digest = public.match_player_add_digest('${email}')`
      );
      const third = await scenario();
      await addPlayer(third.env, third.owner, {
        eventId: third.eventId,
        displayName: 'Again',
        email,
        level: 1
      });
      expect(await authUsersByEmail(email)).toHaveLength(1);
      expect(await mailCount(email)).toBe(2);
    }
  );

  it.skipIf(!environment.env)(
    'gives a registered email only an idempotent pending invitation and no email',
    async () => {
      const { env, owner, eventId } = await scenario();
      const outsider = await signUpFixtureActor(env, 'add-registered', {
        displayName: 'Registered Rita',
        level: 5
      });
      const before = await profile(outsider.id);
      const results = [];
      for (const name of ['Someone', 'Someone Else']) {
        const { result } = await addPlayer(env, owner, {
          eventId,
          displayName: name,
          email: outsider.email.toUpperCase(),
          level: 1
        });
        results.push(result);
      }
      expect(results).toEqual([{ status: 'ok' }, { status: 'ok' }]);
      const invites = await queryTrustedSql(
        `select status, invited_by from public.match_event_invites
          where match_event_id = $1 and invitee_user_id = $2`,
        { values: [eventId, outsider.id] }
      );
      expect(invites.rows).toEqual([{ status: 'pending', invited_by: owner.id }]);
      expect(await profile(outsider.id)).toEqual(before);
      expect(await registration(eventId, outsider.id)).toBeUndefined();
      const memberships = await queryTrustedSql(
        `select 1 from public.community_members where user_id = $1`,
        { values: [outsider.id] }
      );
      expect(memberships.rows).toEqual([]);
      const outcomes = await queryTrustedSql(
        `select branch, outcome, dispatch_state from public.match_player_add_operations
          where match_event_id = $1 order by created_at`,
        { values: [eventId] }
      );
      expect(outcomes.rows).toEqual([
        { branch: 'registered', outcome: 'invited', dispatch_state: 'none' },
        { branch: 'registered', outcome: 'already_invited', dispatch_state: 'none' }
      ]);
      expect(await mailCount(outsider.email)).toBe(0);
    }
  );

  it.skipIf(!environment.env)(
    'answers every branch with byte-identical command and server results',
    async () => {
      const { env, owner, eventId } = await scenario();
      const registered = await signUpFixtureActor(env, 'add-uniform', {
        displayName: 'Uniform Una',
        level: 3
      });
      const provisionalEmail = uniqueEmail('uniform-provisional');
      await addPlayer(env, owner, {
        eventId,
        displayName: 'Prov',
        email: provisionalEmail,
        level: 3
      });
      const requestId = crypto.randomUUID();
      const bodies = [];
      for (const [index, email] of [
        registered.email,
        provisionalEmail,
        uniqueEmail('uniform-new')
      ].entries()) {
        const event = crypto.randomUUID();
        const community = await queryTrustedSql(
          `select community_id from public.match_events where id = $1`,
          { values: [eventId] }
        );
        await insertFixtureEvent({
          id: event,
          communityId: String(community.rows[0]!.community_id),
          creatorId: owner.id,
          visibility: index === 0 ? 'invite_only' : 'community_open'
        });
        const { command, result } = await addPlayer(env, owner, {
          eventId: event,
          displayName: 'Same Name',
          email,
          level: 3,
          requestId
        });
        bodies.push(JSON.stringify({ command, result }));
      }
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0]!)).toEqual({
        command: { status: 'ok', request_id: requestId },
        result: { status: 'ok' }
      });
      const audit = await owner.client.rpc('list_match_event_audit', {
        p_match_event_id: eventId
      });
      expect(audit.error).toBeNull();
      expect(JSON.stringify(audit.data)).not.toMatch(/registered|provisional|new|@/);
    }
  );

  it.skipIf(!environment.env)(
    'authorizes only the current owner or a community admin in SQL',
    async () => {
      const { env, admin, owner, member, eventId } = await scenario();
      const provisional = await signUpFixtureActor(env, 'add-provisional-actor');
      await provisionProvisionalPlayer({
        userId: provisional.id,
        displayName: 'Prov Actor',
        estimatedLevel: 3,
        invitedBy: owner.id,
        sourceEventId: eventId
      });
      const stranger = await signUpFixtureActor(env, 'add-stranger', {
        displayName: 'Stranger',
        level: 3
      });
      const anon = createClient<Database>(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const args = () =>
        addPlayerArgs({ eventId, displayName: 'X', email: uniqueEmail('authz'), level: 3 });

      expect((await member.client.rpc('add_match_player', args())).error?.code).toBe('42501');
      expect((await stranger.client.rpc('add_match_player', args())).error?.code).toBe('42501');
      expect((await anon.rpc('add_match_player', args())).error?.code).toBe('42501');
      expect((await provisional.client.rpc('add_match_player', args())).error).toMatchObject({
        code: '42501',
        message: 'PROVISIONAL_PLAYER_RESTRICTED'
      });
      // Service-only delivery hooks are not callable by end users.
      const key = {
        p_actor_id: owner.id,
        p_match_event_id: eventId,
        p_request_id: crypto.randomUUID()
      };
      for (const call of [
        await owner.client.rpc('dispatch_match_player_add', key),
        await owner.client.rpc('settle_match_player_add', { ...key, p_delivered: true })
      ])
        expect(call.error?.code).toBe('42501');
      expect((await admin.client.rpc('add_match_player', args())).data).toMatchObject({
        status: 'ok'
      });

      // Ownership follows transfers: the former owner loses the command.
      expect(
        (await admin.client.rpc('submit_match_registration', { p_match_event_id: eventId })).error
      ).toBeNull();
      const transfer = await owner.client.rpc('transfer_match_event_ownership', {
        p_match_event_id: eventId,
        p_target_user_id: admin.id,
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(transfer.error).toBeNull();
      expect((await owner.client.rpc('add_match_player', args())).error?.code).toBe('42501');
      expect((await admin.client.rpc('add_match_player', args())).data).toMatchObject({
        status: 'ok'
      });
      const writes = await queryTrustedSql(
        `select count(*)::int as count from public.match_player_add_operations where match_event_id = $1`,
        { values: [eventId] }
      );
      expect(writes.rows).toEqual([{ count: 2 }]);
    }
  );

  it.skipIf(!environment.env)('validates and normalizes input in SQL', async () => {
    const { owner, eventId } = await scenario();
    const base = addPlayerArgs({
      eventId,
      displayName: 'Valid',
      email: uniqueEmail('v'),
      level: 3
    });
    for (const patch of [
      { p_display_name: '   ' },
      { p_display_name: 'x'.repeat(81) },
      { p_email: 'not-an-email' },
      { p_email: 'a b@test.local' },
      { p_estimated_level: 7.1 },
      { p_estimated_level: -0.1 },
      { p_estimated_level: 3.55 },
      { p_locale: 'fr' }
    ]) {
      const { error } = await owner.client.rpc('add_match_player', { ...base, ...patch });
      expect({ patch, code: error?.code }).toEqual({ patch, code: '22023' });
    }
    const missing = await owner.client.rpc(
      'add_match_player',
      addPlayerArgs({
        eventId: crypto.randomUUID(),
        displayName: 'X',
        email: uniqueEmail('m'),
        level: 1
      })
    );
    expect(missing.error?.message).toBe('MATCH_MANAGEMENT_NOT_FOUND');
    const conflict = await owner.client.rpc('add_match_player', base);
    expect(conflict.error).toBeNull();
    const changed = await owner.client.rpc('add_match_player', { ...base, p_estimated_level: 4 });
    expect(changed.error?.message).toBe('MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT');
  });

  it.skipIf(!environment.env)(
    'respects the roster window and capacity without creating any identity',
    async () => {
      const { env, owner, eventId } = await scenario();
      const full = uniqueEmail('full');
      await patchFixtureEvent(eventId, `maximum_registrations = 1`);
      const fullAttempt = await owner.client.rpc(
        'add_match_player',
        addPlayerArgs({ eventId, displayName: 'Full', email: full, level: 3 })
      );
      expect(fullAttempt.error?.message).toBe('MATCH_REGISTRATION_FULL');

      // The window is re-checked inside the Auth transaction: closing it between
      // command and delivery rolls back the new auth.users row and sends nothing.
      await patchFixtureEvent(eventId, `maximum_registrations = null`);
      const late = uniqueEmail('late');
      const requestId = crypto.randomUUID();
      const accepted = await owner.client.rpc(
        'add_match_player',
        addPlayerArgs({ eventId, displayName: 'Late', email: late, level: 3, requestId })
      );
      expect(accepted.error).toBeNull();
      await patchFixtureEvent(eventId, `registration_cutoff_at = now() - interval '1 minute'`);
      const delivered = await deliverMatchPlayerAdd(localAdminClient(env), {
        actor_id: owner.id,
        event_id: eventId,
        request_id: requestId,
        origin: INVITE_ORIGIN
      });
      // A failed delivery answers like every other add; the ledger keeps the retry state.
      expect(delivered).toEqual({ status: 'ok' });
      expect(await authUsersByEmail(late)).toEqual([]);
      expect(await authUsersByEmail(full)).toEqual([]);
      expect(await mailCount(late)).toBe(0);
      expect(await operation(owner.id, eventId, requestId)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'failed'
      });

      const closed = await owner.client.rpc(
        'add_match_player',
        addPlayerArgs({ eventId, displayName: 'Closed', email: uniqueEmail('c'), level: 3 })
      );
      expect(closed.error?.message).toBe('MATCH_MANAGEMENT_CLOSED');

      const other = await scenario();
      const cancel = await other.owner.client.rpc('cancel_match_event', {
        p_match_event_id: other.eventId,
        p_reason: 'Rain',
        p_expected_version: 1,
        p_request_id: crypto.randomUUID()
      });
      expect(cancel.error).toBeNull();
      const cancelled = await other.owner.client.rpc(
        'add_match_player',
        addPlayerArgs({
          eventId: other.eventId,
          displayName: 'Cancelled',
          email: uniqueEmail('x'),
          level: 3
        })
      );
      expect(cancelled.error?.message).toBe('MATCH_MANAGEMENT_CANCELLED');
    }
  );

  it.skipIf(!environment.env)(
    'answers a failed invitation delivery identically for registered, provisional and unknown emails',
    async () => {
      const { env, owner, member, eventId } = await scenario();
      const provisionalEmail = uniqueEmail('fail-provisional');
      const created = await addPlayer(env, owner, {
        eventId,
        displayName: 'Fail Provisional',
        email: provisionalEmail,
        level: 3
      });
      expect(created.result).toEqual({ status: 'ok' });
      // Free the per-recipient slot so the resend actually reaches the failing mail seam.
      await executeTrustedSql(
        `delete from public.match_player_add_recipient_sends where operation_id in
           (select id from public.match_player_add_operations where email = ${sqlText(provisionalEmail)})`
      );

      const failing = failingInviteAdmin(env);
      const requests = [member.email, provisionalEmail, uniqueEmail('fail-unknown')].map((email) =>
        addPlayerArgs({ eventId, displayName: 'Fail Add', email, level: 3 })
      );
      const responses: string[] = [];
      for (const args of requests) {
        expect((await owner.client.rpc('add_match_player', args)).error).toBeNull();
        responses.push(
          JSON.stringify(
            await deliverMatchPlayerAdd(failing, {
              actor_id: owner.id,
              event_id: eventId,
              request_id: args.p_request_id,
              origin: INVITE_ORIGIN
            })
          )
        );
      }
      expect(responses).toEqual(Array.from({ length: 3 }, () => '{"status":"ok"}'));
      // The delivery really failed for the two branches that send, and stays retryable.
      expect(await operation(owner.id, eventId, requests[0]!.p_request_id)).toMatchObject({
        branch: 'registered',
        dispatch_state: 'none'
      });
      expect(await operation(owner.id, eventId, requests[1]!.p_request_id)).toMatchObject({
        state: 'completed',
        branch: 'provisional',
        dispatch_state: 'failed'
      });
      expect(await operation(owner.id, eventId, requests[2]!.p_request_id)).toMatchObject({
        state: 'awaiting_identity',
        dispatch_state: 'failed'
      });
      expect(await mailCount(requests[2]!.p_email)).toBe(0);
    }
  );

  it.skipIf(!environment.env)(
    'keeps restricted provisional additions in the existing approval queue',
    async () => {
      const { env, owner, eventId } = await scenario();
      await patchFixtureEvent(eventId, `restriction_enabled = true, min_level = 4, max_level = 5`);
      const email = uniqueEmail('restricted');
      expect(
        (await addPlayer(env, owner, { eventId, displayName: 'Low', email, level: 2 })).result
      ).toEqual({ status: 'ok' });
      const [user] = await authUsersByEmail(email);
      expect(await registration(eventId, String(user!.id))).toMatchObject({ lifecycle: 'pending' });
    }
  );

  it.skipIf(!environment.env)('throttles the actor and audits the hit', async () => {
    const { owner, eventId } = await scenario();
    await executeTrustedSql(
      `insert into public.match_player_add_actor_windows(actor_id, window_start, add_count)
         values ('${owner.id}', date_bin('1 hour', clock_timestamp(), timestamptz 'epoch'), 20)`
    );
    const requestId = crypto.randomUUID();
    const { data, error } = await owner.client.rpc(
      'add_match_player',
      addPlayerArgs({
        eventId,
        displayName: 'Too Many',
        email: uniqueEmail('rate'),
        level: 3,
        requestId
      })
    );
    expect(error).toBeNull();
    expect(data).toEqual({ status: 'rate_limited', request_id: requestId });
    const hits = await queryTrustedSql(
      `select scope, actor_id, email_digest from public.match_player_add_throttle_hits where request_id = $1`,
      { values: [requestId] }
    );
    expect(hits.rows).toEqual([{ scope: 'actor', actor_id: owner.id, email_digest: null }]);
    expect(await operation(owner.id, eventId, requestId)).toBeUndefined();
  });

  it.skipIf(!environment.env)(
    'rejects a forged capability on public signup and leaves ordinary signups untouched',
    async () => {
      const env = environment.env!;
      const anon = createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const email = uniqueEmail('forged');
      const forged = await anon.auth.signUp({
        email,
        password: 'Password123!',
        options: { data: { padel_add_capability: 'f'.repeat(64) } }
      });
      expect(forged.error).not.toBeNull();
      expect(await authUsersByEmail(email)).toEqual([]);
      const plain = await signUpFixtureActor(env, 'add-plain');
      const profiles = await queryTrustedSql(
        `select 1 from public.player_profiles where user_id = $1`,
        { values: [plain.id] }
      );
      expect(profiles.rows).toEqual([]);
    }
  );

  it.skipIf(!environment.env)('keeps every new table and helper private', async () => {
    const result = await queryTrustedSql(
      `select r.rolname, t.relname,
              has_table_privilege(r.rolname, ('public.' || t.relname)::regclass, 'select,insert,update,delete') as allowed
         from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
        cross join (values ('match_player_add_operations'), ('match_player_add_actor_windows'),
          ('match_player_add_recipient_sends'), ('match_player_add_throttle_hits')) t(relname)
        where has_table_privilege(r.rolname, ('public.' || t.relname)::regclass, 'select,insert,update,delete')`
    );
    expect(result.rows).toEqual([]);
    const grants = await queryTrustedSql(
      `select p.proname, r.rolname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         cross join (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
        where n.nspname = 'public' and (p.proname like '%match_player_add%' or p.proname = 'add_match_player')
          and has_function_privilege(r.rolname, p.oid, 'execute')
        order by 1, 2`
    );
    expect(grants.rows).toEqual([
      { proname: 'add_match_player', rolname: 'authenticated' },
      { proname: 'dispatch_match_player_add', rolname: 'service_role' },
      { proname: 'get_match_player_add_invite_context', rolname: 'service_role' },
      { proname: 'settle_match_player_add', rolname: 'service_role' }
    ]);
  });
});
