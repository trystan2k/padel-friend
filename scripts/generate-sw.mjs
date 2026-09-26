import { generateSW } from 'workbox-build';

await generateSW({
  globDirectory: 'dist/client',
  globPatterns: ['**/*.{js,css,html,svg,webmanifest}'],
  swDest: 'dist/client/sw.js',
  navigateFallback: undefined,
  runtimeCaching: [
    {
      urlPattern: ({ request }) =>
        ['script', 'style', 'font', 'image'].includes(request.destination),
      handler: 'StaleWhileRevalidate',
      options: { cacheName: 'static-assets' }
    }
  ],
  cleanupOutdatedCaches: true,
  skipWaiting: false,
  clientsClaim: false
});
