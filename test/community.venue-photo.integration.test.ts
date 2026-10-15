import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { deflateSync } from 'node:zlib';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';

const serverClient = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validator = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: validator(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: () => serverClient.current }));

import { finalizeCommunityVenuePhoto } from '../src/features/community/community-venue-photo.functions';
import { listCommunityVenues } from '../src/features/community/community-admin.functions';
import { validateVenuePhotoKey } from '../src/features/community/venue-photo';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const localOnly = environment.env ? describe : describe.skip;
const password = 'Password123!';
type Actor = { id: string; email: string; client: SupabaseClient };
const png = pngFixture();
const jpeg = Uint8Array.from(
  Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA//2Q==',
    'base64'
  )
);
const webp = Uint8Array.from(
  Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/v89WAAAAA==', 'base64')
);

function pngFixture() {
  const crc32 = (bytes: Buffer) => {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, payload: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), payload]);
    const length = Buffer.alloc(4);
    const checksum = Buffer.alloc(4);
    length.writeUInt32BE(payload.length);
    checksum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Uint8Array.from(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(Buffer.from([0, 30, 90, 130, 255]))),
      chunk('IEND', Buffer.alloc(0))
    ])
  );
}

function anonymous() {
  const { url, key } = environment.env!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function actor(label: string): Promise<Actor> {
  const email = `venue-photo-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}@example.test`;
  const signup = await anonymous().auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw signup.error ?? new Error('Missing local actor JWT');
  const client = createClient(environment.env!.url, environment.env!.key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${signup.data.session.access_token}` } }
  });
  const sessionResult = await client.auth.setSession(signup.data.session);
  if (sessionResult.error) throw sessionResult.error;
  const onboarding = await client.rpc('onboard_player', {
    p_display_name: label,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboarding.error) throw onboarding.error;
  return { id: signup.data.user.id, email, client };
}

function keyFor(communityId: string, venueId: string, userId: string, ext: string) {
  return `${communityId}/${venueId}/${userId}/${crypto.randomUUID()}.${ext}`;
}

async function upload(
  actorClient: SupabaseClient,
  key: string,
  bytes: Uint8Array,
  type: string,
  upsert = false
) {
  return actorClient.storage
    .from('community-venue-photos')
    .upload(key, new Blob([bytes.slice().buffer], { type }), { contentType: type, upsert });
}

localOnly('private venue photo authorization and finalization with real local Storage', () => {
  vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
  let owner: Actor;
  let photoAdmin: Actor;
  let member: Actor;
  let outsider: Actor;
  let communityId: string;
  let venueId: string;
  let archiveVenueId: string;
  let photoAdminMembershipId: string;

  beforeAll(async () => {
    owner = await actor('Venue Owner');
    photoAdmin = await actor('Venue Photo Admin');
    member = await actor('Venue Member');
    outsider = await actor('Venue Outsider');
    const community = await owner.client.rpc('create_community', {
      p_name: `Photo ${crypto.randomUUID()}`,
      p_visibility: 'private',
      p_join_policy: 'instant'
    });
    if (community.error || typeof community.data !== 'string')
      throw community.error ?? new Error('Community setup failed');
    communityId = community.data;
    const venue = await owner.client
      .from('community_venues')
      .insert({ community_id: communityId, name: 'Photo Court' })
      .select('id')
      .single();
    if (venue.error || !venue.data) throw venue.error ?? new Error('Venue setup failed');
    venueId = venue.data.id;
    const archiveVenue = await owner.client
      .from('community_venues')
      .insert({ community_id: communityId, name: 'Archive Race Court' })
      .select('id')
      .single();
    if (archiveVenue.error || !archiveVenue.data)
      throw archiveVenue.error ?? new Error('Archive venue setup failed');
    archiveVenueId = archiveVenue.data.id;
    const adminMembership = await owner.client
      .from('community_members')
      .insert({
        community_id: communityId,
        user_id: photoAdmin.id,
        role: 'admin',
        status: 'active'
      })
      .select('id')
      .single();
    if (adminMembership.error || !adminMembership.data)
      throw adminMembership.error ?? new Error('Admin membership setup failed');
    photoAdminMembershipId = adminMembership.data.id;
    const memberMembership = await owner.client
      .from('community_members')
      .insert({ community_id: communityId, user_id: member.id, role: 'member', status: 'active' });
    if (memberMembership.error) throw memberMembership.error;
  });

  it('accepts JPEG, PNG and WebP through real Storage upload and links the verified object', async () => {
    for (const [ext, type, bytes] of [
      ['jpg', 'image/jpeg', jpeg],
      ['png', 'image/png', png],
      ['webp', 'image/webp', webp]
    ] as const) {
      const objectKey = keyFor(communityId, venueId, photoAdmin.id, ext);
      expect(
        (await photoAdmin.client.rpc('valid_community_venue_photo_key', { p_key: objectKey })).data
      ).toBe(true);
      expect(
        (await photoAdmin.client.rpc('is_community_admin', { p_community_id: communityId })).data
      ).toBe(true);
      expect(
        (await photoAdmin.client.rpc('safe_venue_photo_uuid', { p_value: photoAdmin.id })).data
      ).toBe(photoAdmin.id);
      const venueVisible = await photoAdmin.client
        .from('community_venues')
        .select('id')
        .eq('id', venueId)
        .maybeSingle();
      expect(venueVisible.data?.id).toBe(venueId);
      const stored = await upload(photoAdmin.client, objectKey, bytes, type);
      expect(stored.error).toBeNull();
      serverClient.current = photoAdmin.client;
      await expect(
        finalizeCommunityVenuePhoto({
          data: { community_id: communityId, venue_id: venueId, object_key: objectKey }
        })
      ).resolves.toBe(objectKey);
      const linked = await owner.client
        .from('community_venues')
        .select('photo_path')
        .eq('id', venueId)
        .single();
      expect(linked.data?.photo_path).toBe(objectKey);
    }
  });

  it('rejects SVG, magic-byte mismatch, oversize files, aliased paths and wrong owner/community/venue', async () => {
    const svg = keyFor(communityId, venueId, photoAdmin.id, 'svg');
    expect(
      (await upload(photoAdmin.client, svg, new TextEncoder().encode('<svg/>'), 'image/svg+xml'))
        .error
    ).not.toBeNull();
    const mismatch = keyFor(communityId, venueId, photoAdmin.id, 'jpg');
    expect((await upload(photoAdmin.client, mismatch, png, 'image/jpeg')).error).toBeNull();
    serverClient.current = photoAdmin.client;
    await expect(
      finalizeCommunityVenuePhoto({
        data: { community_id: communityId, venue_id: venueId, object_key: mismatch }
      })
    ).rejects.toThrow('INVALID_VENUE_PHOTO');
    const oversized = keyFor(communityId, venueId, photoAdmin.id, 'png');
    expect(
      (await upload(photoAdmin.client, oversized, new Uint8Array(2 * 1024 * 1024 + 1), 'image/png'))
        .error
    ).not.toBeNull();
    const valid = keyFor(communityId, venueId, photoAdmin.id, 'png');
    expect(() =>
      validateVenuePhotoKey(valid.replace(`${communityId}/`, `${communityId}%2f`))
    ).toThrow('INVALID_VENUE_PHOTO_KEY');
    expect(() => validateVenuePhotoKey(valid.replace(`${communityId}/`, '../'))).toThrow(
      'INVALID_VENUE_PHOTO_KEY'
    );
    await expect(
      finalizeCommunityVenuePhoto({
        data: { community_id: outsider.id, venue_id: venueId, object_key: valid }
      })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    await expect(
      finalizeCommunityVenuePhoto({
        data: { community_id: communityId, venue_id: outsider.id, object_key: valid }
      })
    ).rejects.toThrow('INVALID_VENUE_PHOTO_KEY');
    const wrongOwner = keyFor(communityId, venueId, outsider.id, 'png');
    expect((await upload(photoAdmin.client, wrongOwner, png, 'image/png')).error).not.toBeNull();
  });

  it('denies anonymous and plain-member uploads while permitting member SELECT in the private community scope', async () => {
    const objectKey = keyFor(communityId, venueId, photoAdmin.id, 'png');
    expect((await upload(photoAdmin.client, objectKey, png, 'image/png')).error).toBeNull();
    const read = await member.client.storage.from('community-venue-photos').download(objectKey);
    expect(read.error).toBeNull();
    const memberKey = keyFor(communityId, venueId, member.id, 'png');
    expect((await upload(member.client, memberKey, png, 'image/png')).error).not.toBeNull();
    const anonymousUpload = await upload(
      anonymous(),
      keyFor(communityId, venueId, outsider.id, 'png'),
      png,
      'image/png'
    );
    expect(anonymousUpload.error).not.toBeNull();
  });

  it('rejects revoked Admin and archived venue finalization without replacing the previous path', async () => {
    const firstKey = keyFor(communityId, venueId, photoAdmin.id, 'png');
    expect((await upload(photoAdmin.client, firstKey, png, 'image/png')).error).toBeNull();
    serverClient.current = photoAdmin.client;
    await finalizeCommunityVenuePhoto({
      data: { community_id: communityId, venue_id: venueId, object_key: firstKey }
    });
    const revokedKey = keyFor(communityId, venueId, photoAdmin.id, 'png');
    expect((await upload(photoAdmin.client, revokedKey, png, 'image/png')).error).toBeNull();
    const demote = await owner.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: photoAdminMembershipId,
      p_action: 'demote'
    });
    expect(demote.error).toBeNull();
    await expect(
      finalizeCommunityVenuePhoto({
        data: { community_id: communityId, venue_id: venueId, object_key: revokedKey }
      })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    const prior = await owner.client
      .from('community_venues')
      .select('photo_path')
      .eq('id', venueId)
      .single();
    expect(prior.data?.photo_path).toBe(firstKey);
    const archiveRaceKey = keyFor(communityId, archiveVenueId, owner.id, 'png');
    expect((await upload(owner.client, archiveRaceKey, png, 'image/png')).error).toBeNull();
    const archived = await owner.client
      .from('community_venues')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', archiveVenueId);
    expect(archived.error).toBeNull();
    serverClient.current = owner.client;
    await expect(
      finalizeCommunityVenuePhoto({
        data: { community_id: communityId, venue_id: archiveVenueId, object_key: archiveRaceKey }
      })
    ).rejects.toThrow('Venue unavailable');
    const after = await owner.client
      .from('community_venues')
      .select('photo_path')
      .eq('id', archiveVenueId)
      .single();
    expect(after.data?.photo_path).toBeNull();
  });

  it('does not permit upsert/update and never serializes signed URLs to unauthorized actors', async () => {
    const freshVenue = await owner.client
      .from('community_venues')
      .insert({ community_id: communityId, name: 'No Upsert Court' })
      .select('id')
      .single();
    if (freshVenue.error || !freshVenue.data)
      throw freshVenue.error ?? new Error('Venue setup failed');
    const objectKey = keyFor(communityId, freshVenue.data.id, owner.id, 'png');
    expect((await upload(owner.client, objectKey, png, 'image/png')).error).toBeNull();
    expect((await upload(owner.client, objectKey, png, 'image/png', true)).error).not.toBeNull();
    serverClient.current = outsider.client;
    await expect(
      listCommunityVenues({ data: { community_id: communityId, offset: 0, limit: 10 } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    const unauthorizedResult = await listCommunityVenues({
      data: { community_id: communityId, offset: 0, limit: 10 }
    }).catch((cause: unknown) => ({
      error: cause instanceof Error ? cause.message : String(cause)
    }));
    expect(JSON.stringify(unauthorizedResult)).not.toContain('photo_signed_url');
    expect(JSON.stringify(unauthorizedResult)).not.toContain('signedUrl');
    const anonymousFinalize = await anonymous().rpc('finalize_community_venue_photo', {
      p_community_id: communityId,
      p_venue_id: venueId,
      p_object_key: objectKey
    });
    expect(anonymousFinalize.error).not.toBeNull();
    const memberFinalize = await member.client.rpc('finalize_community_venue_photo', {
      p_community_id: communityId,
      p_venue_id: venueId,
      p_object_key: objectKey
    });
    expect(memberFinalize.error).not.toBeNull();
  });
});
