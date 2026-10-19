import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { validateMatchPhotoKey } from '../src/features/matches/match-photo';
import type { Database } from '../src/lib/supabase/database.types';

// signMatchPhotoBatch issues its Cache-Control header through the Start server
// runtime; the storage client itself arrives as the authenticated Supabase
// client, so a real (never-networked) client gets its storage.from override
// assigned like the other server-function tests.
const tanstackServer = vi.hoisted(() => ({
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: tanstackServer.setResponseHeader
}));

import { signMatchPhotoBatch } from '../src/features/matches/match-photo.server';

type SignedUrlEntry = { error: string | null; path: string | null; signedUrl: string | null };
type BatchResponse = { data: SignedUrlEntry[] | null; error: unknown };

const OWNER_ID = '123e4567-e89b-42d3-a456-426614174000';
const KEY_A = `11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${OWNER_ID}/33333333-3333-4333-8333-333333333333.png`;
const KEY_B = `11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${OWNER_ID}/44444444-4444-4444-8444-444444444444.webp`;
const KEY_C = `11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/${OWNER_ID}/55555555-5555-4555-8555-555555555555.jpg`;

function batchClientWith(response: BatchResponse) {
  const createSignedUrls = vi
    .fn<(paths: string[], expiresIn: number) => Promise<BatchResponse>>()
    .mockResolvedValue(response);
  const storageFrom = vi
    .fn<(bucket: string) => { createSignedUrls: typeof createSignedUrls }>()
    .mockReturnValue({ createSignedUrls });
  const client = Object.assign(
    createClient<Database>('http://127.0.0.1:54321', 'test-publishable-key'),
    { storage: { from: storageFrom } }
  );
  return { client, createSignedUrls, storageFrom };
}

describe('match photo server input contract', () => {
  it('rejects forged path components before storage access', () => {
    expect(() => validateMatchPhotoKey('community/event/other/object.jpg')).toThrow(
      'INVALID_MATCH_PHOTO_KEY'
    );
  });
  it('rejects percent-encoded owner or traversal segments', () => {
    expect(() =>
      validateMatchPhotoKey(
        '123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174000/123e4567-e89b-42d3-a456-426614174000/%2e%2e.jpg'
      )
    ).toThrow('INVALID_MATCH_PHOTO_KEY');
  });
});

describe('signMatchPhotoBatch', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
  });

  it('signs unique keys in exactly one storage request keyed by returned path', async () => {
    const { client, createSignedUrls, storageFrom } = batchClientWith({
      data: [
        { error: null, path: KEY_B, signedUrl: 'https://signed.test/b' },
        { error: null, path: KEY_A, signedUrl: 'https://signed.test/a' }
      ],
      error: null
    });

    const signed = await signMatchPhotoBatch(client, [KEY_A, KEY_B]);

    expect(storageFrom).toHaveBeenCalledExactlyOnceWith('match-event-photos');
    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B], 60);
    // Result entries arrived out of request order; lookup must follow path.
    expect(signed.get(KEY_A)).toBe('https://signed.test/a');
    expect(signed.get(KEY_B)).toBe('https://signed.test/b');
    expect(tanstackServer.setResponseHeader).toHaveBeenCalledExactlyOnceWith(
      'Cache-Control',
      'private, no-store'
    );
  });

  it('dedupes repeated object keys before signing', async () => {
    const { client, createSignedUrls } = batchClientWith({
      data: [
        { error: null, path: KEY_A, signedUrl: 'https://signed.test/a' },
        { error: null, path: KEY_B, signedUrl: 'https://signed.test/b' }
      ],
      error: null
    });

    const signed = await signMatchPhotoBatch(client, [KEY_A, KEY_A, KEY_B, KEY_A]);

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B], 60);
    expect(signed.size).toBe(2);
  });

  it('drops invalid object keys instead of sending them to storage', async () => {
    const { client, createSignedUrls } = batchClientWith({
      data: [{ error: null, path: KEY_A, signedUrl: 'https://signed.test/a' }],
      error: null
    });

    const signed = await signMatchPhotoBatch(client, [
      KEY_A,
      '../../escape.png',
      `${OWNER_ID}/%2e%2e.png`,
      'not-a-key'
    ]);

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A], 60);
    expect(signed.size).toBe(1);
  });

  it('returns an empty map without touching storage when no key is valid', async () => {
    const { client, createSignedUrls, storageFrom } = batchClientWith({
      data: null,
      error: null
    });

    await expect(signMatchPhotoBatch(client, [])).resolves.toEqual(new Map());
    await expect(signMatchPhotoBatch(client, ['not-a-key', '../../escape.png'])).resolves.toEqual(
      new Map()
    );
    expect(storageFrom).not.toHaveBeenCalled();
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it('returns an empty map when storage rejects the whole batch', async () => {
    const { client, createSignedUrls } = batchClientWith({
      data: null,
      error: { message: 'storage unavailable' }
    });

    const signed = await signMatchPhotoBatch(client, [KEY_A, KEY_B]);

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B], 60);
    expect(signed.size).toBe(0);
  });

  it('keeps only usable signatures and ignores malformed result rows', async () => {
    const { client, createSignedUrls } = batchClientWith({
      data: [
        { error: 'unauthorized', path: KEY_A, signedUrl: null },
        { error: null, path: null, signedUrl: 'https://signed.test/orphan' },
        { error: null, path: KEY_B, signedUrl: '' },
        { error: null, path: KEY_C, signedUrl: 'https://signed.test/c' }
      ],
      error: null
    });

    const signed = await signMatchPhotoBatch(client, [KEY_A, KEY_B, KEY_C]);

    expect(createSignedUrls).toHaveBeenCalledExactlyOnceWith([KEY_A, KEY_B, KEY_C], 60);
    expect([...signed.entries()]).toEqual([[KEY_C, 'https://signed.test/c']]);
  });
});
