import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { signMatchPhoto } from './match-photo.server';
import type { MatchEventListItem, MatchEventListResult } from './match-model';
import { matchesMatchPhotoMagicBytes, validateMatchPhotoKey } from './match-photo';
import {
  validateMatchDetail,
  validateMatchInviteSearch,
  validateMatchList,
  validateMatchOptions,
  validatePublishMatch
} from './matches.validators';

async function authenticatedClient() {
  const result = await requireAuthenticatedClient();
  const { data, error } = await result.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return result;
}

export const getMatchCreationOptions = createServerFn({ method: 'GET' })
  .validator(validateMatchOptions)
  .handler(async ({ data }) => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('get_match_creation_options', {
      p_community_id: data.community_id ?? undefined
    });
    if (error) throw new Error('MATCH_OPTIONS_UNAVAILABLE');
    return result;
  });
export const searchMatchInvitees = createServerFn({ method: 'GET' })
  .validator(validateMatchInviteSearch)
  .handler(async ({ data }) => {
    const { client } = await authenticatedClient();
    if (data.query.trim().length < 3) return [];
    const { data: result, error } = await client.rpc('search_match_invitees', {
      p_community_id: data.community_id ?? '',
      p_query: data.query.trim(),
      p_limit: data.limit
    });
    if (error) throw new Error('MATCH_INVITEES_UNAVAILABLE');
    return result;
  });
export const listMatchEvents = createServerFn({ method: 'GET' })
  .validator(validateMatchList)
  .handler(async ({ data }) => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('list_match_events', {
      p_entry: data.entry,
      // Omitted lists every authorized community; an empty string would fail the uuid cast.
      ...(data.community_id ? { p_community_id: data.community_id } : {}),
      p_cursor: data.cursor,
      p_limit: data.limit,
      p_as_of: data.as_of
    });
    if (error) throw new Error('MATCH_LIST_UNAVAILABLE');
    const rows = Array.isArray(result) ? result : [];
    const items = await Promise.all(
      rows.map(async (row) => {
        if (
          typeof row !== 'object' ||
          row === null ||
          Array.isArray(row) ||
          !('event_id' in row) ||
          typeof row.event_id !== 'string'
        )
          return row;
        const { cursor: _cursor, ...eventRow } = row;
        try {
          return { ...eventRow, photo_url: await signMatchPhoto(client, row.event_id) };
        } catch {
          return { ...eventRow, photo_url: null };
        }
      })
    );
    const lastCursor = rows.at(-1);
    const typedItems = items.filter(
      (item): item is MatchEventListItem =>
        typeof item === 'object' &&
        item !== null &&
        !Array.isArray(item) &&
        'event_id' in item &&
        typeof item.event_id === 'string' &&
        'photo_url' in item &&
        (item.photo_url === null || typeof item.photo_url === 'string')
    );
    return {
      items: typedItems,
      next_cursor:
        rows.length === data.limit &&
        typeof lastCursor === 'object' &&
        lastCursor !== null &&
        !Array.isArray(lastCursor) &&
        typeof lastCursor.cursor === 'string'
          ? lastCursor.cursor
          : null
    } satisfies MatchEventListResult;
  });
export const getMatchEvent = createServerFn({ method: 'GET' })
  .validator(validateMatchDetail)
  .handler(async ({ data }) => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('get_match_event', {
      p_event_id: data.event_id
    });
    if (error || !result) return null;
    const event = Array.isArray(result) ? result[0] : result;
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
    const eventRecord = Object.fromEntries(Object.entries(event));
    try {
      return { ...eventRecord, photo_url: await signMatchPhoto(client, data.event_id) };
    } catch {
      return { ...eventRecord, photo_url: null };
    }
  });
export const publishMatchEvent = createServerFn({ method: 'POST' })
  .validator(validatePublishMatch)
  .handler(async ({ data }) => {
    const { client } = await authenticatedClient();
    const photo = data.input.photo_path;
    if (typeof photo !== 'string') throw new Error('MATCH_PHOTO_UNAVAILABLE');
    const { data: file, error: photoError } = await client.storage
      .from('match-event-photos')
      .download(photo);
    if (photoError || !file || file.size < 1 || file.size > 2 * 1024 * 1024)
      throw new Error('MATCH_PHOTO_UNAVAILABLE');
    const type = file.type;
    try {
      validateMatchPhotoKey(photo);
    } catch {
      throw new Error('MATCH_PHOTO_UNAVAILABLE');
    }
    if (!matchesMatchPhotoMagicBytes(type, new Uint8Array(await file.slice(0, 12).arrayBuffer())))
      throw new Error('MATCH_PHOTO_UNAVAILABLE');
    const { data: id, error } = await client.rpc('publish_match_event', {
      p_event_id: data.event_id,
      p_input: JSON.parse(JSON.stringify(data.input)),
      p_invitee_ids: data.invitee_ids
    });
    if (error || !id)
      throw new Error(error?.code === '23505' ? 'MATCH_CONFLICT' : 'MATCH_PUBLISH_FAILED');
    return { event_id: id };
  });
