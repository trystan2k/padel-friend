import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

type LocaleCopy = {
  title: string;
  signOut: string;
  googleSignInError: string;
  signInWithGoogle: string;
  auth: {
    loginEmailLabel: string;
    loginPasswordLabel: string;
    loginSubmit: string;
    signupSubmit: string;
    signupLink: string;
    signupPasswordLabel: string;
    emailAddress: string;
    welcomeTitle: string;
  };
  onboarding: {
    name: string;
    side: string;
    preciseLevel: string;
    sideEitherShort: string;
    sideRightShort: string;
    save: string;
  };
  communityOnboarding: { skip: string };
  matches: { detail: { title: string; shareUrl: string; visibility: { community_open: string } } };
  matchCreate: {
    title: string;
    next: string;
    review: string;
    publish: string;
    fields: { date: string; startTime: string; venueName: string; mapsUrl: string; photo: string };
    photo: { remove: string };
  };
};

const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);

// Local coverage: deep-link preservation for email/password flows and callback error fallbacks.
// Real Google OAuth needs live credentials (commented out in supabase/config.toml) and stays a
// manual QA step; the callback's cookie forwarding and routing are unit tested in
// test/auth.callback.test.ts with a mocked exchangeCodeForSession instead of provider mocks.

const PASSWORD = 'Password123!';

function uniqueEmail(): string {
  return `e2e-return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
}

async function register(page: Page, email: string, loginUrl = '/login'): Promise<void> {
  await page.goto(loginUrl);
  await waitForHydratedPage(page);
  // Registration is reached ONLY through the real "Create account" link on the Welcome
  // screen: /login itself never renders a signup form.
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await expect(page).toHaveURL(/\/onboarding\/account/);
  await waitForHydratedPage(page);
  const signupEmail = page.locator('#signup-email');
  await expect(signupEmail).toBeEnabled();
  await signupEmail.fill(email);
  await page.getByLabel(en.auth.signupPasswordLabel).fill(PASSWORD);
  // PAF-73 return-path closure: the protected gate now carries the normalized next through
  // the onboarding redirect, so the default sign-up destination is /onboarding?next=%2Fdashboard.
  await submitAndWaitForAuthDestination(page, /\/onboarding(\?.*)?$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await waitForHydratedPage(page);
  expect(new URL(page.url()).pathname).toBe('/onboarding');
}

async function signIn(page: Page, email: string): Promise<void> {
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/dashboard$/, () =>
    page.getByRole('button', { name: en.auth.loginSubmit }).click()
  );
}

async function createOnboardedUser(page: Page, email: string, name: string): Promise<void> {
  await register(page, email);
  await page.getByLabel(en.onboarding.name).fill(name);
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page.getByRole('radio', { name: en.onboarding.sideEitherShort }).check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community(\?.*)?$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityOnboarding.skip }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
}

test('a protected deep link survives sign-in and a newcomer is gated before reaching it', async ({
  page
}) => {
  const email = uniqueEmail();
  await page.goto('/dashboard?src=e2e#top');
  expect(new URL(page.url()).pathname).toBe('/login');
  // URL fragments never reach the server, so SSR beforeLoad cannot preserve '#top' without a
  // client-only handoff that risks hydration divergence or redirect loops. Query preservation is
  // the achievable contract here; hash restoration remains a product follow-up.
  expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard?src=e2e');

  // New account: the onboarding gate intercepts, then the save lands on /dashboard. The
  // gate carries `next` through the redirect, so intermediate URLs include the query, and
  // the registration must start FROM the preserved deep link instead of a bare /login.
  await register(page, email, '/login?next=%2Fdashboard%3Fsrc%3De2e');
  await page.getByLabel(en.onboarding.name).fill('Dee Link');
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page
    .getByRole('group', { name: en.onboarding.side })
    .getByRole('radio', { name: en.onboarding.sideRightShort })
    .check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community(\?.*)?$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityOnboarding.skip }).click();
  const landed = new URL(page.url());
  expect(landed.pathname).toBe('/dashboard');
  expect(landed.searchParams.get('src')).toBe('e2e');
  await expect(page.getByRole('heading', { name: 'Dee Link' })).toBeVisible();
});

test('an existing account signing in returns to the protected deep link', async ({ page }) => {
  const email = uniqueEmail();
  await createOnboardedUser(page, email, 'Rex Return');

  // The probe differs from the /dashboard fallback (`src` carries an encoded & that must
  // survive untouched), so a lost deep link can never be confused with the default return path.
  await page.goto('/dashboard?src=return%26check');
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard?src=return%26check');

  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/dashboard\?src=return%26check$/, () =>
    page.getByRole('button', { name: en.auth.loginSubmit }).click()
  );
  const landed = new URL(page.url());
  expect(landed.pathname).toBe('/dashboard');
  expect(landed.search).toBe('?src=return%26check');
  expect(landed.searchParams.get('src')).toBe('return&check');
  await expect(page.getByRole('heading', { name: 'Rex Return' })).toBeVisible();
});

test('a hostile next parameter falls back to /dashboard', async ({ page }) => {
  const email = uniqueEmail();
  await createOnboardedUser(page, email, 'Mal Here');

  await page.goto('/login?next=//evil.com');
  expect(new URL(page.url()).pathname).toBe('/login');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(page.url()).not.toContain('evil');
});

test('callback code errors fall back to /login?authError=1 without leaking provider detail', async ({
  request,
  page
}) => {
  for (const path of [
    '/auth/callback?error=access_denied',
    '/auth/callback?code=x&error=server_error&error_description=raw-provider-secret-detail',
    '/auth/callback',
    '/auth/callback?error=access_denied&next=%2Fdashboard'
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'];
    expect(location?.startsWith('http://127.0.0.1:4173/login?authError=1')).toBe(true);
    expect(location).not.toContain('raw-provider-secret-detail');
    expect(location).not.toContain('server_error');
    expect(location).not.toContain('access_denied');
  }

  // A safe non-default next is preserved through the failure fallback.
  const response = await request.get('/auth/callback?error=x&next=%2Fmatches', { maxRedirects: 0 });
  expect(response.headers()['location']).toBe(
    'http://127.0.0.1:4173/login?authError=1&next=%2Fmatches'
  );

  await page.goto('/login?authError=1');
  await expect(page.getByText(en.googleSignInError)).toBeVisible();
});

// ---------------------------------------------------------------------------
// PAF-76: the real shared-link return journeys. A public community_open event is
// published through the UI; its canonical share URL must land an authenticated
// viewer on the exact event after password sign-in, after the OAuth callback
// path, and after a full fresh signup through both onboarding stages.
// ---------------------------------------------------------------------------

const MAILPIT_URL = 'http://127.0.0.1:55324';

function localSupabaseConfig() {
  const variables = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        ] as const;
      })
  );
  const url = process.env.VITE_SUPABASE_URL ?? variables.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    variables.get('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    '';
  if (!url || !key || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Match return journeys require loopback Supabase');
  return { url, key };
}

const supabaseConfig = localSupabaseConfig();

type MatchActor = {
  id: string;
  email: string;
  displayName: string;
  client: SupabaseClient;
};

async function createMatchActor(label: string): Promise<MatchActor> {
  const bootstrap = createClient(supabaseConfig.url, supabaseConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `return-match-${crypto.randomUUID()}@test.local`;
  const signup = await bootstrap.auth.signUp({ email, password: PASSWORD });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(`Could not create local E2E actor: ${signup.error?.message ?? 'no session'}`);
  const client = createClient(supabaseConfig.url, supabaseConfig.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const displayName = `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: displayName,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboarded.error) throw onboarded.error;
  return { id: signup.data.user.id, email, displayName, client };
}

/** A real, decodable 1x1 PNG — valid magic bytes and a real browser image. */
const VENUE_PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

function futureDate(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function publishSharedMatch(page: Page, venue: string): Promise<void> {
  await page.goto('/matches/create');
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.matchCreate.title })).toBeVisible();
  await page.getByLabel(en.matchCreate.fields.date).fill(futureDate(3));
  await page.getByLabel(en.matchCreate.fields.startTime).fill('19:30');
  await page.getByLabel(en.matchCreate.fields.venueName).fill(venue);
  await page
    .getByLabel(en.matchCreate.fields.mapsUrl)
    .fill('https://www.google.com/maps/place/?q=place_id:share-court');
  await page
    .getByLabel(en.matchCreate.fields.photo)
    .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: VENUE_PHOTO });
  await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
    timeout: 15_000
  });
  for (let step = 0; step < 3; step += 1)
    await page.getByRole('button', { name: en.matchCreate.next }).click();
  await expect(page.getByRole('heading', { name: en.matchCreate.review })).toBeVisible();
  await page.getByRole('button', { name: en.matchCreate.publish }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('link', { name: venue, exact: true })).toBeVisible();
}

/** Local GoTrue magic link bound to the browser's real PKCE challenge: the Google provider
 * hop is the only step replaced; the code issuance and the /auth/callback exchange are real. */
async function requestMagicLinkToken(email: string, codeChallenge: string): Promise<string> {
  const otp = await fetch(`${supabaseConfig.url}/auth/v1/otp`, {
    method: 'POST',
    headers: { apikey: supabaseConfig.key, 'content-type': 'application/json' },
    body: JSON.stringify({
      email,
      create_user: false,
      code_challenge: codeChallenge,
      code_challenge_method: 's256'
    })
  });
  expect(otp.status).toBe(200);
  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    return Object.fromEntries(Object.entries(value));
  };
  const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const box = asRecord(await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json());
    const messages = Array.isArray(box?.['messages']) ? box['messages'] : [];
    for (const candidate of messages) {
      const record = asRecord(candidate);
      const to = Array.isArray(record?.['To']) ? record['To'] : [];
      const addressed = to.some((recipient) => asRecord(recipient)?.['Address'] === email);
      if (!addressed) continue;
      const detail = asRecord(
        await (await fetch(`${MAILPIT_URL}/api/v1/message/${String(record!['ID'])}`)).json()
      );
      const body = `${asString(detail?.['HTML'])}\n${asString(detail?.['Text'])}`;
      const token = body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
      if (token) return token;
    }
  }
  throw new Error('Local Mailpit did not deliver the magic link');
}

test.describe.serial('shared match link returns to the exact event', () => {
  const shared: {
    creator?: MatchActor;
    eventId?: string;
    venue?: string;
    context?: BrowserContext;
    page?: Page;
  } = {};

  test.beforeAll(async ({ browser }) => {
    shared.creator = await createMatchActor('Share Host');
    const created = await shared.creator.client.rpc('create_community', {
      p_name: `Share circle ${crypto.randomUUID().slice(0, 8)}`,
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    if (created.error || typeof created.data !== 'string')
      throw created.error ?? new Error('Share community fixture failed');
    shared.context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      serviceWorkers: 'block'
    });
    shared.page = await shared.context.newPage();
    await shared.page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
    await shared.page.goto('/login');
    await waitForHydratedPage(shared.page);
    await shared.page.getByLabel(en.auth.loginEmailLabel).fill(shared.creator.email);
    await shared.page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
    await shared.page.getByRole('button', { name: en.auth.loginSubmit }).click();
    await expect(shared.page).toHaveURL(/\/dashboard$/);
    await waitForHydratedPage(shared.page);
    shared.venue = `Share Court ${crypto.randomUUID().slice(0, 8)}`;
    await publishSharedMatch(shared.page, shared.venue);
    const row = await shared.creator.client
      .from('match_events')
      .select('id')
      .eq('venue_name', shared.venue)
      .maybeSingle();
    if (row.error || !row.data) throw row.error ?? new Error('Shared event row is missing');
    shared.eventId = row.data.id;
  });

  test.afterAll(async () => {
    await shared.context?.close();
  });

  test('password sign-in and the OAuth callback path both land on the exact shared event', async ({
    page
  }) => {
    test.setTimeout(240_000);
    const creator = shared.creator!;
    const creatorPage = shared.page!;
    const eventId = shared.eventId!;
    const sharedPath = `/matches/${eventId}`;
    const detailHeading = en.matches.detail.title;
    const venueLine = `${shared.venue} · ${en.matches.detail.visibility.community_open}`;

    // The displayed share value is relative; share/copy still use the canonical absolute URL.
    // The creator signs out
    // immediately afterwards: no part of the journey depends on an idle session.
    await creatorPage.goto(sharedPath);
    await waitForHydratedPage(creatorPage);
    const shareValue = await creatorPage.getByLabel(en.matches.detail.shareUrl).inputValue();
    expect(shareValue).toBe(sharedPath);
    await creatorPage.goto('/dashboard');
    await waitForHydratedPage(creatorPage);
    await creatorPage.getByRole('button', { name: en.signOut }).click();
    await expect(creatorPage.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();

    // Password path: share link -> sign out -> sign in -> exact event.
    await page.goto(sharedPath);
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(new URL(page.url()).searchParams.get('next')).toBe(sharedPath);
    await waitForHydratedPage(page);
    await page.getByLabel(en.auth.loginEmailLabel).fill(creator.email);
    await page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
    await submitAndWaitForAuthDestination(page, new RegExp(`${eventId}$`), () =>
      page.getByRole('button', { name: en.auth.loginSubmit }).click()
    );
    expect(new URL(page.url()).pathname).toBe(sharedPath);
    await expect(page.getByRole('heading', { level: 1, name: detailHeading })).toBeVisible();
    await expect(page.getByText(venueLine, { exact: true })).toBeVisible();

    // OAuth-callback test path: the real PKCE handshake against local GoTrue, with the
    // email magic link standing in for the unconfigured Google provider hop. The browser
    // client stores the verifier cookie itself; the callback route performs the real
    // server-side exchange and re-authorization through the event loader. The password
    // path left this page authenticated, and /login redirects authenticated users, so
    // sign out through the dashboard first.
    await page.goto('/dashboard');
    await waitForHydratedPage(page);
    await page.getByRole('button', { name: en.signOut }).click();
    await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
    await page.goto(`/login?next=${encodeURIComponent(sharedPath)}`);
    await waitForHydratedPage(page);
    await page.route('**/auth/v1/authorize**', async (route) => {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '' });
    });
    const click = page.getByRole('button', { name: en.signInWithGoogle }).click();
    await page.waitForURL(/\/auth\/v1\/authorize/);
    const authorizeUrl = page.url();
    const challenge = new URL(authorizeUrl).searchParams.get('code_challenge');
    expect(challenge).toBeTruthy();
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.endsWith('-code-verifier'))
    ).toBe(true);
    await click.catch(() => undefined);

    const token = await requestMagicLinkToken(creator.email, challenge!);
    const verify = await fetch(
      `${supabaseConfig.url}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent(
        `http://127.0.0.1:4173/auth/callback?next=${encodeURIComponent(sharedPath)}`
      )}`,
      { redirect: 'manual' }
    );
    expect(verify.status).toBe(303);
    const callbackLocation = verify.headers.get('location');
    expect(callbackLocation).toContain('/auth/callback?code=');
    expect(callbackLocation).toContain(`next=${encodeURIComponent(sharedPath)}`);
    await page.goto(callbackLocation!);
    expect(new URL(page.url()).pathname).toBe(sharedPath);
    await expect(page.getByRole('heading', { level: 1, name: detailHeading })).toBeVisible();
    await expect(page.getByText(venueLine, { exact: true })).toBeVisible();
  });

  test('a fresh signup returns through onboarding to the shared event; no next reaches the dashboard', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    const sharedPath = `/matches/${shared.eventId!}`;
    const detailHeading = en.matches.detail.title;
    const venueLine = `${shared.venue} · ${en.matches.detail.visibility.community_open}`;
    const freshContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      serviceWorkers: 'block'
    });
    const plainContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      serviceWorkers: 'block'
    });
    try {
      const fresh = await freshContext.newPage();
      await fresh.goto(sharedPath);
      await waitForHydratedPage(fresh);
      expect(new URL(fresh.url()).pathname).toBe('/login');
      expect(new URL(fresh.url()).searchParams.get('next')).toBe(sharedPath);
      await fresh.getByRole('link', { name: en.auth.signupLink }).click();
      await waitForHydratedPage(fresh);
      const emailInput = fresh.locator('#signup-email');
      await expect(emailInput).toBeEnabled();
      await emailInput.fill(`fresh-return-${Date.now()}@test.local`);
      await fresh.getByLabel(en.auth.signupPasswordLabel).fill(PASSWORD);
      await submitAndWaitForAuthDestination(fresh, /\/onboarding(\?.*)?$/, () =>
        fresh.getByRole('button', { name: en.auth.signupSubmit }).click()
      );
      await waitForHydratedPage(fresh);
      await fresh.getByLabel(en.onboarding.name).fill('Fresh Returner');
      await fresh.getByLabel(en.onboarding.preciseLevel).fill('3.0');
      await fresh.getByRole('radio', { name: en.onboarding.sideEitherShort }).check();
      await fresh.getByRole('button', { name: en.onboarding.save }).click();
      await expect(fresh).toHaveURL(/\/onboarding\/community(\?.*)?$/);
      await waitForHydratedPage(fresh);
      await fresh.getByRole('button', { name: en.communityOnboarding.skip }).click();
      // Landed on the exact authorized event (public community_open, readable nonmember).
      expect(new URL(fresh.url()).pathname).toBe(sharedPath);
      await expect(fresh.getByRole('heading', { level: 1, name: detailHeading })).toBeVisible();
      await expect(fresh.getByText(venueLine, { exact: true })).toBeVisible();

      // Without a next, the same flow still reaches the dashboard.
      const plain = await plainContext.newPage();
      await plain.goto('/onboarding/account');
      await waitForHydratedPage(plain);
      const plainEmail = plain.locator('#signup-email');
      await expect(plainEmail).toBeEnabled();
      await plainEmail.fill(`plain-return-${Date.now()}@test.local`);
      await plain.getByLabel(en.auth.signupPasswordLabel).fill(PASSWORD);
      await submitAndWaitForAuthDestination(plain, /\/onboarding(\?.*)?$/, () =>
        plain.getByRole('button', { name: en.auth.signupSubmit }).click()
      );
      await waitForHydratedPage(plain);
      await plain.getByLabel(en.onboarding.name).fill('Plain Returner');
      await plain.getByLabel(en.onboarding.preciseLevel).fill('3.0');
      await plain.getByRole('radio', { name: en.onboarding.sideEitherShort }).check();
      await plain.getByRole('button', { name: en.onboarding.save }).click();
      await expect(plain).toHaveURL(/\/onboarding\/community(\?.*)?$/);
      await waitForHydratedPage(plain);
      await plain.getByRole('button', { name: en.communityOnboarding.skip }).click();
      await expect(plain).toHaveURL(/\/dashboard$/);
      await expect(plain.getByRole('heading', { name: 'Plain Returner' })).toBeVisible();
    } finally {
      await Promise.all([freshContext.close(), plainContext.close()]);
    }
  });
});
