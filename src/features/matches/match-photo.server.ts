import { setResponseHeader } from '@tanstack/react-start/server';
import type { requireAuthenticatedClient } from '../auth/auth.server';
import {
  MATCH_PHOTO_BUCKET,
  MATCH_PHOTO_MAX_BYTES,
  matchesMatchPhotoMagicBytes,
  matchPhotoExtension,
  validateMatchPhotoKey
} from './match-photo';

type AuthClient = Awaited<ReturnType<typeof requireAuthenticatedClient>>['client'];

export async function uploadMatchPhoto(
  client: AuthClient,
  userId: string,
  communityId: string,
  eventId: string,
  file: File
) {
  if (
    file.size < 1 ||
    file.size > MATCH_PHOTO_MAX_BYTES ||
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
  )
    throw new Error('INVALID_MATCH_PHOTO');
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!matchesMatchPhotoMagicBytes(file.type, bytes)) throw new Error('INVALID_MATCH_PHOTO');
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
  const key = validateMatchPhotoKey(
    `${communityId}/${eventId}/${userId}/${crypto.randomUUID()}.${extension}`
  );
  const { error } = await client.storage
    .from(MATCH_PHOTO_BUCKET)
    .upload(key, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return key;
}

export async function copySavedVenueMatchPhoto(
  client: AuthClient,
  userId: string,
  communityId: string,
  eventId: string,
  savedVenueId: string
) {
  const { data: venue, error: venueError } = await client
    .from('community_venues')
    .select('photo_path')
    .eq('id', savedVenueId)
    .eq('community_id', communityId)
    .is('archived_at', null)
    .maybeSingle();
  if (venueError || !venue?.photo_path) throw new Error('MATCH_PHOTO_UNAVAILABLE');
  const sourceKey = venue.photo_path;
  const { data: source, error: downloadError } = await client.storage
    .from('community-venue-photos')
    .download(sourceKey);
  if (downloadError || !source || source.size < 1 || source.size > MATCH_PHOTO_MAX_BYTES)
    throw new Error('INVALID_MATCH_PHOTO');
  const mime = source.type;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime))
    throw new Error('INVALID_MATCH_PHOTO');
  const bytes = new Uint8Array(await source.slice(0, 12).arrayBuffer());
  if (!matchesMatchPhotoMagicBytes(mime, bytes)) throw new Error('INVALID_MATCH_PHOTO');
  const key = validateMatchPhotoKey(
    `${communityId}/${eventId}/${userId}/${crypto.randomUUID()}.${matchPhotoExtension(mime)}`
  );
  const { error } = await client.storage
    .from(MATCH_PHOTO_BUCKET)
    .upload(key, source, { contentType: mime, upsert: false });
  if (error) throw error;
  return key;
}

export async function removeUnpublishedMatchPhoto(client: AuthClient, objectKey: string) {
  validateMatchPhotoKey(objectKey);
  const { error } = await client.storage.from(MATCH_PHOTO_BUCKET).remove([objectKey]);
  if (error) throw error;
}

export async function signMatchPhoto(client: AuthClient, eventId: string) {
  setResponseHeader('Cache-Control', 'private, no-store');
  try {
    const { data: event, error: eventError } = await client
      .from('match_events')
      .select('photo_path')
      .eq('id', eventId)
      .maybeSingle();
    if (eventError || !event) throw new Error('MATCH_PHOTO_UNAVAILABLE');
    const objectKey = event.photo_path;
    validateMatchPhotoKey(objectKey);
    const { data, error } = await client.storage
      .from(MATCH_PHOTO_BUCKET)
      .createSignedUrl(objectKey, 60);
    if (error) throw new Error('MATCH_PHOTO_UNAVAILABLE');
    return data.signedUrl;
  } catch {
    throw new Error('MATCH_PHOTO_UNAVAILABLE');
  }
}
