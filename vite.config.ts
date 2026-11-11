import { cloudflare } from '@cloudflare/vite-plugin';
import stylex from '@stylexjs/unplugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';

  return {
    server: { port: 3000, strictPort: true },
    resolve: { tsconfigPaths: true },
    // Class 2 (PAF-175): Vite derives `import.meta.env.DEV` and `import.meta.env.PROD` from
    // NODE_ENV, not from the command. A build run with NODE_ENV !== 'production' in its
    // environment therefore baked DevStyleXInject's dev branch into the artifact: the SSR head
    // emitted <link href="/virtual:stylex.css"> and the client imported 'virtual:stylex:runtime'.
    // Those virtual modules only exist behind the dev server's configureServer hook, so the
    // preview server answered 404 (surfacing as "Failed to load resource" console errors).
    // The same ambient NODE_ENV would also leave PROD false and silently skip the service-worker
    // registration gated on it (src/features/pwa/update-store.ts). Pinning DEV=false and
    // PROD=true (and StyleX dev mode) to the Vite command guarantees exactly two things for a build:
    // the two flags agree, and the StyleX dev-injection branch is excluded; `vite dev` is left
    // untouched. It does NOT make the whole artifact independent of the ambient NODE_ENV: dependency
    // bundles still follow it (e.g. React's development build in SSR: 1161kB vs 952kB). That divergence
    // is known and accepted: no functional defect is evidenced, and the artifact contract
    // (test/build.dev-style-artifact.test.ts) pins only what this guard guarantees.
    define: isDevServer ? {} : { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
    plugins: [
      cloudflare({ viteEnvironment: { name: 'ssr' } }),
      tanstackStart(),
      stylex.vite({
        useCSSLayers: true,
        runtimeInjection: false,
        dev: isDevServer && process.env.NODE_ENV === 'development'
      }),
      react()
    ]
  };
});
