import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { queryTrustedSql } from './helpers/sql-transport';
import { trustedClient } from './helpers/trusted-client';
import type { Database, Json } from '../src/lib/supabase/database.types';

const environment = localSupabaseEnv();
if (!environment.env)
  throw new Error(
    `Community write-boundary suite requires live local Supabase: ${environment.reason}`
  );
const { url, key } = environment.env;
const PERMISSION_DENIED = '42501';

async function createActor(label: string) {
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const signup = await anon.auth.signUp({
    email: `${crypto.randomUUID()}@example.test`,
    password: 'Password123!'
  });
  expect(signup.data.session).toBeTruthy();
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
  });
  expect(
    (
      await client.rpc('onboard_player', {
        p_display_name: label,
        p_preferred_side: 'EITHER',
        p_initial_level: 3.2
      })
    ).error
  ).toBeNull();
  return { id: signup.data.user!.id, client };
}
type Actor = Awaited<ReturnType<typeof createActor>>;

async function createCommunity(owner: Actor, visibility: 'public' | 'private') {
  const created = await owner.client.rpc('create_community', {
    p_name: `Boundary ${crypto.randomUUID().slice(0, 8)}`,
    p_visibility: visibility,
    p_join_policy: visibility === 'private' ? 'admin_approval' : 'instant'
  });
  expect(created.error).toBeNull();
  if (typeof created.data !== 'string') throw new Error('create_community returned no id');
  return created.data;
}
const sha256Hex = async (value: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');

describe('community write boundary (real local Supabase JWTs)', () => {
  it('denies direct membership, invitation, venue and community writes to every authenticated role', async () => {
    const [owner, member, outsider, victim] = await Promise.all([
      createActor('Boundary Owner'),
      createActor('Boundary Member'),
      createActor('Boundary Outsider'),
      createActor('Boundary Victim')
    ]);
    const communityId = await createCommunity(owner, 'private');
    expect(
      (
        await trustedClient().from('community_members').insert({
          community_id: communityId,
          user_id: member.id,
          role: 'member',
          status: 'active'
        })
      ).error
    ).toBeNull();
    const venue = await owner.client.rpc('add_community_venue', {
      p_community_id: communityId,
      p_name: 'Boundary Court'
    });
    expect(venue.error).toBeNull();
    const issued = await owner.client
      .rpc('issue_community_invitation', {
        p_community_id: communityId,
        p_invitee_user_id: victim.id
      })
      .single();
    expect(issued.error).toBeNull();
    const membershipRow = (
      await trustedClient()
        .from('community_members')
        .select('id')
        .eq('community_id', communityId)
        .eq('user_id', member.id)
        .single()
    ).data!.id;

    // An outsider force-adding anyone (the reviewed exploit), a member self-promoting, and the
    // community's own admin bypassing the consent RPCs all hit column/table-level denial.
    for (const [label, actor] of [
      ['outsider', outsider],
      ['member', member],
      ['admin', owner]
    ] as const) {
      const forcedAdd = await actor.client
        .from('community_members')
        .insert({ community_id: communityId, user_id: victim.id, role: 'admin', status: 'active' });
      expect(forcedAdd.error?.code, `${label} membership insert`).toBe(PERMISSION_DENIED);
      const selfInsert = await actor.client.from('community_members').insert({
        community_id: communityId,
        user_id: actor.id,
        role: 'admin',
        status: 'active'
      });
      expect(selfInsert.error?.code, `${label} self membership insert`).toBe(PERMISSION_DENIED);
      const promote = await actor.client
        .from('community_members')
        .update({ role: 'admin' })
        .eq('id', membershipRow);
      expect(promote.error?.code, `${label} membership update`).toBe(PERMISSION_DENIED);
      const invitation = await actor.client.from('community_invitations').insert({
        community_id: communityId,
        invitee_user_id: victim.id,
        token_hash: 'a'.repeat(64),
        expires_at: new Date(Date.now() + 86400000).toISOString()
      });
      expect(invitation.error?.code, `${label} invitation insert`).toBe(PERMISSION_DENIED);
      const revoke = await actor.client
        .from('community_invitations')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', issued.data!.invitation_id);
      expect(revoke.error?.code, `${label} invitation update`).toBe(PERMISSION_DENIED);
      const venueInsert = await actor.client
        .from('community_venues')
        .insert({ community_id: communityId, name: 'Forged' });
      expect(venueInsert.error?.code, `${label} venue insert`).toBe(PERMISSION_DENIED);
      const venueUpdate = await actor.client
        .from('community_venues')
        .update({ name: 'Forged' })
        .eq('community_id', communityId);
      expect(venueUpdate.error?.code, `${label} venue update`).toBe(PERMISSION_DENIED);
      const tamper = await actor.client
        .from('communities')
        .update({ visibility: 'public' })
        .eq('id', communityId);
      expect(tamper.error?.code, `${label} community update`).toBe(PERMISSION_DENIED);
    }

    const state = await trustedClient()
      .from('community_members')
      .select('user_id,role,status')
      .eq('community_id', communityId);
    expect(state.data).toHaveLength(2);
    expect(state.data?.find((row) => row.user_id === victim.id)).toBeUndefined();
    expect(state.data?.find((row) => row.user_id === member.id)).toMatchObject({ role: 'member' });
    const community = await trustedClient()
      .from('communities')
      .select('visibility')
      .eq('id', communityId)
      .single();
    expect(community.data?.visibility).toBe('private');
  }, 60000);

  it('issues invitations only through the admin-checked RPC and stores only the token digest', async () => {
    const [owner, outsider, invitee, existing] = await Promise.all([
      createActor('Invite Owner'),
      createActor('Invite Outsider'),
      createActor('Invite Target'),
      createActor('Invite Existing')
    ]);
    const privateId = await createCommunity(owner, 'private');
    const publicId = await createCommunity(owner, 'public');
    const args = (communityId: string, userId: string) => ({
      p_community_id: communityId,
      p_invitee_user_id: userId
    });

    const forged = await outsider.client.rpc(
      'issue_community_invitation',
      args(privateId, invitee.id)
    );
    expect(forged.error?.message).toBe('NOT_COMMUNITY_ADMIN');
    const publicAttempt = await owner.client.rpc(
      'issue_community_invitation',
      args(publicId, invitee.id)
    );
    expect(publicAttempt.error?.message).toBe('COMMUNITY_NOT_ELIGIBLE');
    const unknownUser = await owner.client.rpc(
      'issue_community_invitation',
      args(privateId, crypto.randomUUID())
    );
    expect(unknownUser.error?.message).toBe('INVITEE_NOT_FOUND');
    const unknownCommunity = await owner.client.rpc(
      'issue_community_invitation',
      args(crypto.randomUUID(), invitee.id)
    );
    expect(unknownCommunity.error?.message).toBe('NOT_COMMUNITY_ADMIN');
    expect(
      (await owner.client.rpc('issue_community_invitation', args(privateId, owner.id))).error
        ?.message
    ).toBe('ALREADY_MEMBER_OR_PENDING');
    expect(
      (
        await trustedClient()
          .from('community_invitations')
          .select('id')
          .eq('community_id', privateId)
      ).data
    ).toEqual([]);

    const issued = await owner.client
      .rpc('issue_community_invitation', args(privateId, invitee.id))
      .single();
    expect(issued.error).toBeNull();
    expect(issued.data?.token).toMatch(/^[0-9a-f]{64}$/);
    const stored = await trustedClient()
      .from('community_invitations')
      .select('id,token_hash,issued_by,invitee_user_id,expires_at,created_at')
      .eq('id', issued.data!.invitation_id)
      .single();
    expect(stored.data).toMatchObject({
      token_hash: await sha256Hex(issued.data!.token),
      issued_by: owner.id,
      invitee_user_id: invitee.id
    });
    expect(Date.parse(stored.data!.expires_at) - Date.parse(stored.data!.created_at)).toBe(
      7 * 24 * 60 * 60 * 1000
    );
    expect(
      (await owner.client.rpc('issue_community_invitation', args(privateId, invitee.id))).error
        ?.message
    ).toBe('INVITATION_ALREADY_OPEN');

    // The raw token works end to end through the existing acceptance RPC.
    const accepted = await invitee.client.rpc('accept_community_invitation', {
      p_token: issued.data!.token
    });
    expect(accepted.error).toBeNull();

    expect(
      (
        await trustedClient().from('community_members').insert({
          community_id: privateId,
          user_id: existing.id,
          role: 'member',
          status: 'active'
        })
      ).error
    ).toBeNull();
    expect(
      (await owner.client.rpc('issue_community_invitation', args(privateId, existing.id))).error
        ?.message
    ).toBe('ALREADY_MEMBER_OR_PENDING');

    const revokeArgs = (invitationId: string) => ({
      p_community_id: privateId,
      p_invitation_id: invitationId
    });
    const second = await createActor('Invite Second Target');
    const open = await owner.client
      .rpc('issue_community_invitation', args(privateId, second.id))
      .single();
    expect(open.error).toBeNull();
    expect(
      (
        await outsider.client.rpc(
          'revoke_community_invitation',
          revokeArgs(open.data!.invitation_id)
        )
      ).error?.message
    ).toBe('NOT_COMMUNITY_ADMIN');
    const revoked = await owner.client
      .rpc('revoke_community_invitation', revokeArgs(open.data!.invitation_id))
      .single();
    expect(revoked.error).toBeNull();
    expect(revoked.data?.revoked_at).toBeTruthy();
    expect(
      (await owner.client.rpc('revoke_community_invitation', revokeArgs(open.data!.invitation_id)))
        .error?.message
    ).toBe('INVITATION_NOT_FOUND');
    const otherCommunity = await createCommunity(owner, 'private');
    const foreignScope = await owner.client.rpc('revoke_community_invitation', {
      p_community_id: otherCommunity,
      p_invitation_id: issued.data!.invitation_id
    });
    expect(foreignScope.error?.message).toBe('INVITATION_NOT_FOUND');
  }, 60000);

  it('manages venues only through admin-checked RPCs scoped to their own community', async () => {
    const [owner, outsider, rival] = await Promise.all([
      createActor('Venue Owner'),
      createActor('Venue Outsider'),
      createActor('Venue Rival')
    ]);
    const communityId = await createCommunity(owner, 'private');
    const rivalCommunity = await createCommunity(rival, 'private');

    const forged = await outsider.client.rpc('add_community_venue', {
      p_community_id: communityId,
      p_name: 'Forged'
    });
    expect(forged.error?.message).toBe('NOT_COMMUNITY_ADMIN');
    const crossAdmin = await rival.client.rpc('add_community_venue', {
      p_community_id: communityId,
      p_name: 'Cross'
    });
    expect(crossAdmin.error?.message).toBe('NOT_COMMUNITY_ADMIN');

    const created = await owner.client
      .rpc('add_community_venue', {
        p_community_id: communityId,
        p_name: 'North Court',
        p_address: 'Madrid',
        p_maps_url: 'https://maps.example.test/north'
      })
      .single();
    expect(created.error).toBeNull();
    expect(created.data).toMatchObject({
      community_id: communityId,
      name: 'North Court',
      address: 'Madrid',
      archived_at: null
    });
    const venueId = created.data!.id;
    expect(
      (
        await trustedClient()
          .from('community_venues')
          .select('created_by')
          .eq('id', venueId)
          .single()
      ).data?.created_by
    ).toBe(owner.id);

    expect(
      (
        await owner.client.rpc('add_community_venue', {
          p_community_id: communityId,
          p_name: 'Bad URL',
          p_maps_url: 'http://insecure.example.test'
        })
      ).error?.code
    ).toBe('23514');

    const edit = (client: Actor['client'], communityArg: string, changes: Json) =>
      client.rpc('edit_community_venue', {
        p_community_id: communityArg,
        p_venue_id: venueId,
        p_changes: changes
      });
    expect((await edit(outsider.client, communityId, { name: 'Forged' })).error?.message).toBe(
      'NOT_COMMUNITY_ADMIN'
    );
    expect((await edit(rival.client, rivalCommunity, { name: 'Cross' })).error?.message).toBe(
      'COMMUNITY_VENUE_NOT_FOUND'
    );
    expect((await edit(owner.client, communityId, { photo_path: 'x/y' })).error?.message).toBe(
      'COMMUNITY_INVALID_INPUT'
    );
    expect((await edit(owner.client, communityId, {})).error?.message).toBe(
      'COMMUNITY_INVALID_INPUT'
    );
    const edited = await edit(owner.client, communityId, {
      name: 'South Court',
      address: null
    }).single();
    expect(edited.error).toBeNull();
    expect(edited.data).toMatchObject({
      name: 'South Court',
      address: null,
      maps_url: 'https://maps.example.test/north'
    });

    const archive = (client: Actor['client'], communityArg: string) =>
      client.rpc('archive_community_venue', { p_community_id: communityArg, p_venue_id: venueId });
    expect((await archive(outsider.client, communityId)).error?.message).toBe(
      'NOT_COMMUNITY_ADMIN'
    );
    expect((await archive(rival.client, rivalCommunity)).error?.message).toBe(
      'COMMUNITY_VENUE_NOT_FOUND'
    );
    const archived = await archive(owner.client, communityId).single();
    expect(archived.error).toBeNull();
    expect(archived.data?.archived_at).toBeTruthy();
    expect((await archive(owner.client, communityId)).error?.message).toBe(
      'COMMUNITY_VENUE_NOT_FOUND'
    );
    expect((await edit(owner.client, communityId, { name: 'Late' })).error?.message).toBe(
      'COMMUNITY_VENUE_NOT_FOUND'
    );
  }, 60000);

  it('keeps the new RPCs authenticated-only, search_path-pinned and anonymous-proof', async () => {
    const catalog = await queryTrustedSql(
      `select p.proname, p.prosecdef, p.proconfig,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace and p.proname = any($1::text[])
       order by p.proname`,
      {
        values: [
          [
            'add_community_venue',
            'edit_community_venue',
            'archive_community_venue',
            'issue_community_invitation',
            'revoke_community_invitation'
          ]
        ]
      }
    );
    expect(catalog.rows).toHaveLength(5);
    for (const row of catalog.rows)
      expect(row).toMatchObject({
        prosecdef: true,
        proconfig: ['search_path=""'],
        anon_exec: false,
        authenticated_exec: true
      });
    const anon = createClient(url, key, { auth: { persistSession: false } });
    const owner = await createActor('Anon Probe Owner');
    const communityId = await createCommunity(owner, 'private');
    const calls: Array<[string, object]> = [
      ['add_community_venue', { p_community_id: communityId, p_name: 'Anon' }],
      [
        'edit_community_venue',
        { p_community_id: communityId, p_venue_id: crypto.randomUUID(), p_changes: { name: 'x' } }
      ],
      ['archive_community_venue', { p_community_id: communityId, p_venue_id: crypto.randomUUID() }],
      [
        'issue_community_invitation',
        { p_community_id: communityId, p_invitee_user_id: crypto.randomUUID() }
      ],
      [
        'revoke_community_invitation',
        { p_community_id: communityId, p_invitation_id: crypto.randomUUID() }
      ]
    ];
    const codes = await Promise.all(
      calls.map(async ([name, args]) => (await anon.rpc(name, args)).error?.code)
    );
    expect(codes).toEqual(calls.map(() => PERMISSION_DENIED));
  }, 60000);
});
