import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  GLYPH,
  MASKABLE_SAFE_RADIUS,
  glyphReach,
  iconColors,
  iconFiles,
  iconSvg
} from '../scripts/generate-pwa-icons.mjs';
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

describe('icon source', () => {
  const colors = iconColors(tokensCss);

  it('uses token colors and keeps public/icon.svg in sync with the generator', () => {
    expect(colors).toEqual({
      background: palette['palette-green-deep'],
      glyph: palette['palette-lime']
    });
    expect(readFileSync('public/icon.svg', 'utf8')).toBe(iconSvg(colors, { rounded: true }));
  });

  it('keeps the maskable glyph inside the 80% safe zone and the mask full-bleed', () => {
    expect(glyphReach()).toBeLessThanOrEqual(MASKABLE_SAFE_RADIUS);
    expect(GLYPH.start).toBeGreaterThan(256 - MASKABLE_SAFE_RADIUS);
    expect(iconSvg(colors, { rounded: false })).not.toContain('rx=');
    expect(iconSvg(colors, { rounded: true })).toContain('rx=');
  });

  it('generates every manifest icon file plus the apple-touch icon', () => {
    const generated = iconFiles(colors).map((entry) => entry.file.replace('public', ''));
    for (const icon of manifest.icons) expect(generated).toContain(icon.src);
    expect(generated).toContain('/icons/apple-touch-icon.png');
  });
});
