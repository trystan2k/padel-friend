import { cloudflare } from '@cloudflare/vite-plugin';
import stylex from '@stylexjs/unplugin';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3000, strictPort: true },
  resolve: { tsconfigPaths: true },
  plugins: [
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tanstackStart(),
    stylex.vite({
      useCSSLayers: true,
      runtimeInjection: false,
      dev: process.env.NODE_ENV === 'development'
    }),
    react()
  ]
});
