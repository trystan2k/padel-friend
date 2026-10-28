import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

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
  getMyMembershipTimeline,
  joinCommunity,
  leaveCommunity,
  listPublicCommunities,
  updateCommunitySettings
} from '../src/features/community/community.functions';
import {
  promoteCommunityMember,
  reactivateCommunityMember
} from '../src/features/community/community-admin.functions';
import { validateUpdateCommunitySettings } from '../src/features/community/community.validators';
import {
  buildFixtureAtBytes,
  communityJsonbFixtures,
  compactJsonBytes
} from './helpers/community-jsonb-fixtures';
import {
  createFixtureCleanupRegistry,
  type FixtureCleanupRegistry
} from './helpers/fixture-cleanup';
import { executeTrustedSqlBatch, queryTrustedSql } from './helpers/sql-transport';

vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });
type LocalEnv = NonNullable<ReturnType<typeof localSupabaseEnv>['env']>;
const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
if (!environment.env)
  process.stderr.write(`[community.integration] suite NOT RUN: ${environment.reason}\n`);
describe('community domain — CI backend guard', () => {
  it('fails closed without local backend in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
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
  type Actor = { client: SupabaseClient; email: string; id: string };
  const actorCleanup = createFixtureCleanupRegistry('community-actors');
  const actors: Actor[] = [];
  let testCleanup: FixtureCleanupRegistry | undefined;

  function registerCommunityRows(registry: FixtureCleanupRegistry, communityId: string): void {
    registry.register('public.communities', { id: communityId });
    registry.register('public.community_members', { community_id: communityId });
    registry.register('public.community_audit_log', { community_id: communityId });
    registry.register('public.community_invitations', { community_id: communityId });
    registry.register('public.community_venues', { community_id: communityId });
    registry.register('public.notifications', { community_id: communityId });
  }

  function registerActorScope(registry: FixtureCleanupRegistry, actorId: string): void {
    registry.register('public.communities', { created_by: actorId });
    registry.register('public.community_members', { user_id: actorId });
  }

  function createTestCleanup(): FixtureCleanupRegistry {
    const registry = createFixtureCleanupRegistry('community-test');
    for (const testActor of actors) registerActorScope(registry, testActor.id);
    registry.setCleanupExecutor(async (current) => {
      const actorIds = actors.map(({ id }) => id);
      if (actorIds.length === 0) return;

      const communities = await queryTrustedSql(
        `select id::text as id from public.communities where created_by = any($1::uuid[])`,
        { values: [actorIds] }
      );
      for (const row of communities.rows) registerCommunityRows(current, String(row['id']));

      await current.deleteRegisteredRowsInOrder({
        beforeStatements: [
          'alter table public.community_members disable trigger community_member_guard'
        ],
        afterStatements: [
          'alter table public.community_members enable trigger community_member_guard'
        ],
        restoreOnFailure: [
          'alter table public.community_members enable trigger community_member_guard'
        ]
      });
    });
    return registry;
  }

  async function actor(label: string): Promise<Actor> {
    const { url, key } = env();
    const email = `${label}-${actorCleanup.namespace}-${crypto.randomUUID()}@test.local`;
    actorCleanup.register('auth.users', { email });
    const signup = await anon().auth.signUp({
      email,
      password: 'Password123!'
    });
    expect(signup.error).toBeNull();
    actorCleanup.register('auth.users', { id: signup.data.user!.id });
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
    const createdActor = { id: signup.data.user!.id, email, client };
    actors.push(createdActor);
    if (testCleanup) registerActorScope(testCleanup, createdActor.id);
    return createdActor;
  }
  async function rows(
    client: SupabaseClient,
    table: 'communities' | 'community_members' | 'community_venues' | 'community_audit_log',
    communityId: string
  ) {
    if (table === 'communities') {
      const result = await client
        .from('communities')
        .select(
          'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at'
        )
        .eq('id', communityId);
      expectNoError(result);
      return result.data ?? [];
    }
    let query = client.from(table).select('*').eq('community_id', communityId);
    if (table === 'community_audit_log') query = query.order('occurred_at', { ascending: true });
    const result = await query;
    expectNoError(result);
    return result.data ?? [];
  }
  function expectNoError(result: { error: unknown }) {
    expect(result.error).toBeNull();
  }
  async function settingsSnapshot(client: SupabaseClient, communityId: string): Promise<unknown> {
    const result = await client
      .rpc('get_community_settings', { p_community_id: communityId })
      .single();
    expectNoError(result);
    return result.data;
  }
  // One SQL round trip for row (includes updated_at), private settings and the
  // complete audit trail ordered by the same stable (occurred_at, id) key the
  // per-descriptor rejection loop below snapshots repeatedly; this keeps that
  // loop's runtime bounded by batching state reads into a single statement.
  async function fullSnapshot(communityId: string) {
    const snapshot = await executeLocalFixtureSql(
      `select to_jsonb(c) as row, c.settings as settings, (select coalesce(jsonb_agg(audit_event order by audit_event.occurred_at, audit_event.id), '[]'::jsonb) from public.community_audit_log audit_event where audit_event.community_id = c.id) as audit from public.communities c where id='${communityId}'`
    );
    const snapshotRow = snapshot.rows[0];
    if (!isPlainRowObject(snapshotRow))
      throw new Error(`fullSnapshot found no community row for ${communityId}`);
    return {
      row: snapshotRow.row,
      settings: [{ settings: snapshotRow.settings }],
      audit: snapshotRow.audit
    };
  }
  function isExpiredInvitationResult(
    value: unknown
  ): value is { rows: Array<{ id: string; created_at: string; expires_at: string }> } {
    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
    const { rows: resultRows } = value;
    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
    const row: unknown = resultRows[0];
    return (
      typeof row === 'object' &&
      row !== null &&
      'id' in row &&
      typeof row.id === 'string' &&
      'created_at' in row &&
      typeof row.created_at === 'string' &&
      'expires_at' in row &&
      typeof row.expires_at === 'string'
    );
  }
  function isSqlRowsWithId(value: unknown): value is { rows: Array<{ id: string }> } {
    if (typeof value !== 'object' || value === null || !('rows' in value)) return false;
    const { rows: resultRows } = value;
    if (!Array.isArray(resultRows) || resultRows.length !== 1) return false;
    const row: unknown = resultRows[0];
    return typeof row === 'object' && row !== null && 'id' in row && typeof row.id === 'string';
  }
  function isPlainRowObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  // Fixture SQL only ever references the SHA-256 token hash, never the raw
  // invitation token.
  async function executeLocalFixtureSql(sql: string): Promise<{
    rows: Array<Record<string, unknown>>;
  }> {
    const result = await queryTrustedSql(sql);
    return { rows: result.rows };
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
    venueId: string,
    fixtureTokenHash: string;
  beforeAll(async () => {
    [admin, member, invited, pending, inactive, outsider, publicActor] = await Promise.all([
      actor('admin'),
      actor('member'),
      actor('invited'),
      actor('pending'),
      actor('inactive'),
      actor('outsider'),
      actor('public')
    ]);
  });

  beforeEach(async () => {
    testCleanup = createTestCleanup();
    async function create(name: string, visibility: 'private' | 'public') {
      const scopedName = `${name} ${testCleanup!.namespace.slice(-8)}`;
      testCleanup!.register('public.communities', { name: scopedName });
      const result = await admin.client.rpc('create_community', {
        p_name: scopedName,
        p_visibility: visibility,
        p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
      });
      if (result.error) throw result.error;
      if (typeof result.data !== 'string') throw new Error('create_community returned no ID');
      registerCommunityRows(testCleanup!, result.data);
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
      if (result.error) throw result.error;
      if (user === member) memberRow = result.data.id;
      if (user === pending) pendingRow = result.data.id;
      if (user === inactive) inactiveRow = result.data.id;
    }
    const closed = await admin.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
      .eq('id', inactiveRow);
    if (closed.error) throw closed.error;
    const invitation = await admin.client
      .from('community_invitations')
      .insert({
        community_id: privateId,
        invitee_user_id: invited.id,
        token_hash: (fixtureTokenHash = crypto.randomUUID().replaceAll('-', '').padEnd(64, '0')),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
      .select('id')
      .single();
    if (invitation.error) throw invitation.error;
    inviteId = invitation.data.id;
    const venue = await admin.client
      .from('community_venues')
      .insert({ community_id: privateId, name: 'Court' })
      .select('id')
      .single();
    if (venue.error) throw venue.error;
    venueId = venue.data.id;
  });

  afterEach(async () => {
    try {
      await testCleanup?.cleanup();
    } finally {
      testCleanup = undefined;
      serverClient.current = null;
    }
  });

  it('AC1/2: creator bootstrap and enum values are enforced by real SQL', async () => {
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
      'member_count',
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
    const cityOnly = `City-(x),"\\-${crypto.randomUUID()}`;
    const cityRow = await admin.client.rpc('create_community', {
      p_name: `Unrelated-${crypto.randomUUID()}`,
      p_visibility: 'public',
      p_join_policy: 'instant',
      p_city_label: cityOnly
    });
    const hiddenCity = await admin.client.rpc('create_community', {
      p_name: `Hidden-${crypto.randomUUID()}`,
      p_visibility: 'private',
      p_join_policy: 'admin_approval',
      p_city_label: cityOnly
    });
    expect(cityRow.error).toBeNull();
    expect(hiddenCity.error).toBeNull();
    serverClient.current = outsider.client;
    for (const term of [
      cityOnly,
      'CITY-(X),"\\-',
      ')',
      '"',
      '\\',
      '") , visibility.eq.private, name.imatch.("'
    ]) {
      const results = await listPublicCommunities({ data: { search: term, limit: 50 } });
      expect(results.communities.map(({ id }) => id).includes(cityRow.data)).toBe(
        term !== '") , visibility.eq.private, name.imatch.("'
      );
      expect(results.communities.map(({ id }) => id)).not.toContain(hiddenCity.data);
    }
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
    // Community column ACLs deny SELECT *; safe direct fields remain row-isolated.
    const filtered = await outsider.client.from('communities').select('id').eq('id', privateId);
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

  // Longest membership-matrix round-trip chain in the suite; measured >5s under
  // full-suite worker contention, so it carries an explicit timeout.
  it('counts only active open memberships, including Admins, once after reactivation, and preserves zero', async () => {
    const created = await admin.client.rpc('create_community', {
      p_name: `Count matrix ${crypto.randomUUID()}`,
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    expect(created.error).toBeNull();
    const communityId = created.data;
    if (typeof communityId !== 'string') throw new Error('Missing count fixture community');
    const inactiveUntil = new Date().toISOString();
    const invitedUntil = new Date().toISOString();
    const activeMemberFixture = {
      id: crypto.randomUUID(),
      userId: member.id,
      status: 'active' as const,
      validUntil: null
    };
    const pendingMemberFixture = {
      id: crypto.randomUUID(),
      userId: pending.id,
      status: 'pending' as const,
      validUntil: null
    };
    const inactiveMemberFixture = {
      id: crypto.randomUUID(),
      userId: inactive.id,
      status: 'inactive' as const,
      validUntil: inactiveUntil
    };
    const invitedMemberFixture = {
      id: crypto.randomUUID(),
      userId: invited.id,
      status: 'inactive' as const,
      validUntil: invitedUntil
    };
    const adminMemberFixture = {
      id: crypto.randomUUID(),
      userId: outsider.id,
      status: 'active' as const,
      validUntil: null
    };
    const membershipFixtures = [
      activeMemberFixture,
      pendingMemberFixture,
      inactiveMemberFixture,
      invitedMemberFixture,
      adminMemberFixture
    ];
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await executeTrustedSqlBatch(
      membershipFixtures.map((fixture) => ({
        sql: `insert into public.community_members (id,community_id,user_id,status,role,valid_from,valid_until) values (${quote(fixture.id)},${quote(communityId)},${quote(fixture.userId)},${quote(fixture.status)},'member',now()-interval '1 day',${fixture.validUntil === null ? 'null' : `${quote(fixture.validUntil)}::timestamptz`}) returning id`,
        expectedRowCount: 1
      }))
    );
    const activeMemberId = activeMemberFixture.id;
    const adminMemberId = adminMemberFixture.id;
    serverClient.current = admin.client;
    await promoteCommunityMember({
      data: { community_id: communityId, membership_id: adminMemberId }
    });

    serverClient.current = publicActor.client;
    const list = () => listPublicCommunities({ data: { search: 'Count matrix', limit: 50 } });
    const detail = () => getPublicCommunity({ data: { community_id: communityId } });
    expect((await list()).communities.find((item) => item.id === communityId)?.member_count).toBe(
      3
    );
    expect((await detail())?.member_count).toBe(3);

    serverClient.current = member.client;
    await expect(leaveCommunity({ data: { community_id: communityId } })).resolves.toMatchObject({
      status: 'inactive',
      valid_until: expect.any(String)
    });
    serverClient.current = publicActor.client;
    expect((await detail())?.member_count).toBe(2);

    serverClient.current = admin.client;
    await reactivateCommunityMember({
      data: { community_id: communityId, membership_id: activeMemberId }
    });
    serverClient.current = publicActor.client;
    expect((await detail())?.member_count).toBe(3);
    const history = await admin.client
      .from('community_members')
      .select('id,status,valid_until')
      .eq('community_id', communityId)
      .eq('user_id', member.id);
    expect(history.error).toBeNull();
    expect(history.data).toHaveLength(2);
    expect((await detail())?.member_count).toBe(3);

    serverClient.current = null;
  }, 15000);

  it('denies anonymous RPC execution and never serializes private fields', async () => {
    const anonymousRole = await anon().rpc('public_community_discovery');
    expect(anonymousRole.error?.code).toBe('42501');
    const anonymous = anon();
    const anonymousSignIn = await anonymous.auth.signInAnonymously();
    expect(anonymousSignIn.error?.code).toBe('anonymous_provider_disabled');
    serverClient.current = admin.client;
    const payload = JSON.stringify({
      list: await listPublicCommunities({ data: {} }),
      private: await getPublicCommunity({ data: { community_id: privateId } })
    });
    expect(payload).not.toContain('settings');
    expect(payload).not.toContain('created_by');
    expect(payload).not.toContain(privateId);
    expect(await getPublicCommunity({ data: { community_id: privateId } })).toBeNull();
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
      expect(community[0]).toMatchObject({ join_policy: policy });
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
    let audits = await rows(admin.client, 'community_audit_log', created.id);
    const hiddenId = await admin.client.rpc('create_community', {
      p_name: 'Hidden ' + crypto.randomUUID(),
      p_visibility: 'private',
      p_join_policy: 'admin_approval'
    });
    expect(hiddenId.error).toBeNull();
    if (typeof hiddenId.data !== 'string') throw new Error('create_community returned no ID');
    serverClient.current = outsider.client;
    const hiddenAudits = await rows(admin.client, 'community_audit_log', hiddenId.data);
    await expect(
      updateCommunitySettings({ data: { community_id: hiddenId.data, name: 'Hidden edit' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    await expect(
      updateCommunitySettings({ data: { community_id: crypto.randomUUID(), name: 'Missing' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    expect(await rows(admin.client, 'communities', hiddenId.data)).toHaveLength(1);
    expect(
      (await rows(admin.client, 'community_audit_log', hiddenId.data)).map((event) => event.id)
    ).toEqual(hiddenAudits.map((event) => event.id));

    const secondAdmin = await actor('demoted-admin');
    const secondMember = await admin.client
      .from('community_members')
      .insert({
        community_id: created.id,
        user_id: secondAdmin.id,
        status: 'active',
        role: 'admin'
      })
      .select('id')
      .single();
    expect(secondMember.error).toBeNull();
    if (!secondMember.data) throw new Error('second admin membership missing');
    const demoted = await admin.client
      .from('community_members')
      .update({ role: 'member' })
      .eq('id', secondMember.data.id);
    expect(demoted.error).toBeNull();
    const demotedBaseline = (await rows(admin.client, 'communities', created.id))[0];
    const demotedAudits = await rows(admin.client, 'community_audit_log', created.id);
    serverClient.current = secondAdmin.client;
    await expect(
      updateCommunitySettings({ data: { community_id: created.id, name: 'Demoted edit' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    await expect(
      updateCommunitySettings({ data: { community_id: crypto.randomUUID(), name: 'Missing' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    expect((await rows(admin.client, 'communities', created.id))[0]).toEqual(demotedBaseline);
    expect(
      (await rows(admin.client, 'community_audit_log', created.id)).map((event) => event.id)
    ).toEqual(demotedAudits.map((event) => event.id));
    audits = demotedAudits;
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

  // Linux MAX_ARG_STRLEN caps one spawn argument at 131072 bytes, so the oracle
  // statements (each ~8.3 KiB of hex per case) must be batched well below that
  // or CI fails with E2BIG. 64 KiB keeps a wide safety margin on both platforms.
  const ORACLE_SQL_BATCH_BUDGET_BYTES = 64 * 1024;
  function batchSqlStatementsByBudget(statements: readonly string[], budgetBytes: number) {
    const batches: string[][] = [];
    let batch: string[] = [];
    let batchBytes = 0;
    for (const statement of statements) {
      const statementBytes = Buffer.byteLength(statement, 'utf8');
      if (statementBytes > budgetBytes)
        throw new Error(
          `Single oracle statement (${statementBytes} bytes) exceeds the ${budgetBytes}-byte batch budget`
        );
      if (batch.length > 0 && batchBytes + ' union all '.length + statementBytes > budgetBytes) {
        batches.push(batch);
        batch = [];
        batchBytes = 0;
      }
      batch.push(statement);
      batchBytes += (batch.length > 1 ? ' union all '.length : 0) + statementBytes;
    }
    if (batch.length > 0) batches.push(batch);
    return batches;
  }
  it('validator decisions match PostgreSQL JSONB byte oracle at 4095, 4096 and 4097 bytes', async () => {
    const cases = communityJsonbFixtures.flatMap((descriptor) =>
      ([4095, 4096, 4097] as const).map((target) => ({
        descriptor,
        target,
        settings: buildFixtureAtBytes(descriptor, target)
      }))
    );
    const statements = cases.map(({ descriptor, target, settings }, index) => {
      const hex = Buffer.from(JSON.stringify(settings), 'utf8').toString('hex');
      return `select ${index} as case_index, '${descriptor.name.replaceAll("'", "''")}' as fixture, ${target} as target, octet_length(convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb::text) as bytes`;
    });
    const batches = batchSqlStatementsByBudget(statements, ORACLE_SQL_BATCH_BUDGET_BYTES);
    const batchSqls = batches.map((batch) => batch.join(' union all '));
    const maxBatchBytes = Math.max(...batchSqls.map((sql) => Buffer.byteLength(sql, 'utf8')));
    // Guard the CI constraint itself: no emitted SQL argument may reach the
    // 131072-byte Linux per-argument limit, and the budget must hold.
    expect(maxBatchBytes, 'oracle SQL batch must stay below Linux MAX_ARG_STRLEN').toBeLessThan(
      131072
    );
    expect(maxBatchBytes).toBeLessThanOrEqual(ORACLE_SQL_BATCH_BUDGET_BYTES);
    expect(batches.length, 'oracle must actually split across batches').toBeGreaterThan(1);
    process.stderr.write(
      `[community.integration] JSONB oracle: ${cases.length} cases in ${batches.length} batches, max SQL ${maxBatchBytes} bytes\n`
    );
    const oracleRows: Array<Record<string, unknown>> = [];
    for (const batchSql of batchSqls)
      oracleRows.push(...(await executeLocalFixtureSql(batchSql)).rows);
    expect(oracleRows).toHaveLength(cases.length);
    for (const [index, item] of cases.entries()) {
      const measured = oracleRows.find((row) => row.case_index === index);
      if (measured?.fixture !== item.descriptor.name)
        throw new Error(`${item.descriptor.name}: oracle batch row misassembled`);
      if (Number(measured?.bytes) !== item.target)
        throw new Error(`${item.descriptor.name} target ${item.target}: oracle byte mismatch`);
      const input = { community_id: privateId, settings: item.settings };
      const accepted = item.target <= 4096;
      let validatorAccepted = true;
      try {
        validateUpdateCommunitySettings(input);
      } catch {
        validatorAccepted = false;
      }
      if (validatorAccepted !== accepted)
        throw new Error(
          `${item.descriptor.name} target ${item.target}: validator decision mismatch`
        );
      if (!accepted) continue;
      serverClient.current = admin.client;
      const result = await updateCommunitySettings({ data: input });
      try {
        expect(result.settings).toEqual(JSON.parse(JSON.stringify(item.settings)));
      } catch (error) {
        throw new Error(`${item.descriptor.name}: returned settings mismatch`, { cause: error });
      }
      const storedResult = await settingsSnapshot(admin.client, privateId);
      if (!isPlainRowObject(storedResult) || !('settings' in storedResult))
        throw new Error(`${item.descriptor.name}: settings RPC returned invalid shape`);
      const storedSettings = storedResult.settings;
      try {
        expect(storedSettings).toEqual(JSON.parse(JSON.stringify(item.settings)));
      } catch (error) {
        throw new Error(`${item.descriptor.name}: persisted RPC settings mismatch`, {
          cause: error
        });
      }
      const persisted = await executeLocalFixtureSql(
        `select octet_length(settings::text) as bytes from public.communities where id='${privateId}'`
      );
      if (Number(persisted.rows[0]?.bytes) !== item.target)
        throw new Error(`${item.descriptor.name} persisted ${item.target}: byte mismatch`);
    }
  });

  it('rejects 4097-byte settings for every descriptor through the database RPC without changing row or audit', async () => {
    for (const descriptor of communityJsonbFixtures) {
      const settings = buildFixtureAtBytes(descriptor, 4097);
      const before = await fullSnapshot(privateId);
      const marker = `forbidden-${crypto.randomUUID()}`;
      expect(
        Array.from(marker).length,
        `${descriptor.name}: name marker must stay within the community name limit`
      ).toBeLessThanOrEqual(80);
      const direct = await admin.client.rpc('update_community_settings', {
        p_community_id: privateId,
        p_changes: { settings, name: marker }
      });
      expect(direct.error?.code, `${descriptor.name}: expected SQLSTATE 22023`).toBe('22023');
      expect(direct.error?.message, `${descriptor.name}: expected exact rejection message`).toBe(
        'Invalid community patch'
      );
      expect(
        await fullSnapshot(privateId),
        `${descriptor.name}: row/settings/audit changed after rejected RPC`
      ).toEqual(before);

      // The application validator short-circuits before the database RPC.
      serverClient.current = admin.client;
      await expect(
        updateCommunitySettings({ data: { community_id: privateId, settings } }),
        `${descriptor.name}: app validator must reject before the database RPC`
      ).rejects.toThrow('INVALID_COMMUNITY_INPUT');
      expect(
        await fullSnapshot(privateId),
        `${descriptor.name}: row/settings/audit changed after app rejection`
      ).toEqual(before);
    }
  }, 60000);

  it('compact JSON size is not the PostgreSQL settings byte oracle', async () => {
    const settings = { x: 'a'.repeat(4088) };
    expect(compactJsonBytes(settings)).toBe(4096);
    const hex = Buffer.from(JSON.stringify(settings), 'utf8').toString('hex');
    const oracle = await executeLocalFixtureSql(
      `select octet_length(convert_from(decode('${hex}', 'hex'), 'UTF8')::jsonb::text) as bytes`
    );
    expect(Number(oracle.rows[0]?.bytes)).toBe(4097);
    const before = await fullSnapshot(privateId);
    const direct = await admin.client.rpc('update_community_settings', {
      p_community_id: privateId,
      p_changes: { settings }
    });
    expect(direct.error?.code).toBe('22023');
    expect(direct.error?.message).toBe('Invalid community patch');
    expect(await fullSnapshot(privateId)).toEqual(before);
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

  // Full invitation-visibility matrix across several actors; measured >3s under
  // full-suite worker contention, so it carries an explicit timeout.
  it('AC4: private rows hidden filtered and unfiltered; only own invitation is exposed', async () => {
    const assertInactiveOnly = async () => {
      const history = (await rows(admin.client, 'community_members', privateId)).filter(
        (row) => row.user_id === inactive.id
      );
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: 'inactive', valid_until: expect.any(String) });
      expect(history[0].activated_at).not.toBeNull();
      expect(history[0].valid_until).not.toBeNull();
      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
    };
    await assertInactiveOnly();
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
    await assertInactiveOnly();
  }, 15000);

  it('AC5: admin alone mutates rows/settings; member sees own interval, not roster', async () => {
    const assertInactiveOnly = async () => {
      const history = (await rows(admin.client, 'community_members', privateId)).filter(
        (row) => row.user_id === inactive.id
      );
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({ status: 'inactive' });
      expect(history[0].activated_at).not.toBeNull();
      expect(history[0].valid_until).not.toBeNull();
      expect(history.filter((row) => row.valid_until === null)).toHaveLength(0);
    };
    await assertInactiveOnly();
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
    const updatedCommunity = await admin.client
      .rpc('get_community_settings', { p_community_id: privateId })
      .single();
    expect(updatedCommunity.data).toMatchObject({ settings: { courts: 2 } });
    const publicFields = (await rows(admin.client, 'communities', privateId))[0];
    expect(new Date(publicFields.updated_at).getTime()).toBeGreaterThan(
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
    const deniedInvitationId = openInvitation.data!.id;
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
    expect(
      (await admin.client.rpc('get_community_settings', { p_community_id: privateId }).single())
        .data
    ).toMatchObject({ settings: { courts: 2 } });
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
    const unchanged = await admin.client
      .from('community_invitations')
      .select('id,revoked_at,redeemed_at')
      .eq('id', deniedInvitationId)
      .single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toMatchObject({ revoked_at: null, redeemed_at: null });
    expect(unchanged.data?.id).toBe(deniedInvitationId);
    await assertInactiveOnly();
  });

  it('audit UPDATE details list changed fields and only safe transitions', async () => {
    const secretSettings = 'settings-secret-' + crypto.randomUUID();
    const secretText = 'private-text-' + crypto.randomUUID();
    const before = await rows(admin.client, 'community_audit_log', privateId);

    const settingsChange = await admin.client
      .from('communities')
      .update({ settings: { private_marker: secretSettings } })
      .eq('id', privateId);
    expect(settingsChange.error).toBeNull();
    const settingsAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
    expect(settingsAudit.details).toMatchObject({ changed_fields: ['settings'], transitions: {} });

    const scalarChange = await admin.client
      .from('communities')
      .update({ name: `Changed ${crypto.randomUUID()}`, description: secretText })
      .eq('id', privateId);
    expect(scalarChange.error).toBeNull();
    const scalarAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
    expect(scalarAudit.details.changed_fields).toEqual(['name', 'description']);

    const enumChange = await admin.client
      .from('communities')
      .update({ visibility: 'public', join_policy: 'instant' })
      .eq('id', privateId);
    expect(enumChange.error).toBeNull();
    const enumAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
    expect(enumAudit.details).toMatchObject({
      visibility: 'public',
      changed_fields: ['visibility', 'join_policy'],
      transitions: {
        visibility: { before: 'private', after: 'public' },
        join_policy: { before: 'admin_approval', after: 'instant' }
      }
    });

    const venueChange = await admin.client
      .from('community_venues')
      .update({ name: `Court ${crypto.randomUUID()}`, address: secretText })
      .eq('id', venueId);
    expect(venueChange.error).toBeNull();
    const venueAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
    expect(venueAudit.details).toMatchObject({
      changed_fields: ['name', 'address'],
      transitions: {}
    });

    const archive = await admin.client
      .from('community_venues')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', venueId);
    expect(archive.error).toBeNull();
    const archiveAudit = (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!;
    expect(archiveAudit.details).toMatchObject({
      archived: true,
      changed_fields: ['archived_at'],
      transitions: { archived: { before: false, after: true } }
    });

    const nullableChange = await admin.client
      .from('communities')
      .update({ city_label: secretText })
      .eq('id', privateId);
    expect(nullableChange.error).toBeNull();
    expect(
      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
    ).toEqual(['city_label']);
    const clearNullable = await admin.client
      .from('communities')
      .update({ city_label: null })
      .eq('id', privateId);
    expect(clearNullable.error).toBeNull();
    expect(
      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
    ).toEqual(['city_label']);

    const multiple = await admin.client
      .from('communities')
      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
      .eq('id', privateId);
    expect(multiple.error).toBeNull();
    expect(
      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details.changed_fields
    ).toEqual(['logo_path', 'settings']);
    const noOp = await admin.client
      .from('communities')
      .update({ logo_path: 'logos/safe.svg', settings: { replacement: true } })
      .eq('id', privateId);
    expect(noOp.error).toBeNull();
    expect(
      (await rows(admin.client, 'community_audit_log', privateId)).at(-1)!.details
    ).toMatchObject({
      changed_fields: [],
      transitions: {}
    });

    const after = await rows(admin.client, 'community_audit_log', privateId);
    const oldIds = new Set(before.map((event) => event.id));
    expect(
      after.filter((event) => oldIds.has(event.id)).sort((a, b) => a.id.localeCompare(b.id))
    ).toEqual(before.sort((a, b) => a.id.localeCompare(b.id)));
    const serializedDetails = JSON.stringify(after.map((event) => event.details));
    for (const secret of [secretSettings, secretText, fixtureTokenHash, admin.email])
      expect(serializedDetails).not.toContain(secret);
    const forbiddenRead = await outsider.client
      .from('community_audit_log')
      .select('*')
      .eq('community_id', privateId);
    expect(forbiddenRead.data).toEqual([]);
    expect(
      (await anon().from('community_audit_log').select('*').eq('community_id', privateId)).error
        ?.code
    ).toBe('42501');
    for (const client of [outsider.client, anon()])
      expect(
        (
          await client.from('community_audit_log').insert({
            community_id: privateId,
            entity: 'communities',
            entity_id: privateId,
            action: 'UPDATE'
          })
        ).error?.code
      ).toBe('42501');
    for (const client of [outsider.client, anon()])
      expect((await client.rpc('audit_community_change')).error).not.toBeNull();
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
    const seededSettings = await admin.client
      .from('communities')
      .update({ settings: { ac7: true } })
      .eq('id', privateId);
    expect(seededSettings.error).toBeNull();
    const seededVenue = await admin.client
      .from('community_venues')
      .update({ name: 'AC7 court' })
      .eq('id', venueId);
    expect(seededVenue.error).toBeNull();
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
        .select('id, created_at, expires_at')
        .single();
      expect(seeded.error).toBeNull();
      return {
        raw,
        id: seeded.data!.id,
        createdAt: seeded.data!.created_at,
        expiresAt: seeded.data!.expires_at
      };
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
    const revoked = await invitation(privateApproval, thief);
    expect(
      (
        await owner.client
          .from('community_invitations')
          .update({
            revoked_at: new Date(
              Math.max(Date.now(), Date.parse(revoked.createdAt) + 1000)
            ).toISOString()
          })
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

  it('seeds expired invitation from database clock and waits for stored expiry', async () => {
    const [owner, invitee] = await Promise.all([actor('expiry-owner'), actor('expiry-invitee')]);
    const created = await owner.client.rpc('create_community', {
      p_name: `Expiry fixture ${crypto.randomUUID()}`,
      p_visibility: 'private',
      p_join_policy: 'instant'
    });
    expect(created.error).toBeNull();
    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const seeded = await executeLocalFixtureSql(`
      insert into public.community_invitations
        (community_id, invitee_user_id, issued_by, token_hash, expires_at)
      values ('${created.data}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '5 seconds')
      returning id, created_at, expires_at;
    `);
    if (!isExpiredInvitationResult(seeded))
      throw new Error(
        `Expired invitation fixture returned an unexpected CLI JSON result: ${JSON.stringify(seeded)}`
      );
    const row = seeded.rows[0];
    if (!row) throw new Error('Expired invitation fixture returned no row');
    expect(Date.parse(row.expires_at)).toBeGreaterThan(Date.parse(row.created_at));
    const expiry = Date.parse(row.expires_at);
    if (!Number.isFinite(expiry)) throw new Error('Expired invitation fixture has invalid expiry');
    const deadline = Date.now() + 15000;
    while (Date.now() < expiry + 250 && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 100));
    if (Date.now() < expiry + 250)
      throw new Error('Invitation did not reach expiry before bounded wait deadline');
    serverClient.current = invitee.client;
    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow('INVITATION_EXPIRED');
    const unchanged = await owner.client
      .from('community_invitations')
      .select('id,redeemed_at,revoked_at')
      .eq('id', row.id)
      .single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data?.redeemed_at).toBeNull();
    expect(unchanged.data?.revoked_at).toBeNull();
    expect(
      (await rows(owner.client, 'community_members', created.data)).filter(
        (membership) => membership.user_id === invitee.id
      )
    ).toEqual([]);
  }, 30000);

  it('closes self-leave and removal intervals, blocks inactive re-entry, and exposes only owned timeline rows', async () => {
    const [owner, leaver, invitee, lifecycleOutsider] = await Promise.all([
      actor('lifecycle-owner'),
      actor('lifecycle-leaver'),
      actor('lifecycle-invitee'),
      actor('lifecycle-outsider')
    ]);
    async function create(
      visibility: 'public' | 'private',
      joinPolicy: 'instant' | 'admin_approval'
    ) {
      const result = await owner.client.rpc('create_community', {
        p_name: `Lifecycle ${crypto.randomUUID()}`,
        p_visibility: visibility,
        p_join_policy: joinPolicy
      });
      expect(result.error).toBeNull();
      if (typeof result.data !== 'string') throw new Error('Community fixture creation failed');
      return result.data;
    }
    async function invite(communityId: string, inviteeActor: Actor) {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const inserted = await owner.client
        .from('community_invitations')
        .insert({
          community_id: communityId,
          invitee_user_id: inviteeActor.id,
          token_hash: tokenHash,
          expires_at: new Date(Date.now() + 86400000).toISOString()
        })
        .select('id')
        .single();
      expect(inserted.error).toBeNull();
      return { id: inserted.data!.id, raw };
    }
    async function playerRows(user: Actor) {
      const profile = await user.client
        .from('player_profiles')
        .select('*')
        .eq('user_id', user.id)
        .single();
      const rating = await user.client
        .from('global_player_ratings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      expect(profile.error).toBeNull();
      expect(rating.error).toBeNull();
      return { profile: profile.data, rating: rating.data };
    }
    for (const user of [leaver, invitee]) {
      const onboarded = await user.client.rpc('onboard_player', {
        p_display_name: `Lifecycle ${crypto.randomUUID().slice(0, 8)}`,
        p_preferred_side: 'EITHER',
        p_initial_level: 3.2
      });
      expect(onboarded.error).toBeNull();
    }
    const leaverPlayerRows = await playerRows(leaver);
    const inviteePlayerRows = await playerRows(invitee);

    const lifecyclePublicId = await create('public', 'instant');
    serverClient.current = leaver.client;
    await expect(
      joinCommunity({ data: { community_id: lifecyclePublicId } })
    ).resolves.toMatchObject({
      community_id: lifecyclePublicId,
      status: 'active'
    });
    const beforeLeave = (await rows(owner.client, 'community_members', lifecyclePublicId)).find(
      (row) => row.user_id === leaver.id
    )!;
    const auditBeforeLeave = await rows(owner.client, 'community_audit_log', lifecyclePublicId);
    await expect(
      leaveCommunity({ data: { community_id: lifecyclePublicId } })
    ).resolves.toMatchObject({
      membership_id: beforeLeave.id,
      community_id: lifecyclePublicId,
      status: 'inactive'
    });
    const afterLeave = (await rows(owner.client, 'community_members', lifecyclePublicId)).find(
      (row) => row.id === beforeLeave.id
    )!;
    expect(afterLeave).toMatchObject({
      id: beforeLeave.id,
      user_id: leaver.id,
      role: beforeLeave.role,
      status: 'inactive',
      valid_from: beforeLeave.valid_from,
      activated_at: beforeLeave.activated_at
    });
    expect(afterLeave.valid_until).toBeTruthy();
    const { status: _beforeStatus, valid_until: _beforeUntil, ...beforeFields } = beforeLeave;
    const { status: _afterStatus, valid_until: _afterUntil, ...afterFields } = afterLeave;
    expect(afterFields).toEqual(beforeFields);
    const auditAfterLeave = await rows(owner.client, 'community_audit_log', lifecyclePublicId);
    expect(auditAfterLeave).toHaveLength(auditBeforeLeave.length + 1);
    const leaveEvents = auditAfterLeave.filter(
      (event) => !auditBeforeLeave.some((previous) => previous.id === event.id)
    );
    expect(leaveEvents).toHaveLength(1);
    expect(leaveEvents[0]).toMatchObject({
      actor_user_id: leaver.id,
      entity: 'community_members',
      entity_id: beforeLeave.id,
      action: 'UPDATE',
      details: { role: beforeLeave.role, status: 'inactive' }
    });
    await expect(leaveCommunity({ data: { community_id: lifecyclePublicId } })).rejects.toThrow(
      'COMMUNITY_MEMBERSHIP_NOT_OPEN'
    );
    serverClient.current = lifecycleOutsider.client;
    await expect(leaveCommunity({ data: { community_id: lifecyclePublicId } })).rejects.toThrow(
      'COMMUNITY_MEMBERSHIP_NOT_OPEN'
    );
    await expect(leaveCommunity({ data: { community_id: crypto.randomUUID() } })).rejects.toThrow(
      'COMMUNITY_MEMBERSHIP_NOT_OPEN'
    );
    serverClient.current = leaver.client;
    await expect(joinCommunity({ data: { community_id: lifecyclePublicId } })).rejects.toThrow(
      'MEMBERSHIP_INACTIVE'
    );
    expect(
      (
        await leaver.client.rpc('join_public_community', {
          p_community_id: lifecyclePublicId
        })
      ).error?.code
    ).toBe('PJ008');
    expect(
      (await rows(owner.client, 'community_members', lifecyclePublicId)).filter(
        (row) => row.user_id === leaver.id
      )
    ).toHaveLength(1);
    const timeline = await getMyMembershipTimeline({
      data: { community_id: lifecyclePublicId }
    });
    expect(timeline).toEqual({
      intervals: [
        {
          membership_id: beforeLeave.id,
          community_id: lifecyclePublicId,
          role: beforeLeave.role,
          status: 'inactive',
          valid_from: beforeLeave.valid_from,
          valid_until: afterLeave.valid_until,
          activated_at: beforeLeave.activated_at
        }
      ],
      next_offset: null,
      truncated: false
    });
    expect(
      (await anon().rpc('leave_community', { p_community_id: lifecyclePublicId })).error?.code
    ).toBe('42501');

    const approvalId = await create('public', 'admin_approval');
    serverClient.current = lifecycleOutsider.client;
    await expect(joinCommunity({ data: { community_id: approvalId } })).resolves.toMatchObject({
      community_id: approvalId,
      status: 'pending'
    });
    const lifecyclePendingRow = (await rows(owner.client, 'community_members', approvalId)).find(
      (row) => row.user_id === lifecycleOutsider.id
    )!;
    expect(lifecyclePendingRow.activated_at).toBeNull();
    await expect(leaveCommunity({ data: { community_id: approvalId } })).resolves.toMatchObject({
      membership_id: lifecyclePendingRow.id,
      community_id: approvalId,
      status: 'inactive'
    });
    const withdrawn = (await rows(owner.client, 'community_members', approvalId)).find(
      (row) => row.id === lifecyclePendingRow.id
    )!;
    expect(withdrawn).toMatchObject({
      status: 'inactive',
      valid_from: lifecyclePendingRow.valid_from,
      activated_at: null
    });
    expect(withdrawn.valid_until).toBeTruthy();
    await expect(joinCommunity({ data: { community_id: approvalId } })).rejects.toThrow(
      'MEMBERSHIP_INACTIVE'
    );

    const lifecyclePrivateId = await create('private', 'admin_approval');
    const venue = await owner.client
      .from('community_venues')
      .insert({ community_id: lifecyclePrivateId, name: 'Lifecycle Court' })
      .select('id,name')
      .single();
    expect(venue.error).toBeNull();
    const venueSnapshot = venue.data;
    const originalInvitation = await invite(lifecyclePrivateId, invitee);
    serverClient.current = invitee.client;
    await expect(acceptInvitation({ data: { token: originalInvitation.raw } })).resolves.toEqual({
      community_id: lifecyclePrivateId,
      status: 'pending'
    });
    const lifecyclePending = (
      await rows(owner.client, 'community_members', lifecyclePrivateId)
    ).find((row) => row.user_id === invitee.id)!;
    expect(lifecyclePending.activated_at).toBeNull();
    expect(
      (
        await owner.client.rpc('govern_community_member', {
          p_community_id: lifecyclePrivateId,
          p_membership_id: lifecyclePending.id,
          p_action: 'approve'
        })
      ).error
    ).toBeNull();
    const active = (await rows(owner.client, 'community_members', lifecyclePrivateId)).find(
      (row) => row.id === lifecyclePending.id
    )!;
    expect(active.status).toBe('active');
    const removal = await owner.client.rpc('govern_community_member', {
      p_community_id: lifecyclePrivateId,
      p_membership_id: active.id,
      p_action: 'remove'
    });
    expect(removal.error).toBeNull();
    const removed = (await rows(owner.client, 'community_members', lifecyclePrivateId)).find(
      (row) => row.id === active.id
    )!;
    expect(removed).toMatchObject({
      id: active.id,
      status: 'inactive',
      valid_from: active.valid_from,
      activated_at: active.activated_at
    });
    expect(removed.valid_until).toBeTruthy();
    const removedSnapshot = { ...removed };
    expect(await rows(invitee.client, 'community_members', lifecyclePrivateId)).toMatchObject([
      { id: removed.id, status: 'inactive', valid_until: removed.valid_until }
    ]);
    expect(
      (
        await invitee.client
          .from('community_venues')
          .select('id,name')
          .eq('community_id', lifecyclePrivateId)
      ).data
    ).toEqual([]);

    const blockedInvitation = await invite(lifecyclePrivateId, invitee);
    serverClient.current = invitee.client;
    await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
      'MEMBERSHIP_INACTIVE'
    );
    expect(
      (
        await invitee.client.rpc('accept_community_invitation', {
          p_token: blockedInvitation.raw
        })
      ).error?.code
    ).toBe('PJ008');
    const unused = await owner.client
      .from('community_invitations')
      .select('redeemed_at')
      .eq('id', blockedInvitation.id)
      .single();
    expect(unused.error).toBeNull();
    expect(unused.data?.redeemed_at).toBeNull();
    expect(
      (await rows(owner.client, 'community_members', lifecyclePrivateId)).filter(
        (row) => row.user_id === invitee.id
      )
    ).toHaveLength(1);

    serverClient.current = owner.client;
    const reactivated = await reactivateCommunityMember({
      data: { community_id: lifecyclePrivateId, membership_id: removed.id }
    });
    const replacementId = reactivated.membership_id;
    expect(replacementId).toBeTruthy();
    expect(replacementId).not.toBe(removed.id);
    expect(
      (await rows(owner.client, 'community_members', lifecyclePrivateId)).find(
        (row) => row.id === removed.id
      )
    ).toEqual(removedSnapshot);
    expect(
      (await rows(owner.client, 'community_members', lifecyclePrivateId)).find(
        (row) => row.id === replacementId
      )
    ).toMatchObject({ status: 'active', role: 'member', valid_until: null });
    expect(
      (
        await invitee.client
          .from('community_venues')
          .select('id,name')
          .eq('community_id', lifecyclePrivateId)
      ).data
    ).toEqual([venueSnapshot]);
    expect(
      (await owner.client.from('community_venues').select('id,name').eq('id', venueSnapshot!.id))
        .data
    ).toEqual([venueSnapshot]);
    serverClient.current = invitee.client;
    await expect(acceptInvitation({ data: { token: blockedInvitation.raw } })).rejects.toThrow(
      'ALREADY_MEMBER_OR_PENDING'
    );
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('redeemed_at')
          .eq('id', blockedInvitation.id)
          .single()
      ).data?.redeemed_at
    ).toBeNull();

    serverClient.current = invitee.client;
    const inviteeTimeline = await getMyMembershipTimeline({
      data: { community_id: lifecyclePrivateId }
    });
    expect(inviteeTimeline.intervals).toHaveLength(2);
    expect(
      inviteeTimeline.intervals.map(({ membership_id, status }) => ({ membership_id, status }))
    ).toEqual([
      { membership_id: removed.id, status: 'inactive' },
      { membership_id: replacementId, status: 'active' }
    ]);
    serverClient.current = owner.client;
    const ownerTimeline = await getMyMembershipTimeline({
      data: { community_id: lifecyclePrivateId }
    });
    expect(ownerTimeline.intervals).toHaveLength(1);
    expect(ownerTimeline.intervals[0]?.membership_id).not.toBe(removed.id);
    expect(ownerTimeline.intervals[0]?.membership_id).not.toBe(replacementId);
    expect(await playerRows(leaver)).toEqual(leaverPlayerRows);
    expect(await playerRows(invitee)).toEqual(inviteePlayerRows);
    serverClient.current = null;
  }, 90000);

  it('closed membership history rejects public and private rejoin until admin reactivation', async () => {
    async function createHistoryCommunity(owner: Actor, visibility: 'public' | 'private') {
      const created = await owner.client.rpc('create_community', {
        p_name: `Closed history ${crypto.randomUUID()}`,
        p_visibility: visibility,
        p_join_policy: visibility === 'public' ? 'instant' : 'admin_approval'
      });
      expect(created.error).toBeNull();
      if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
      return created.data;
    }
    async function addInvitation(owner: Actor, communityId: string, invitee: Actor) {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
      const hash = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, '0')
      ).join('');
      const seeded = await executeLocalFixtureSql(`
        insert into public.community_invitations
          (community_id, invitee_user_id, issued_by, token_hash, expires_at)
        values ('${communityId}'::uuid, '${invitee.id}'::uuid, '${owner.id}'::uuid, '${hash}', clock_timestamp() + interval '1 day')
        returning id;
      `);
      if (!isSqlRowsWithId(seeded))
        throw new Error(
          `Invitation fixture returned an unexpected CLI result: ${JSON.stringify(seeded)}`
        );
      const inserted = seeded.rows[0];
      if (!inserted) throw new Error('Invitation fixture returned no inserted row');
      return { id: inserted.id, raw };
    }
    async function seedAndClose(owner: Actor, former: Actor, communityId: string) {
      serverClient.current = former.client;
      await expect(joinCommunity({ data: { community_id: communityId } })).resolves.toMatchObject({
        status: 'active'
      });
      const initial = (await rows(owner.client, 'community_members', communityId)).find(
        (row) => row.user_id === former.id
      )!;
      serverClient.current = former.client;
      await leaveCommunity({ data: { community_id: communityId } });
      return (await rows(owner.client, 'community_members', communityId)).find(
        (row) => row.id === initial.id
      )!;
    }
    const [publicOwner, publicFormer, privateOwner, privateFormer] = await Promise.all([
      actor('history-public-owner'),
      actor('history-public-former'),
      actor('history-private-owner'),
      actor('history-private-former')
    ]);
    const historyPublicId = await createHistoryCommunity(publicOwner, 'public');
    const publicOld = await seedAndClose(publicOwner, publicFormer, historyPublicId);
    const publicClosed = { ...publicOld };
    const tokenBucketId = await createHistoryCommunity(publicOwner, 'private');
    const publicInvitation = await addInvitation(publicOwner, tokenBucketId, publicFormer);
    serverClient.current = publicFormer.client;
    await expect(joinCommunity({ data: { community_id: historyPublicId } })).rejects.toThrow(
      'MEMBERSHIP_INACTIVE'
    );
    expect(
      (await rows(publicOwner.client, 'community_members', historyPublicId)).filter(
        (row) => row.user_id === publicFormer.id
      )
    ).toEqual([publicClosed]);
    const publicTokenState = await publicOwner.client
      .from('community_invitations')
      .select('id,redeemed_at,revoked_at')
      .eq('id', publicInvitation.id)
      .single();
    expect(publicTokenState.error).toBeNull();
    expect(publicTokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
    serverClient.current = publicOwner.client;
    const publicReactivation = await reactivateCommunityMember({
      data: { community_id: historyPublicId, membership_id: publicOld.id }
    });
    const publicHistory = (
      await rows(publicOwner.client, 'community_members', historyPublicId)
    ).filter((row) => row.user_id === publicFormer.id);
    expect(publicHistory.find((row) => row.id === publicOld.id)).toEqual(publicClosed);
    const publicActive = publicHistory.find((row) => row.id === publicReactivation.membership_id)!;
    expect(publicActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
    expect(publicActive.id).not.toBe(publicOld.id);
    expect(publicHistory.filter((row) => row.valid_until === null)).toHaveLength(1);
    expect(publicOld.valid_until).toBeTruthy();
    expect(Date.parse(publicActive.valid_from)).toBeGreaterThanOrEqual(
      Date.parse(publicOld.valid_until)
    );
    expect(Date.parse(publicActive.activated_at)).toBeGreaterThanOrEqual(
      Date.parse(publicActive.valid_from)
    );

    const historyPrivateId = await createHistoryCommunity(privateOwner, 'private');
    serverClient.current = privateOwner.client;
    const seededMembership = await privateOwner.client
      .from('community_members')
      .insert({ community_id: historyPrivateId, user_id: privateFormer.id, status: 'active' })
      .select('id')
      .single();
    expect(seededMembership.error).toBeNull();
    const freshToken = await addInvitation(privateOwner, historyPrivateId, privateFormer);
    const closedResult = await privateOwner.client
      .from('community_members')
      .update({ status: 'inactive', valid_until: new Date(Date.now() + 5000).toISOString() })
      .eq('id', seededMembership.data!.id);
    expect(closedResult.error).toBeNull();
    const privateClosedRow = (
      await rows(privateOwner.client, 'community_members', historyPrivateId)
    ).find((row) => row.id === seededMembership.data!.id)!;
    const privateSnapshot = { ...privateClosedRow };
    serverClient.current = privateFormer.client;
    await expect(acceptInvitation({ data: { token: freshToken.raw } })).rejects.toThrow(
      'MEMBERSHIP_INACTIVE'
    );
    const privateHistory = (
      await rows(privateOwner.client, 'community_members', historyPrivateId)
    ).filter((row) => row.user_id === privateFormer.id);
    expect(privateHistory).toEqual([privateSnapshot]);
    const tokenState = await privateOwner.client
      .from('community_invitations')
      .select('id,redeemed_at,revoked_at')
      .eq('id', freshToken.id)
      .single();
    expect(tokenState.error).toBeNull();
    expect(tokenState.data).toMatchObject({ redeemed_at: null, revoked_at: null });
    serverClient.current = privateOwner.client;
    const privateReactivation = await reactivateCommunityMember({
      data: { community_id: historyPrivateId, membership_id: privateClosedRow.id }
    });
    const reactivatedRows = (
      await rows(privateOwner.client, 'community_members', historyPrivateId)
    ).filter((row) => row.user_id === privateFormer.id);
    expect(reactivatedRows.find((row) => row.id === privateClosedRow.id)).toEqual(privateSnapshot);
    const privateActive = reactivatedRows.find(
      (row) => row.id === privateReactivation.membership_id
    )!;
    expect(privateActive).toMatchObject({ role: 'member', status: 'active', valid_until: null });
    expect(privateActive.id).not.toBe(privateClosedRow.id);
    expect(reactivatedRows.filter((row) => row.valid_until === null)).toHaveLength(1);
    expect(privateClosedRow.valid_until).toBeTruthy();
    expect(Date.parse(privateActive.valid_from)).toBeGreaterThanOrEqual(
      Date.parse(privateClosedRow.valid_until)
    );
    expect(Date.parse(privateActive.activated_at)).toBeGreaterThanOrEqual(
      Date.parse(privateActive.valid_from)
    );
  }, 90000);

  it('visibility flip rejects acceptance without consuming invitation or creating membership', async () => {
    const [owner, invitee] = await Promise.all([
      actor('visibility-flip-owner'),
      actor('visibility-flip-invitee')
    ]);
    const created = await owner.client.rpc('create_community', {
      p_name: `Visibility flip ${crypto.randomUUID()}`,
      p_visibility: 'private',
      p_join_policy: 'instant'
    });
    expect(created.error).toBeNull();
    if (typeof created.data !== 'string') throw new Error('Community fixture creation failed');
    const communityId = created.data;
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const tokenHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const invitation = await owner.client
      .from('community_invitations')
      .insert({
        community_id: communityId,
        invitee_user_id: invitee.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + 86400000).toISOString()
      })
      .select('id')
      .single();
    expect(invitation.error).toBeNull();
    const auditBefore = await rows(owner.client, 'community_audit_log', communityId);
    const flipped = await owner.client
      .from('communities')
      .update({ visibility: 'public' })
      .eq('id', communityId);
    expect(flipped.error).toBeNull();
    serverClient.current = invitee.client;
    await expect(acceptInvitation({ data: { token: raw } })).rejects.toThrow(
      'COMMUNITY_NOT_ELIGIBLE'
    );
    const invitationAfterReject = await owner.client
      .from('community_invitations')
      .select('id,redeemed_at,revoked_at')
      .eq('id', invitation.data!.id)
      .single();
    expect(invitationAfterReject.error).toBeNull();
    expect(invitationAfterReject.data?.redeemed_at).toBeNull();
    expect(invitationAfterReject.data?.revoked_at).toBeNull();
    expect(
      (await rows(owner.client, 'community_members', communityId)).filter(
        (row) => row.user_id === invitee.id
      )
    ).toEqual([]);
    const auditsAfterReject = await rows(owner.client, 'community_audit_log', communityId);
    expect(
      auditsAfterReject
        .filter((event) => !auditBefore.some((old) => old.id === event.id))
        .filter(
          (event) =>
            (event.entity === 'community_invitations' && event.action === 'UPDATE') ||
            (event.entity === 'community_members' && event.action === 'INSERT')
        )
    ).toEqual([]);
    const flippedBack = await owner.client
      .from('communities')
      .update({ visibility: 'private' })
      .eq('id', communityId);
    expect(flippedBack.error).toBeNull();
    await expect(acceptInvitation({ data: { token: raw } })).resolves.toMatchObject({
      community_id: communityId,
      status: 'active'
    });
    expect(
      (
        await owner.client
          .from('community_invitations')
          .select('id,redeemed_at,revoked_at')
          .eq('id', invitation.data!.id)
          .single()
      ).data?.redeemed_at
    ).toBeTruthy();
  }, 90000);

  it('paginates persisted timeline history completely and deterministically', async () => {
    const [owner, timelineActor, decoy, emptyActor] = await Promise.all([
      actor('timeline-page-owner'),
      actor('timeline-page-subject'),
      actor('timeline-page-decoy'),
      actor('timeline-page-empty')
    ]);
    async function createTimelineCommunity() {
      const result = await owner.client.rpc('create_community', {
        p_name: `Timeline ${crypto.randomUUID()}`,
        p_visibility: 'private',
        p_join_policy: 'admin_approval'
      });
      expect(result.error).toBeNull();
      if (typeof result.data !== 'string')
        throw new Error('Timeline community fixture creation failed');
      return result.data;
    }
    const communityIds = await Promise.all([
      createTimelineCommunity(),
      createTimelineCommunity(),
      createTimelineCommunity()
    ]);
    const fixtureIds = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID()
    ] as const;
    const fixtures = [
      {
        community_id: communityIds[0],
        valid_from: '2020-01-01T00:00:00.000001Z',
        id: fixtureIds[0]
      },
      {
        community_id: communityIds[0],
        valid_from: '2020-01-01T00:00:00.000001Z',
        id: fixtureIds[1]
      },
      {
        community_id: communityIds[0],
        valid_from: '2020-02-01T00:00:00.000002Z',
        id: fixtureIds[2]
      },
      {
        community_id: communityIds[1],
        valid_from: '2020-01-01T00:00:00.000003Z',
        id: fixtureIds[3]
      },
      {
        community_id: communityIds[1],
        valid_from: '2020-02-01T00:00:00.000004Z',
        id: fixtureIds[4]
      },
      {
        community_id: communityIds[2],
        valid_from: '2020-01-01T00:00:00.000005Z',
        id: fixtureIds[5]
      },
      {
        community_id: communityIds[2],
        valid_from: '2020-02-01T00:00:00.000006Z',
        id: fixtureIds[6]
      }
    ];
    const fixtureValues = fixtures.map((fixture, index) => {
      const until = index < 2 ? '2020-01-02T00:00:00.000001Z' : '2020-03-01T00:00:00.000000Z';
      return `('${fixture.id}'::uuid, '${fixture.community_id}'::uuid, '${timelineActor.id}'::uuid, 'member', 'inactive', '${fixture.valid_from}'::timestamptz, '${until}'::timestamptz)`;
    });
    const decoyValues = communityIds
      .slice(0, 2)
      .map(
        (community_id, index) =>
          `(gen_random_uuid(), '${community_id}'::uuid, '${decoy.id}'::uuid, 'member', 'inactive', '2020-04-0${index + 1}T00:00:00.000001Z'::timestamptz, '2020-05-0${index + 1}T00:00:00.000001Z'::timestamptz)`
      );
    await executeLocalFixtureSql(`
      insert into public.community_members
        (id, community_id, user_id, role, status, valid_from, valid_until)
      values ${[...fixtureValues, ...decoyValues].join(', ')};
    `);

    const expectedAll = [...fixtures]
      .sort(
        (a, b) =>
          a.community_id.localeCompare(b.community_id) ||
          a.valid_from.localeCompare(b.valid_from) ||
          a.id.localeCompare(b.id)
      )
      .map(({ id }) => id);
    async function traverse(
      subject: Actor,
      limit: 1 | 2,
      community_id?: string,
      expected: string[] = []
    ) {
      const ids: string[] = [];
      let offset = 0;
      let exhausted = false;
      for (let pageCount = 0; pageCount < 20; pageCount += 1) {
        serverClient.current = subject.client;
        const page = await getMyMembershipTimeline({
          data: community_id ? { offset, limit, community_id } : { offset, limit }
        });
        ids.push(...page.intervals.map((interval) => interval.membership_id));
        expect(page.truncated).toBe(false);
        if (page.next_offset === null) {
          exhausted = true;
          break;
        }
        offset = page.next_offset;
      }
      expect(exhausted, `Timeline pagination exceeded iteration bound for limit ${limit}`).toBe(
        true
      );
      expect(ids).toEqual(expected);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const limit of [1, 2] as const) {
      await traverse(timelineActor, limit, undefined, expectedAll);
      await traverse(
        timelineActor,
        limit,
        communityIds[0],
        expectedAll.filter(
          (id) => fixtures.find((fixture) => fixture.id === id)?.community_id === communityIds[0]
        )
      );
      await traverse(emptyActor, limit, undefined, []);
    }
    expect(expectedAll).toHaveLength(7);
    expect(expectedAll).not.toContain(decoy.id);
    serverClient.current = null;
  }, 90000);
});
