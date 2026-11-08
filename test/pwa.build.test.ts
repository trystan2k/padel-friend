/** @vitest-environment jsdom */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_LOCALES,
  PRECACHE_GLOB_PATTERNS,
  injectPrecacheManifest,
  isAllowedPrecacheUrl,
  parseTokens,
  renderOfflineDocument,
  resolveTokens
} from '../scripts/pwa-build.mjs';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const tokensCss = readFileSync('design-tokens/dist/tokens.css', 'utf8');
const locales = { en, 'pt-BR': ptBR, es };
const temporary: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('precache allowlist', () => {
  it('allows only content-hashed build assets and the vetted public files', () => {
    for (const url of [
      'assets/index-DuQ3abc9.js',
      'assets/styles-Bq1x2y3z.css',
      'assets/inter-latin-400-normal-CGt2uvwx.woff2',
      'manifest.webmanifest',
      'icon.svg',
      'icons/maskable-512.png',
      'offline.html'
    ])
      expect(isAllowedPrecacheUrl(url)).toBe(true);
    for (const url of [
      'index.html',
      'dashboard.html',
      'assets/index.js',
      'assets/index-DuQ3abc9.js.map',
      'assets/photo-DuQ3abc9.png',
      'sw.js',
      'icons/../secret.png',
      'notifications/preferences',
      'https://example.com/assets/index-DuQ3abc9.js'
    ])
      expect(isAllowedPrecacheUrl(url)).toBe(false);
  });

  it('injects exactly the allowlisted files from a build directory', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'pwa-precache-'));
    temporary.push(root);
    const write = (file: string) => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), file);
    };
    for (const file of [
      'assets/app-AbCdEf12.js',
      'assets/app-AbCdEf12.js.map',
      'assets/app-Zy9Xw8Vu.css',
      'assets/font-12345678.woff2',
      'assets/photo-12345678.png',
      'manifest.webmanifest',
      'icon.svg',
      'icons/icon-192.png',
      'offline.html',
      'index.html',
      'private-account.html',
      'secrets.json',
      'sw.js'
    ])
      write(file);
    const swSrc = path.join(root, 'sw-src.js');
    writeFileSync(swSrc, 'precache(PRECACHE_MANIFEST);');
    const swDest = path.join(root, 'sw-out.js');

    await injectPrecacheManifest({ globDirectory: root, swSrc, swDest });

    const injected = readFileSync(swDest, 'utf8');
    const urls = [...injected.matchAll(/"url":"([^"]+)"/g)]
      .map((match) => match[1] ?? '')
      .sort((a, b) => a.localeCompare(b));
    expect(urls).toEqual([
      'assets/app-AbCdEf12.js',
      'assets/app-Zy9Xw8Vu.css',
      'assets/font-12345678.woff2',
      'icon.svg',
      'icons/icon-192.png',
      'manifest.webmanifest',
      'offline.html'
    ]);
    expect(PRECACHE_GLOB_PATTERNS.some((pattern) => pattern.includes('html}'))).toBe(false);
    expect(injected).not.toContain('index.html');
    expect(injected).not.toContain('private-account');
  });
});

describe('design token resolution', () => {
  it('parses both themes and resolves nested var() references to literals', () => {
    const tokens = parseTokens(
      ':root, [data-theme="light"] { --a: #111111; --b: var(--a); --c: 4px; }\n' +
        '[data-theme="dark"] { --b: #eeeeee; }'
    );
    expect(resolveTokens(tokens, 'light')).toEqual({ a: '#111111', b: '#111111', c: '4px' });
    expect(resolveTokens(tokens, 'dark')).toEqual({ b: '#eeeeee' });
    expect(() => resolveTokens(parseTokens(':root { --a: var(--missing); }'), 'light')).toThrow(
      'Unknown design token --missing'
    );
  });

  it('resolves every real design token without leftovers', () => {
    const tokens = parseTokens(tokensCss);
    for (const theme of ['light', 'dark'] as const)
      for (const value of Object.values(resolveTokens(tokens, theme)))
        expect(value).not.toContain('var(--');
  });
});

describe('offline document', () => {
  const html = renderOfflineDocument({ tokens: parseTokens(tokensCss), locales });

  it('carries all three languages and token-derived styles', () => {
    expect(Object.keys(locales)).toEqual(OFFLINE_LOCALES);
    for (const { pwa } of Object.values(locales)) {
      const copy = pwa.offline;
      expect(html).toContain(copy.title);
      expect(html).toContain(copy.body);
      expect(html).toContain(copy.retry);
    }
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain(resolveTokens(parseTokens(tokensCss), 'light')['color-bg']);
    expect(html).toContain('min-height:44px');
  });

  it('never reads credentials, storage or the network', () => {
    for (const forbidden of ['cookie', 'localStorage', 'sessionStorage', 'fetch(', 'indexedDB'])
      expect(html).not.toContain(forbidden);
    expect(html).not.toContain('@test.local');
  });

  it.each([
    [['pt-BR', 'en'], 'pt-BR', ptBR],
    [['es-MX'], 'es', es],
    [['fr-FR', 'es'], 'es', es],
    [['fr-FR'], 'en', en],
    [['en-GB', 'pt'], 'en', en]
  ])('selects %j deterministically as %s', (languages, locale, copy) => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(languages);
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = parsed.body.innerHTML;
    const script = parsed.querySelector('script')?.textContent ?? '';
    const element = document.createElement('script');
    element.textContent = script;
    document.body.append(element);
    expect(document.documentElement.lang).toBe(locale);
    const visible = [...document.querySelectorAll<HTMLElement>('[data-locale]')].filter(
      (section) => !section.hidden
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.querySelector('h1')?.textContent).toBe(copy.pwa.offline.title);
  });
});
