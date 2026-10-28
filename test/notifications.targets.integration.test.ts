import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
type JoinPolicy = 'instant' | 'admin_approval';

const password = 'Password123!';
const unavailableTarget = {
  target_status: 'unavailable',
  community_id: null,
  community_name: null,
  invitation_id: null,
  membership_status: null
};
const rawToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
// Same scheme as issueInvitation/accept_community_invitation: SHA-256 hex of the raw token.
const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');
const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;

describe.skipIf(!environment.env)(
  'notification targets and acceptance (real local Supabase)',
  () => {
    function env(): Env {
      if (!environment.env) throw new Error(environment.reason);
      return environment.env;
    }

    async function actor(label: string): Promise<Actor> {
      const { url, key } = env();
      const anonymous = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const signup = await anonymous.auth.signUp({
        email: `${slug}-${crypto.randomUUID()}@example.test`,
        password
      });
      expect(signup.error).toBeNull();
      const token = signup.data.session?.access_token;
      expect(token).toBeTruthy();
      return {
        id: signup.data.user!.id,
        client: createClient(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${token}` } }
        })
      };
    }

    const sql = (statement: string) => executeTrustedSql(statement);
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

    async function community(admin: Actor, joinPolicy: JoinPolicy = 'instant') {
      const created = await admin.client.rpc('create_community', {
        p_name: `Target ${crypto.randomUUID().slice(0, 8)}`,
        p_visibility: 'private',
        p_join_policy: joinPolicy
      });
      expect(created.error).toBeNull();
      if (typeof created.data !== 'string') throw new Error('create_community returned no ID');
      return created.data;
    }

    /** Issues a live invitation and returns the raw token plus the recipient's alert id. */
    async function invite(admin: Actor, communityId: string, invitee: Actor) {
      const token = rawToken();
      const inserted = await admin.client
        .from('community_invitations')
        .insert({
          community_id: communityId,
          invitee_user_id: invitee.id,
          token_hash: await sha256Hex(token),
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString()
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();
      if (!inserted.data) throw new Error('invitation fixture missing');
      const invitationId: string = inserted.data.id;
      const alert = await invitee.client
        .from('notifications')
        .select('id')
        .eq('event_key', `community.invitation:${invitationId}`)
        .single();
      expect(alert.error).toBeNull();
      const notificationId: string = alert.data!.id;
      return { token, invitationId, notificationId };
    }

    // `community_invitation_guard` makes expires_at immutable after insert, so an
    // expired fixture must be born expired; the producer skips expired inserts,
    // so the alert is created through the private helper, exactly as the trigger
    // would have persisted it.
    async function expiredInvite(admin: Actor, communityId: string, invitee: Actor) {
      const token = rawToken();
      const invitationId = crypto.randomUUID();
      await sql(
        `insert into public.community_invitations (id,community_id,invitee_user_id,issued_by,token_hash,expires_at,created_at) values (${quote(invitationId)}::uuid,${quote(communityId)}::uuid,${quote(invitee.id)}::uuid,${quote(admin.id)}::uuid,${quote(await sha256Hex(token))},now() - interval '1 hour', now() - interval '2 days')`
      );
      await sql(
        `select public.persist_notification(${quote(invitee.id)}::uuid,${quote(`community.invitation:${invitationId}`)},'community_invitation','community','community_invitation',${quote(invitationId)}::uuid,${quote(communityId)}::uuid)`
      );
      const alert = await invitee.client
        .from('notifications')
        .select('id')
        .eq('event_key', `community.invitation:${invitationId}`)
        .single();
      expect(alert.error).toBeNull();
      const notificationId: string = alert.data!.id;
      return { token, invitationId, notificationId };
    }

    const revokeInvitation = (invitationId: string) =>
      sql(
        `update public.community_invitations set revoked_at = now() where id = ${quote(invitationId)}::uuid`
      );
    const insertAlert = (
      recipient: string,
      kind: string,
      targetType: string,
      targetId: string,
      communityId: string | null
    ) =>
      sql(
        `insert into public.notifications (recipient_user_id,event_key,kind,category,target_type,target_id,community_id) values (${quote(recipient)}::uuid,${quote(`fixture:${crypto.randomUUID()}`)},${quote(kind)},'community',${quote(targetType)},${quote(targetId)}::uuid,${communityId ? `${quote(communityId)}::uuid` : 'null'})`
      );

    const targetFor = (client: SupabaseClient, notificationId: string) =>
      client.rpc('get_my_notification_target', { p_notification_id: notificationId }).single();
    const acceptFor = (client: SupabaseClient, notificationId: string) =>
      client
        .rpc('accept_my_notification_invitation', { p_notification_id: notificationId })
        .single();
    const tokenAccept = (client: SupabaseClient, token: string) =>
      client.rpc('accept_community_invitation', { p_token: token }).single();
    const intervals = (member: Actor, communityId: string) =>
      member.client
        .from('community_members')
        .select('id,status,valid_from,valid_until')
        .eq('community_id', communityId);

    it('treats foreign and missing notification ids identically and rejects anonymous callers', async () => {
      const { url, key } = env();
      const admin = await actor('Target Privacy Admin');
      const owner = await actor('Target Owner');
      const outsider = await actor('Target Outsider');
      const anonymous = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const communityId = await community(admin);
      const { notificationId } = await invite(admin, communityId, owner);
      const missing = crypto.randomUUID();

      expect(
        (await outsider.client.from('notifications').select('id').eq('id', notificationId)).data
      ).toEqual([]);
      expect(errorCode((await targetFor(outsider.client, notificationId)).error)).toBe('42501');
      expect(errorCode((await targetFor(owner.client, missing)).error)).toBe('42501');
      // EXECUTE is revoked from anon, so the grant layer rejects anonymous
      // callers with the same hard 42501 denial before the RPC body's 28000
      // guard could run; either way anonymous access is denied outright.
      expect(errorCode((await targetFor(anonymous, notificationId)).error)).toBe('42501');
      // Forgery: the invitation alert belongs to another recipient; its id authorizes nothing.
      expect(errorCode((await acceptFor(outsider.client, notificationId)).error)).toBe('42501');
      expect(errorCode((await acceptFor(owner.client, missing)).error)).toBe('42501');
      expect(errorCode((await acceptFor(anonymous, notificationId)).error)).toBe('42501');
    }, 30000);

    it('resolves the invited recipient to the authorized community and never leaks the invitation token', async () => {
      const admin = await actor('Target Resolve Admin');
      const invitee = await actor('Target Invitee');
      const communityId = await community(admin);
      const { token, invitationId, notificationId } = await invite(admin, communityId, invitee);

      const resolved = await targetFor(invitee.client, notificationId);
      expect(resolved.error).toBeNull();
      const storedName: string = (
        await admin.client.from('communities').select('name').eq('id', communityId).single()
      ).data!.name;
      expect(resolved.data).toEqual({
        target_status: 'invitation_available',
        community_id: communityId,
        community_name: storedName,
        invitation_id: invitationId,
        membership_status: null
      });
      expect(Object.keys(resolved.data!).sort()).toEqual([
        'community_id',
        'community_name',
        'invitation_id',
        'membership_status',
        'target_status'
      ]);
      const serialized = JSON.stringify(resolved.data);
      expect(serialized).not.toContain(token);
      expect(serialized.toLowerCase()).not.toContain('hash');
    }, 30000);

    it('returns exactly one unavailable row for revoked, expired, dangling and unknown-kind alerts', async () => {
      const admin = await actor('Target Unavailable Admin');
      const revokedInvitee = await actor('Revoked Target Invitee');
      const expiredInvitee = await actor('Expired Target Invitee');
      const danglingInvitee = await actor('Dangling Target Invitee');
      const communityId = await community(admin);

      const revoked = await invite(admin, communityId, revokedInvitee);
      const expired = await expiredInvite(admin, communityId, expiredInvitee);
      await revokeInvitation(revoked.invitationId);

      // Missing join: invitation id and community id that exist nowhere.
      const danglingTarget = crypto.randomUUID();
      const danglingCommunity = crypto.randomUUID();
      await insertAlert(
        danglingInvitee.id,
        'community_invitation',
        'community_invitation',
        danglingTarget,
        danglingCommunity
      );
      // Producers only emit known kinds; the unknown kind row is a trusted-SQL fixture.
      await insertAlert(
        danglingInvitee.id,
        'mystery_kind',
        'future_target',
        crypto.randomUUID(),
        null
      );
      const danglingAlert = await danglingInvitee.client
        .from('notifications')
        .select('id')
        .eq('target_id', danglingTarget)
        .single();
      expect(danglingAlert.error).toBeNull();
      const mysteryAlert = await danglingInvitee.client
        .from('notifications')
        .select('id')
        .eq('kind', 'mystery_kind')
        .single();
      expect(mysteryAlert.error).toBeNull();

      const danglingAlertId: string = danglingAlert.data!.id;
      const mysteryAlertId: string = mysteryAlert.data!.id;
      const recipients: [Actor, string][] = [
        [revokedInvitee, revoked.notificationId],
        [expiredInvitee, expired.notificationId],
        [danglingInvitee, danglingAlertId],
        [danglingInvitee, mysteryAlertId]
      ];
      for (const [recipient, notificationId] of recipients) {
        const resolved = await targetFor(recipient.client, notificationId);
        expect(resolved.error).toBeNull();
        expect(resolved.data).toEqual(unavailableTarget);
      }
    }, 30000);

    it('matches token acceptance outcomes for valid invitations under both join policies', async () => {
      const admin = await actor('Target Parity Admin');
      for (const joinPolicy of ['instant', 'admin_approval'] as const) {
        const communityId = await community(admin, joinPolicy);
        const viaToken = await actor(`Parity Token ${joinPolicy}`);
        const viaNotification = await actor(`Parity Notification ${joinPolicy}`);
        const tokenRoute = await invite(admin, communityId, viaToken);
        const notificationRoute = await invite(admin, communityId, viaNotification);

        const tokenResult = await tokenAccept(viaToken.client, tokenRoute.token);
        const notificationResult = await acceptFor(
          viaNotification.client,
          notificationRoute.notificationId
        );
        expect(tokenResult.error).toBeNull();
        expect(notificationResult.error).toBeNull();
        const expectedStatus = joinPolicy === 'instant' ? 'active' : 'pending';
        expect(tokenResult.data).toEqual({ community_id: communityId, status: expectedStatus });
        expect(notificationResult.data).toEqual(tokenResult.data);
        expect((await intervals(viaToken, communityId)).data).toHaveLength(1);
        expect((await intervals(viaNotification, communityId)).data).toHaveLength(1);
      }
    }, 60000);

    it('matches token rejection codes for expired, revoked and already-redeemed invitations', async () => {
      const admin = await actor('Target Rejection Admin');
      const expiredRecipient = await actor('Expired Rejection Invitee');
      const revokedRecipient = await actor('Revoked Rejection Invitee');
      const redeemedRecipient = await actor('Redeemed Rejection Invitee');
      const communityId = await community(admin);

      const expired = await expiredInvite(admin, communityId, expiredRecipient);
      expect(errorCode((await tokenAccept(expiredRecipient.client, expired.token)).error)).toBe(
        'PJ002'
      );
      expect(
        errorCode((await acceptFor(expiredRecipient.client, expired.notificationId)).error)
      ).toBe('PJ002');
      expect((await intervals(expiredRecipient, communityId)).data).toEqual([]);

      const revoked = await invite(admin, communityId, revokedRecipient);
      await revokeInvitation(revoked.invitationId);
      expect(errorCode((await tokenAccept(revokedRecipient.client, revoked.token)).error)).toBe(
        'PJ004'
      );
      expect(
        errorCode((await acceptFor(revokedRecipient.client, revoked.notificationId)).error)
      ).toBe('PJ004');
      expect((await intervals(revokedRecipient, communityId)).data).toEqual([]);

      const redeemed = await invite(admin, communityId, redeemedRecipient);
      const firstAccept = await tokenAccept(redeemedRecipient.client, redeemed.token);
      expect(firstAccept.error).toBeNull();
      expect(errorCode((await tokenAccept(redeemedRecipient.client, redeemed.token)).error)).toBe(
        'PJ003'
      );
      // The notification path replays the redeemed invitation as its existing
      // membership instead of PJ003: plan-mandated idempotency, asserted at the
      // outcome level (same membership, one interval, invitation consumed).
      const replay = await acceptFor(redeemedRecipient.client, redeemed.notificationId);
      expect(replay.error).toBeNull();
      expect(replay.data).toEqual(firstAccept.data!);
      expect((await intervals(redeemedRecipient, communityId)).data).toHaveLength(1);
    }, 60000);

    it('matches token rejection codes for open and inactive membership blocks', async () => {
      const admin = await actor('Target Block Admin');
      const pendingMember = await actor('Pending Block Member');
      const inactiveMember = await actor('Inactive Block Member');
      const communityId = await community(admin);

      expect(
        (
          await admin.client.from('community_members').insert({
            community_id: communityId,
            user_id: pendingMember.id,
            role: 'member',
            status: 'pending'
          })
        ).error
      ).toBeNull();
      await sql(
        `insert into public.community_members (community_id,user_id,role,status,valid_from,valid_until) values (${quote(communityId)}::uuid,${quote(inactiveMember.id)}::uuid,'member','inactive',now() - interval '2 hours', now() - interval '1 hour')`
      );

      const pendingRoute = await invite(admin, communityId, pendingMember);
      const inactiveRoute = await invite(admin, communityId, inactiveMember);
      expect(errorCode((await tokenAccept(pendingMember.client, pendingRoute.token)).error)).toBe(
        'PJ006'
      );
      expect(
        errorCode((await acceptFor(pendingMember.client, pendingRoute.notificationId)).error)
      ).toBe('PJ006');
      expect(errorCode((await tokenAccept(inactiveMember.client, inactiveRoute.token)).error)).toBe(
        'PJ008'
      );
      expect(
        errorCode((await acceptFor(inactiveMember.client, inactiveRoute.notificationId)).error)
      ).toBe('PJ008');
      expect((await intervals(pendingMember, communityId)).data).toHaveLength(1);
      expect((await intervals(inactiveMember, communityId)).data).toHaveLength(1);
    }, 60000);

    it('creates the membership, redeems the invitation and refreshes the target atomically', async () => {
      const admin = await actor('Target Accept Admin');
      const invitee = await actor('Target Accept Invitee');
      const communityId = await community(admin, 'instant');
      const { invitationId, notificationId } = await invite(admin, communityId, invitee);

      const accepted = await acceptFor(invitee.client, notificationId);
      expect(accepted.error).toBeNull();
      expect(accepted.data).toEqual({ community_id: communityId, status: 'active' });

      const invitation = await invitee.client
        .from('community_invitations')
        .select('redeemed_at,revoked_at')
        .eq('id', invitationId)
        .single();
      expect(invitation.error).toBeNull();
      expect(invitation.data!.redeemed_at).not.toBeNull();
      expect(invitation.data!.revoked_at).toBeNull();

      const memberships = await intervals(invitee, communityId);
      expect(memberships.error).toBeNull();
      expect(memberships.data).toHaveLength(1);
      expect(memberships.data![0]).toMatchObject({ status: 'active', valid_until: null });

      const refreshed = await targetFor(invitee.client, notificationId);
      expect(refreshed.error).toBeNull();
      expect(refreshed.data).toEqual({
        target_status: 'membership_available',
        community_id: communityId,
        community_name: expect.any(String),
        invitation_id: null,
        membership_status: 'active'
      });
    }, 30000);

    it('keeps repeated and concurrent acceptance to exactly one membership interval', async () => {
      const admin = await actor('Target Idempotent Admin');
      const sequential = await actor('Sequential Invitee');
      const concurrent = await actor('Concurrent Invitee');
      const communityId = await community(admin, 'instant');

      const firstRoute = await invite(admin, communityId, sequential);
      const firstCall = await acceptFor(sequential.client, firstRoute.notificationId);
      expect(firstCall.error).toBeNull();
      const secondCall = await acceptFor(sequential.client, firstRoute.notificationId);
      expect(secondCall.error).toBeNull();
      expect(secondCall.data).toEqual(firstCall.data!);
      expect((await intervals(sequential, communityId)).data).toHaveLength(1);

      const secondRoute = await invite(admin, communityId, concurrent);
      // The invitation row lock serializes both calls: the loser observes the
      // committed redemption and replays the winner's membership, so both
      // resolve to the same row and exactly one interval exists.
      const [left, right] = await Promise.all([
        acceptFor(concurrent.client, secondRoute.notificationId),
        acceptFor(concurrent.client, secondRoute.notificationId)
      ]);
      expect(left.error).toBeNull();
      expect(right.error).toBeNull();
      expect(right.data).toEqual(left.data!);
      expect((await intervals(concurrent, communityId)).data).toHaveLength(1);
    }, 60000);

    it('keeps removal alerts readable while withholding the removed community target', async () => {
      const admin = await actor('Target Removal Admin');
      const member = await actor('Target Removed Member');
      const communityId = await community(admin);

      const inserted = await admin.client
        .from('community_members')
        .insert({
          community_id: communityId,
          user_id: member.id,
          role: 'member',
          status: 'pending'
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();
      const membershipId: string = inserted.data!.id;
      const govern = (action: string) =>
        admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: membershipId,
          p_action: action
        });
      expect((await govern('approve')).error).toBeNull();
      expect((await govern('remove')).error).toBeNull();

      const alerts = await member.client
        .from('notifications')
        .select('id')
        .eq('kind', 'community_membership_removed');
      expect(alerts.error).toBeNull();
      expect(alerts.data).toHaveLength(1);
      const removalAlertId: string = alerts.data![0]!.id;

      const resolved = await targetFor(member.client, removalAlertId);
      expect(resolved.error).toBeNull();
      expect(resolved.data).toEqual(unavailableTarget);

      const stillReadable = await member.client
        .from('notifications')
        .select('*')
        .eq('id', removalAlertId)
        .single();
      expect(stillReadable.error).toBeNull();
      expect(stillReadable.data).toMatchObject({
        recipient_user_id: member.id,
        kind: 'community_membership_removed',
        community_id: communityId
      });
    }, 30000);
  }
);
