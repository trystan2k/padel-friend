import { describe, expect, it, vi } from 'vitest';
import { isVerifiedImage, matchesImageMagicBytes } from '../src/lib/image-verification';

const headers = [
  ['image/png', [137, 80, 78, 71, 13, 10, 26, 10]],
  ['image/jpeg', [255, 216, 255, 224]],
  ['image/webp', [82, 73, 70, 70, 4, 0, 0, 0, 87, 69, 66, 80]]
] as const;

describe('shared image verification', () => {
  it.each(headers)('accepts matching %s signature', async (mime, header) => {
    const bytes = new Uint8Array(header);
    expect(matchesImageMagicBytes(mime, bytes)).toBe(true);
    expect(await isVerifiedImage(new Blob([bytes], { type: mime }), 1024)).toBe(true);
    for (const other of headers.filter(([type]) => type !== mime))
      expect(matchesImageMagicBytes(other[0], bytes)).toBe(false);
  });

  it.each([
    '<html><script>alert(1)</script>',
    '<script>/*\u0089PNG*/</script>',
    '/*RIFF0000WEBP*/alert(1)',
    'GIF89a<script>'
  ])('rejects HTML/script and lookalike polyglot headers: %s', async (text) => {
    for (const [mime] of headers)
      expect(await isVerifiedImage(new Blob([text], { type: mime }), 1024)).toBe(false);
  });

  it('rejects empty, truncated, unsupported MIME and oversized objects', async () => {
    expect(await isVerifiedImage(new Blob([], { type: 'image/png' }), 1024)).toBe(false);
    expect(matchesImageMagicBytes('image/png', new Uint8Array([137, 80]))).toBe(false);
    expect(matchesImageMagicBytes('text/html', new Uint8Array(headers[0][1]))).toBe(false);
    const large = new Blob([new Uint8Array(1025)], { type: 'image/png' });
    const slice = vi.spyOn(large, 'slice');
    expect(await isVerifiedImage(large, 1024)).toBe(false);
    expect(slice).not.toHaveBeenCalled();
  });

  it('reads only the bounded 12-byte header', async () => {
    const blob = new Blob([new Uint8Array(headers[0][1]), new Uint8Array(100)], {
      type: 'image/png'
    });
    const slice = vi.spyOn(blob, 'slice');
    expect(await isVerifiedImage(blob, 1024)).toBe(true);
    expect(slice).toHaveBeenCalledExactlyOnceWith(0, 12);
  });
});
