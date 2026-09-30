import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { waitForHydratedPage } from './auth-helpers';

const BASE_URL = 'http://127.0.0.1:4173';

type LocaleCopy = {
  title: string;
  description: string;
  signInWithGoogle: string;
  googleSignInError: string;
  auth: {
    or: string;
    accountPrompt: string;
    loginEmailLabel: string;
    loginEmailPlaceholder: string;
    loginSubmit: string;
  };
};

function localeCopy(locale: string): LocaleCopy {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
}

test('server-renders the home page and exposes localized UI', async ({ page }) => {
  const enDescription = 'Padel Friend, built with TanStack Start, Cloudflare Workers and Supabase.';
  const esDescription = 'Padel Friend, creado con TanStack Start, Cloudflare Workers y Supabase.';
  const response = await page.goto('/');
  expect(await response?.text()).toContain('Padel Friend');
  await expect(page.getByRole('heading', { name: 'Padel Friend' })).toBeVisible();
  await expect(page.locator('section p')).toHaveText(enDescription);
  await page.getByLabel('Language').selectOption('es');
  await expect(page.locator('section p')).toHaveText(esDescription);
  await page.waitForFunction(() => document.cookie.includes('locale=es'));
  await page.reload();
  await expect(page.locator('section p')).toHaveText(esDescription);
  await page.getByLabel('Tema').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForFunction(() => document.cookie.includes('theme=dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('server-renders and hydrates every supported locale without a copy flash', async ({
  page
}) => {
  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const response = await page.goto('/');
    // SSR payload already carries the locale copy.
    expect(await response?.text()).toContain(copy.description);
    // After hydration the copy is unchanged (no localized-content flash).
    await expect(page.locator('section p')).toHaveText(copy.description);
    await expect(page.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.reload();
    await expect(page.locator('section p')).toHaveText(copy.description);
  }
});

test('the protected redirect happens server-side without a public flash', async ({
  request,
  page
}) => {
  // First hop for an anonymous request is already the login redirect: no protected HTML is
  // ever rendered before the client app boots.
  const redirect = await request.get('/dashboard', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(redirect.status());
  const locationHeader = redirect.headers()['location'];
  expect(locationHeader, 'protected redirect must include a location header').toBeTruthy();
  const location = new URL(locationHeader!, BASE_URL);
  expect(location.pathname).toBe('/login');
  expect(location.searchParams.get('next')).toBe('/dashboard');
  expect(redirect.headers()['cache-control']).toBe('private, no-store');

  await page.goto('/dashboard');
  expect(new URL(page.url()).pathname).toBe('/login');
  await expect(page.getByRole('button', { name: localeCopy('en').auth.loginSubmit })).toBeVisible();
});

test('the login screen localizes the OR divider, provider mark and account prompt', async ({
  page
}) => {
  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const response = await page.goto('/login');
    // SSR already carries the localized login copy.
    expect(await response?.text()).toContain(copy.auth.or);
    await expect(page.getByText(copy.auth.or, { exact: true })).toBeVisible();
    const google = page.getByRole('button', { name: copy.signInWithGoogle });
    await expect(google).toBeVisible();
    await expect(google.locator('span[aria-hidden="true"]')).toHaveText('G');
    await expect(page.getByText(copy.auth.accountPrompt)).toBeVisible();
    // Welcome email uses its own localized example; the design has no mail icon.
    const emailField = page.getByLabel(copy.auth.loginEmailLabel);
    await expect(emailField).toHaveAttribute('placeholder', copy.auth.loginEmailPlaceholder);
    await expect(emailField.locator('..').locator('svg[aria-hidden="true"]')).toHaveCount(0);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  }
});

test('the login submit keeps the StyleX design typography in light and dark themes', async ({
  page
}) => {
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark')
      await page.context().addCookies([{ name: 'theme', value: 'dark', url: BASE_URL }]);
    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // The Welcome submit control uses the design's 14px/700 typography, which must win the
    // cascade over the reset layer's font:inherit.
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeVisible();
    const typography = await submit.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    });
    expect(typography, `submit control must keep the design typography (${theme} theme)`).toEqual({
      fontSize: '14px',
      fontWeight: '700'
    });
  }
});

test('the bare root selects inherit the body font metrics in light and dark themes', async ({
  page
}) => {
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark')
      await page.context().addCookies([{ name: 'theme', value: 'dark', url: BASE_URL }]);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    // The root language/theme selects carry no StyleX styles: only the @layer reset
    // font:inherit rule gives them the body typography. A regression there (or an unlayered
    // font rule) drops them back onto the UA default, which diverges from body.
    const metrics = await page.evaluate(() => {
      const fontMetrics = (element: Element) => {
        const style = getComputedStyle(element);
        return {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight
        };
      };
      return {
        body: fontMetrics(document.body),
        locale: fontMetrics(document.querySelector('#locale')!),
        theme: fontMetrics(document.querySelector('#theme')!)
      };
    });
    expect(
      metrics.locale,
      `language select must inherit the body font metrics (${theme} theme)`
    ).toEqual(metrics.body);
    expect(
      metrics.theme,
      `theme select must inherit the body font metrics (${theme} theme)`
    ).toEqual(metrics.body);
    // Pin the body itself so a shared drift (body AND selects moving together) still fails.
    expect(metrics.body).toEqual({
      fontFamily: expect.stringContaining('Inter'),
      fontSize: '16px',
      fontWeight: '400'
    });
  }
});

test('OAuth callback rejects missing or denied codes without redirecting off-site', async ({
  request,
  page
}) => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('http://127.0.0.1:4173/login?authError=1');
    expect(response.headers()['cache-control']).toBe('no-store');
  }

  await page.goto('/login?authError=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Google sign-in was not completed. Please try again.')).toBeVisible();
});

test.describe('Google sign-in OAuth failure handling', () => {
  // Block the service worker so route interception below is deterministic (same technique as
  // the sign-out failure suite in onboarding.spec.ts).
  test.use({ serviceWorkers: 'block' });

  test('the OAuth start targets the Supabase authorize endpoint with Google and PKCE params and stays pending-disabled', async ({
    page
  }) => {
    const copy = localeCopy('en');
    let authorizeAttempts = 0;
    // Hold the authorize navigation instead of aborting it outright (same gate/hold
    // technique as the expired-session onboarding test): the start is a full-page
    // window.location.assign navigation, so while the request is pending the login
    // document stays mounted with busy kept true.
    let releaseAuthorizeNavigation: () => void = () => {};
    const authorizeNavigationHeld = new Promise<void>((resolve) => {
      releaseAuthorizeNavigation = resolve;
    });
    await page.route('**/auth/v1/authorize**', async (route) => {
      authorizeAttempts += 1;
      await authorizeNavigationHeld;
      return route.abort();
    });

    // Playwright gates EVERY in-page observation (locators, evaluate, waitForFunction)
    // while a navigation is pending — "waiting for navigation to finish" — so the
    // held-flight state cannot be read with locators. The sampler below runs in the
    // PAGE's own event loop instead and streams the Google control's disabled state out
    // through console messages, which arrive in the test process as push events while
    // the navigation is held.
    const heldFlightSamples: boolean[] = [];
    let sampling = false;
    page.on('console', (message) => {
      if (sampling && message.text().startsWith('pf-google-disabled:')) {
        heldFlightSamples.push(message.text() === 'pf-google-disabled:true');
      }
    });
    await page.addInitScript(() => {
      window.setInterval(() => {
        const google = [...document.querySelectorAll('main button')].find(
          (button): button is HTMLButtonElement =>
            button instanceof HTMLButtonElement &&
            button.querySelector('span[aria-hidden="true"]')?.textContent === 'G'
        );
        if (google) console.log(`pf-google-disabled:${String(google.disabled)}`);
      }, 50);
    });

    await page.goto('/login');
    await waitForHydratedPage(page);
    const google = page.getByRole('button', { name: copy.signInWithGoogle });

    // The intercepted request IS what supabase-js issues for signInWithOAuth: the Supabase
    // authorize endpoint with the Google provider, the PKCE challenge params and this app's
    // /auth/callback as redirect target. The click is kicked off WITHOUT awaiting it: a
    // locator click resolves only once its scheduled navigations settle, and the authorize
    // navigation stays HELD below — so the request event is the deterministic
    // "OAuth start happened" signal, and the click promise is settled after the release.
    const authorizeRequested = page.waitForRequest('**/auth/v1/authorize**');
    const googleClick = google.click().then(
      () => 'clicked' as const,
      () => 'refused' as const
    );
    const authorize = new URL((await authorizeRequested).url());
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    // Trust boundary: redirect_to must point at THIS app's origin with exactly the
    // /auth/callback pathname. A contains() check could never catch an off-origin redirect
    // (https://evil.com/auth/callback contains the path too), so origin and pathname are
    // asserted separately.
    const redirectTo = authorize.searchParams.get('redirect_to') ?? '';
    expect(redirectTo, 'authorize request must carry a redirect_to').toBeTruthy();
    const callback = new URL(redirectTo, BASE_URL);
    expect(callback.origin).toBe(BASE_URL);
    expect(callback.pathname).toBe('/auth/callback');

    // Pending-navigation window, observed while the authorize navigation is HELD: sample
    // the flight for at least ~500ms (ten 50ms ticks) and require EVERY sample to report
    // the control disabled — busy must stay true until the document is replaced. A
    // regression that re-enables it mid-flight (e.g. a restored finally) flips samples to
    // false and fails here.
    sampling = true;
    await expect
      .poll(() => heldFlightSamples.length, 'sampler must stream during the held flight')
      .toBeGreaterThanOrEqual(10);
    expect(
      heldFlightSamples.every((disabled) => disabled),
      'the Google control must stay disabled for every held-flight sample'
    ).toBe(true);
    // With the control disabled for the whole held flight, a user retry cannot dispatch a
    // click (disabled form controls never fire click events), so no second authorize
    // request may have been issued either.
    expect(authorizeAttempts, 'no second authorize request while the first is held').toBe(1);

    // WHY there is no in-page failure assertion on the network path: supabase-js computes
    // the PKCE challenge in-page and hands the authorize URL to window.location.assign — a
    // full-page navigation, NOT a fetch whose rejection the app could observe. Aborting (or
    // 5xx-fulfilling) that navigation replaces the document with the browser's network-error
    // page at the Supabase origin, so the login screen — error alert, re-enabled button — is
    // gone either way. The in-page catch recovery is covered by the test below, which fails
    // the sign-in start in-page through the same signInWithOAuth call.
    //
    // WHY the returned-error branch (if (error) in signInWithGoogle) has no in-page test:
    // it is unreachable with the real client stack. @supabase/auth-js 2.117.1 (resolved via
    // @supabase/supabase-js) implements signInWithOAuth → _handleProviderSignIn WITHOUT a
    // try/catch: the promise always resolves with { error: null }, and every failure (PKCE
    // challenge generation, storage/cookie writes) REJECTS it — exactly the catch path the
    // test below exercises. @supabase/ssr's createBrowserClient does not wrap
    // signInWithOAuth either. Making signInWithOAuth resolve { error } would require
    // patching the client prototype with behavior the library can never produce —
    // fabricated, not reachable, coverage.
    releaseAuthorizeNavigation();
    expect(await googleClick, 'the click itself must succeed').toBe('clicked');
  });

  test('a failed OAuth start shows the localized error and re-enables the button for a retry', async ({
    page
  }) => {
    const copy = localeCopy('en');
    // Fail signInWithOAuth deterministically BEFORE the redirect: @supabase/ssr persists the
    // PKCE verifier as a cookie through document.cookie; making THAT write throw exercises
    // the component's catch (localized error, busy cleared) — the same code path a real
    // authorize failure would have to reach in-page. The wrap passes every other cookie
    // write through untouched.
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (!descriptor?.get || !descriptor.set) return;
      const originalGet = descriptor.get.bind(document);
      const originalSet = descriptor.set.bind(document);
      Object.defineProperty(document, 'cookie', {
        get() {
          return originalGet();
        },
        set(value: string) {
          if (value.includes('-code-verifier=')) {
            throw new TypeError('cookie storage unavailable');
          }
          originalSet(value);
        }
      });
    });

    await page.goto('/login');
    await waitForHydratedPage(page);
    const google = page.getByRole('button', { name: copy.signInWithGoogle });

    await google.click();
    await expect(page.getByText(copy.googleSignInError)).toBeVisible();
    await expect(google).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/login');

    // The failure is not one-shot: clicking again reports the failure again with the button
    // still usable — the control never stays permanently disabled.
    await google.click();
    await expect(page.getByText(copy.googleSignInError)).toBeVisible();
    await expect(google).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/login');
  });
});
