import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// PAF-175 Class 2: a build run with a non-production NODE_ENV once baked DevStyleXInject's dev
// branch into the artifact (SSR <link href="/virtual:stylex.css"> + a client import of
// 'virtual:stylex:runtime'). Those virtual modules only exist behind the dev server, so the preview
// answered 404 and the browser logged "Failed to load resource". This contract inspects the REAL
// emitted client and SSR output. Like the bundle cascade gate in styles.cascade.test.ts, a missing
// dist/ means a standalone unit run before any build and skips; once dist/ exists, every missing
// piece fails loudly. `pnpm complete-check` builds first, so the gate always executes there.
//
// The triggering condition is an AMBIENT non-production NODE_ENV, which a normal prod-env build never
// reproduces: a prod build passes even with the vite.config.ts guard removed. The hostile-env lane at
// the bottom therefore builds the app itself under NODE_ENV=development into a throwaway outDir (the
// E2E-consumed dist/ is never touched) and runs the SAME artifact checks on that output. It also asserts
// the service-worker registration survived, because Vite derives import.meta.env.PROD from the same
// NODE_ENV and a dev-env build would otherwise fold the production-gated registration away.
const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.resolve(import.meta.dirname, '../dist');
const EXECUTABLE = /\.(?:m?js|html)$/;
const DEV_STYLE_REFERENCE = /virtual:stylex|virtual_stylex|\/virtual:stylex\.css/;
const STYLESHEET_MANIFEST = /^_tanstack-start-manifest_v-[\w-]+\.js$/;
// StyleX atomic rule: a hashed class whose body reads a design token.
const STYLEX_ATOMIC_RULE = /\.x[a-z0-9]{3,}\s*\{[^}]*var\(--/;
const STYLEX_PRIORITY_LAYER = /@layer priority1\b/;
// Service-worker registration (src/features/pwa): the update controller's default script URL, its
// root-scope register call and the browser container binding. Pattern-matched on shape, not on
// minifier-chosen identifiers. The `'serviceWorker' in navigator` capability probe is NOT a marker:
// the push code carries it too, so it survives even when registration is folded away.
const SW_SCRIPT = /\/sw\.js/;
const SW_REGISTER_CALL = /\.register\(\s*[\w$]+\s*,\s*\{\s*scope:\s*[`'"]\/[`'"]\s*\}\s*\)/;
const SW_CONTAINER = /container:\s*navigator\.serviceWorker/;
// A `PROD=false` build folds the registration guard into an unconditional early return.
const SW_FOLDED_GUARD = /!1\s*\|\|\s*!\s*\(\s*[`'"]serviceWorker[`'"]\s*in\s+navigator/;

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

function checkPwaRegistration(clientScripts: EmittedFile[]): string[] {
  const source = clientScripts.map(({ content }) => content).join('\n');
  const problems: string[] = [];
  if (SW_FOLDED_GUARD.test(source))
    problems.push(
      'service-worker registration guard is folded out (import.meta.env.PROD is false)'
    );
  if (!SW_SCRIPT.test(source)) problems.push('client code never references /sw.js');
  if (!SW_REGISTER_CALL.test(source))
    problems.push('client code has no root-scope service-worker register call');
  if (!SW_CONTAINER.test(source))
    problems.push('client code never binds navigator.serviceWorker to the update controller');
  return problems;
}

interface EmittedOutput {
  /** Executable files (.js/.mjs/.html) under client and server output, relative to the outDir. */
  files: EmittedFile[];
  /** SSR stylesheet manifest chunk sources found in the server output. */
  manifests: string[];
  readClientAsset: (href: string) => string | undefined;
}

/** The one artifact contract: dev-only StyleX, hashed StyleX stylesheets, PWA registration. */
function checkArtifact({ files, manifests, readClientAsset }: EmittedOutput): string[] {
  const problems: string[] = [];
  if (files.length === 0) problems.push('no emitted executable files');
  problems.push(
    ...findDevStyleReferences(files).map((file) => `${file} references the dev-only StyleX module`)
  );
  if (manifests.length !== 1) problems.push('SSR stylesheet manifest chunk is missing');
  else problems.push(...checkStylesheets(manifests[0] ?? '', readClientAsset));
  problems.push(
    ...checkPwaRegistration(
      files.filter(({ file }) => file.startsWith(`client${path.sep}`) && /\.m?js$/.test(file))
    )
  );
  return problems;
}

function readOutput(outDir: string): EmittedOutput {
  const client = path.join(outDir, 'client');
  const server = path.join(outDir, 'server');
  expect(existsSync(client), `${client} is missing`).toBe(true);
  expect(existsSync(server), `${server} is missing`).toBe(true);
  const assets = path.join(server, 'assets');
  return {
    files: [...walk(client), ...walk(server)]
      .filter((file) => EXECUTABLE.test(file))
      .map((file) => ({ file: path.relative(outDir, file), content: readFileSync(file, 'utf8') })),
    manifests: readdirSync(assets)
      .filter((name) => STYLESHEET_MANIFEST.test(name))
      .map((name) => readFileSync(path.join(assets, name), 'utf8')),
    readClientAsset: (href) => {
      const file = path.join(client, href);
      return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
    }
  };
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

  describe('PWA registration marker', () => {
    const registered =
      'if(!(`serviceWorker`in navigator))return()=>void 0;let n=wi({container:navigator.serviceWorker,scriptUrl:i=`/sw.js`});' +
      'async start(){let t=await e.register(i,{scope:`/`})}';
    const client = (content: string) => [{ file: 'client/assets/index-1.js', content }];

    it('accepts the production registration shape', () => {
      expect(checkPwaRegistration(client(registered))).toEqual([]);
    });

    it('rejects a client whose registration guard was folded out by PROD=false', () => {
      const folded =
        'if(!1||!(`serviceWorker`in navigator))return()=>void 0;return{start(){}}' +
        'const probe=`serviceWorker`in navigator;';
      expect(checkPwaRegistration(client(folded))).toEqual([
        'service-worker registration guard is folded out (import.meta.env.PROD is false)',
        'client code never references /sw.js',
        'client code has no root-scope service-worker register call',
        'client code never binds navigator.serviceWorker to the update controller'
      ]);
    });

    it('rejects a client with only the capability probe and an unrelated register call', () => {
      const incidental = 'const ok=`serviceWorker`in navigator;api.register({subscription:n})';
      expect(checkPwaRegistration(client(incidental))).toEqual([
        'client code never references /sw.js',
        'client code has no root-scope service-worker register call',
        'client code never binds navigator.serviceWorker to the update controller'
      ]);
    });

    it('fails the whole artifact contract when styles are fine but registration is missing', () => {
      const output = (content: string): EmittedOutput => ({
        files: [{ file: path.join('client', 'assets', 'index-1.js'), content }],
        manifests: [goodManifest],
        readClientAsset: () => goodCss
      });
      expect(checkArtifact(output(registered))).toEqual([]);
      expect(
        checkArtifact(output('if(!1||!(`serviceWorker`in navigator))return()=>void 0;'))
      ).toEqual([
        'service-worker registration guard is folded out (import.meta.env.PROD is false)',
        'client code never references /sw.js',
        'client code has no root-scope service-worker register call',
        'client code never binds navigator.serviceWorker to the update controller'
      ]);
    });
  });

  describe.skipIf(!existsSync(DIST))('fresh build output', () => {
    it('emits no dev-only StyleX reference in client or SSR code', () => {
      const { files } = readOutput(DIST);
      expect(files.length).toBeGreaterThan(0);
      expect(findDevStyleReferences(files)).toEqual([]);
    });

    it('serves the SSR-referenced stylesheets as emitted hashed assets with StyleX styles', () => {
      const { manifests, readClientAsset } = readOutput(DIST);
      expect(manifests, 'SSR stylesheet manifest chunk is missing').toHaveLength(1);
      expect(checkStylesheets(manifests[0] ?? '', readClientAsset)).toEqual([]);
    });

    it('keeps the service-worker registration in the client code', () => {
      expect(checkArtifact(readOutput(DIST))).toEqual([]);
    });
  });

  // Hostile-env lane: a REAL build under the ambient NODE_ENV that used to bake dev-only code into the
  // artifact. Isolated outDir; the Cloudflare plugin also rewrites the git-ignored deploy redirect
  // (.wrangler/deploy/config.json) to point at the build it just made, so that file is restored (or
  // removed again when it did not exist). Residual: the redirect is briefly repointed while the build
  // runs, so a concurrent wrangler/preview invocation in the same checkout could read it; gates that
  // use it (E2E, complete-check) do not run alongside unit tests.
  describe('build under ambient NODE_ENV=development', () => {
    const VITE_BIN = path.join(ROOT, 'node_modules/vite/bin/vite.js');
    const REDIRECT = path.join(ROOT, '.wrangler/deploy/config.json');
    let outDir = '';
    let output: EmittedOutput | undefined;

    beforeAll(() => {
      outDir = mkdtempSync(path.join(tmpdir(), 'pf-hostile-build-'));
      const redirect = existsSync(REDIRECT) ? readFileSync(REDIRECT, 'utf8') : undefined;
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([key]) => !key.startsWith('VITEST'))
      );
      try {
        execFileSync(process.execPath, [VITE_BIN, 'build', '--outDir', outDir], {
          cwd: ROOT,
          env: { ...env, NODE_ENV: 'development' },
          stdio: 'pipe',
          timeout: 240_000
        });
      } finally {
        // Restore the exact prior state: contents when the file existed, ABSENCE when it did not (the
        // build leaves a redirect to the temp outDir that is deleted afterwards).
        if (redirect !== undefined) writeFileSync(REDIRECT, redirect);
        else rmSync(REDIRECT, { force: true });
      }
      output = readOutput(outDir);
    }, 300_000);

    afterAll(() => {
      if (outDir) rmSync(outDir, { recursive: true, force: true });
    });

    it('emits no dev-only StyleX reference, hashed StyleX stylesheets and the PWA registration', () => {
      if (!output) throw new Error('hostile build produced no output');
      expect(checkArtifact(output)).toEqual([]);
    });
  });
});
