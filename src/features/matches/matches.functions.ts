import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { signMatchPhotoBatch, signMatchPhoto } from './match-photo.server';
import type {
  MatchCreationOptions,
  MatchEventCard,
  MatchEventDetail,
  MatchEventListResult,
  MatchEventRpcListRow,
  MatchInvitee
} from './match-contracts';
import {
  decodeMatchCreationOptions,
  decodeMatchInvitees,
  decodeMatchRpcDetail,
  decodeMatchRpcListRows,
  signedMatchDetail
} from './match-decoders';
import { matchesMatchPhotoMagicBytes, validateMatchPhotoKey } from './match-photo';
import {
  validateMatchDetail,
  validateMatchInviteSearch,
  validateMatchList,
  validateMatchOptions,
  validatePublishMatch
} from './matches.validators';

export type MatchEventResult =
  | { status: 'ok'; event: MatchEventDetail }
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
  .handler(async ({ data }): Promise<MatchCreationOptions> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('get_match_creation_options', {
      p_community_id: data.community_id ?? undefined
    });
    if (error) throw new Error('MATCH_OPTIONS_UNAVAILABLE');
    try {
      return decodeMatchCreationOptions(result);
    } catch {
      throw new Error('MATCH_OPTIONS_UNAVAILABLE');
    }
  });
export const searchMatchInvitees = createServerFn({ method: 'GET' })
  .validator(validateMatchInviteSearch)
  .handler(async ({ data }): Promise<MatchInvitee[]> => {
    const { client } = await authenticatedClient();
    if (data.query.trim().length < 3) return [];
    const { data: result, error } = await client.rpc('search_match_invitees', {
      p_community_id: data.community_id ?? '',
      p_query: data.query.trim(),
      p_limit: data.limit
    });
    if (error) throw new Error('MATCH_INVITEES_UNAVAILABLE');
    try {
      return decodeMatchInvitees(result);
    } catch {
      throw new Error('MATCH_INVITEES_UNAVAILABLE');
    }
  });
export const listMatchEvents = createServerFn({ method: 'GET' })
  .validator(validateMatchList)
  .handler(async ({ data }): Promise<MatchEventListResult> => {
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
    let rows: MatchEventRpcListRow[];
    try {
      rows = decodeMatchRpcListRows(result);
    } catch {
      throw new Error('MATCH_LIST_UNAVAILABLE');
    }
    if (rows.length === 0)
      return { items: [], next_cursor: null, as_of: null } satisfies MatchEventListResult;
    const asOf = rows[0]?.as_of ?? null;
    const expectedAsOf = data.as_of ?? asOf;
    const expectedInstant = expectedAsOf === null ? null : snapshotInstant(expectedAsOf);
    if (
      asOf === null ||
      expectedInstant === null ||
      rows.some((row) => snapshotInstant(row.as_of) !== expectedInstant)
    )
      throw new Error('MATCH_LIST_SNAPSHOT_MISMATCH');
    const photoKeys = rows.flatMap((row) => {
      try {
        return [validateMatchPhotoKey(row.photo_path)];
      } catch {
        return [];
      }
    });
    let signed = new Map<string, string>();
    if (photoKeys.length > 0) {
      try {
        signed = await signMatchPhotoBatch(client, photoKeys);
      } catch {
        // Storage failure must not turn a valid event list into an RPC failure.
      }
    }
    const typedItems: MatchEventCard[] = rows.map((row) => {
      const { photo_path: path, cursor: _cursor, as_of: _rowAsOf, ...projection } = row;
      let key: string | null = null;
      try {
        key = validateMatchPhotoKey(path);
      } catch {
        /* malformed paths receive null URL */
      }
      return { ...projection, photo_url: key ? (signed.get(key) ?? null) : null };
    });
    const lastCursor = rows.at(-1)?.cursor;
    return {
      items: typedItems,
      as_of: asOf,
      next_cursor: rows.length === data.limit ? (lastCursor ?? null) : null
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
    let decoded;
    try {
      decoded = decodeMatchRpcDetail(event);
    } catch {
      return { status: 'error' };
    }
    try {
      return {
        status: 'ok',
        event: signedMatchDetail(decoded, await signMatchPhoto(client, data.event_id))
      };
    } catch {
      return { status: 'ok', event: signedMatchDetail(decoded, null) };
    }
  });
export const publishMatchEvent = createServerFn({ method: 'POST' })
  .validator(validatePublishMatch)
  .handler(async ({ data }): Promise<{ event_id: string }> => {
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
      p_input: data.input,
      p_invitee_ids: data.invitee_ids
    });
    if (error || !id)
      throw new Error(error?.code === '23505' ? 'MATCH_CONFLICT' : 'MATCH_PUBLISH_FAILED');
    return { event_id: id };
  });
