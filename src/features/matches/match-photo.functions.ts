import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  copySavedVenueMatchPhoto,
  removeUnpublishedMatchPhoto,
  uploadMatchPhoto
} from './match-photo.server';
import { validateMatchPhotoKey } from './match-photo';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateUpload(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('community_id' in value) ||
    !('event_id' in value) ||
    !('file' in value) ||
    Object.keys(value).some((key) => !['community_id', 'event_id', 'file'].includes(key)) ||
    typeof value.community_id !== 'string' ||
    !uuid.test(value.community_id) ||
    typeof value.event_id !== 'string' ||
    !uuid.test(value.event_id) ||
    !(value.file instanceof File)
  )
    throw new Error('INVALID_MATCH_PHOTO_INPUT');
  return { community_id: value.community_id, event_id: value.event_id, file: value.file };
}
function validateRemove(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('object_key' in value) ||
    Object.keys(value).some((key) => key !== 'object_key')
  )
    throw new Error('INVALID_MATCH_PHOTO_INPUT');
  return { object_key: validateMatchPhotoKey(value.object_key) };
}

export const uploadMatchPhotoFn = createServerFn({ method: 'POST' })
  .validator(validateUpload)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    return uploadMatchPhoto(client, userId, data.community_id, data.event_id, data.file);
  });

export const removeUnpublishedMatchPhotoFn = createServerFn({ method: 'POST' })
  .validator(validateRemove)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    await removeUnpublishedMatchPhoto(client, data.object_key);
  });

function validateSavedVenue(value: unknown) {
  if (
    !value ||
    typeof value !== 'object' ||
    !('community_id' in value) ||
    !('event_id' in value) ||
    !('saved_venue_id' in value) ||
    Object.keys(value).some(
      (key) => !['community_id', 'event_id', 'saved_venue_id'].includes(key)
    ) ||
    typeof value.community_id !== 'string' ||
    !uuid.test(value.community_id) ||
    typeof value.event_id !== 'string' ||
    !uuid.test(value.event_id) ||
    typeof value.saved_venue_id !== 'string' ||
    !uuid.test(value.saved_venue_id)
  )
    throw new Error('INVALID_MATCH_PHOTO_INPUT');
  return {
    community_id: value.community_id,
    event_id: value.event_id,
    saved_venue_id: value.saved_venue_id
  };
}

export const copySavedVenueMatchPhotoFn = createServerFn({ method: 'POST' })
  .validator(validateSavedVenue)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    return copySavedVenueMatchPhoto(
      client,
      userId,
      data.community_id,
      data.event_id,
      data.saved_venue_id
    );
  });
