import { createRouter } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { routeTree } from './routeTree.gen';
import { currentNonce } from './lib/security-headers.server';

// The per-request CSP nonce lives in request-scoped storage on the server. Start renders every
// inline script/style through router.options.ssr.nonce; the client reads it back from the
// csp-nonce meta tag the router emits, so nothing is computed in the browser.
const getSsrNonce = createIsomorphicFn()
  .server(() => currentNonce())
  .client(() => undefined);

export function getRouter() {
  return createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    ssr: { nonce: getSsrNonce() }
  });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
