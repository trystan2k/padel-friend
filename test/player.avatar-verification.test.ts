import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { verifiedAvatarKey } from '../src/features/player/player.server';
import { toClientError } from '../src/lib/client-error.server';

const admin = vi.hoisted(() => ({
  get: vi.fn<() => unknown>(),
  remove: vi.fn<(keys: string[]) => Promise<{ error: unknown }>>()
}));
vi.mock('../src/lib/supabase/admin.server', () => ({ getAdminClient: admin.get }));

const owner = '11111111-1111-4111-8111-111111111111';
const filename = '22222222-2222-4222-8222-222222222222.png';
const key = `${owner}/${filename}`;
const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });

function client(blob = png, size = blob.size) {
  const list = vi.fn<
    () => Promise<{ data: { name: string; metadata: { size: number } }[]; error: null }>
  >(async () => ({ data: [{ name: filename, metadata: { size } }], error: null }));
  const download = vi.fn<() => Promise<{ data: Blob; error: null }>>(async () => ({
    data: blob,
    error: null
  }));
  return {
    client: Object.assign(createClient<Database>('http://127.0.0.1:55421', 'test-key'), {
      storage: { from: () => ({ list, download }) }
    }),
    list,
    download
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  admin.get.mockReturnValue({ storage: { from: () => ({ remove: admin.remove }) } });
  admin.remove.mockResolvedValue({ error: null });
});

describe('avatar byte verification and cleanup', () => {
  it('accepts PNG without constructing a privileged cleanup client', async () => {
    await verifiedAvatarKey(client().client, owner, key);
    expect(admin.get).not.toHaveBeenCalled();
  });

  it.each([
    ['HTML', new Blob(['<html><script>alert(1)</script>'], { type: 'image/png' })],
    ['MIME mismatch', new Blob([new Uint8Array([255, 216, 255])], { type: 'image/jpeg' })],
    ['empty', new Blob([], { type: 'image/png' })],
    ['oversized', new Blob([new Uint8Array(2097153)], { type: 'image/png' })]
  ])(
    'awaits removal of owned rejected %s candidate; mapper preserves error',
    async (_label, blob) => {
      const { client: caller } = client(blob);
      const error: unknown = await verifiedAvatarKey(caller, owner, key).catch(
        (failure: unknown) => failure
      );
      expect(toClientError(error).message).toBe('INVALID_AVATAR');
      expect(admin.remove).toHaveBeenCalledExactlyOnceWith([key]);
    }
  );

  it('checks metadata before downloading', async () => {
    const test = client(png, 2097153);
    await expect(verifiedAvatarKey(test.client, owner, key)).rejects.toThrow('INVALID_AVATAR');
    expect(test.download).not.toHaveBeenCalled();
    expect(admin.remove).toHaveBeenCalledWith([key]);
  });

  it('never touches foreign or malformed supplied keys', async () => {
    const test = client();
    for (const candidate of [key.replace(owner, crypto.randomUUID()), `${owner}/../${filename}`])
      await expect(verifiedAvatarKey(test.client, owner, candidate)).rejects.toThrow(
        'INVALID_AVATAR_KEY'
      );
    expect(test.list).not.toHaveBeenCalled();
    expect(admin.get).not.toHaveBeenCalled();
  });

  it('never removes the previous/current avatar when verification fails', async () => {
    await expect(verifiedAvatarKey(client(new Blob([])).client, owner, key, key)).rejects.toThrow(
      'INVALID_AVATAR'
    );
    expect(admin.remove).not.toHaveBeenCalled();
  });

  it('reports cleanup failure safely instead of claiming object removed', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    admin.remove.mockResolvedValue({ error: { message: 'private storage failure' } });
    await expect(verifiedAvatarKey(client(new Blob([])).client, owner, key)).rejects.toThrow(
      'AVATAR_CLEANUP_FAILED'
    );
    expect(String(log.mock.calls[0]?.[0])).not.toContain('private storage failure');
    log.mockRestore();
  });
});
