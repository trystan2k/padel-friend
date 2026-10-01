/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter, isRedirect } from '@tanstack/react-router';

// Route guards are integration-tested against the REAL file-route objects with
// getOnboardingStatus (and the other private server functions) mocked: the same double
// strategy as test/player.onboarding-status.test.ts, applied at the route boundary so the
// guard matrix of every auth route stays asserted without a request context.
const playerFunctions = vi.hoisted(() => ({
  getOnboardingStatus: vi.fn<() => Promise<{ authenticated: boolean; complete: boolean }>>(),
  getMyPlayerProfile: vi.fn<() => Promise<{ display_name: string }>>(),
  onboardPlayer: vi.fn<() => Promise<void>>(),
  updateMyPlayerProfile: vi.fn<() => Promise<void>>(),
  completeAvatarUpload: vi.fn<() => Promise<void>>()
}));
vi.mock('../src/features/player/player.functions', () => playerFunctions);

// The app root's beforeLoad reads the locale/theme server functions during router.load();
// they are irrelevant to the auth guards, so both modules are stubbed for the test tree.
vi.mock('../src/features/theme/theme.functions', () => ({
  getInitialTheme: vi.fn<() => Promise<string>>(async () => 'light'),
  saveTheme: vi.fn<() => void>()
}));
vi.mock('../src/i18n/locale.functions', () => ({
  getInitialLocale: vi.fn<() => Promise<string>>(async () => 'en'),
  saveLocale: vi.fn<() => void>()
}));

import { routeTree } from '../src/routeTree.gen';

const ANON = { authenticated: false, complete: false };
const INCOMPLETE = { authenticated: true, complete: false };
const COMPLETE = { authenticated: true, complete: true };

function onboardedAs(status: typeof ANON): void {
  playerFunctions.getOnboardingStatus.mockResolvedValue(status);
}

// Use the generated route tree: it owns the file-route path/parent types and patches.
const routerForGuards = createRouter({ routeTree, history: createMemoryHistory() });
const LoginRoute = routerForGuards.routesById['/login'];
const HomeRoute = routerForGuards.routesById['/'];
const AccountRoute = routerForGuards.routesById['/onboarding_/account'];
const OnboardingRoute = routerForGuards.routesById['/onboarding'];
const ProtectedRoute = routerForGuards.routesById['/_protected'];
const ForgotPasswordRoute = routerForGuards.routesById['/forgot-password'];
const ResetPasswordRoute = routerForGuards.routesById['/reset-password'];

// The route guards destructure only `search`/`location` from the router-provided context, but
// TanStack's declared BeforeLoadContext is a router-internal generic a unit test cannot
// faithfully construct — the same situation as the /auth/callback handler test — so the
// guards are narrowed to the minimal callable shape instead of an unsafe full-context fake.
type GuardContext = { search?: Record<string, unknown>; location?: { href: string } };
type GuardFn = (context: GuardContext) => Promise<unknown>;

function guardOf(routeOptions: { beforeLoad?: unknown }, routeName: string): GuardFn {
  if (typeof routeOptions.beforeLoad !== 'function')
    throw new Error(`${routeName} route must define beforeLoad`);
  const guard = routeOptions.beforeLoad;
  return (context) => {
    const result: unknown = Reflect.apply(guard, undefined, [context]);
    return Promise.resolve(result);
  };
}

function thrownRedirect(error: unknown) {
  if (!isRedirect(error)) throw new Error(`expected a redirect Response, got: ${String(error)}`);
  return error;
}

// Awaiting a guard resolves only when the visitor may stay; every redirect surfaces as a
// thrown TanStack redirect Response, which this helper unwraps for per-route assertions.
async function redirectOf(guard: Promise<unknown>): Promise<ReturnType<typeof thrownRedirect>> {
  try {
    await guard;
  } catch (error) {
    return thrownRedirect(error);
  }
  throw new Error('expected the route guard to redirect');
}

const loginGuard = guardOf(LoginRoute.options, '/login');
const homeGuard = guardOf(HomeRoute.options, '/');
const accountGuard = guardOf(AccountRoute.options, '/onboarding/account');
const onboardingGuard = guardOf(OnboardingRoute.options, '/onboarding');
const protectedGuard = guardOf(ProtectedRoute.options, '/_protected');
const forgotPasswordGuard = guardOf(ForgotPasswordRoute.options, '/forgot-password');
const resetPasswordGuard = guardOf(ResetPasswordRoute.options, '/reset-password');

// Full-router loads follow real redirect chains through the real route tree (no rendering), so
// each terminal state proves the whole guard pipeline, including the target route's
// validateSearch normalization of a redirected `next`.
function buildRouter(initialEntry: string) {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialEntry] })
  });
}

async function landedOn(initialEntry: string): Promise<{
  pathname: string;
  search: Record<string, unknown>;
}> {
  const router = buildRouter(initialEntry);
  await router.load();
  return {
    pathname: router.state.location.pathname,
    search: router.state.location.search
  };
}

beforeEach(() => {
  playerFunctions.getOnboardingStatus.mockReset();
  playerFunctions.getMyPlayerProfile
    .mockReset()
    .mockResolvedValue({ display_name: 'Route Player' });
});

describe('/ root guard (beforeLoad)', () => {
  it('redirects anonymous visitors to login without rendering public content', async () => {
    onboardedAs(ANON);
    const redirect = await redirectOf(homeGuard({}));
    expect(redirect.options.to).toBe('/login');
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');
    expect(await landedOn('/')).toEqual({ pathname: '/login', search: {} });
  });

  it('sends both incomplete and complete players through the protected dashboard guard', async () => {
    for (const [status, destination] of [
      [INCOMPLETE, '/onboarding'],
      [COMPLETE, '/dashboard']
    ] as const) {
      onboardedAs(status);
      const redirect = await redirectOf(homeGuard({}));
      expect(redirect.options.to).toBe('/dashboard');
      expect(await landedOn('/')).toEqual({ pathname: destination, search: {} });
    }
  });
});

describe('/login guard (beforeLoad)', () => {
  it('stays on the Welcome screen for an anonymous visitor', async () => {
    onboardedAs(ANON);
    await expect(loginGuard({ search: { next: '/matches' } })).resolves.toBeUndefined();
    expect(playerFunctions.getOnboardingStatus).toHaveBeenCalledTimes(1);
  });

  it('sends an authenticated incomplete player to player setup', async () => {
    onboardedAs(INCOMPLETE);
    const redirect = await redirectOf(loginGuard({ search: { next: '/matches' } }));
    expect(redirect.status).toBe(307);
    expect(redirect.options.to).toBe('/onboarding');
  });

  it('sends a complete player to the sanitized next destination', async () => {
    onboardedAs(COMPLETE);
    for (const [search, expectedHref] of [
      [{ next: '/matches?tab=history#top' }, '/matches?tab=history#top'],
      [{}, '/dashboard'],
      [{ next: '//evil.com' }, '/dashboard'],
      [{ next: '/onboarding' }, '/dashboard'],
      [{ next: '/auth/callback?code=x' }, '/dashboard']
    ] as const) {
      const redirect = await redirectOf(loginGuard({ search }));
      expect(redirect.options.href, `search ${JSON.stringify(search)}`).toBe(expectedHref);
    }
  });
});

describe('/forgot-password guard (beforeLoad)', () => {
  it('shows the reset request form to an anonymous visitor', async () => {
    onboardedAs(ANON);
    await expect(forgotPasswordGuard({ search: { next: '/matches' } })).resolves.toBeUndefined();
  });

  it('redirects an authenticated player to the dashboard', async () => {
    onboardedAs(INCOMPLETE);
    const redirect = await redirectOf(forgotPasswordGuard({}));
    expect(redirect.options.to).toBe('/dashboard');
  });
});

describe('/reset-password guard (beforeLoad)', () => {
  it('redirects an anonymous visitor to the reset request form', async () => {
    onboardedAs(ANON);
    const redirect = await redirectOf(resetPasswordGuard({}));
    expect(redirect.options.to).toBe('/forgot-password');
  });

  it('allows authenticated players regardless of onboarding completion', async () => {
    for (const status of [INCOMPLETE, COMPLETE]) {
      onboardedAs(status);
      await expect(resetPasswordGuard({})).resolves.toBeUndefined();
    }
  });
});

describe('/onboarding/account guard (beforeLoad)', () => {
  it('shows the signup form to an anonymous visitor', async () => {
    onboardedAs(ANON);
    await expect(accountGuard({ search: { next: '/matches' } })).resolves.toBeUndefined();
  });

  it('sends an authenticated incomplete player to player setup instead of the wizard loop', async () => {
    onboardedAs(INCOMPLETE);
    const redirect = await redirectOf(accountGuard({ search: { next: '/matches' } }));
    expect(redirect.options.to).toBe('/onboarding');
  });

  it('sends a complete player to the sanitized next destination', async () => {
    onboardedAs(COMPLETE);
    for (const [search, expectedHref] of [
      [{ next: '/community/nearby' }, '/community/nearby'],
      [{}, '/dashboard'],
      [{ next: 'https://evil.com' }, '/dashboard']
    ] as const) {
      const redirect = await redirectOf(accountGuard({ search }));
      expect(redirect.options.href, `search ${JSON.stringify(search)}`).toBe(expectedHref);
    }
  });
});

describe('/onboarding guard (beforeLoad)', () => {
  it('redirects an anonymous visitor to the Welcome screen carrying the onboarding next', async () => {
    onboardedAs(ANON);
    const redirect = await redirectOf(onboardingGuard({}));
    expect(redirect.options.to).toBe('/login');
    expect(redirect.options.search).toEqual({ next: '/onboarding' });
  });

  it('keeps an authenticated incomplete player on the setup form', async () => {
    onboardedAs(INCOMPLETE);
    await expect(onboardingGuard({})).resolves.toBeUndefined();
  });

  it('sends a complete player to the dashboard', async () => {
    onboardedAs(COMPLETE);
    const redirect = await redirectOf(onboardingGuard({}));
    expect(redirect.options.to).toBe('/dashboard');
  });
});

describe('/_protected guard (beforeLoad)', () => {
  it('bounces an anonymous deep link to the Welcome screen with the sanitized next preserved', async () => {
    onboardedAs(ANON);
    const redirect = await redirectOf(protectedGuard({ location: { href: '/dashboard?src=e2e' } }));
    expect(redirect.status).toBe(307);
    expect(redirect.options.to).toBe('/login');
    expect(redirect.options.search).toEqual({ next: '/dashboard?src=e2e' });
    expect(redirect.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps encoded query user data intact in the preserved next', async () => {
    onboardedAs(ANON);
    const redirect = await redirectOf(
      protectedGuard({ location: { href: '/dashboard?src=return%26check' } })
    );
    expect(redirect.options.search).toEqual({ next: '/dashboard?src=return%26check' });
  });

  it('sends an authenticated incomplete player to player setup and never leaks private content', async () => {
    onboardedAs(INCOMPLETE);
    const redirect = await redirectOf(protectedGuard({ location: { href: '/dashboard' } }));
    expect(redirect.options.to).toBe('/onboarding');
  });

  it('lets a complete player through to the protected content', async () => {
    onboardedAs(COMPLETE);
    await expect(protectedGuard({ location: { href: '/dashboard' } })).resolves.toBeUndefined();
  });
});

describe('search validation on the auth routes', () => {
  function validatorOf(routeOptions: { validateSearch?: unknown }, routeName: string) {
    if (typeof routeOptions.validateSearch !== 'function')
      throw new Error(`${routeName} route must define validateSearch`);
    const validate = routeOptions.validateSearch;
    return (search: Record<string, unknown>): unknown =>
      Reflect.apply(validate, undefined, [search]);
  }

  it('normalizes the login next and maps the authError flag', () => {
    const validateSearch = validatorOf(LoginRoute.options, '/login');
    expect(validateSearch({})).toEqual({});
    expect(validateSearch({ next: '/matches?tab=history#top' })).toEqual({
      next: '/matches?tab=history#top'
    });
    expect(validateSearch({ next: '//evil.com' })).toEqual({ next: '/dashboard' });
    expect(validateSearch({ next: '/login?next=/dashboard' })).toEqual({ next: '/dashboard' });
    expect(validateSearch({ next: '/onboarding?step=2' })).toEqual({ next: '/dashboard' });
    expect(validateSearch({ next: '/dashboard', authError: '1' })).toEqual({
      next: '/dashboard',
      authError: true
    });
    expect(validateSearch({ authError: '0', reset: 'unknown' })).toEqual({});
    expect(validateSearch({ reset: 'sent' })).toEqual({ reset: 'sent' });
    expect(validateSearch({ next: '/dashboard', reset: 'sent' })).toEqual({
      next: '/dashboard',
      reset: 'sent'
    });
  });

  it('normalizes the account next the same way', () => {
    const validateSearch = validatorOf(AccountRoute.options, '/onboarding/account');
    expect(validateSearch({})).toEqual({});
    expect(validateSearch({ next: '/community/nearby' })).toEqual({ next: '/community/nearby' });
    expect(validateSearch({ next: '/onboarding' })).toEqual({ next: '/dashboard' });
    expect(validateSearch({ next: 'javascript:alert(1)' })).toEqual({ next: '/dashboard' });
  });
});

describe('auth route chains (memory-router loads, no rendering)', () => {
  it('keeps an anonymous visitor on /login Welcome', async () => {
    onboardedAs(ANON);
    expect(await landedOn('/login')).toEqual({ pathname: '/login', search: {} });
  });

  it('keeps an anonymous visitor on /forgot-password and validates its next path', async () => {
    onboardedAs(ANON);
    expect(await landedOn('/forgot-password?next=%2Fmatches')).toEqual({
      pathname: '/forgot-password',
      search: { next: '/matches' }
    });
  });

  it('redirects an anonymous /reset-password visit to /forgot-password', async () => {
    onboardedAs(ANON);
    expect(await landedOn('/reset-password')).toEqual({
      pathname: '/forgot-password',
      search: {}
    });
  });

  it('keeps an anonymous visitor on the account signup route', async () => {
    onboardedAs(ANON);
    expect(await landedOn('/onboarding/account?next=%2Fdashboard')).toEqual({
      pathname: '/onboarding/account',
      search: { next: '/dashboard' }
    });
  });

  it('routes an authenticated incomplete player from /login to player setup', async () => {
    onboardedAs(INCOMPLETE);
    expect(await landedOn('/login')).toEqual({ pathname: '/onboarding', search: {} });
  });

  it('routes an authenticated incomplete player from the account route to player setup', async () => {
    onboardedAs(INCOMPLETE);
    expect(await landedOn('/onboarding/account')).toEqual({
      pathname: '/onboarding',
      search: {}
    });
  });

  it('returns a complete player from /login to the sanitized deep link', async () => {
    onboardedAs(COMPLETE);
    expect(await landedOn('/login?next=%2Fmatches%3Ftab%3Dhistory')).toEqual({
      pathname: '/matches',
      search: { tab: 'history' }
    });
  });

  it('never completes an open redirect from /login', async () => {
    onboardedAs(COMPLETE);
    expect(await landedOn('/login?next=//evil.com')).toEqual({
      pathname: '/dashboard',
      search: {}
    });
  });

  it('gates an anonymous /onboarding visit behind the Welcome screen with a loop-free next', async () => {
    onboardedAs(ANON);
    // The guard assigns next=/onboarding, but the login route's validateSearch rewrites an
    // onboarding next to /dashboard: login → onboarding → login would otherwise loop.
    expect(await landedOn('/onboarding')).toEqual({
      pathname: '/login',
      search: { next: '/dashboard' }
    });
  });

  it('preserves an anonymous protected deep link onto the Welcome screen search', async () => {
    onboardedAs(ANON);
    expect(await landedOn('/dashboard?src=e2e')).toEqual({
      pathname: '/login',
      search: { next: '/dashboard?src=e2e' }
    });
  });

  it('lets a complete player reach the protected deep link with its search intact', async () => {
    onboardedAs(COMPLETE);
    expect(await landedOn('/dashboard?src=e2e')).toEqual({
      pathname: '/dashboard',
      search: { src: 'e2e' }
    });
    expect(playerFunctions.getMyPlayerProfile).toHaveBeenCalledTimes(1);
  });
});
