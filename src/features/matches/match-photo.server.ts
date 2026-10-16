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

// The browser uploads the staged object directly (the established VenuePhotoUpload
// pattern; POST server functions cannot carry a File through this TanStack Start
// version), then this server-side finalize authorizes the exact key and re-verifies
// the stored bytes before the key may be attached to a publication.
export async function finalizeMatchPhotoUpload(
  client: AuthClient,
  userId: string,
  communityId: string,
  eventId: string,
  objectKey: string
) {
  const key = validateMatchPhotoKey(objectKey);
  const segments = key.split('/');
  if (segments[0] !== communityId || segments[1] !== eventId || segments[2] !== userId)
    throw new Error('INVALID_MATCH_PHOTO_KEY');
  const { data: objects, error: listError } = await client.storage
    .from(MATCH_PHOTO_BUCKET)
    .list(`${communityId}/${eventId}/${userId}`, { search: segments[3] });
  if (listError) throw listError;
  const metadata = objects?.find((object) => object.name === segments[3]);
  if (!metadata || !metadata.metadata || metadata.metadata.size > MATCH_PHOTO_MAX_BYTES)
    throw new Error('INVALID_MATCH_PHOTO');
  const { data: blob, error: downloadError } = await client.storage
    .from(MATCH_PHOTO_BUCKET)
    .download(key);
  if (downloadError) throw downloadError;
  if (blob.size < 1 || blob.size > MATCH_PHOTO_MAX_BYTES) throw new Error('INVALID_MATCH_PHOTO');
  const bytes = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  if (!matchesMatchPhotoMagicBytes(blob.type, bytes)) throw new Error('INVALID_MATCH_PHOTO');
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

export async function signUnattachedMatchPhoto(
  client: AuthClient,
  userId: string,
  objectKey: string
) {
  setResponseHeader('Cache-Control', 'private, no-store');
  const key = validateMatchPhotoKey(objectKey);
  const [communityId, eventId, ownerId] = key.split('/');
  if (!communityId || !eventId || ownerId !== userId) throw new Error('MATCH_PHOTO_UNAVAILABLE');
  const { data: event, error: eventError } = await client
    .from('match_events')
    .select('photo_path, community_id')
    .eq('id', eventId)
    .maybeSingle();
  if (eventError || (event && (event.community_id !== communityId || event.photo_path === key)))
    throw new Error('MATCH_PHOTO_UNAVAILABLE');
  const { data: objects, error: listError } = await client.storage
    .from(MATCH_PHOTO_BUCKET)
    .list(`${communityId}/${eventId}/${userId}`, { search: key.split('/')[3] });
  if (listError || !objects?.some((object) => object.name === key.split('/')[3]))
    throw new Error('MATCH_PHOTO_UNAVAILABLE');
  const filename = key.split('/')[3];
  if (!filename) throw new Error('MATCH_PHOTO_UNAVAILABLE');
  const { data, error } = await client.storage.from(MATCH_PHOTO_BUCKET).createSignedUrl(key, 60);
  if (error || !data?.signedUrl) throw new Error('MATCH_PHOTO_UNAVAILABLE');
  return data.signedUrl;
}
