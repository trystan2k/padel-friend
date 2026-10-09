import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const serverClient = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: () => serverClient.current }));
import {
  addCommunityVenue,
  approveCommunityMember,
  archiveCommunityVenue,
  demoteCommunityMember,
  denyCommunityMember,
  editCommunityVenue,
  getCommunityMemberById,
  issueInvitation,
  listMyAdminCommunities,
  listCommunityAudit,
  listCommunityVenues,
  promoteCommunityMember,
  reactivateCommunityMember,
  removeCommunityMember,
  revokeInvitation,
  searchCommunityMembers
} from '../src/features/community/community-admin.functions';
import {
  acceptInvitation,
  leaveCommunity,
  updateCommunitySettings
} from '../src/features/community/community.functions';

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
const vars = new Map(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
    .map((line) => {
      const at = line.indexOf('=');
      return [line.slice(0, at), line.slice(at + 1).replace(/^['"]|['"]$/g, '')];
    })
);
const url = process.env.VITE_SUPABASE_URL ?? vars.get('VITE_SUPABASE_URL') ?? '';
const key =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? vars.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname))
  throw new Error('Integration requires loopback backend');
function anon() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Actor = { id: string; client: SupabaseClient };
async function actor(label: string): Promise<Actor> {
  const result = await anon().auth.signUp({
    email: `${label}-${crypto.randomUUID()}@test.local`,
    password: 'Password123!'
  });
  expect(result.error).toBeNull();
  const session = result.data.session!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } }
  });
  expect((await client.auth.setSession(session)).error).toBeNull();
  expect(
    (
      await client.rpc('onboard_player', {
        p_display_name: label,
        p_preferred_side: 'EITHER',
        p_initial_level: 3
      })
    ).error
  ).toBeNull();
  return { id: result.data.user!.id, client };
}
async function community(admin: Actor) {
  const created = await admin.client.rpc('create_community', {
    p_name: `Club ${crypto.randomUUID()}`,
    p_visibility: 'private',
    p_join_policy: 'instant'
  });
  expect(created.error).toBeNull();
  if (typeof created.data !== 'string') throw new Error('Community creation failed');
  return created.data;
}
async function membership(
  admin: Actor,
  community_id: string,
  user: Actor,
  status: 'pending' | 'active',
  role: 'member' | 'admin' = 'member'
) {
  const result = await admin.client
    .from('community_members')
    .insert({ community_id, user_id: user.id, status, role })
    .select('id')
    .single();
  expect(result.error).toBeNull();
  if (!result.data) throw new Error('Membership creation failed');
  return result.data.id;
}
async function audit(admin: Actor, id: string) {
  const result = await admin.client
    .from('community_audit_log')
    .select('id,actor_user_id,entity,entity_id,action,details')
    .eq('community_id', id)
    .order('id');
  expect(result.error).toBeNull();
  return result.data!;
}
let admin: Actor, member: Actor, outsider: Actor, target: Actor, alternate: Actor;
beforeAll(async () => {
  [admin, member, outsider, target, alternate] = await Promise.all([
    actor('Admin'),
    actor('Member'),
    actor('Outsider'),
    actor('Target'),
    actor('Alternate')
  ]);
});

describe('community governance with real JWTs', () => {
  const actions = [
    ['approve', approveCommunityMember, 'pending', 'member', 'active', 'member'],
    ['deny', denyCommunityMember, 'pending', 'member', 'inactive', 'member'],
    ['remove', removeCommunityMember, 'active', 'member', 'inactive', 'member'],
    ['reactivate', reactivateCommunityMember, 'inactive', 'member', 'active', 'member'],
    ['promote', promoteCommunityMember, 'active', 'member', 'active', 'admin'],
    ['demote', demoteCommunityMember, 'active', 'admin', 'active', 'member']
  ] as const;
  for (const [name, fn, initial, role, expectedStatus, expectedRole] of actions) {
    it(`${name}: role matrix, history and one audited transition`, async () => {
      const id = await community(admin);
      await membership(admin, id, member, 'active');
      const targetId = await membership(
        admin,
        id,
        target,
        initial === 'inactive' ? 'active' : initial,
        role
      );
      if (initial === 'inactive') {
        serverClient.current = admin.client;
        await removeCommunityMember({ data: { community_id: id, membership_id: targetId } });
      }
      const before = await audit(admin, id);
      const input = { community_id: id, membership_id: targetId };
      for (const unauthorized of [member, outsider]) {
        serverClient.current = unauthorized.client;
        await expect(fn({ data: input })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
        expect(await audit(admin, id)).toEqual(before);
      }
      serverClient.current = anon();
      await expect(fn({ data: input })).rejects.toThrow('UNAUTHENTICATED');
      const direct = await anon().rpc('govern_community_member', {
        p_community_id: id,
        p_membership_id: targetId,
        p_action: name
      });
      expect(direct.error?.code).toBe('42501');
      serverClient.current = admin.client;
      const originalBefore = await admin.client
        .from('community_members')
        .select('id,status,role,valid_from,valid_until,activated_at')
        .eq('id', targetId)
        .single();
      expect(originalBefore.error).toBeNull();
      const changed = await fn({ data: input });
      expect(changed).toMatchObject({ status: expectedStatus, role: expectedRole });
      const original = await admin.client
        .from('community_members')
        .select('id,status,role,valid_from,valid_until,activated_at')
        .eq('id', targetId)
        .single();
      expect(original.error).toBeNull();
      let current = original;
      if (name === 'reactivate') {
        current = await admin.client
          .from('community_members')
          .select('id,status,role,valid_from,valid_until,activated_at')
          .eq('id', changed.membership_id)
          .single();
      }
      if (!originalBefore.data || !original.data || !current.data)
        throw new Error('Persisted membership row missing');
      expect(current.error).toBeNull();
      expect(changed.membership_id === targetId).toBe(name !== 'reactivate');
      expect(original.data).toMatchObject(
        name === 'reactivate'
          ? originalBefore.data
          : {
              id: targetId,
              status: expectedStatus,
              role: expectedRole,
              valid_from: originalBefore.data.valid_from
            }
      );
      expect(current.data).toMatchObject({
        id: changed.membership_id,
        status: expectedStatus,
        role: expectedRole
      });
      expect(current.data?.valid_until === null).toBe(expectedStatus === 'active');
      expect(Boolean(current.data?.activated_at)).toBe(name !== 'deny');
      expect(Boolean(current.data?.valid_from)).toBe(true);
      const intervalIsOrdered =
        name !== 'reactivate' ||
        Date.parse(current.data.valid_from) >= Date.parse(original.data.valid_until);
      expect(intervalIsOrdered).toBe(true);
      const after = await audit(admin, id);
      expect(after).toHaveLength(before.length + 1);
      expect(after.filter((row) => !before.some((previous) => previous.id === row.id))).toEqual([
        expect.objectContaining({
          actor_user_id: admin.id,
          entity: 'community_members',
          entity_id: changed.membership_id,
          action: name === 'reactivate' ? 'INSERT' : 'UPDATE',
          details: { role: expectedRole, status: expectedStatus }
        })
      ]);
    });
  }

  it('cross-community targets hide identity, invalid transitions leave no audit, last admin guard blocks direct writes', async () => {
    const id = await community(admin);
    const other = await community(outsider);
    const foreign = await membership(outsider, other, target, 'pending');
    const mine = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id)
      .eq('user_id', admin.id)
      .single();
    const before = await audit(admin, id);
    serverClient.current = admin.client;
    await expect(
      approveCommunityMember({ data: { community_id: id, membership_id: foreign } })
    ).rejects.toThrow('COMMUNITY_MEMBER_NOT_FOUND');
    await expect(
      approveCommunityMember({ data: { community_id: id, membership_id: mine.data!.id } })
    ).rejects.toThrow('INVALID_MEMBERSHIP_TRANSITION');
    for (const fn of [demoteCommunityMember, removeCommunityMember])
      await expect(
        fn({ data: { community_id: id, membership_id: mine.data!.id } })
      ).rejects.toThrow('FINAL_COMMUNITY_ADMIN');
    const direct = await admin.client
      .from('community_members')
      .update({ role: 'member' })
      .eq('id', mine.data!.id);
    expect(direct.error?.code).toBe('23514');
    expect(await audit(admin, id)).toEqual(before);
  });

  it('last Admin and two concurrent independent Admin JWTs retain an active Admin', async () => {
    const id = await community(admin);
    const secondId = await membership(admin, id, alternate, 'active', 'admin');
    const first = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id)
      .eq('user_id', admin.id)
      .single();
    const before = await audit(admin, id);
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: id,
          p_membership_id: first.data!.id,
          p_action: 'remove'
        })
      ).error
    ).toBeNull();
    expect(
      (
        await alternate.client.rpc('govern_community_member', {
          p_community_id: id,
          p_membership_id: secondId,
          p_action: 'demote'
        })
      ).error?.code
    ).toBe('PG002');
    expect(await audit(alternate, id)).toHaveLength(before.length + 1);

    const id2 = await community(admin);
    const otherId = await membership(admin, id2, alternate, 'active', 'admin');
    const original = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id2)
      .eq('user_id', admin.id)
      .single();
    const outcome = await Promise.all([
      admin.client.rpc('govern_community_member', {
        p_community_id: id2,
        p_membership_id: otherId,
        p_action: 'demote'
      }),
      alternate.client.rpc('govern_community_member', {
        p_community_id: id2,
        p_membership_id: original.data!.id,
        p_action: 'remove'
      })
    ]);
    expect(outcome.filter((result) => result.error === null)).toHaveLength(1);
    expect(['PG001', 'PG002', '40P01', '40001']).toContain(
      outcome.find((result) => result.error)?.error?.code
    );
    const surviving = outcome[0].error ? alternate : admin;
    const rows = await surviving.client
      .from('community_members')
      .select('role,status')
      .eq('community_id', id2);
    expect(
      rows.data!.filter((row) => row.role === 'admin' && row.status === 'active')
    ).toHaveLength(1);
    expect(await audit(surviving, id2)).toHaveLength(4);
  });

  it('scoped search, audit and venues deny members/outsiders and reject malformed search', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    const other = await community(outsider);
    serverClient.current = admin.client;
    await vi.waitFor(
      async () =>
        expect(await listMyAdminCommunities()).toContainEqual(expect.objectContaining({ id })),
      { timeout: 5000, interval: 25 }
    );
    expect(await listMyAdminCommunities()).not.toContainEqual(
      expect.objectContaining({ id: other })
    );
    serverClient.current = member.client;
    expect(await listMyAdminCommunities()).not.toContainEqual(expect.objectContaining({ id }));
    const foreignMembershipId = await membership(outsider, other, target, 'active');
    const page = { community_id: id, offset: 0, limit: 20 };
    for (const fn of [listCommunityAudit, listCommunityVenues]) {
      for (const user of [member, outsider]) {
        serverClient.current = user.client;
        await expect(fn({ data: page })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      }
      serverClient.current = anon();
      await expect(fn({ data: page })).rejects.toThrow('UNAUTHENTICATED');
      serverClient.current = admin.client;
      expect(await fn({ data: page })).toBeInstanceOf(Array);
    }
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        searchCommunityMembers({ data: { ...page, query: '', status: null } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(searchCommunityMembers({ data: { ...page, query: '' } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect((await anon().rpc('search_community_members', { p_community_id: id })).error?.code).toBe(
      '42501'
    );
    expect(
      (await member.client.rpc('search_community_members', { p_community_id: id })).error?.code
    ).toBe('PG001');
    serverClient.current = admin.client;
    const rows = await searchCommunityMembers({
      data: { ...page, query: 'Mem%_\\', status: null }
    });
    expect(rows).toEqual([]);
    const found = await searchCommunityMembers({
      data: { ...page, query: 'mem', status: 'active' }
    });
    expect(found).toHaveLength(1);
    const direct = await getCommunityMemberById({
      data: { community_id: id, membership_id: found[0]!.membership_id }
    });
    expect(direct.membership_id).toBe(found[0]!.membership_id);
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: foreignMembershipId } })
    ).rejects.toThrow('COMMUNITY_MEMBER_NOT_FOUND');
    serverClient.current = member.client;
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: found[0]!.membership_id } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = anon();
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: found[0]!.membership_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    expect((await searchCommunityMembers({ data: { ...page, status: 'pending' } })).length).toBe(0);
    expect(Object.keys(found[0]!).sort()).toEqual(
      [
        'activated_at',
        'display_level',
        'display_name',
        'membership_id',
        'reliability_percent',
        'role',
        'status',
        'user_id',
        'valid_from',
        'valid_until'
      ].sort()
    );
    await expect(
      searchCommunityMembers({ data: { ...page, community_id: other, query: '' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
  });

  it('venue mutations archive without DELETE and invitation token is bound to invitee', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    const before = await audit(admin, id);
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        addCommunityVenue({ data: { community_id: id, name: 'Court' } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      await expect(
        issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(addCommunityVenue({ data: { community_id: id, name: 'Court' } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(await audit(admin, id)).toEqual(before);
    serverClient.current = admin.client;
    const venue = await addCommunityVenue({ data: { community_id: id, name: 'Court' } });
    const other = await community(outsider);
    serverClient.current = outsider.client;
    await expect(
      editCommunityVenue({ data: { community_id: other, venue_id: venue.id, name: 'Other' } })
    ).rejects.toThrow('COMMUNITY_VENUE_NOT_FOUND');
    serverClient.current = admin.client;
    await editCommunityVenue({ data: { community_id: id, venue_id: venue.id, name: 'Court two' } });
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        editCommunityVenue({ data: { community_id: id, venue_id: venue.id, name: 'Other' } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      await expect(
        archiveCommunityVenue({ data: { community_id: id, venue_id: venue.id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = admin.client;
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: member.id } })
    ).rejects.toThrow('ALREADY_MEMBER_OR_PENDING');
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: crypto.randomUUID() } })
    ).rejects.toThrow('INVITEE_NOT_FOUND');
    const archived = await archiveCommunityVenue({
      data: { community_id: id, venue_id: venue.id }
    });
    expect(archived.archived_at).toBeTruthy();
    expect(await listCommunityVenues({ data: { community_id: id } })).toEqual([]);
    const issued = await issueInvitation({
      data: { community_id: id, invitee_user_id: target.id }
    });
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
    ).rejects.toThrow('INVITATION_ALREADY_OPEN');
    const revocable = await issueInvitation({
      data: { community_id: id, invitee_user_id: alternate.id }
    });
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        revokeInvitation({ data: { community_id: id, invitation_id: revocable.invitation_id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(
      revokeInvitation({ data: { community_id: id, invitation_id: revocable.invitation_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    expect(
      (
        await revokeInvitation({
          data: { community_id: id, invitation_id: revocable.invitation_id }
        })
      ).revoked_at
    ).toBeTruthy();
    expect(
      (await issueInvitation({ data: { community_id: id, invitee_user_id: alternate.id } })).token
    ).not.toBe(revocable.token);
    serverClient.current = outsider.client;
    await expect(acceptInvitation({ data: { token: issued.token } })).rejects.toThrow(
      'INVITATION_NOT_FOR_USER'
    );
    serverClient.current = target.client;
    expect(await acceptInvitation({ data: { token: issued.token } })).toMatchObject({
      community_id: id,
      status: 'active'
    });
    await expect(acceptInvitation({ data: { token: issued.token } })).rejects.toThrow(
      'INVITATION_USED'
    );
    const after = await audit(admin, id);
    expect(after.filter((row) => row.entity === 'community_venues')).toHaveLength(3);
    expect(after.filter((row) => row.entity === 'community_invitations')).toHaveLength(5);
    expect(JSON.stringify(after)).not.toContain(issued.token);
    serverClient.current = admin.client;
    const events = await listCommunityAudit({ data: { community_id: id } });
    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(events[0]!).sort()).toEqual(
      ['id', 'actor_user_id', 'entity', 'entity_id', 'action', 'details', 'occurred_at'].sort()
    );
  });

  it('settings patch preserves unrelated keys under Admin-only RLS', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    serverClient.current = admin.client;
    await updateCommunitySettings({ data: { community_id: id, settings: { keep: 'yes' } } });
    serverClient.current = member.client;
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = outsider.client;
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = anon();
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    const updated = await updateCommunitySettings({
      data: { community_id: id, join_policy: 'admin_approval' }
    });
    expect(updated.settings).toEqual({ keep: 'yes' });
  });

  it('blocks final-admin leave and serializes simultaneous admin departures', async () => {
    const soloCommunity = await community(admin);
    const soloAdmin = await admin.client
      .from('community_members')
      .select('id,status,role,valid_until')
      .eq('community_id', soloCommunity)
      .eq('user_id', admin.id)
      .single();
    expect(soloAdmin.error).toBeNull();
    const soloAudit = await audit(admin, soloCommunity);
    serverClient.current = admin.client;
    await expect(leaveCommunity({ data: { community_id: soloCommunity } })).rejects.toThrow(
      'FINAL_COMMUNITY_ADMIN'
    );
    expect(
      (await admin.client.rpc('leave_community', { p_community_id: soloCommunity })).error?.code
    ).toBe('PL002');
    const unchanged = await admin.client
      .from('community_members')
      .select('id,status,role,valid_until')
      .eq('id', soloAdmin.data!.id)
      .single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual(soloAdmin.data);
    expect(await audit(admin, soloCommunity)).toEqual(soloAudit);

    const sharedCommunity = await community(admin);
    await membership(admin, sharedCommunity, alternate, 'active', 'admin');
    const before = await audit(admin, sharedCommunity);
    const [adminLeave, alternateLeave] = await Promise.all([
      admin.client.rpc('leave_community', { p_community_id: sharedCommunity }),
      alternate.client.rpc('leave_community', { p_community_id: sharedCommunity })
    ]);
    expect([adminLeave, alternateLeave].filter(({ error }) => !error)).toHaveLength(1);
    expect([adminLeave, alternateLeave].find(({ error }) => error)?.error?.code).toBe('PL002');
    const survivor = adminLeave.error ? admin : alternate;
    const persisted = await survivor.client
      .from('community_members')
      .select('user_id,role,status,valid_until')
      .eq('community_id', sharedCommunity);
    expect(persisted.error).toBeNull();
    expect(
      persisted.data?.filter(
        (row) => row.role === 'admin' && row.status === 'active' && row.valid_until === null
      )
    ).toHaveLength(1);
    expect(await audit(survivor, sharedCommunity)).toHaveLength(before.length + 1);
    serverClient.current = null;
  });
});
