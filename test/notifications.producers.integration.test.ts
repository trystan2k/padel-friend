import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { executeTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;
type Actor = { client: SupabaseClient; id: string };
const password = 'Password123!';

describe.skipIf(!environment.env)('community notification producers (local Supabase)', () => {
  function env(): Env {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }

  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const anonymous = createClient(url, key, { auth: { persistSession: false } });
    const signup = await anonymous.auth.signUp({
      email: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}@example.test`,
      password
    });
    expect(signup.error).toBeNull();
    const token = signup.data.session?.access_token;
    expect(token).toBeTruthy();
    return {
      id: signup.data.user!.id,
      client: createClient(url, key, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
    };
  }

  const sql = (statement: string) => executeTrustedSql(statement);
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;

  async function community(admin: Actor) {
    const result = await admin.client.rpc('create_community', {
      p_name: `Producer ${crypto.randomUUID()}`,
      p_visibility: 'private',
      p_join_policy: 'admin_approval'
    });
    expect(result.error).toBeNull();
    if (typeof result.data !== 'string') throw new Error('create_community returned no ID');
    return result.data;
  }

  async function membership(admin: Actor, communityId: string, member: Actor, status: string) {
    const result = await admin.client
      .from('community_members')
      .insert({ community_id: communityId, user_id: member.id, status })
      .select('id')
      .single();
    expect(result.error).toBeNull();
    if (!result.data) throw new Error('membership fixture missing');
    return result.data.id;
  }

  async function notification(client: SupabaseClient, recipientId: string, eventKey: string) {
    const result = await client
      .from('notifications')
      .select('*')
      .eq('event_key', eventKey)
      .single();
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ recipient_user_id: recipientId, event_key: eventKey });
    return result.data!;
  }

  it('persists exact invitation alert, allowlists its payload, and handles duplicate invite attempts', async () => {
    const admin = await actor('Producer Admin');
    const invitee = await actor('Producer Invitee');
    const communityId = await community(admin);
    const invitationId = crypto.randomUUID();
    const tokenHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0');
    await sql(
      `insert into public.community_invitations (id,community_id,invitee_user_id,issued_by,token_hash,expires_at) values (${quote(invitationId)}::uuid,${quote(communityId)}::uuid,${quote(invitee.id)}::uuid,${quote(admin.id)}::uuid,${quote(tokenHash)},now()+interval '1 day')`
    );
    const alert = await notification(
      invitee.client,
      invitee.id,
      `community.invitation:${invitationId}`
    );
    expect(alert).toMatchObject({
      kind: 'community_invitation',
      category: 'community',
      target_type: 'community_invitation',
      target_id: invitationId,
      community_id: communityId
    });
    expect(Object.keys(alert).sort()).toEqual([
      'category',
      'community_id',
      'created_at',
      'event_key',
      'id',
      'kind',
      'read_at',
      'recipient_user_id',
      'sequence',
      'target_id',
      'target_type'
    ]);
    expect(JSON.stringify(alert)).not.toContain('token');
    expect(JSON.stringify(alert)).not.toContain('settings');
    expect(JSON.stringify(alert)).not.toContain('Producer ');

    expect(
      (
        await invitee.client
          .from('notifications')
          .select('id')
          .eq('event_key', `community.invitation:${invitationId}`)
      ).data
    ).toHaveLength(1);
  }, 30000);

  it('emits approval, denial and admin-removal alerts; role edits and unauthorized calls emit none', async () => {
    const admin = await actor('Governance Admin');
    const other = await actor('Governance Outsider');
    const approvedMember = await actor('Approved Member');
    const deniedMember = await actor('Denied Member');
    const removedMember = await actor('Removed Member');
    const communityId = await community(admin);
    const approvedId = await membership(admin, communityId, approvedMember, 'pending');
    const deniedId = await membership(admin, communityId, deniedMember, 'pending');
    const removedId = await membership(admin, communityId, removedMember, 'active');
    const govern = (client: SupabaseClient, id: string, action: string) =>
      client.rpc('govern_community_member', {
        p_community_id: communityId,
        p_membership_id: id,
        p_action: action
      });

    expect((await govern(other.client, approvedId, 'approve')).error).not.toBeNull();
    expect(
      (await approvedMember.client.from('notifications').select('id').eq('target_id', approvedId))
        .data
    ).toEqual([]);
    expect((await govern(admin.client, approvedId, 'approve')).error).toBeNull();
    expect(
      await notification(
        approvedMember.client,
        approvedMember.id,
        `community.membership_approved:${approvedId}`
      )
    ).toMatchObject({
      kind: 'community_membership_approved',
      category: 'community',
      target_type: 'community_membership',
      target_id: approvedId,
      community_id: communityId
    });
    expect((await govern(admin.client, deniedId, 'deny')).error).toBeNull();
    expect(
      await notification(
        deniedMember.client,
        deniedMember.id,
        `community.membership_denied:${deniedId}`
      )
    ).toMatchObject({ kind: 'community_membership_denied' });
    expect((await govern(admin.client, removedId, 'remove')).error).toBeNull();
    expect(
      await notification(
        removedMember.client,
        removedMember.id,
        `community.membership_removed:${removedId}`
      )
    ).toMatchObject({ kind: 'community_membership_removed' });
    expect((await govern(admin.client, approvedId, 'promote')).error).toBeNull();
    expect(
      (await approvedMember.client.from('notifications').select('id').eq('target_id', approvedId))
        .data
    ).toHaveLength(1);
    expect((await govern(admin.client, approvedId, 'approve')).error).not.toBeNull();
    expect(
      (await approvedMember.client.from('notifications').select('id').eq('target_id', approvedId))
        .data
    ).toHaveLength(1);
  }, 30000);

  it('suppresses self-leave, delivers with push disabled, and uses a distinct event for a new interval', async () => {
    const admin = await actor('Interval Admin');
    const member = await actor('Interval Member');
    const communityId = await community(admin);
    await sql(
      `insert into public.notification_preferences (user_id,push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues) values (${quote(member.id)}::uuid,false,false,false,false,false,false)`
    );
    const firstId = await membership(admin, communityId, member, 'pending');
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: firstId,
          p_action: 'approve'
        })
      ).error
    ).toBeNull();
    expect(
      (await member.client.from('notifications').select('id').eq('target_id', firstId)).data
    ).toHaveLength(1);
    expect(
      (await member.client.rpc('leave_community', { p_community_id: communityId })).error
    ).toBeNull();
    expect(
      (await member.client.from('notifications').select('id').eq('target_id', firstId)).data
    ).toHaveLength(1);
    const secondId = await membership(admin, communityId, member, 'pending');
    expect(secondId).not.toBe(firstId);
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: communityId,
          p_membership_id: secondId,
          p_action: 'approve'
        })
      ).error
    ).toBeNull();
    await notification(member.client, member.id, `community.membership_approved:${secondId}`);
    expect(
      (
        await member.client
          .from('notifications')
          .select('event_key')
          .eq('recipient_user_id', member.id)
      ).data
    ).toHaveLength(2);
  }, 30000);

  it('rolls back domain transitions when an existing event key has conflicting semantics', async () => {
    const admin = await actor('Atomic Admin');
    const member = await actor('Atomic Member');
    const communityId = await community(admin);
    const memberId = await membership(admin, communityId, member, 'pending');
    const key = `community.membership_approved:${memberId}`;
    await sql(
      `insert into public.notifications (recipient_user_id,event_key,kind,category,target_type,target_id,community_id) values (${quote(member.id)}::uuid,${quote(key)},'conflicting_kind','community','community_membership',${quote(memberId)}::uuid,${quote(communityId)}::uuid)`
    );
    const transition = await admin.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: memberId,
      p_action: 'approve'
    });
    expect(transition.error).not.toBeNull();
    expect(
      (await admin.client.from('community_members').select('status').eq('id', memberId).single())
        .data?.status
    ).toBe('pending');
    expect(
      (await member.client.from('notifications').select('kind').eq('event_key', key)).data
    ).toEqual([{ kind: 'conflicting_kind' }]);
  }, 30000);

  it('rejects duplicate open invitations without a second alert and keeps applied approvals invariant on retry', async () => {
    const admin = await actor('Idempotent Admin');
    const invitee = await actor('Idempotent Invitee');
    const member = await actor('Idempotent Member');
    const communityId = await community(admin);
    const tokenHash = () => crypto.randomUUID().replaceAll('-', '').padEnd(64, '0');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const firstInvite = await admin.client
      .from('community_invitations')
      .insert({
        community_id: communityId,
        invitee_user_id: invitee.id,
        token_hash: tokenHash(),
        expires_at: expiresAt
      })
      .select('id')
      .single();
    expect(firstInvite.error).toBeNull();
    if (!firstInvite.data) throw new Error('invitation fixture missing');
    const invitationId: string = firstInvite.data.id;
    const alert = await notification(
      invitee.client,
      invitee.id,
      `community.invitation:${invitationId}`
    );

    const duplicateInvite = await admin.client.from('community_invitations').insert({
      community_id: communityId,
      invitee_user_id: invitee.id,
      token_hash: tokenHash(),
      expires_at: expiresAt
    });
    expect(duplicateInvite.error).not.toBeNull();
    expect(duplicateInvite.error!.code).toBe('23505');
    expect(duplicateInvite.error!.message).toContain('community_invitations_open');

    const invitationAlerts = await invitee.client
      .from('notifications')
      .select('id,created_at')
      .eq('event_key', `community.invitation:${invitationId}`);
    expect(invitationAlerts.data).toHaveLength(1);
    expect(invitationAlerts.data![0]).toMatchObject({ id: alert.id, created_at: alert.created_at });

    const memberId = await membership(admin, communityId, member, 'pending');
    const approve = () =>
      admin.client.rpc('govern_community_member', {
        p_community_id: communityId,
        p_membership_id: memberId,
        p_action: 'approve'
      });
    expect((await approve()).error).toBeNull();
    const approval = await notification(
      member.client,
      member.id,
      `community.membership_approved:${memberId}`
    );
    expect((await approve()).error).not.toBeNull();
    const approvalAlerts = await member.client
      .from('notifications')
      .select('id,created_at')
      .eq('target_id', memberId);
    expect(approvalAlerts.data).toHaveLength(1);
    expect(approvalAlerts.data![0]).toMatchObject({
      id: approval.id,
      created_at: approval.created_at
    });
  }, 30000);
});
