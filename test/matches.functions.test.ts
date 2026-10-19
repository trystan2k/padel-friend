import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown }>>(),
  signMatchPhoto: vi.fn<(client: unknown, eventId: string) => Promise<string>>(),
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: mocks.setResponseHeader
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));
// Only the per-card signer is replaced; signMatchPhotoBatch stays real so the
// listing's call counts, dedupe and path-keyed mapping are exercised end to end.
vi.mock('../src/features/matches/match-photo.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/matches/match-photo.server')>()),
  signMatchPhoto: mocks.signMatchPhoto
}));

import { getMatchEvent, listMatchEvents } from '../src/features/matches/matches.functions';

const eventId = '00000000-0000-4000-8000-000000000001';

describe('getMatchEvent result contract', () => {
  let client: {
    auth: {
      getClaims: ReturnType<
        typeof vi.fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>
      >;
    };
    rpc: ReturnType<
      typeof vi.fn<
        (name: string, args?: { p_event_id: string }) => Promise<{ data: unknown; error: unknown }>
      >
    >;
  };

  beforeEach(() => {
    client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({
            data: { claims: { sub: 'authenticated-user' } },
            error: null
          })
      },
      rpc: vi
        .fn<
          (
            name: string,
            args?: { p_event_id: string }
          ) => Promise<{ data: unknown; error: unknown }>
        >()
        .mockResolvedValue({ data: null, error: null })
    };
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });
    mocks.signMatchPhoto.mockReset().mockResolvedValue('https://example.test/signed-photo');
  });

  it('treats missing and forbidden projections as the same unavailable result', async () => {
    for (const data of [null, []]) {
      client.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
        status: 'unavailable'
      });
    }
    expect(client.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.signMatchPhoto).not.toHaveBeenCalled();
  });

  it('returns an error state for RPC failures without exposing diagnostics', async () => {
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: 'private SQL diagnostic' }
    });

    await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'error'
    });
    expect(mocks.signMatchPhoto).not.toHaveBeenCalled();
  });

  it('keeps authorized event projections and signed photo URLs', async () => {
    const projection = { event_id: eventId, venue_name: 'Court Central' };
    client.rpc.mockResolvedValue({ data: projection, error: null });

    await expect(getMatchEvent({ data: { event_id: eventId } })).resolves.toEqual({
      status: 'ok',
      event: { ...projection, photo_url: 'https://example.test/signed-photo' }
    });
    expect(client.auth.getClaims).toHaveBeenCalledOnce();
    expect(mocks.requireAuthenticatedClient).toHaveBeenCalledOnce();
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('get_match_event', {
      p_event_id: eventId
    });
    expect(mocks.signMatchPhoto).toHaveBeenCalledExactlyOnceWith(client, eventId);
  });
});

type SignedUrlEntry = { error: string | null; path: string | null; signedUrl: string | null };
type BatchResponse = { data: SignedUrlEntry[] | null; error: unknown };

const COMMUNITY_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const OWNER_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const KEY_A = `${COMMUNITY_ID}/${EVENT_A}/${OWNER_ID}/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png`;
const KEY_B = `${COMMUNITY_ID}/${EVENT_B}/${OWNER_ID}/ffff0000-ffff-4fff-8fff-ffffffffffff.webp`;
const KEY_C = `${COMMUNITY_ID}/${EVENT_C}/${OWNER_ID}/19999999-9999-4999-8999-999999999999.jpg`;

// list_match_events always answers through one RPC; storage signing goes through
// client.storage.from(bucket).createSignedUrls, while per-card event lookups
// would show up as client.from('match_events') calls.
function listClientWith(rows: unknown[], signed: BatchResponse) {
  const snapshotRows = rows.map((row) =>
    typeof row === 'object' && row !== null && !Array.isArray(row)
      ? { as_of: '2026-01-01T00:00:00.000Z', ...row }
      : row
  );
  const createSignedUrls = vi
    .fn<(paths: string[], expiresIn: number) => Promise<BatchResponse>>()
    .mockResolvedValue(signed);
  const storageFrom = vi
    .fn<(bucket: string) => { createSignedUrls: typeof createSignedUrls }>()
    .mockReturnValue({ createSignedUrls });
  const dbFrom = vi.fn<(table: string) => unknown>();
  const client = {
    auth: {
      getClaims: vi
        .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
        .mockResolvedValue({ data: { claims: { sub: 'authenticated-user' } }, error: null })
    },
    from: dbFrom,
    rpc: vi
      .fn<
        (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>
      >()
      .mockResolvedValue({ data: snapshotRows, error: null }),
    storage: { from: storageFrom }
  };
  return { client, createSignedUrls, storageFrom, dbFrom };
}

describe('listMatchEvents batch photo signing', () => {
  const baseInput = {
    entry: 'available',
    community_id: null,
    cursor: '',
    limit: 20,
    as_of: '2026-01-01T00:00:00.000Z'
  };

  beforeEach(() => {
    mocks.signMatchPhoto.mockReset();
    mocks.setResponseHeader.mockReset();
  });

  it('signs all card photos in exactly one storage request with no per-card event lookups', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'Morning game', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Noon game', photo_path: KEY_B, cursor: 'cur-b' },
      { event_id: EVENT_C, title: 'Evening game', photo_path: KEY_C, cursor: 'cur-c' }
    ];
    // Response rows arrive out of request order: mapping must follow the
    // returned path, never the array index.
    const { client, createSignedUrls, storageFrom, dbFrom } = listClientWith(rows, {
      data: [
        { error: null, path: KEY_C, signedUrl: 'https://signed.test/c' },
        { error: null, path: KEY_A, signedUrl: 'https://signed.test/a' },
        { error: null, path: KEY_B, signedUrl: 'https://signed.test/b' }
      ],
      error: null
    });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: { ...baseInput, limit: 3 } });

    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('list_match_events', {
      p_entry: 'available',
      p_cursor: '',
      p_limit: 3,
      p_as_of: '2026-01-01T00:00:00.000Z'
    });
    expect(dbFrom).not.toHaveBeenCalled();
    expect(storageFrom).toHaveBeenCalledExactlyOnceWith('match-event-photos');
    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B, KEY_C], 60);
    expect(mocks.signMatchPhoto).not.toHaveBeenCalled();
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, 'https://signed.test/a'],
      [EVENT_B, 'https://signed.test/b'],
      [EVENT_C, 'https://signed.test/c']
    ]);
    expect(result.next_cursor).toBe('cur-c');
  });

  it('dedupes repeated photo paths into one signing request shared by every matching row', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'First', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Second', photo_path: KEY_A, cursor: 'cur-b' }
    ];
    const { client, createSignedUrls } = listClientWith(rows, {
      data: [{ error: null, path: KEY_A, signedUrl: 'https://signed.test/shared' }],
      error: null
    });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A], 60);
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, 'https://signed.test/shared'],
      [EVENT_B, 'https://signed.test/shared']
    ]);
  });

  it('never sends null or invalid photo paths for signing and nulls their URLs', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'Signed', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'No photo', photo_path: null, cursor: 'cur-b' },
      { event_id: EVENT_C, title: 'Forged', photo_path: '../../escape.png', cursor: 'cur-c' }
    ];
    const { client, createSignedUrls } = listClientWith(rows, {
      data: [{ error: null, path: KEY_A, signedUrl: 'https://signed.test/a' }],
      error: null
    });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A], 60);
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, 'https://signed.test/a'],
      [EVENT_B, null],
      [EVENT_C, null]
    ]);
  });

  it('keeps every card and nulls only the rows whose key failed to sign', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'Signed', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Denied', photo_path: KEY_B, cursor: 'cur-b' }
    ];
    const { client, createSignedUrls } = listClientWith(rows, {
      data: [
        { error: null, path: KEY_A, signedUrl: 'https://signed.test/a' },
        { error: 'new object violates row-level security policy', path: KEY_B, signedUrl: null }
      ],
      error: null
    });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B], 60);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, 'https://signed.test/a'],
      [EVENT_B, null]
    ]);
  });

  it('returns every card with a null photo when the whole signing request fails', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'First', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Second', photo_path: KEY_B, cursor: 'cur-b' }
    ];
    const { client, createSignedUrls } = listClientWith(rows, {
      data: null,
      error: { message: 'storage unavailable' }
    });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B], 60);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, null],
      [EVENT_B, null]
    ]);
  });

  it('makes no storage calls for an empty page or pages without usable photo paths', async () => {
    const empty = listClientWith([], { data: [], error: null });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: empty.client });
    await expect(listMatchEvents({ data: baseInput })).resolves.toEqual({
      items: [],
      next_cursor: null,
      as_of: null
    });
    expect(empty.createSignedUrls).not.toHaveBeenCalled();
    expect(empty.storageFrom).not.toHaveBeenCalled();
    expect(empty.dbFrom).not.toHaveBeenCalled();

    const noPhotos = listClientWith(
      [
        { event_id: EVENT_A, title: 'No photo', photo_path: null, cursor: 'cur-a' },
        { event_id: EVENT_B, title: 'No photo either', cursor: 'cur-b' }
      ],
      { data: [], error: null }
    );
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: noPhotos.client });
    const result = await listMatchEvents({ data: baseInput });
    expect(noPhotos.createSignedUrls).not.toHaveBeenCalled();
    expect(noPhotos.storageFrom).not.toHaveBeenCalled();
    expect(result.items.map((item) => [item.event_id, item.photo_url])).toEqual([
      [EVENT_A, null],
      [EVENT_B, null]
    ]);
  });
});

describe('listMatchEvents database-issued snapshot', () => {
  const baseInput = {
    entry: 'available',
    community_id: null,
    cursor: '',
    limit: 20,
    as_of: null as string | null
  };

  beforeEach(() => {
    mocks.signMatchPhoto.mockReset();
    mocks.setResponseHeader.mockReset();
  });

  it('surfaces the database-issued as_of when the request omits a snapshot', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'First', photo_path: KEY_A, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Second', photo_path: null, cursor: 'cur-b' }
    ];
    const { client } = listClientWith(rows, { data: [], error: null });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    // No snapshot supplied: the instant comes from the rows, and the RPC call
    // must not invent one of its own (old handler sent the validator's fresh
    // JS timestamp as p_as_of instead of leaving it to the database).
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('list_match_events', {
      p_entry: 'available',
      p_cursor: '',
      p_limit: 20,
      p_as_of: undefined
    });
    expect(result.as_of).toBe('2026-01-01T00:00:00.000Z');
    expect(result.items).toHaveLength(2);
  });

  it('forwards the identical snapshot on the next page and echoes it back', async () => {
    const snapshot = '2026-02-02T03:04:05.678Z';
    const rows = [
      { event_id: EVENT_A, title: 'First', photo_path: null, cursor: 'cur-a', as_of: snapshot },
      { event_id: EVENT_B, title: 'Second', photo_path: null, cursor: 'cur-b', as_of: snapshot }
    ];
    const { client } = listClientWith(rows, { data: [], error: null });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({
      data: { ...baseInput, entry: 'my', cursor: 'cur-z', limit: 2, as_of: snapshot }
    });

    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('list_match_events', {
      p_entry: 'my',
      p_cursor: 'cur-z',
      p_limit: 2,
      p_as_of: snapshot
    });
    expect(result.as_of).toBe(snapshot);
    expect(result.next_cursor).toBe('cur-b');
  });

  it('accepts PostgreSQL snapshot spelling for the same instant and rejects microsecond drift', async () => {
    const requestedSnapshot = '2026-10-19T00:00:00.000Z';
    const databaseSnapshot = '2026-10-19T00:00:00+00:00';
    const equivalent = listClientWith(
      [
        {
          event_id: EVENT_A,
          title: 'Second page',
          photo_path: null,
          cursor: 'cur-a',
          as_of: databaseSnapshot
        }
      ],
      { data: [], error: null }
    );
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: equivalent.client });

    const result = await listMatchEvents({ data: { ...baseInput, as_of: requestedSnapshot } });

    expect(result.as_of).toBe(databaseSnapshot);
    expect(equivalent.client.rpc).toHaveBeenCalledExactlyOnceWith('list_match_events', {
      p_entry: 'available',
      p_cursor: '',
      p_limit: 20,
      p_as_of: requestedSnapshot
    });

    const drifted = listClientWith(
      [
        {
          event_id: EVENT_A,
          title: 'Drifted page',
          photo_path: null,
          cursor: 'cur-a',
          as_of: '2026-10-19T00:00:00.000001+00:00'
        }
      ],
      { data: [], error: null }
    );
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: drifted.client });

    await expect(
      listMatchEvents({ data: { ...baseInput, as_of: requestedSnapshot } })
    ).rejects.toThrow('MATCH_LIST_SNAPSHOT_MISMATCH');
  });

  it('strips the row-only as_of and cursor fields from every card', async () => {
    const rows = [
      { event_id: EVENT_A, title: 'First', photo_path: null, cursor: 'cur-a' },
      { event_id: EVENT_B, title: 'Second', cursor: 'cur-b' }
    ];
    const { client } = listClientWith(rows, { data: [], error: null });
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client });

    const result = await listMatchEvents({ data: baseInput });

    expect(result.items).toHaveLength(2);
    for (const item of result.items) {
      expect(Object.keys(item)).not.toContain('as_of');
      expect(Object.keys(item)).not.toContain('cursor');
    }
  });

  it('rejects a page whose rows disagree on the snapshot', async () => {
    const snapshot = '2026-01-01T00:00:00.000Z';
    // With an explicit request snapshot: a row stamped with another instant
    // means the database re-evaluated the page instead of continuing it.
    const drifted = listClientWith(
      [
        { event_id: EVENT_A, title: 'First', photo_path: null, cursor: 'cur-a', as_of: snapshot },
        {
          event_id: EVENT_B,
          title: 'Second',
          photo_path: null,
          cursor: 'cur-b',
          as_of: '1999-12-31T23:59:59.000Z'
        }
      ],
      { data: [], error: null }
    );
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: drifted.client });
    await expect(listMatchEvents({ data: { ...baseInput, as_of: snapshot } })).rejects.toThrow(
      'MATCH_LIST_SNAPSHOT_MISMATCH'
    );

    // Without a request snapshot: rows must at least agree with each other.
    const divergent = listClientWith(
      [
        { event_id: EVENT_A, title: 'First', photo_path: null, cursor: 'cur-a' },
        {
          event_id: EVENT_B,
          title: 'Second',
          photo_path: null,
          cursor: 'cur-b',
          as_of: '1999-12-31T23:59:59.000Z'
        }
      ],
      { data: [], error: null }
    );
    mocks.requireAuthenticatedClient.mockReset().mockResolvedValue({ client: divergent.client });
    await expect(listMatchEvents({ data: baseInput })).rejects.toThrow(
      'MATCH_LIST_SNAPSHOT_MISMATCH'
    );
  });
});
