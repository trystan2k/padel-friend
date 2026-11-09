import { injectManifest } from 'workbox-build';

export const OFFLINE_LOCALES = ['en', 'pt-BR', 'es'];

// Explicit public build output allowed in CacheStorage: content-hashed JS/CSS/fonts, the public
// manifest and icons, and the offline document (the only HTML). Everything else stays network-only.
export const PRECACHE_GLOB_PATTERNS = [
  'assets/**/*.{js,css,woff,woff2}',
  'manifest.webmanifest',
  'icon.svg',
  'icons/*.png',
  'offline.html'
];
const HASHED_ASSET = /^assets\/.+-[\w-]{8}\.(?:js|css|woff2?)$/;
const PUBLIC_FILE = /^(?:manifest\.webmanifest|icon\.svg|offline\.html|icons\/[\w-]+\.png)$/;

export const isAllowedPrecacheUrl = (url) => HASHED_ASSET.test(url) || PUBLIC_FILE.test(url);

export function parseTokens(css) {
  const light = new Map();
  const dark = new Map();
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const target = selector.includes('data-theme="dark"') ? dark : light;
    for (const [, name, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g))
      target.set(name, value.trim());
  }
  return { light, dark };
}

/** Resolves every token of a theme to literal values (dark falls back to light). */
export function resolveTokens(tokens, theme) {
  const lookup = (name) =>
    theme === 'dark' && tokens.dark.has(name) ? tokens.dark.get(name) : tokens.light.get(name);
  const resolve = (value, depth = 0) => {
    if (depth > 10) throw new Error('Design token reference is too deep or circular');
    return value.replace(/var\(--([\w-]+)\)/g, (_, name) => {
      const found = lookup(name);
      if (found === undefined) throw new Error('Unknown design token --' + name);
      return resolve(found, depth + 1);
    });
  };
  const names = theme === 'dark' ? [...tokens.dark.keys()] : [...tokens.light.keys()];
  return Object.fromEntries(names.map((name) => [name, resolve(lookup(name))]));
}

const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]
  );
const declarations = (values) =>
  Object.entries(values)
    .map(([name, value]) => '--' + name + ':' + value + ';')
    .join('');

// Runs in the offline document only. Language comes from navigator.languages alone (never storage or
// cookies): first supported prefix wins, English otherwise. Retry reloads the requested URL.
const OFFLINE_SCRIPT = [
  '(function(){',
  'var list=navigator.languages&&navigator.languages.length?navigator.languages:[navigator.language];',
  'var pick="en";',
  'for(var i=0;i<list.length;i++){var p=String(list[i]).toLowerCase().split("-")[0];',
  'if(p==="pt"){pick="pt-BR";break}if(p==="es"){pick="es";break}if(p==="en"){break}}',
  'document.documentElement.lang=pick;',
  'var all=document.querySelectorAll("[data-locale]");',
  'for(var j=0;j<all.length;j++){all[j].hidden=all[j].getAttribute("data-locale")!==pick}',
  'var buttons=document.querySelectorAll("[data-retry]");',
  'for(var k=0;k<buttons.length;k++){buttons[k].addEventListener("click",function(){location.reload()})}',
  'window.addEventListener("online",function(){location.reload()});',
  '})();'
].join('');

/** Static public offline document: three-language copy and token styles, no account data or reads. */
export function renderOfflineDocument({ tokens, locales }) {
  const light = resolveTokens(tokens, 'light');
  const dark = resolveTokens(tokens, 'dark');
  const sections = OFFLINE_LOCALES.map((locale) => {
    const copy = locales[locale].pwa.offline;
    return (
      '<section lang="' +
      locale +
      '" data-locale="' +
      locale +
      '"' +
      (locale === 'en' ? '' : ' hidden') +
      '>' +
      '<h1>' +
      escapeHtml(copy.title) +
      '</h1>' +
      '<p>' +
      escapeHtml(copy.body) +
      '</p>' +
      '<button type="button" data-retry>' +
      escapeHtml(copy.retry) +
      '</button>' +
      '</section>'
    );
  }).join('');
  const css =
    ':root{' +
    declarations(light) +
    '}' +
    '@media (prefers-color-scheme: dark){:root{' +
    declarations(dark) +
    '}}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:var(--color-bg);color:var(--color-text);font-family:var(--font-family-body)}' +
    'main{box-sizing:border-box;width:100%;max-width:calc(var(--space-40) * 12);padding:var(--space-16)}' +
    'section{display:flex;flex-direction:column;align-items:flex-start;gap:var(--space-12);' +
    'padding:var(--space-20);background:var(--color-surface);border:var(--border-width-sm) solid var(--color-line);' +
    'border-radius:var(--radius-16)}' +
    'section[hidden]{display:none}' +
    'h1{margin:0;font-size:var(--font-size-20);line-height:var(--font-line-height-tight)}' +
    'p{margin:0;font-size:var(--font-size-14);line-height:var(--font-line-height-body);color:var(--color-muted);overflow-wrap:anywhere}' +
    'button{min-height:44px;padding-inline:var(--space-16);border:0;border-radius:var(--radius-14);' +
    'background:var(--color-green);color:var(--color-surface);font:inherit;font-weight:var(--font-weight-bold);cursor:pointer}' +
    'button:focus-visible{outline:var(--border-width-lg) solid var(--color-text);outline-offset:var(--space-2)}';
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="robots" content="noindex"><meta name="color-scheme" content="light dark">' +
    '<title>' +
    escapeHtml(locales.en.title) +
    '</title><style>' +
    css +
    '</style></head>' +
    '<body><main>' +
    sections +
    '</main><script>' +
    OFFLINE_SCRIPT +
    '</script></body></html>\n'
  );
}

/** Injects the allowlisted precache manifest into the bundled authored service worker. */
export async function injectPrecacheManifest({ globDirectory, swSrc, swDest }) {
  const { count, warnings } = await injectManifest({
    globDirectory,
    swSrc,
    swDest,
    injectionPoint: 'PRECACHE_MANIFEST',
    globPatterns: PRECACHE_GLOB_PATTERNS,
    globIgnores: ['**/*.map'],
    // Content-hashed build files need no revision; public files are revisioned by content hash.
    dontCacheBustURLsMatching: HASHED_ASSET,
    manifestTransforms: [
      (entries) => {
        const rejected = entries.filter((entry) => !isAllowedPrecacheUrl(entry.url));
        if (rejected.length > 0)
          throw new Error(
            'Precache outside the public allowlist: ' + rejected.map((e) => e.url).join(', ')
          );
        return { manifest: entries, warnings: [] };
      }
    ]
  });
  return { count, warnings };
}
