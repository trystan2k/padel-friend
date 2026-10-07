import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';

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
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));
vi.mock('../src/lib/supabase/server', () => ({
  getServerClient: () => {
    if (!serverClient.current) throw new Error('Missing integration client');
    return serverClient.current;
  }
}));
import {
  acceptInvitation,
  createCommunity,
  getPublicCommunity,
  joinCommunity,
  listPublicCommunities,
  updateCommunitySettings
} from '../src/features/community/community.functions';

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
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });
    const session = await client.auth.setSession({
      access_token: token!,
      refresh_token: signup.data.session!.refresh_token
    });
    expect(session.error).toBeNull();
    return { id: signup.data.user!.id, client };
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
        p_visibility: visibility,
        p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
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
    expect((await rows(admin.client, 'communities', privateId))[0].join_policy).toBe(
      'admin_approval'
    );
    expect((await rows(admin.client, 'communities', publicId))[0].join_policy).toBe('instant');
    expect(await rows(admin.client, 'communities', privateId)).toHaveLength(1);
    for (const communityId of [privateId, publicId]) {
      const creatorMembership = (await rows(admin.client, 'community_members', communityId)).filter(
        (membership) => membership.user_id === admin.id
      );
      expect(creatorMembership).toHaveLength(1);
      expect(creatorMembership[0]).toMatchObject({
        role: 'admin',
        status: 'active',
        valid_until: null
      });
      expect(Date.parse(creatorMembership[0].activated_at)).toBeGreaterThanOrEqual(
        Date.parse(creatorMembership[0].valid_from)
      );
    }
    expect(
      (await admin.client.from('communities').select('id').eq('id', publicId)).data
    ).toHaveLength(1);
    for (const visibility of ['public', 'private'] as const) {
      expect(
        (
          await admin.client.rpc('create_community', {
            p_name: 'Enum ' + crypto.randomUUID(),
            p_visibility: visibility,
            p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
          })
        ).error
      ).toBeNull();
    }
    expect(
      (
        await admin.client.rpc('create_community', {
          p_name: 'Invalid policy',
          p_visibility: 'public',
          p_join_policy: 'unknown'
        })
      ).error?.code
    ).toBe('22P02');
    expect(
      (
        await admin.client.rpc('create_community', {
          p_name: 'Old signature',
          p_visibility: 'public'
        })
      ).error?.code
    ).toBe('PGRST202');
    expect(
      (
        await admin.client.rpc('create_community', {
          p_name: 'Invalid',
          p_visibility: 'secret',
          p_join_policy: 'instant'
        })
      ).error?.code
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

  it('public discovery uses real JWTs and keeps private IDs and fields out of payloads', async () => {
    const publicName: unknown = (await rows(admin.client, 'communities', publicId))[0].name;
    const privateName: unknown = (await rows(admin.client, 'communities', privateId))[0].name;
    if (typeof publicName !== 'string' || typeof privateName !== 'string')
      throw new Error('Missing community fixture names');
    const seeded = await admin.client
      .from('communities')
      .update({ settings: { private_note: 'not for discovery' } })
      .eq('id', publicId);
    expect(seeded.error).toBeNull();
    const safeKeys = [
      'city_label',
      'created_at',
      'description',
      'id',
      'join_policy',
      'logo_path',
      'name',
      'updated_at',
      'visibility'
    ];
    serverClient.current = anon();
    await expect(listPublicCommunities({ data: {} })).rejects.toThrow('UNAUTHENTICATED');
    await expect(getPublicCommunity({ data: { community_id: publicId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(getPublicCommunity({ data: { community_id: privateId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );

    const literalName = `Literal %_\\ ${crypto.randomUUID()}`;
    const literal = await admin.client.rpc('create_community', {
      p_name: literalName,
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    expect(literal.error).toBeNull();
    const suffix = crypto.randomUUID();
    const probeNames = [
      `Star*Club-${suffix}`,
      `StarXClub-${suffix}`,
      `Percent%Club-${suffix}`,
      `PercentXClub-${suffix}`,
      `Under_Club-${suffix}`,
      `UnderXClub-${suffix}`
    ];
    const probeIds: string[] = [];
    for (const name of probeNames) {
      const created = await admin.client.rpc('create_community', {
        p_name: name,
        p_visibility: 'public',
        p_join_policy: 'instant'
      });
      expect(created.error).toBeNull();
      probeIds.push(created.data);
    }
    serverClient.current = outsider.client;
    for (const [search, included, excluded] of [
      ['*', [0], [1, 2, 3, 4, 5]],
      ['Star*', [0], [1]],
      ['StarX', [1], [0]],
      ['%', [2], [3]],
      ['Percent%', [2], [3]],
      ['Under_', [4], [5]]
    ] as const) {
      const result = await listPublicCommunities({ data: { search, limit: 50 } });
      const ids = result.communities.map((community) => community.id);
      for (const index of included) expect(ids).toContain(probeIds[index]);
      for (const index of excluded) expect(ids).not.toContain(probeIds[index]);
    }
    for (const user of [outsider, member, admin]) {
      serverClient.current = user.client;
      const literalSearch = await listPublicCommunities({
        data: { search: literalName.toUpperCase() }
      });
      expect(literalSearch.communities.map((community) => community.id)).toContain(literal.data);
      const listing = await listPublicCommunities({ data: {} });
      expect(listing.communities.some((community) => community.id === publicId)).toBe(true);
      expect(listing.communities.some((community) => community.id === privateId)).toBe(false);
      for (const community of listing.communities)
        expect(Object.keys(community).sort()).toEqual(safeKeys);
      const searched = await listPublicCommunities({ data: { search: publicName.toUpperCase() } });
      expect(searched.communities.map((community) => community.id)).toContain(publicId);
      expect(searched.communities.every((community) => community.visibility === 'public')).toBe(
        true
      );
      expect((await listPublicCommunities({ data: { search: privateName } })).communities).toEqual(
        []
      );
      const detail = await getPublicCommunity({ data: { community_id: publicId } });
      expect(detail?.id).toBe(publicId);
      expect(Object.keys(detail!).sort()).toEqual(safeKeys);
      expect(await getPublicCommunity({ data: { community_id: privateId } })).toBeNull();
      expect(await getPublicCommunity({ data: { community_id: crypto.randomUUID() } })).toBeNull();
    }
    // PAF-4 owns match SELECT policy/tests; no matches table exists yet.
    // RLS protects private rows, not public columns: direct SELECT * of public rows remains unrestricted.
    const filtered = await outsider.client.from('communities').select('*').eq('id', privateId);
    const privateList = await outsider.client
      .from('communities')
      .select('id')
      .eq('visibility', 'private');
    const unfiltered = await outsider.client.from('communities').select('id');
    for (const result of [filtered, privateList, unfiltered]) expect(result.error).toBeNull();
    expect(filtered.data).toEqual([]);
    expect(privateList.data).toEqual([]);
    expect(unfiltered.data?.map((community) => community.id)).not.toContain(privateId);
    for (const user of [member, admin])
      expect(await rows(user.client, 'communities', privateId)).toHaveLength(1);
    expect((await anon().from('communities').select('id')).error?.code).toBe('42501');
    serverClient.current = null;
  });

  it('server functions enforce creator bootstrap and admin-only settings with real JWTs', async () => {
    serverClient.current = admin.client;
    const created = await createCommunity({
      data: {
        name: 'Function ' + crypto.randomUUID(),
        visibility: 'private',
        join_policy: 'instant',
        description: null
      }
    });
    const second = await createCommunity({
      data: {
        name: 'Second ' + crypto.randomUUID(),
        visibility: 'public',
        join_policy: 'admin_approval'
      }
    });
    expect(second.id).not.toBe(created.id);
    for (const [id, policy] of [
      [created.id, 'instant'],
      [second.id, 'admin_approval']
    ] as const) {
      const community = await rows(admin.client, 'communities', id);
      expect(community).toHaveLength(1);
      expect(community[0]).toMatchObject({ join_policy: policy, created_by: admin.id });
      const membership = await rows(admin.client, 'community_members', id);
      expect(membership).toHaveLength(1);
      expect(membership[0]).toMatchObject({
        user_id: admin.id,
        role: 'admin',
        status: 'active',
        valid_until: null
      });
      const start = Date.parse(membership[0].valid_from);
      const activated = Date.parse(membership[0].activated_at);
      expect(Number.isFinite(start)).toBe(true);
      expect(activated).toBeGreaterThanOrEqual(start);
      expect(activated).toBeLessThanOrEqual(Date.now() + 5000);
    }
    const insert = await admin.client.from('community_members').insert({
      community_id: created.id,
      user_id: member.id,
      status: 'active'
    });
    expect(insert.error).toBeNull();
    const changed = await updateCommunitySettings({
      data: {
        community_id: created.id,
        visibility: 'public',
        join_policy: 'admin_approval',
        settings: { courts: 3 }
      }
    });
    expect(changed).toMatchObject({
      id: created.id,
      visibility: 'public',
      join_policy: 'admin_approval',
      settings: { courts: 3 }
    });
    const baseline = (await rows(admin.client, 'communities', created.id))[0];
    const audits = await rows(admin.client, 'community_audit_log', created.id);
    for (const denied of [member, outsider]) {
      serverClient.current = denied.client;
      await expect(
        updateCommunitySettings({
          data: {
            community_id: created.id,
            join_policy: 'instant'
          }
        })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = outsider.client;
    await expect(
      updateCommunitySettings({
        data: {
          community_id: crypto.randomUUID(),
          name: 'Missing'
        }
      })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = anon();
    await expect(
      createCommunity({
        data: {
          name: 'No access',
          visibility: 'public',
          join_policy: 'instant'
        }
      })
    ).rejects.toThrow('UNAUTHENTICATED');
    await expect(
      updateCommunitySettings({
        data: {
          community_id: created.id,
          name: 'No access'
        }
      })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect((await rows(admin.client, 'communities', created.id))[0]).toEqual(baseline);
    expect(
      (await rows(admin.client, 'community_audit_log', created.id))
        .map((event) => event.id)
        .sort((a, b) => a.localeCompare(b))
    ).toEqual(audits.map((event) => event.id).sort((a, b) => a.localeCompare(b)));
    serverClient.current = null;
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
      (
        await anon().rpc('create_community', {
          p_name: 'Anon',
          p_visibility: 'public',
          p_join_policy: 'instant'
        })
      ).error?.code
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

  it('joins public and invitee-bound private communities with atomic, policy-aware membership', async () => {
    const [owner, instantUser, applicant, invitee, secondInvitee, thief] = await Promise.all([
      actor('join-owner'),
      actor('join-instant'),
      actor('join-applicant'),
      actor('join-invitee'),
      actor('join-second'),
      actor('join-thief')
    ]);
    async function community(
      visibility: 'public' | 'private',
      policy: 'instant' | 'admin_approval'
    ) {
      const created = await owner.client.rpc('create_community', {
        p_name: `Join ${crypto.randomUUID()}`,
        p_visibility: visibility,
        p_join_policy: policy
      });
      expect(created.error).toBeNull();
      return created.data!;
    }
    async function invitation(communityId: string, user: Actor, expiry = Date.now() + 86400000) {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const seeded = await owner.client
        .from('community_invitations')
        .insert({
          community_id: communityId,
          invitee_user_id: user.id,
          token_hash: tokenHash,
          expires_at: new Date(expiry).toISOString()
        })
        .select('id, created_at')
        .single();
      expect(seeded.error).toBeNull();
      return { raw, id: seeded.data!.id, createdAt: seeded.data!.created_at };
    }
    async function membership(communityId: string, user: Actor) {
      const found = await owner.client
        .from('community_members')
        .select('*')
        .eq('community_id', communityId)
        .eq('user_id', user.id);
      expect(found.error).toBeNull();
      return found.data ?? [];
    }
    const publicInstant = await community('public', 'instant');
    const publicApproval = await community('public', 'admin_approval');
    const privateInstant = await community('private', 'instant');
    const privateApproval = await community('private', 'admin_approval');
    serverClient.current = instantUser.client;
    expect(await joinCommunity({ data: { community_id: publicInstant } })).toEqual({
      community_id: publicInstant,
      status: 'active'
    });
    expect(await membership(publicInstant, instantUser)).toMatchObject([
      {
        role: 'member',
        status: 'active',
        valid_until: null,
        user_id: instantUser.id
      }
    ]);
    expect((await membership(publicInstant, instantUser))[0].activated_at).not.toBeNull();
    await expect(joinCommunity({ data: { community_id: publicInstant } })).rejects.toThrow(
      'ALREADY_MEMBER_OR_PENDING'
    );

    serverClient.current = applicant.client;
    expect(await joinCommunity({ data: { community_id: publicApproval } })).toEqual({
      community_id: publicApproval,
      status: 'pending'
    });
    expect(await membership(publicApproval, applicant)).toMatchObject([
      {
        role: 'member',
        status: 'pending',
        activated_at: null,
        valid_until: null
      }
    ]);
    expect(await rows(applicant.client, 'community_members', publicApproval)).toHaveLength(1);
    expect(
      (await applicant.client.rpc('is_community_member', { p_community_id: publicApproval })).data
    ).toBe(false);
    await expect(joinCommunity({ data: { community_id: publicApproval } })).rejects.toThrow(
      'ALREADY_MEMBER_OR_PENDING'
    );
    for (const id of [privateInstant, crypto.randomUUID()])
      await expect(joinCommunity({ data: { community_id: id } })).rejects.toThrow(
        'COMMUNITY_NOT_ELIGIBLE'
      );

    const bound = await invitation(privateInstant, invitee);
    serverClient.current = thief.client;
    await expect(acceptInvitation({ data: { token: bound.raw } })).rejects.toThrow(
      'INVITATION_NOT_FOR_USER'
    );
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', bound.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();
    expect(await membership(privateInstant, thief)).toHaveLength(0);
    serverClient.current = invitee.client;
    expect(await acceptInvitation({ data: { token: bound.raw } })).toEqual({
      community_id: privateInstant,
      status: 'active'
    });
    expect(await membership(privateInstant, invitee)).toMatchObject([
      {
        role: 'member',
        status: 'active',
        valid_until: null
      }
    ]);
    expect((await membership(privateInstant, invitee))[0].activated_at).not.toBeNull();
    const redeemed = await owner.client
      .from('community_invitations')
      .select('redeemed_at')
      .eq('id', bound.id)
      .single();
    expect(redeemed.error).toBeNull();
    const redeemedAt = Date.parse(redeemed.data!.redeemed_at ?? '');
    expect(Number.isNaN(redeemedAt)).toBe(false);
    expect(redeemedAt).toBeGreaterThanOrEqual(Date.parse(bound.createdAt));
    await expect(acceptInvitation({ data: { token: bound.raw } })).rejects.toThrow(
      'INVITATION_USED'
    );
    const afterReuse = await owner.client
      .from('community_invitations')
      .select('redeemed_at')
      .eq('id', bound.id)
      .single();
    expect(afterReuse.error).toBeNull();
    expect(afterReuse.data!.redeemed_at).toBe(redeemed.data!.redeemed_at);

    const approvalToken = await invitation(privateApproval, secondInvitee);
    serverClient.current = secondInvitee.client;
    expect(await acceptInvitation({ data: { token: approvalToken.raw } })).toEqual({
      community_id: privateApproval,
      status: 'pending'
    });
    expect(await membership(privateApproval, secondInvitee)).toMatchObject([
      {
        role: 'member',
        status: 'pending',
        activated_at: null,
        valid_until: null
      }
    ]);
    expect(await rows(secondInvitee.client, 'community_members', privateApproval)).toHaveLength(1);
    for (const table of ['communities', 'community_venues', 'community_audit_log'] as const)
      expect(await rows(secondInvitee.client, table, privateApproval)).toEqual([]);
    for (const helper of [
      'is_community_member',
      'can_read_community',
      'is_community_admin'
    ] as const)
      expect(
        (await secondInvitee.client.rpc(helper, { p_community_id: privateApproval })).data
      ).toBe(false);
    const venue = await owner.client
      .from('community_venues')
      .insert({ community_id: privateApproval, name: 'Private court' });
    expect(venue.error).toBeNull();
    expect(await rows(secondInvitee.client, 'community_venues', privateApproval)).toEqual([]);
    expect(
      (await rows(owner.client, 'community_members', privateApproval)).some(
        (row) => row.user_id === secondInvitee.id && row.status === 'pending'
      )
    ).toBe(true);
    expect(
      (await rows(owner.client, 'community_audit_log', privateApproval)).some(
        (event) => event.entity === 'community_invitations' && event.action === 'UPDATE'
      )
    ).toBe(true);
    expect(
      (
        await secondInvitee.client
          .from('community_members')
          .insert({ community_id: privateApproval, user_id: thief.id, status: 'active' })
      ).error?.code
    ).toBe('42501');
    expect(
      (
        await secondInvitee.client
          .from('community_invitations')
          .update({ redeemed_at: new Date().toISOString() })
          .eq('id', approvalToken.id)
      ).error?.code
    ).toBe('42501');

    const duplicate = await invitation(privateApproval, secondInvitee);
    await expect(acceptInvitation({ data: { token: duplicate.raw } })).rejects.toThrow(
      'ALREADY_MEMBER_OR_PENDING'
    );
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', duplicate.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();
    serverClient.current = thief.client;
    await expect(
      acceptInvitation({ data: { token: crypto.randomUUID().replaceAll('-', '').repeat(2) } })
    ).rejects.toThrow('INVITATION_INVALID');
    expect(
      (await thief.client.rpc('accept_community_invitation', { p_token: 'bad' })).error?.code
    ).toBe('PJ001');
    const expired = await invitation(privateInstant, thief, Date.now() + 1200);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await expect(acceptInvitation({ data: { token: expired.raw } })).rejects.toThrow(
      'INVITATION_EXPIRED'
    );
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', expired.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();
    const revoked = await invitation(privateApproval, thief);
    expect(
      (
        await owner.client
          .from('community_invitations')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', revoked.id)
      ).error
    ).toBeNull();
    await expect(acceptInvitation({ data: { token: revoked.raw } })).rejects.toThrow(
      'INVITATION_REVOKED'
    );

    const raceCommunity = await community('private', 'instant');
    const racing = await invitation(raceCommunity, thief);
    const [first, second] = await Promise.all([
      thief.client.rpc('accept_community_invitation', { p_token: racing.raw }),
      thief.client.rpc('accept_community_invitation', { p_token: racing.raw })
    ]);
    expect([first, second].filter((result) => !result.error)).toHaveLength(1);
    expect(
      [first, second].filter((result) => result.error).map((result) => result.error?.code)
    ).toEqual(['PJ003']);
    expect(await membership(raceCommunity, thief)).toHaveLength(1);
    const publicRace = await community('public', 'instant');
    const [joined, duplicateJoin] = await Promise.all([
      thief.client.rpc('join_public_community', { p_community_id: publicRace }),
      thief.client.rpc('join_public_community', { p_community_id: publicRace })
    ]);
    expect([joined, duplicateJoin].filter((result) => !result.error)).toHaveLength(1);
    expect(
      [joined, duplicateJoin].filter((result) => result.error).map((result) => result.error?.code)
    ).toEqual(['PJ006']);
    expect(await membership(publicRace, thief)).toHaveLength(1);
    serverClient.current = anon();
    await expect(joinCommunity({ data: { community_id: publicRace } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(acceptInvitation({ data: { token: racing.raw } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(
      (await anon().rpc('join_public_community', { p_community_id: publicRace })).error?.code
    ).toBe('42501');
    expect(
      (await anon().rpc('accept_community_invitation', { p_token: racing.raw })).error?.code
    ).toBe('42501');
    serverClient.current = null;
  }, 90000);
});
