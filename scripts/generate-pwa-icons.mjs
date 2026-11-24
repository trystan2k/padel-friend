import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { parseTokens, resolveTokens } from './pwa-build.mjs';

const root = new URL('../', import.meta.url);
// An inscribed square at 56% of the icon width fits completely inside the maskable
// 80%-diameter safe circle, including the original's own transparent margins.
export const iconSlots = [
  { file: 'public/icons/icon-192.png', size: 192 },
  { file: 'public/icons/icon-512.png', size: 512, exportFile: 'pwa-icon-512.png' },
  { file: 'public/icons/maskable-192.png', size: 192, artworkWidth: '56%' },
  { file: 'public/icons/maskable-512.png', size: 512, artworkWidth: '56%' },
  { file: 'public/icons/apple-touch-icon.png', size: 180, artworkWidth: '100%' },
  { file: 'public/icons/favicon.png', size: 64, exportFile: 'favicon.png' }
];

async function generate() {
  const source = await readFile(new URL('docs/design/padel-friends-app-icon.png', root));
  const sourceUrl = 'data:image/png;base64,' + source.toString('base64');
  const css = await readFile(new URL('design-tokens/dist/tokens.css', root), 'utf8');
  const background = resolveTokens(parseTokens(css), 'light')['palette-green-deep'];

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const svgOnly = process.argv.includes('--svg');
    const files = {};
    for (const { file, size, artworkWidth, exportFile } of svgOnly ? [{ size: 24 }] : iconSlots) {
      await page.setViewportSize({ width: size, height: size });
      const imageCss = artworkWidth ?? '100%';
      await page.setContent(
        `<style>html,body{margin:0;width:100%;height:100%}body{display:grid;place-items:center;background:${artworkWidth ? background : 'transparent'}}img{display:block;width:${imageCss};height:auto}</style><img alt="" src="${sourceUrl}">`
      );
      await page.locator('img').evaluate((image) => image.decode());
      const bytes = await page.screenshot({ type: 'png', omitBackground: !artworkWidth });
      if (svgOnly) {
        console.log(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><image width="24" height="24" href="data:image/png;base64,${bytes.toString('base64')}"/></svg>`
        );
      } else {
        await writeFile(new URL(file, root), bytes);
        files[file] = createHash('sha256').update(bytes).digest('hex');
        if (exportFile) {
          await writeFile(new URL('docs/design/icon-exports/' + exportFile, root), bytes);
        }
      }
    }
    if (!svgOnly) console.log(JSON.stringify(files, null, 2));
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await generate();
