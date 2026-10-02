import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
type LocalEnv = { url: string; key: string; source: 'environment' | '.env file' };
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);
function usableLocalEnv(
  rawUrl: string | undefined,
  key: string | undefined,
  source: LocalEnv['source']
): LocalEnv | null {
  if (!rawUrl || !key || key.startsWith('replace-with')) return null;
  const url = rawUrl.replace(/^["']+|["']+$/g, '');
  try {
    if (!LOOPBACK_HOSTS.has(new URL(url).hostname)) return null;
  } catch {
    return null;
  }
  return { url, key, source };
}
function localSupabaseEnv(): { env: LocalEnv | null; reason: string } {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (url && key && !key.startsWith('replace-with')) {
    return {
      env: usableLocalEnv(url, key, 'environment'),
      reason: `Non-loopback environment URL: ${url}`
    };
  }
  try {
    const vars = new Map(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
        .map((line) => {
          const index = line.indexOf('=');
          return [line.slice(0, index).trim(), line.slice(index + 1).trim()] as const;
        })
    );
    const fileUrl = vars.get('VITE_SUPABASE_URL');
    const fileKey = vars.get('VITE_SUPABASE_PUBLISHABLE_KEY');
    return {
      env: usableLocalEnv(fileUrl, fileKey, '.env file'),
      reason: `Missing or non-loopback .env URL: ${fileUrl ?? 'unset'}`
    };
  } catch {
    return { env: null, reason: 'Missing loopback Supabase environment and .env' };
  }
}
const environment = localSupabaseEnv();
if (!environment.env)
  process.stderr.write(`[community.integration] suite NOT RUN: ${environment.reason}\n`);
describe('community domain — CI backend guard', () => {
  it('fails closed without local backend in CI', () => {
    expect(process.env.CI === undefined || environment.env !== null).toBe(true);
  });
});

describe.skipIf(environment.env === null)('community domain (local Supabase integration)', () => {
  function env(): LocalEnv {
    if (!environment.env) throw new Error(environment.reason);
    return environment.env;
  }
  function anon() {
    const { url, key } = env();
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  type Actor = { client: SupabaseClient; id: string };
  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const signup = await anon().auth.signUp({
      email: `${label}-${crypto.randomUUID()}@test.local`,
      password: 'Password123!'
    });
    expect(signup.error).toBeNull();
    const token = signup.data.session?.access_token;
    expect(token, 'local email confirmations must be disabled').toBeTruthy();
    return {
      id: signup.data.user!.id,
      client: createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      })
    };
  }
  async function rows(
    client: SupabaseClient,
    table: 'communities' | 'community_members' | 'community_venues' | 'community_audit_log',
    communityId: string
  ) {
    const query = client.from(table).select('*');
    const result =
      table === 'communities'
        ? await query.eq('id', communityId)
        : await query.eq('community_id', communityId);
    expect(result.error).toBeNull();
    return result.data ?? [];
  }
  const invitationColumns =
    'id,community_id,invitee_user_id,issued_by,expires_at,redeemed_at,revoked_at,created_at';
  let admin: Actor,
    member: Actor,
    invited: Actor,
    pending: Actor,
    inactive: Actor,
    outsider: Actor,
    publicActor: Actor;
  let privateId: string,
    publicId: string,
    memberRow: string,
    pendingRow: string,
    inactiveRow: string,
    inviteId: string,
    venueId: string;
  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
    [admin, member, invited, pending, inactive, outsider, publicActor] = await Promise.all([
      actor('admin'),
      actor('member'),
      actor('invited'),
      actor('pending'),
      actor('inactive'),
      actor('outsider'),
      actor('public')
    ]);
    async function create(name: string, visibility: 'private' | 'public') {
      const result = await admin.client.rpc('create_community', {
        p_name: name,
        p_visibility: visibility
      });
      expect(result.error).toBeNull();
      if (typeof result.data !== 'string') throw new Error('create_community returned no ID');
      return result.data;
    }
    privateId = await create('Private ' + crypto.randomUUID(), 'private');
    publicId = await create('Public ' + crypto.randomUUID(), 'public');
    for (const [user, status] of [
      [member, 'active'],
      [pending, 'pending'],
      [inactive, 'active']
    ] as const) {
      const result = await admin.client
        .from('community_members')
        .insert({ community_id: privateId, user_id: user.id, status })
        .select('id')
        .single();
      expect(result.error).toBeNull();
      if (user === member) memberRow = result.data!.id;
      if (user === pending) pendingRow = result.data!.id;
      if (user === inactive) inactiveRow = result.data!.id;
    }
    const closed = await admin.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: new Date(Date.now() + 1000).toISOString() })
      .eq('id', inactiveRow);
    expect(closed.error).toBeNull();
    const invitation = await admin.client
      .from('community_invitations')
      .insert({
        community_id: privateId,
        invitee_user_id: invited.id,
        token_hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
      .select('id')
      .single();
    expect(invitation.error).toBeNull();
    inviteId = invitation.data!.id;
    const venue = await admin.client
      .from('community_venues')
      .insert({ community_id: privateId, name: 'Court' })
      .select('id')
      .single();
    expect(venue.error).toBeNull();
    venueId = venue.data!.id;
    expect(await rows(admin.client, 'communities', privateId)).toHaveLength(1);
    const first = (await rows(admin.client, 'community_members', privateId)).find(
      (m) => m.user_id === admin.id
    );
    expect(first).toMatchObject({ role: 'admin', status: 'active', valid_until: null });
    expect(
      (await admin.client.from('communities').select('id').eq('id', publicId)).data
    ).toHaveLength(1);
    for (const visibility of ['public', 'private'] as const) {
      expect(
        (
          await admin.client.rpc('create_community', {
            p_name: 'Enum ' + crypto.randomUUID(),
            p_visibility: visibility
          })
        ).error
      ).toBeNull();
    }
    expect(
      (await admin.client.rpc('create_community', { p_name: 'Invalid', p_visibility: 'secret' }))
        .error?.code
    ).toBe('22P02');
    expect(
      (
        await admin.client
          .from('community_members')
          .insert({ community_id: privateId, user_id: outsider.id, status: 'unknown' })
      ).error?.code
    ).toBe('22P02');
    expect(
      (
        await admin.client.from('community_members').insert({
          community_id: privateId,
          user_id: outsider.id,
          status: 'pending',
          role: 'owner'
        })
      ).error?.code
    ).toBe('22P02');
  });

  it('AC3: closed intervals survive, cannot reopen/delete, and rejoin creates another row', async () => {
    const history = (await rows(inactive.client, 'community_members', privateId)).filter(
      (m) => m.user_id === inactive.id
    );
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ status: 'inactive' });
    expect(history[0].activated_at).not.toBeNull();
    expect(new Date(history[0].activated_at).getTime()).toBeLessThanOrEqual(
      new Date(history[0].valid_until).getTime()
    );
    expect(
      (
        await admin.client.from('community_members').insert({
          community_id: privateId,
          user_id: outsider.id,
          status: 'inactive'
        })
      ).error?.code
    ).toBe('23514');
    expect(
      (
        await admin.client
          .from('community_members')
          .update({ status: 'inactive' })
          .eq('id', pendingRow)
      ).error?.code
    ).toBe('23514');
    expect(new Date(history[0].valid_until).getTime()).toBeGreaterThan(
      new Date(history[0].valid_from).getTime()
    );
    expect(
      (
        await admin.client
          .from('community_members')
          .update({ status: 'active', valid_until: null })
          .eq('id', inactiveRow)
      ).error?.code
    ).toBe('23514');
    expect(
      (await admin.client.from('community_members').delete().eq('id', inactiveRow)).error?.code
    ).toBe('42501');
    const rejoin = await admin.client
      .from('community_members')
      .insert({ community_id: privateId, user_id: inactive.id, status: 'pending' })
      .select('id')
      .single();
    expect(rejoin.error).toBeNull();
    expect(rejoin.data!.id).not.toBe(inactiveRow);
    expect(
      (await rows(inactive.client, 'community_members', privateId)).filter(
        (m) => m.user_id === inactive.id
      )
    ).toHaveLength(2);
    expect(
      (
        await admin.client
          .from('community_members')
          .insert({ community_id: privateId, user_id: inactive.id, status: 'pending' })
      ).error?.code
    ).toBe('23505');
    expect(
      (
        await admin.client
          .from('community_members')
          .update({ valid_from: '2000-01-01' })
          .eq('id', memberRow)
      ).error?.code
    ).toBe('42501');
  });

  it('AC4: private rows hidden filtered and unfiltered; only own invitation is exposed', async () => {
    for (const user of [outsider, publicActor, invited, pending, inactive]) {
      expect(await rows(user.client, 'communities', privateId)).toEqual([]);
      expect(
        (await user.client.from('communities').select('id')).data?.map((row) => row.id)
      ).not.toContain(privateId);
      expect(await rows(user.client, 'community_venues', privateId)).toEqual([]);
      expect(
        (await user.client.from('community_venues').select('id')).data?.map((row) => row.id)
      ).not.toContain(venueId);
      expect(await rows(user.client, 'community_audit_log', privateId)).toEqual([]);
      expect(
        (await user.client.from('community_audit_log').select('community_id')).data?.map(
          (row) => row.community_id
        )
      ).not.toContain(privateId);
      const filtered = await user.client
        .from('community_invitations')
        .select(invitationColumns)
        .eq('community_id', privateId);
      const unfiltered = await user.client.from('community_invitations').select(invitationColumns);
      expect(filtered.error).toBeNull();
      expect(unfiltered.error).toBeNull();
      expect(filtered.data?.map((row) => row.id)).toEqual(user === invited ? [inviteId] : []);
      expect(unfiltered.data?.map((row) => row.id).filter((id) => id === inviteId)).toEqual(
        user === invited ? [inviteId] : []
      );
      const membership = await user.client
        .from('community_members')
        .select('id,user_id')
        .eq('community_id', privateId);
      const allMembership = await user.client.from('community_members').select('id,user_id');
      expect(membership.error).toBeNull();
      expect(allMembership.error).toBeNull();
      expect(membership.data?.every((row) => row.user_id === user.id)).toBe(true);
      expect(
        allMembership.data
          ?.filter((row) => [memberRow, pendingRow, inactiveRow].includes(row.id))
          .every((row) => row.user_id === user.id)
      ).toBe(true);
      expect(
        (await user.client.rpc('can_read_community', { p_community_id: privateId })).data
      ).toBe(false);
    }
    expect(await rows(member.client, 'communities', privateId)).toHaveLength(1);
    expect(
      (await member.client.rpc('is_community_member', { p_community_id: privateId })).data
    ).toBe(true);
    expect((await admin.client.rpc('is_community_admin', { p_community_id: privateId })).data).toBe(
      true
    );
    expect(
      (await outsider.client.rpc('can_read_community', { p_community_id: publicId })).data
    ).toBe(true);
    expect(await rows(outsider.client, 'communities', publicId)).toHaveLength(1);
    expect((await invited.client.from('community_invitations').select('*')).error?.code).toBe(
      '42501'
    );
  });

  it('AC5: admin alone mutates rows/settings; member sees own interval, not roster', async () => {
    expect((await rows(member.client, 'community_members', privateId)).map((m) => m.id)).toEqual([
      memberRow
    ]);
    expect((await rows(admin.client, 'community_members', privateId)).length).toBeGreaterThan(3);
    const communityUpdatedAt = (await rows(admin.client, 'communities', privateId))[0].updated_at;
    const venueUpdatedAt = (await rows(admin.client, 'community_venues', privateId))[0].updated_at;
    const update = await admin.client
      .from('communities')
      .update({ settings: { courts: 2 } })
      .eq('id', privateId);
    expect(update.error).toBeNull();
    const updatedCommunity = (await rows(admin.client, 'communities', privateId))[0];
    expect(updatedCommunity.settings).toEqual({ courts: 2 });
    expect(new Date(updatedCommunity.updated_at).getTime()).toBeGreaterThan(
      new Date(communityUpdatedAt).getTime()
    );
    expect(
      (await admin.client.from('community_venues').update({ name: 'Court 2' }).eq('id', venueId))
        .error
    ).toBeNull();
    expect(
      new Date((await rows(admin.client, 'community_venues', privateId))[0].updated_at).getTime()
    ).toBeGreaterThan(new Date(venueUpdatedAt).getTime());
    expect(
      (
        await admin.client
          .from('community_invitations')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', inviteId)
      ).error
    ).toBeNull();
    const openInvitation = await admin.client
      .from('community_invitations')
      .insert({
        community_id: privateId,
        invitee_user_id: outsider.id,
        token_hash: crypto.randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
      .select(invitationColumns)
      .single();
    expect(openInvitation.error).toBeNull();
    expect(openInvitation.data?.revoked_at).toBeNull();
    const forgedRevoke = await outsider.client
      .from('community_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', openInvitation.data!.id)
      .select(invitationColumns);
    expect(forgedRevoke.error).toBeNull();
    expect(forgedRevoke.data).toEqual([]);
    const openAfterForgedRevoke = await admin.client
      .from('community_invitations')
      .select(invitationColumns)
      .eq('id', openInvitation.data!.id)
      .single();
    expect(openAfterForgedRevoke.error).toBeNull();
    expect(openAfterForgedRevoke.data).toMatchObject({ revoked_at: null, redeemed_at: null });
    for (const user of [outsider, invited, pending, inactive, member]) {
      expect(
        (
          await user.client
            .from('community_members')
            .insert({ community_id: privateId, user_id: user.id, status: 'active' })
        ).error?.code
      ).toBe('42501');
      expect(
        (
          await user.client.from('community_invitations').insert({
            community_id: privateId,
            invitee_user_id: user.id,
            token_hash: 'a'.repeat(64),
            expires_at: new Date(Date.now() + 86400000).toISOString()
          })
        ).error?.code
      ).toBe('42501');
      expect(
        (
          await user.client
            .from('community_venues')
            .insert({ community_id: privateId, name: 'Forged' })
        ).error?.code
      ).toBe('42501');
      for (const result of [
        await user.client.from('community_members').update({ role: 'admin' }).eq('id', memberRow),
        await user.client
          .from('community_invitations')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', inviteId),
        await user.client.from('community_venues').update({ name: 'Forged' }).eq('id', venueId),
        await user.client
          .from('communities')
          .update({ settings: { forged: true } })
          .eq('id', privateId)
      ])
        expect(result.error).toBeNull();
      expect(
        (await user.client.rpc('is_community_admin', { p_community_id: privateId })).data
      ).toBe(false);
    }
    const ownActivation = await pending.client
      .from('community_members')
      .update({ status: 'active' })
      .eq('id', pendingRow)
      .select('id');
    expect(ownActivation.error).toBeNull();
    expect(ownActivation.data).toEqual([]);
    expect(
      (await rows(admin.client, 'community_members', privateId)).find((m) => m.id === pendingRow)
    ).toMatchObject({ status: 'pending', activated_at: null });
    expect((await rows(admin.client, 'communities', privateId))[0].settings).toEqual({ courts: 2 });
    expect((await rows(admin.client, 'community_venues', privateId))[0].name).toBe('Court 2');
    expect(
      (await rows(admin.client, 'community_members', privateId)).find((m) => m.id === memberRow)
        ?.role
    ).toBe('member');
    expect(
      (
        await admin.client
          .from('community_members')
          .update({ user_id: outsider.id })
          .eq('id', memberRow)
      ).error?.code
    ).toBe('42501');
    expect(
      (
        await admin.client
          .from('community_invitations')
          .update({ token_hash: 'b'.repeat(64) })
          .eq('id', inviteId)
      ).error?.code
    ).toBe('42501');
    expect(
      (
        await admin.client
          .from('communities')
          .update({ created_by: outsider.id })
          .eq('id', privateId)
      ).error?.code
    ).toBe('42501');
  });

  it('AC6: signed-out guest cannot access tables or call privileged functions', async () => {
    for (const table of [
      'communities',
      'community_members',
      'community_invitations',
      'community_venues',
      'community_audit_log'
    ] as const) {
      expect((await anon().from(table).select('id')).error?.code).toBe('42501');
    }
    for (const name of ['is_community_member', 'is_community_admin', 'can_read_community'] as const)
      expect((await anon().rpc(name, { p_community_id: privateId })).error?.code).toBe('42501');
    expect(
      (await anon().rpc('create_community', { p_name: 'Anon', p_visibility: 'public' })).error?.code
    ).toBe('42501');
  });

  it('AC7: final-admin guard survives simultaneous demotion; audit is append-only/admin-only', async () => {
    const only = (await rows(admin.client, 'community_members', privateId)).find(
      (m) => m.user_id === admin.id
    )!;
    expect(
      (await admin.client.from('community_members').update({ role: 'member' }).eq('id', only.id))
        .error?.code
    ).toBe('23514');
    const promoted = await admin.client
      .from('community_members')
      .update({ role: 'admin' })
      .eq('id', memberRow);
    expect(promoted.error).toBeNull();
    const [a, b] = await Promise.all([
      admin.client.from('community_members').update({ role: 'member' }).eq('id', only.id),
      member.client.from('community_members').update({ role: 'member' }).eq('id', memberRow)
    ]);
    expect([a.error?.code, b.error?.code].filter(Boolean)).toEqual(['23514']);
    const ownAdmin = (await rows(admin.client, 'community_members', privateId)).find(
      (m) => m.user_id === admin.id
    );
    const ownMember = (await rows(member.client, 'community_members', privateId)).find(
      (m) => m.user_id === member.id
    );
    const admins = [ownAdmin, ownMember].filter(
      (m) => m?.role === 'admin' && m.status === 'active'
    );
    expect(admins).toHaveLength(1);
    const reader = admins[0]!.user_id === admin.id ? admin : member;
    const audit = await rows(reader.client, 'community_audit_log', privateId);
    expect(audit.length).toBeGreaterThanOrEqual(9);
    expect(
      audit.some(
        (event) => event.entity === 'community_members' && event.actor_user_id === admin.id
      )
    ).toBe(true);
    expect(
      audit.some((event) => event.entity === 'community_venues' && event.action === 'UPDATE')
    ).toBe(true);
    expect(
      (
        await member.client.from('community_audit_log').insert({
          community_id: privateId,
          entity: 'communities',
          entity_id: privateId,
          action: 'INSERT'
        })
      ).error?.code
    ).toBe('42501');
    expect(
      (await reader.client.from('community_audit_log').delete().eq('community_id', privateId)).error
        ?.code
    ).toBe('42501');
    expect(await rows(outsider.client, 'community_audit_log', privateId)).toEqual([]);
  });

  it('activation separates denied requests from former members', async () => {
    const currentAdmin = (
      await admin.client.rpc('is_community_admin', { p_community_id: privateId })
    ).data
      ? admin
      : member;
    const denied = await currentAdmin.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: new Date(Date.now() + 1000).toISOString() })
      .eq('id', pendingRow);
    expect(denied.error).toBeNull();
    const deniedRow = (await rows(currentAdmin.client, 'community_members', privateId)).find(
      (row) => row.id === pendingRow
    );
    expect(deniedRow).toMatchObject({ status: 'inactive', activated_at: null });

    const approved = await actor('approved');
    const request = await currentAdmin.client
      .from('community_members')
      .insert({ community_id: privateId, user_id: approved.id, status: 'pending' })
      .select('id,activated_at')
      .single();
    expect(request.error).toBeNull();
    expect(request.data?.activated_at).toBeNull();
    const activated = await currentAdmin.client
      .from('community_members')
      .update({ status: 'active' })
      .eq('id', request.data!.id);
    expect(activated.error).toBeNull();
    const activeRow = (await rows(currentAdmin.client, 'community_members', privateId)).find(
      (row) => row.id === request.data!.id
    );
    expect(activeRow?.activated_at).not.toBeNull();
    expect(activeRow?.valid_until).toBeNull();
    expect(new Date(activeRow!.activated_at).getTime()).toBeGreaterThanOrEqual(
      new Date(activeRow!.valid_from).getTime()
    );
  });

  it('rejects closing an approved request before activation, but accepts the activation boundary', async () => {
    const currentAdmin = (
      await admin.client.rpc('is_community_admin', { p_community_id: privateId })
    ).data
      ? admin
      : member;
    const applicant = await actor('interval');
    const request = await currentAdmin.client
      .from('community_members')
      .insert({ community_id: privateId, user_id: applicant.id, status: 'pending' })
      .select('id,valid_from,activated_at')
      .single();
    expect(request.error).toBeNull();
    expect(request.data?.activated_at).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const approval = await currentAdmin.client
      .from('community_members')
      .update({ status: 'active' })
      .eq('id', request.data!.id)
      .select('id,status,valid_from,valid_until,activated_at')
      .single();
    expect(approval.error).toBeNull();
    const activeRow = approval.data!;
    expect(activeRow).toMatchObject({ status: 'active', valid_until: null });
    expect(activeRow.activated_at).not.toBeNull();
    const start = new Date(activeRow.valid_from).getTime();
    const activation = new Date(activeRow.activated_at).getTime();
    expect(activation - start).toBeGreaterThan(1);
    const prematureEnd = new Date(Math.floor((start + activation) / 2)).toISOString();
    const rejected = await currentAdmin.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: prematureEnd })
      .eq('id', activeRow.id);
    expect(rejected.error?.code).toBe('23514');
    expect(rejected.error?.message).toContain('membership_activation_interval');
    const afterRejection = await currentAdmin.client
      .from('community_members')
      .select('id,status,valid_from,valid_until,activated_at')
      .eq('id', activeRow.id)
      .single();
    expect(afterRejection.error).toBeNull();
    expect(afterRejection.data).toEqual(activeRow);

    const closed = await currentAdmin.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: activeRow.activated_at })
      .eq('id', activeRow.id)
      .select('status,valid_until,activated_at')
      .single();
    expect(closed.error).toBeNull();
    expect(closed.data).toMatchObject({
      status: 'inactive',
      valid_until: activeRow.activated_at,
      activated_at: activeRow.activated_at
    });
  });
});
