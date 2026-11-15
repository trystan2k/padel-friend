import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { executeTrustedSql } from './helpers/sql-transport';
import { trustedClient } from './helpers/trusted-client';
import {
  signUpFixtureActor,
  insertFixtureCommunity,
  insertFixtureEvent,
  provisionProvisionalPlayer
} from './helpers/provisional-player-fixtures';

const serverClient = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: () => serverClient.current }));

import {
  completeAvatarUpload,
  updateMyPlayerProfile
} from '../src/features/player/player.functions';

const environment = localSupabaseEnv();
if (!environment.env) throw new Error(environment.reason);
const env = environment.env;
const bucket = 'player-avatars';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

async function actor(label: string, onboard = true) {
  const signup = await createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  }).auth.signUp({
    email: `avatar-${label}-${crypto.randomUUID()}@test.local`,
    password: 'Password123!'
  });
  expect(signup.error).toBeNull();
  const session = signup.data.session!;
  const client = createClient(env.url, env.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  expect((await client.auth.setSession(session)).error).toBeNull();
  if (onboard) {
    const result = await client.rpc('onboard_player', {
      p_display_name: label,
      p_preferred_side: 'EITHER',
      p_initial_level: 3
    });
    if (result.error) throw result.error;
  }
  serverClient.current = client;
  return { client, id: signup.data.user!.id };
}

async function upload(client: SupabaseClient, id: string, bytes: Uint8Array = png) {
  const key = `${id}/${crypto.randomUUID()}.png`;
  expect(
    (
      await client.storage
        .from(bucket)
        .upload(key, bytes, { contentType: 'image/png', upsert: false })
    ).error
  ).toBeNull();
  return key;
}

async function storedAvatar(client: SupabaseClient, id: string) {
  const result = await client
    .from('player_profiles')
    .select('avatar_url')
    .eq('user_id', id)
    .single();
  expect(result.error).toBeNull();
  return result.data!.avatar_url;
}

describe('verified avatar server path and database boundary', () => {
  it('rejects disguised HTML and removes the already-uploaded object', async () => {
    const user = await actor('invalid');
    const key = await upload(user.client, user.id, Buffer.from('<html><script>alert(1)</script>'));
    await expect(completeAvatarUpload({ data: { objectKey: key } })).rejects.toThrow(
      'INVALID_AVATAR'
    );
    expect((await user.client.storage.from(bucket).download(key)).error).not.toBeNull();
    expect(await storedAvatar(user.client, user.id)).toBeNull();
  });

  it('accepts verified PNG through service CAS; direct PATCH and mutation remain denied', async () => {
    const user = await actor('valid');
    const key = await upload(user.client, user.id);
    const profile = await completeAvatarUpload({
      data: { objectKey: key, expectedPreviousKey: null }
    });
    expect(profile.avatar_signed_url).toContain('/object/sign/');
    expect(await storedAvatar(user.client, user.id)).toBe(key);

    for (const avatar of [null, `${user.id}/${crypto.randomUUID()}.png`]) {
      const direct = await user.client
        .from('player_profiles')
        .update({ avatar_url: avatar })
        .eq('user_id', user.id);
      expect(direct.error?.code).toBe('42501');
    }
    await expect(
      updateMyPlayerProfile({ data: { bio: 'Ordinary update' } })
    ).resolves.toMatchObject({ bio: 'Ordinary update' });
    expect((await user.client.storage.from(bucket).remove([key])).data).toEqual([]);
    const replacement = await user.client.storage
      .from(bucket)
      .upload(key, Buffer.from('<script>evil</script>'), {
        contentType: 'image/png',
        upsert: true
      });
    expect(replacement.error).not.toBeNull();
    const mutation = await user.client.storage
      .from(bucket)
      .update(key, Buffer.from('evil'), { contentType: 'image/png' });
    expect(mutation.error).not.toBeNull();
    const remaining = await user.client.storage.from(bucket).download(key);
    expect(Buffer.from(await remaining.data!.arrayBuffer())).toEqual(png);
    expect(await storedAvatar(user.client, user.id)).toBe(key);
  });

  it('concurrent expected-none finalizers preserve one winner and never delete either valid candidate', async () => {
    const user = await actor('race');
    const first = await upload(user.client, user.id);
    const second = await upload(user.client, user.id);
    const results = await Promise.allSettled(
      [first, second].map((objectKey) =>
        completeAvatarUpload({ data: { objectKey, expectedPreviousKey: null } })
      )
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failed = results.find((result) => result.status === 'rejected');
    expect(failed?.status === 'rejected' && failed.reason.message).toBe('AVATAR_CONFLICT');
    expect([first, second]).toContain(await storedAvatar(user.client, user.id));
    for (const key of [first, second])
      expect((await user.client.storage.from(bucket).download(key)).error).toBeNull();
  });

  it('foreign key rejection never deletes the foreign object', async () => {
    const owner = await actor('owner');
    const key = await upload(owner.client, owner.id);
    await actor('attacker');
    await expect(completeAvatarUpload({ data: { objectKey: key } })).rejects.toThrow(
      'INVALID_AVATAR_KEY'
    );
    expect((await owner.client.storage.from(bucket).download(key)).error).toBeNull();
  });

  it('denies non-onboarded and revoked actors before privileged writes', async () => {
    const fresh = await actor('fresh', false);
    await expect(
      completeAvatarUpload({ data: { objectKey: `${fresh.id}/${crypto.randomUUID()}.png` } })
    ).rejects.toThrow('PLAYER_NOT_ONBOARDED');
    const revoked = await actor('revoked');
    const key = await upload(revoked.client, revoked.id);
    // Existing liveness guard applies to claimed identities, identified by claim audit.
    const communityId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    await insertFixtureCommunity({ id: communityId, visibility: 'private', adminId: revoked.id });
    await insertFixtureEvent({
      id: eventId,
      communityId,
      creatorId: revoked.id,
      visibility: 'invite_only'
    });
    await executeTrustedSql(
      `insert into public.match_event_audit_log
      (match_event_id, community_id, actor_id, target_user_id, action, transition_revision)
      values ($1, $2, $3, $3, 'player_claimed', 1)`,
      { values: [eventId, communityId, revoked.id] }
    );
    await executeTrustedSql('delete from auth.sessions where user_id = $1', {
      values: [revoked.id]
    });
    await expect(completeAvatarUpload({ data: { objectKey: key } })).rejects.toThrow(
      'PLAYER_NOT_ONBOARDED'
    );
    expect(await storedAvatar(trustedClient(), revoked.id)).toBeNull();
  });

  it('denies provisional actors even though the final writer uses service role', async () => {
    const inviter = await signUpFixtureActor(env, 'avatar-inviter', {
      displayName: 'Inviter',
      level: 3
    });
    const provisional = await actor('provisional', false);
    const communityId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    await insertFixtureCommunity({ id: communityId, visibility: 'private', adminId: inviter.id });
    await insertFixtureEvent({
      id: eventId,
      communityId,
      creatorId: inviter.id,
      visibility: 'invite_only'
    });
    await provisionProvisionalPlayer({
      userId: provisional.id,
      displayName: 'Invited',
      estimatedLevel: 3,
      invitedBy: inviter.id,
      sourceEventId: eventId
    });
    const key = `${provisional.id}/${crypto.randomUUID()}.png`;
    expect(
      (await trustedClient().storage.from(bucket).upload(key, png, { contentType: 'image/png' }))
        .error
    ).toBeNull();
    await expect(completeAvatarUpload({ data: { objectKey: key } })).rejects.toThrow(
      'PLAYER_NOT_ONBOARDED'
    );
    expect(await storedAvatar(trustedClient(), provisional.id)).toBeNull();
    expect((await trustedClient().storage.from(bucket).download(key)).error).toBeNull();
  });
});
