import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { finalizeVenuePhoto } from './community-venue-photo.server';
import { validateVenuePhotoKey } from './venue-photo';

export type CommunityAdminClient = Awaited<ReturnType<typeof requireAuthenticatedClient>>['client'];

function validateInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_VENUE_PHOTO_INPUT');
  if (!('community_id' in value) || !('venue_id' in value) || !('object_key' in value))
    throw new Error('INVALID_VENUE_PHOTO_INPUT');
  const input = value;
  if (
    Object.keys(input).some((key) => !['community_id', 'venue_id', 'object_key'].includes(key)) ||
    typeof input.community_id !== 'string' ||
    typeof input.venue_id !== 'string'
  )
    throw new Error('INVALID_VENUE_PHOTO_INPUT');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(input.community_id) || !uuid.test(input.venue_id))
    throw new Error('INVALID_VENUE_PHOTO_INPUT');
  return {
    community_id: input.community_id,
    venue_id: input.venue_id,
    object_key: validateVenuePhotoKey(input.object_key)
  };
}

export const finalizeCommunityVenuePhoto = createServerFn({ method: 'POST' })
  .validator(validateInput)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    const { data: isAdmin, error } = await client.rpc('is_community_admin', {
      p_community_id: data.community_id
    });
    if (error) throw error;
    if (!isAdmin) throw new Error('NOT_COMMUNITY_ADMIN');
    return finalizeVenuePhoto(client, data.community_id, data.venue_id, data.object_key, userId);
  });
