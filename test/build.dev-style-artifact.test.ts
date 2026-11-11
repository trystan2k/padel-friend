import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// PAF-175 Class 2: a build run with a non-production NODE_ENV once baked DevStyleXInject's dev
// branch into the artifact (SSR <link href="/virtual:stylex.css"> + a client import of
// 'virtual:stylex:runtime'). Those virtual modules only exist behind the dev server, so the preview
// answered 404 and the browser logged "Failed to load resource". This contract inspects the REAL
// emitted client and SSR output. Like the bundle cascade gate in styles.cascade.test.ts, a missing
// dist/ means a standalone unit run before any build and skips; once dist/ exists, every missing
// piece fails loudly. `pnpm complete-check` builds first, so the gate always executes there.
const DIST = path.resolve(import.meta.dirname, '../dist');
const CLIENT = path.join(DIST, 'client');
const SERVER = path.join(DIST, 'server');
const EXECUTABLE = /\.(?:m?js|html)$/;
const DEV_STYLE_REFERENCE = /virtual:stylex|virtual_stylex|\/virtual:stylex\.css/;
const STYLESHEET_MANIFEST = /^_tanstack-start-manifest_v-[\w-]+\.js$/;
// StyleX atomic rule: a hashed class whose body reads a design token.
const STYLEX_ATOMIC_RULE = /\.x[a-z0-9]{3,}\s*\{[^}]*var\(--/;
const STYLEX_PRIORITY_LAYER = /@layer priority1\b/;

interface EmittedFile {
  file: string;
  content: string;
}

function findDevStyleReferences(files: EmittedFile[]): string[] {
  return files
    .filter(({ file, content }) => EXECUTABLE.test(file) && DEV_STYLE_REFERENCE.test(content))
    .map(({ file }) => file);
}

function extractStylesheetHrefs(manifestSource: string): string[] {
  return [...manifestSource.matchAll(/css:\s*\[([^\]]*)\]/g)].flatMap(([, list]) =>
    [...(list ?? '').matchAll(/"([^"]+\.css)"/g)].map((match) => match[1] ?? '')
  );
}

function checkStylesheets(
  manifestSource: string,
  readClientAsset: (href: string) => string | undefined
): string[] {
  const hrefs = extractStylesheetHrefs(manifestSource);
  if (hrefs.length === 0) return ['SSR manifest references no stylesheet'];
  const problems: string[] = [];
  for (const href of new Set(hrefs)) {
    if (!/^\/assets\/[\w.-]+-[\w-]{8}\.css$/.test(href)) {
      problems.push(`${href} is not a hashed /assets stylesheet`);
      continue;
    }
    const css = readClientAsset(href);
    if (css === undefined) problems.push(`${href} is referenced by SSR but not emitted`);
    else if (!STYLEX_PRIORITY_LAYER.test(css) || !STYLEX_ATOMIC_RULE.test(css))
      problems.push(`${href} carries no StyleX computed styles`);
  }
  return problems;
}

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(path.join(directory, entry.name))
      : [path.join(directory, entry.name)]
  );
}

describe('dev-only StyleX artifact contract', () => {
  const goodManifest = 'css: ["/assets/index-Yi0DRkAY.css"],';
  const goodCss =
    '@layer priority1,priority2;@layer priority1{.xguxcyr{accent-color:var(--color-green)}}';

  it('rejects a representative SSR dev stylesheet link', () => {
    const files = [
      { file: 'dist/server/assets/router-1.js', content: 'href:"/virtual:stylex.css"' },
      { file: 'dist/server/assets/ok.js', content: 'href:"/assets/index-Yi0DRkAY.css"' }
    ];
    expect(findDevStyleReferences(files)).toEqual(['dist/server/assets/router-1.js']);
  });

  it('rejects a client runtime import of the dev virtual module', () => {
    const files = [
      {
        file: 'dist/client/assets/index-1.js',
        content: 'import("./virtual_stylex_runtime-Bb.js")'
      },
      { file: 'dist/client/assets/index-2.js', content: 'import("virtual:stylex:runtime")' }
    ];
    expect(findDevStyleReferences(files)).toEqual([
      'dist/client/assets/index-1.js',
      'dist/client/assets/index-2.js'
    ]);
  });

  it('ignores sourcemaps and other non-executable source text', () => {
    const files = [
      { file: 'dist/server/index.js.map', content: '"virtual:stylex:runtime"' },
      { file: 'dist/client/notes.txt', content: '/virtual:stylex.css' }
    ];
    expect(findDevStyleReferences(files)).toEqual([]);
  });

  it('accepts a manifest whose stylesheet is emitted with StyleX styles', () => {
    expect(extractStylesheetHrefs(goodManifest)).toEqual(['/assets/index-Yi0DRkAY.css']);
    expect(checkStylesheets(goodManifest, () => goodCss)).toEqual([]);
  });

  it('rejects a missing stylesheet, an empty one, an unhashed one and a manifest without CSS', () => {
    expect(checkStylesheets(goodManifest, () => undefined)).toEqual([
      '/assets/index-Yi0DRkAY.css is referenced by SSR but not emitted'
    ]);
    expect(checkStylesheets(goodManifest, () => '@font-face{font-family:Inter}')).toEqual([
      '/assets/index-Yi0DRkAY.css carries no StyleX computed styles'
    ]);
    expect(checkStylesheets('css: ["/virtual:stylex.css"],', () => goodCss)).toEqual([
      '/virtual:stylex.css is not a hashed /assets stylesheet'
    ]);
    expect(checkStylesheets('css: [],', () => goodCss)).toEqual([
      'SSR manifest references no stylesheet'
    ]);
    expect('_tanstack-start-manifest_v-AbCdEf12.js').toMatch(STYLESHEET_MANIFEST);
  });

  describe.skipIf(!existsSync(DIST))('fresh build output', () => {
    it('emits no dev-only StyleX reference in client or SSR code', () => {
      expect(existsSync(CLIENT), 'dist/client is missing').toBe(true);
      expect(existsSync(SERVER), 'dist/server is missing').toBe(true);
      const files = [...walk(CLIENT), ...walk(SERVER)]
        .filter((file) => EXECUTABLE.test(file))
        .map((file) => ({ file: path.relative(DIST, file), content: readFileSync(file, 'utf8') }));
      expect(files.length).toBeGreaterThan(0);
      expect(findDevStyleReferences(files)).toEqual([]);
    });

    it('serves the SSR-referenced stylesheets as emitted hashed assets with StyleX styles', () => {
      const assets = path.join(SERVER, 'assets');
      const manifests = readdirSync(assets).filter((name) => STYLESHEET_MANIFEST.test(name));
      expect(manifests, 'SSR stylesheet manifest chunk is missing').toHaveLength(1);
      const source = readFileSync(path.join(assets, manifests[0] ?? ''), 'utf8');
      const problems = checkStylesheets(source, (href) => {
        const file = path.join(CLIENT, href);
        return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
      });
      expect(problems).toEqual([]);
    });
  });
});
