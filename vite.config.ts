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
    // Class 2 (PAF-175): Vite derives `import.meta.env.DEV` from NODE_ENV, not from the command.
    // A build run with NODE_ENV !== 'production' in its environment therefore baked
    // DevStyleXInject's dev branch into the artifact: the SSR head emitted
    // <link href="/virtual:stylex.css"> and the client imported 'virtual:stylex:runtime'.
    // Those virtual modules only exist behind the dev server's configureServer hook, so the
    // preview server answered 404 (surfacing as "Failed to load resource" console errors).
    // Pinning DEV (and StyleX dev mode) to the Vite command makes build output independent of
    // the ambient NODE_ENV: the dev-only branch is always folded away outside `vite dev`.
    define: isDevServer ? {} : { 'import.meta.env.DEV': 'false' },
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
