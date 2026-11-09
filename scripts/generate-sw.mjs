import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { injectPrecacheManifest, parseTokens, renderOfflineDocument } from './pwa-build.mjs';

// Post-build step: writes the public offline document, bundles the authored service worker
// (src/features/pwa/service-worker.ts) and injects the allowlisted precache manifest as
// dist/client/sw.js, keeping the stable /sw.js URL.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const clientDir = path.join(root, 'dist/client');
const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));

async function generate() {
  const [tokensCss, en, ptBR, es] = await Promise.all([
    readFile(path.join(root, 'design-tokens/dist/tokens.css'), 'utf8'),
    readJson('src/locales/en/translation.json'),
    readJson('src/locales/pt-BR/translation.json'),
    readJson('src/locales/es/translation.json')
  ]);
  await writeFile(
    path.join(clientDir, 'offline.html'),
    renderOfflineDocument({ tokens: parseTokens(tokensCss), locales: { en, 'pt-BR': ptBR, es } })
  );
  const bundleDir = await mkdtemp(path.join(os.tmpdir(), 'padel-friend-sw-'));
  try {
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      publicDir: false,
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        outDir: bundleDir,
        emptyOutDir: true,
        target: 'es2022',
        lib: {
          entry: path.join(root, 'src/features/pwa/service-worker.ts'),
          formats: ['iife'],
          name: 'PadelFriendServiceWorker',
          fileName: () => 'sw.js'
        }
      }
    });
    await injectPrecacheManifest({
      globDirectory: clientDir,
      swSrc: path.join(bundleDir, 'sw.js'),
      swDest: path.join(clientDir, 'sw.js')
    });
  } finally {
    await rm(bundleDir, { recursive: true, force: true });
  }
}

generate().catch((error) => {
  console.error(`service worker build failed: ${error.message}`);
  process.exitCode = 1;
});
