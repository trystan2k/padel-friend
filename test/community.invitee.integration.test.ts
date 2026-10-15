import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
if (!environment.env)
  throw new Error(`Invitee integration suite requires live local Supabase: ${environment.reason}`);
const rowIds = (rows: unknown) =>
  Array.isArray(rows) ? rows.map((row: { user_id: string }) => row.user_id) : [];
const rawToken = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
describe('invitee directory (real local Supabase JWTs)', () => {
  it('returns only opted-in invitees to current private-community admins and honors withdrawal', async () => {
    const { url, key } = environment.env!;
    const createActor = async (label: string) => {
      const anon = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      });
      const signup = await anon.auth.signUp({
        email: `${crypto.randomUUID()}@example.test`,
        password: 'Password123!'
      });
      expect(signup.data.session).toBeTruthy();
      const client = createClient(url, key, {
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
      return { id: signup.data.user!.id, client, name: label };
    };
    const admin = await createActor(`Directory Admin ${crypto.randomUUID().slice(0, 6)}`);
    const person = await createActor(`Discoverable Player ${crypto.randomUUID().slice(0, 6)}`);
    const nonAdmin = await createActor(`Member ${crypto.randomUUID().slice(0, 6)}`);
    const inactive = await createActor(`Inactive ${crypto.randomUUID().slice(0, 6)}`);
    const pending = await createActor(`Pending ${crypto.randomUUID().slice(0, 6)}`);
    const invited = await createActor(`Invited ${crypto.randomUUID().slice(0, 6)}`);
    const outsider = await createActor(`Outsider ${crypto.randomUUID().slice(0, 6)}`);
    const community = await admin.client.rpc('create_community', {
      p_name: `Private ${crypto.randomUUID().slice(0, 8)}`,
      p_visibility: 'private',
      p_join_policy: 'admin_approval'
    });
    expect(community.error).toBeNull();
    if (typeof community.data !== 'string') throw new Error('Community RPC returned no id');
    const cid = community.data;
    const search = (client: SupabaseClient, query = 'Discoverable', limit = 20) =>
      client.rpc('search_community_invitees', {
        p_community_id: cid,
        p_query: query,
        p_limit: limit
      });
    expect((await search(admin.client, personName(person))).data).toEqual([]);
    expect(
      (
        await person.client
          .from('community_invitee_directory_preferences')
          .insert({ user_id: person.id })
      ).error
    ).toBeNull();
    const found = await search(admin.client, personName(person));
    expect(found.data).toEqual([{ user_id: person.id, display_name: person.name }]);
    expect(Object.keys(found.data[0]).sort()).toEqual(['display_name', 'user_id']);
    expect((await search(nonAdmin.client, personName(person))).error).not.toBeNull();
    expect((await search(outsider.client, personName(person))).error).not.toBeNull();
    const anonymous = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    expect((await search(anonymous, personName(person))).error).not.toBeNull();
    const publicCommunity = await admin.client.rpc('create_community', {
      p_name: `Public ${crypto.randomUUID().slice(0, 8)}`,
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    expect(publicCommunity.error).toBeNull();
    expect(
      (
        await admin.client.rpc('search_community_invitees', {
          p_community_id: publicCommunity.data,
          p_query: personName(person),
          p_limit: 20
        })
      ).error
    ).not.toBeNull();
    for (const [query, limit] of [
      ['ab', 20],
      ['x'.repeat(81), 20],
      [personName(person), 0],
      [personName(person), 21]
    ] as const)
      expect((await search(admin.client, query, limit)).error).not.toBeNull();
    expect((await search(admin.client, person.name.slice(0, 3), 1)).error).toBeNull();
    expect((await search(admin.client, 'x'.repeat(80), 20)).error).toBeNull();

    const special = await createActor('Literal 100%_.* Name');
    expect(
      (
        await special.client
          .from('community_invitee_directory_preferences')
          .insert({ user_id: special.id })
      ).error
    ).toBeNull();
    expect(rowIds((await search(admin.client, '100%_.*')).data)).toContain(special.id);
    expect(rowIds((await search(admin.client, '100%_x')).data)).not.toContain(special.id);
    expect(
      (
        await admin.client
          .from('community_invitee_directory_preferences')
          .insert({ user_id: admin.id })
      ).error
    ).toBeNull();
    expect(rowIds((await search(admin.client, admin.name)).data)).not.toContain(admin.id);
    expect(
      (
        await person.client
          .from('community_invitee_directory_preferences')
          .insert({ user_id: outsider.id })
      ).error
    ).not.toBeNull();

    const inviteToken = rawToken();
    const inviteHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inviteToken))),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    const invitation = await admin.client.from('community_invitations').insert({
      community_id: cid,
      invitee_user_id: invited.id,
      token_hash: inviteHash,
      expires_at: new Date(Date.now() + 60_000).toISOString()
    });
    expect(invitation.error).toBeNull();
    const acceptToken = rawToken();
    const acceptHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(acceptToken))),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    expect(
      (
        await admin.client.from('community_invitations').insert({
          community_id: cid,
          invitee_user_id: nonAdmin.id,
          token_hash: acceptHash,
          expires_at: new Date(Date.now() + 60_000).toISOString()
        })
      ).error
    ).toBeNull();
    expect(
      (await nonAdmin.client.rpc('accept_community_invitation', { p_token: acceptToken })).error
    ).toBeNull();
    // Membership history remains excluded after the member leaves.
    const inactiveToken = rawToken();
    const inactiveHash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(inactiveToken))
      ),
      (byte) => byte.toString(16).padStart(2, '0')
    ).join('');
    await inactive.client
      .from('community_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('invitee_user_id', inactive.id);
    expect(
      (
        await admin.client.from('community_invitations').insert({
          community_id: cid,
          invitee_user_id: inactive.id,
          token_hash: inactiveHash,
          expires_at: new Date(Date.now() + 60_000).toISOString()
        })
      ).error
    ).toBeNull();
    expect(
      (await inactive.client.rpc('accept_community_invitation', { p_token: inactiveToken })).error
    ).toBeNull();
    expect(
      (await inactive.client.rpc('leave_community', { p_community_id: cid })).error
    ).toBeNull();
    expect(
      (
        await admin.client
          .from('community_members')
          .insert({ community_id: cid, user_id: pending.id, role: 'member', status: 'pending' })
      ).error
    ).toBeNull();
    for (const actor of [nonAdmin, inactive, pending, invited])
      expect(rowIds((await search(admin.client, actor.name)).data)).not.toContain(actor.id);
    expect(rowIds((await search(admin.client, invited.name)).data)).not.toContain(invited.id);
    expect(
      (
        await person.client
          .from('community_invitee_directory_preferences')
          .delete()
          .eq('user_id', person.id)
      ).error
    ).toBeNull();
    expect((await search(admin.client, person.name)).data).toEqual([]);
    expect(
      (await person.client.from('community_invitee_directory_preferences').select('user_id')).data
    ).toEqual([]);
  });
});

function personName(actor: { name?: string }) {
  return actor.name ?? '';
}
