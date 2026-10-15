import { setResponseHeader } from '@tanstack/react-start/server';
import {
  COMMUNITY_VENUE_PHOTO_BUCKET,
  COMMUNITY_VENUE_PHOTO_MAX_BYTES,
  matchesVenuePhotoMagicBytes,
  validateVenuePhotoKey
} from './venue-photo';
import type { CommunityAdminClient } from './community-venue-photo.functions';

export async function finalizeVenuePhoto(
  client: CommunityAdminClient,
  communityId: string,
  venueId: string,
  objectKey: string,
  userId: string
) {
  validateVenuePhotoKey(objectKey);
  const segments = objectKey.split('/');
  if (segments[0] !== communityId || segments[1] !== venueId || segments[2] !== userId)
    throw new Error('INVALID_VENUE_PHOTO_KEY');
  const { data: objects, error: listError } = await client.storage
    .from(COMMUNITY_VENUE_PHOTO_BUCKET)
    .list(`${communityId}/${venueId}/${userId}`, { search: segments[3] });
  if (listError) throw listError;
  const metadata = objects?.find((object) => object.name === segments[3]);
  if (!metadata || !metadata.metadata || metadata.metadata.size > COMMUNITY_VENUE_PHOTO_MAX_BYTES)
    throw new Error('INVALID_VENUE_PHOTO');
  const { data: blob, error: downloadError } = await client.storage
    .from(COMMUNITY_VENUE_PHOTO_BUCKET)
    .download(objectKey);
  if (downloadError) throw downloadError;
  if (blob.size > COMMUNITY_VENUE_PHOTO_MAX_BYTES) throw new Error('INVALID_VENUE_PHOTO');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const mime = blob.type;
  if (!matchesVenuePhotoMagicBytes(mime, bytes)) throw new Error('INVALID_VENUE_PHOTO');
  const { error } = await client.rpc('finalize_community_venue_photo', {
    p_community_id: communityId,
    p_venue_id: venueId,
    p_object_key: objectKey
  });
  if (error) throw error;
  return objectKey;
}

export async function signVenuePhoto(client: CommunityAdminClient, objectKey: string | null) {
  setResponseHeader('Cache-Control', 'private, no-store');
  if (!objectKey) return null;
  try {
    validateVenuePhotoKey(objectKey);
    const { data, error } = await client.storage
      .from(COMMUNITY_VENUE_PHOTO_BUCKET)
      .createSignedUrl(objectKey, 60);
    return error ? null : data.signedUrl;
  } catch {
    return null;
  }
}
