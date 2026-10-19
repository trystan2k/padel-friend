import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { signMatchPhotoBatch, signMatchPhoto } from './match-photo.server';
import type { MatchEventListItem, MatchEventListResult } from './match-model';
import { matchesMatchPhotoMagicBytes, validateMatchPhotoKey } from './match-photo';
import {
  validateMatchDetail,
  validateMatchInviteSearch,
  validateMatchList,
  validateMatchOptions,
  validatePublishMatch
} from './matches.validators';

export type MatchEventProjection = Record<string, string | number | boolean | null>;

export type MatchEventResult =
  | { status: 'ok'; event: MatchEventProjection }
  | { status: 'unavailable' }
  | { status: 'error' };

function snapshotInstant(value: string): bigint | null {
  const match =
    /^(\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/i.exec(value);
  if (match) {
    const baseMilliseconds = Date.parse(`${match[1]}${match[3] ?? 'Z'}`);
    if (!Number.isFinite(baseMilliseconds)) return null;
    const fraction = match[2] ?? '';
    // PostgreSQL timestamptz preserves microseconds; compare at that precision.
    const microseconds = BigInt(fraction.slice(0, 6).padEnd(6, '0') || '0');
    const roundedMicroseconds =
      fraction.length > 6 && Number(fraction[6]) >= 5 ? microseconds + 1n : microseconds;
    return BigInt(baseMilliseconds) * 1000n + roundedMicroseconds;
  }

  // Date.parse only retains milliseconds. Refuse fractional non-ISO forms rather
  // than accidentally accepting a timestamp that differs below millisecond precision.
  if (/[.,]\d{4,}/.test(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? BigInt(milliseconds) * 1000n : null;
}

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
      p_as_of: data.as_of ?? undefined
    });
    if (error) throw new Error('MATCH_LIST_UNAVAILABLE');
    const rows = Array.isArray(result) ? result : [];
    if (rows.length === 0)
      return { items: [], next_cursor: null, as_of: null } satisfies MatchEventListResult;
    const asOf =
      typeof rows[0] === 'object' &&
      rows[0] !== null &&
      !Array.isArray(rows[0]) &&
      'as_of' in rows[0] &&
      typeof rows[0].as_of === 'string'
        ? rows[0].as_of
        : null;
    const expectedAsOf = data.as_of ?? asOf;
    const expectedInstant = expectedAsOf === null ? null : snapshotInstant(expectedAsOf);
    if (
      asOf === null ||
      expectedInstant === null ||
      rows.some(
        (row) =>
          typeof row !== 'object' ||
          row === null ||
          Array.isArray(row) ||
          !('as_of' in row) ||
          typeof row.as_of !== 'string' ||
          snapshotInstant(row.as_of) !== expectedInstant
      )
    )
      throw new Error('MATCH_LIST_SNAPSHOT_MISMATCH');
    const eventRows: Record<string, unknown>[] = [];
    const keys: string[] = [];
    const rowKeys: (string | null)[] = [];
    for (const row of rows) {
      if (
        typeof row !== 'object' ||
        row === null ||
        Array.isArray(row) ||
        !('event_id' in row) ||
        typeof row.event_id !== 'string'
      ) {
        eventRows.push({});
        rowKeys.push(null);
        continue;
      }
      const { cursor: _cursor, as_of: _asOf, ...eventRow } = row;
      eventRows.push(eventRow);
      const photoKey =
        'photo_path' in row && typeof row.photo_path === 'string' ? row.photo_path : null;
      let validKey: string | null = null;
      if (photoKey !== null) {
        try {
          validKey = validateMatchPhotoKey(photoKey);
          keys.push(validKey);
        } catch {
          validKey = null;
        }
      }
      rowKeys.push(validKey);
    }
    const signed =
      keys.length > 0 ? await signMatchPhotoBatch(client, keys) : new Map<string, string>();
    const items = rows.map((row, index) => {
      const eventRow = eventRows[index];
      if (!eventRow || Object.keys(eventRow).length === 0) return row;
      const key = rowKeys[index];
      return { ...eventRow, photo_url: key ? (signed.get(key) ?? null) : null };
    });
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
      as_of: asOf,
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
  .handler(async ({ data }): Promise<MatchEventResult> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('get_match_event', {
      p_event_id: data.event_id
    });
    if (error) return { status: 'error' };
    if (!result) return { status: 'unavailable' };
    const event = Array.isArray(result) ? result[0] : result;
    if (event == null) return { status: 'unavailable' };
    if (typeof event !== 'object' || Array.isArray(event)) return { status: 'error' };
    const eventRecord: MatchEventProjection = {};
    for (const [key, value] of Object.entries(event)) {
      if (
        value !== null &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      )
        return { status: 'error' };
      eventRecord[key] = value;
    }
    try {
      return {
        status: 'ok',
        event: { ...eventRecord, photo_url: await signMatchPhoto(client, data.event_id) }
      };
    } catch {
      return { status: 'ok', event: { ...eventRecord, photo_url: null } };
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
