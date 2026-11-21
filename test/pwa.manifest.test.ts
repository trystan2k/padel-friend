import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { iconSlots } from '../scripts/generate-pwa-icons.mjs';
import { parseTokens, resolveTokens } from '../scripts/pwa-build.mjs';

type Icon = { src: string; sizes: string; type: string; purpose: string };
const manifest: {
  id: string;
  scope: string;
  start_url: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: Icon[];
} = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
const tokensCss = readFileSync('design-tokens/dist/tokens.css', 'utf8');
const palette = resolveTokens(parseTokens(tokensCss), 'light');

function pngSize(file: string) {
  const buffer = readFileSync(file);
  expect(buffer.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

describe('web app manifest', () => {
  it('has a stable identity, scope and private-query-free start URL', () => {
    expect(manifest.id).toBe('/');
    expect(manifest.scope).toBe('/');
    expect(manifest.start_url).toBe('/');
    expect(new URL(manifest.start_url, 'https://app.example').search).toBe('');
    expect(manifest.display).toBe('standalone');
  });

  it('derives its colors from the approved design tokens, not the legacy blue', () => {
    expect(manifest.theme_color).toBe(palette['palette-green-deep']);
    expect(manifest.background_color).toBe(palette['palette-bg']);
    expect(JSON.stringify(manifest)).not.toContain('#315fe3');
  });

  it('declares any and maskable 192/512 PNG icons that exist with matching dimensions', () => {
    for (const purpose of ['any', 'maskable'])
      for (const size of [192, 512]) {
        const icon = manifest.icons.find(
          (candidate) => candidate.purpose === purpose && candidate.sizes === size + 'x' + size
        );
        expect(icon).toBeDefined();
        expect(icon!.type).toBe('image/png');
        expect(existsSync('public' + icon!.src)).toBe(true);
        expect(pngSize('public' + icon!.src)).toEqual({ width: size, height: size });
      }
    expect(manifest.icons.every((icon) => !icon.purpose.includes(' '))).toBe(true);
  });

  it('ships an opaque apple-touch icon', () => {
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
    // PNG color type 2 = RGB without alpha: iOS fills transparency with black.
    expect(readFileSync('public/icons/apple-touch-icon.png')[25]).toBe(2);
  });
});

describe('D8 icon source', () => {
  const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

  it('pins the approved source and all resizing/padding-only derivatives', () => {
    // Output from pnpm pwa:icons; SVG fallback emitted by pnpm pwa:icons --svg.
    const digests = {
      'docs/design/padel-friends-app-icon.png':
        '5f76f01f112dbdc8d7b80a5911d46ef1c0051be2d4af8c02c878ef7e0a74689a',
      'public/icons/icon-192.png':
        '917c168776b745b18d0fec4d95212d752578963718faed8a281f1a00be631317',
      'public/icons/icon-512.png':
        '9a23b8f077e61ea75042e83bc6774c2959365835a72506cf7a1ca0743d8a92a1',
      'public/icons/maskable-192.png':
        '4611e2974494222e76a18d2f1c67a3e6f226aae1d11f7dc963bd9b90614105c7',
      'public/icons/maskable-512.png':
        'a10a3e15bc27b78dc1d9383a1510e35658287e38ba9c2919e3a6b1087480aaca',
      'public/icons/apple-touch-icon.png':
        'a1bd9eec6217e6e074549fa383d7eee021fcb9dcad654fc95306a3054b8faa8c',
      'public/icons/favicon.png':
        '2217a191c3eaea1c5fbe3812cae8ef96158c472cebae5f43027e0f24f2b28f3b',
      'public/icon.svg': '944d6e108df2a09ea9c7d1016925f293fc2a21c1c3ffcc07d3677e75b5042d42'
    };
    for (const [path, digest] of Object.entries(digests))
      expect([path, sha256(path)]).toEqual([path, digest]);
    expect(sha256('docs/design/icon-exports/favicon.png')).toBe(
      digests['public/icons/favicon.png']
    );
    expect(sha256('docs/design/icon-exports/pwa-icon-512.png')).toBe(
      digests['public/icons/icon-512.png']
    );
    expect(manifest.icons.map(({ src }) => src).sort()).toEqual(
      iconSlots
        .filter(({ file }) => !file.includes('apple-touch'))
        .map(({ file }) => file.slice('public'.length))
        .sort()
    );
    for (const { file, size } of iconSlots) {
      expect([file, pngSize(file)]).toEqual([file, { width: size, height: size }]);
    }
  });

  it('keeps the 56% square inside the 80% maskable safe circle and fills the edges', () => {
    const maskable = iconSlots.filter(({ file }) => file.includes('maskable'));
    expect(maskable.map(({ size }) => size)).toEqual([192, 512]);
    for (const { file, artworkWidth } of maskable) {
      expect((Math.SQRT2 * Number.parseFloat(artworkWidth ?? '100%')) / 100).toBeLessThan(0.8);
      expect(readFileSync(file)[25]).toBe(2);
    }
  });
});
