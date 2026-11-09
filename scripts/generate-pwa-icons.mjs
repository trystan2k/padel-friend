import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { parseTokens, resolveTokens } from './pwa-build.mjs';

// Brand mark: a plus glyph on the brand green. Geometry is shared by every variant; colors come from the
// approved design tokens. Maskable icons are full-bleed and keep the glyph (including its round caps)
// inside the 80% safe-zone circle so OS masks never crop it.
const VIEWBOX = 512;
export const GLYPH = { start: 130, end: 382, stroke: 48 };
export const MASKABLE_SAFE_RADIUS = (VIEWBOX * 0.8) / 2;
export const glyphReach = () => (GLYPH.end - GLYPH.start) / 2 + GLYPH.stroke / 2;

export function iconColors(css) {
  const palette = resolveTokens(parseTokens(css), 'light');
  return { background: palette['palette-green-deep'], glyph: palette['palette-lime'] };
}

export function iconSvg({ background, glyph }, { rounded }) {
  const middle = VIEWBOX / 2;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' +
    VIEWBOX +
    ' ' +
    VIEWBOX +
    '">' +
    '<rect width="' +
    VIEWBOX +
    '" height="' +
    VIEWBOX +
    '"' +
    (rounded ? ' rx="96"' : '') +
    ' fill="' +
    background +
    '"/>' +
    '<path d="M' +
    GLYPH.start +
    ' ' +
    middle +
    'h' +
    (GLYPH.end - GLYPH.start) +
    'M' +
    middle +
    ' ' +
    GLYPH.start +
    'v' +
    (GLYPH.end - GLYPH.start) +
    '" stroke="' +
    glyph +
    '" stroke-width="' +
    GLYPH.stroke +
    '" stroke-linecap="round"/></svg>\n'
  );
}

export function iconFiles(colors) {
  const any = iconSvg(colors, { rounded: true });
  const maskable = iconSvg(colors, { rounded: false });
  return [
    { file: 'public/icon.svg', svg: any },
    { file: 'public/icons/icon-192.png', svg: any, size: 192 },
    { file: 'public/icons/icon-512.png', svg: any, size: 512 },
    { file: 'public/icons/maskable-192.png', svg: maskable, size: 192 },
    { file: 'public/icons/maskable-512.png', svg: maskable, size: 512 },
    { file: 'public/icons/apple-touch-icon.png', svg: maskable, size: 180 }
  ];
}

async function generate() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const colors = iconColors(
    await readFile(path.join(root, 'design-tokens/dist/tokens.css'), 'utf8')
  );
  await mkdir(path.join(root, 'public/icons'), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const { file, svg, size } of iconFiles(colors)) {
      if (!size) {
        await writeFile(path.join(root, file), svg);
        continue;
      }
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(
        '<style>html,body{margin:0;background:transparent}svg{display:block;width:100vw;height:100vh}</style>' +
          svg
      );
      await writeFile(
        path.join(root, file),
        await page.screenshot({ type: 'png', omitBackground: true })
      );
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generate();
