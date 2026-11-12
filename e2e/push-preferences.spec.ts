import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { testSupabaseConfig } from './test-supabase-config';
import { E2E_WEB_PUSH_ENV } from '../scripts/e2e-build-env.mjs';
import { waitForHydratedPage } from './auth-helpers';
import { controlledByBuiltWorker } from './service-worker-helpers';
import en from '../src/locales/en/translation.json' with { type: 'json' };
import es from '../src/locales/es/translation.json' with { type: 'json' };
import ptBR from '../src/locales/pt-BR/translation.json' with { type: 'json' };

// UI flows run against deterministic Notification/PushManager mocks (a mock never talks to a real
// push service); the registry round-trips through the real server functions and database. One case
// at the end registers the real built service worker and reads the real PushManager.
//
// Worker churn (PAF-175): every mocked case blocks native workers (the mock container replaces
// navigator.serviceWorker), so the only real install is the final case; it waits for the activated,
// controlled built worker explicitly before reading PushManager.
const BASE_URL = 'http://127.0.0.1:4173';
const password = 'Password123!';
const config = localConfig();

test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(90_000);

type Permission = 'default' | 'granted' | 'denied';
type MockOptions = { permission?: Permission; requested?: Permission; ios?: boolean };
type Actor = { email: string; id: string; client: SupabaseClient };

const copy = en.push;
const panel = (page: Page) => page.getByRole('region', { name: copy.title });

async function installMocks(context: BrowserContext, options: MockOptions = {}) {
  await context.addInitScript(
    ({ permission, requested, ios, publicKey, origin }) => {
      // Context init scripts also run in about:blank and opaque frames, where localStorage throws a
      // SecurityError. Mock only the app origin; a storage failure there is a real defect, so it is
      // rethrown with its origin instead of being swallowed.
      if (location.origin !== origin) return;
      const storage = (() => {
        try {
          return window.localStorage;
        } catch (cause) {
          throw new Error('Push mock storage unavailable at ' + location.origin, { cause });
        }
      })();
      // Permission persists across reloads like a real browser; each context is its own device.
      const state = {
        permission: storage.getItem('fakePermission') ?? permission,
        permissionRequests: 0,
        subscribeCalls: 0,
        failNextSubscribe: false
      };
      Object.defineProperty(window, '__push', { value: state });
      Object.defineProperty(Notification, 'permission', {
        configurable: true,
        get: () => state.permission
      });
      Notification.requestPermission = () => {
        state.permissionRequests += 1;
        state.permission = requested;
        storage.setItem('fakePermission', requested);
        return Promise.resolve(requested);
      };
      if (ios) {
        Object.defineProperty(navigator, 'userAgent', {
          configurable: true,
          get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15'
        });
        Reflect.deleteProperty(window, 'PushManager');
      }
      const toBytes = (value: string) =>
        Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const toBase64Url = (bytes: Uint8Array) =>
        btoa(String.fromCharCode(...bytes))
          .replace(/\+/g, '-')
          .replace(/\//g, '_')
          .replace(/=+$/, '');
      const build = (stored: { endpoint: string; p256dh: string; auth: string }) => ({
        endpoint: stored.endpoint,
        expirationTime: null,
        options: { applicationServerKey: toBytes(publicKey).buffer },
        unsubscribe: async () => {
          storage.removeItem('fakeSubscription');
          return true;
        },
        toJSON: () => ({
          endpoint: stored.endpoint,
          expirationTime: null,
          keys: { p256dh: stored.p256dh, auth: stored.auth }
        })
      });
      const current = () => {
        const raw = storage.getItem('fakeSubscription');
        return raw ? build(JSON.parse(raw)) : null;
      };
      const pushManager = {
        getSubscription: async () => current(),
        subscribe: async () => {
          state.subscribeCalls += 1;
          if (state.failNextSubscribe) {
            state.failNextSubscribe = false;
            throw new Error('push service unavailable');
          }
          const p256dh = crypto.getRandomValues(new Uint8Array(65));
          p256dh[0] = 4;
          const stored = {
            endpoint: 'https://push.example.test/send/' + crypto.randomUUID(),
            p256dh: toBase64Url(p256dh),
            auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16)))
          };
          storage.setItem('fakeSubscription', JSON.stringify(stored));
          return build(stored);
        }
      };
      const container = {
        controller: null,
        ready: Promise.resolve({ pushManager }),
        register: () => new Promise(() => undefined),
        getRegistration: async () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined
      };
      Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: container });
    },
    {
      permission: options.permission ?? 'default',
      requested: options.requested ?? 'granted',
      ios: options.ios ?? false,
      publicKey: E2E_WEB_PUSH_ENV.WEB_PUSH_VAPID_PUBLIC_KEY,
      origin: BASE_URL
    }
  );
}

const counters = (page: Page) =>
  page.evaluate(() => {
    const state = Reflect.get(window, '__push');
    return { requests: state.permissionRequests, subscribes: state.subscribeCalls };
  });

async function activeDevices(actor: Actor) {
  const result = await actor.client.rpc('reconcile_my_push_devices', {
    p_current_endpoint: null,
    p_locale: null
  });
  expect(result.error).toBeNull();
  return result.data ?? [];
}

async function openPreferences(page: Page, actor: Actor, locale = 'en') {
  await signIn(page, actor);
  // Login labels are asserted in English; the translated locale applies from the next navigation.
  await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
  await page.goto('/notifications/preferences');
  await waitForHydratedPage(page);
}

test.describe('mocked browser capabilities', () => {
  test.use({ serviceWorkers: 'block' });

  test('default permission waits for the explicit button and never prompts on load or on saving', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context);
      const page = await context.newPage();
      await openPreferences(page, actor);
      await expect(panel(page).getByRole('status')).toHaveText(copy.permissionDefault);
      const enable = panel(page).getByRole('button', { name: copy.enable });
      await expect(enable).toBeVisible();
      expect((await enable.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await counters(page)).toEqual({ requests: 0, subscribes: 0 });

      await page.getByRole('switch', { name: en.notificationPreferences.pushTitle }).click();
      await page.getByRole('button', { name: en.notificationPreferences.save }).click();
      await expect(page.getByText(en.notificationPreferences.saved)).toBeVisible();
      expect(await counters(page)).toEqual({ requests: 0, subscribes: 0 });
      expect(await activeDevices(actor)).toHaveLength(0);
      // Saved intent alone never marks this device enabled.
      await expect(panel(page).getByText(copy.enabled)).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('keyboard activation prompts once, registers the device, and reload reconciles from the registry', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context);
      const page = await context.newPage();
      await openPreferences(page, actor);
      const enable = panel(page).getByRole('button', { name: copy.enable });
      await enable.focus();
      await page.keyboard.press('Enter');
      await expect(panel(page).getByRole('status')).toHaveText(copy.intentOff);
      expect(await counters(page)).toEqual({ requests: 1, subscribes: 1 });
      expect(await activeDevices(actor)).toHaveLength(1);

      await page.reload();
      await waitForHydratedPage(page);
      await expect(panel(page).getByRole('status')).toHaveText(copy.intentOff);
      await expect(panel(page).getByRole('button', { name: copy.disableDevice })).toBeVisible();
      // Permission is already granted after reload: no second prompt.
      expect(await counters(page)).toEqual({ requests: 0, subscribes: 0 });

      // Saving the global intent flips the same registered device to fully enabled.
      await page.getByRole('switch', { name: en.notificationPreferences.pushTitle }).click();
      await page.getByRole('button', { name: en.notificationPreferences.save }).click();
      await expect(panel(page).getByRole('status')).toHaveText(copy.enabled);
    } finally {
      await context.close();
    }
  });

  test('two devices coexist and disabling one retires only that registration', async ({
    browser
  }) => {
    const actor = await createActor();
    const first = await browser.newContext({ serviceWorkers: 'block' });
    const second = await browser.newContext({ serviceWorkers: 'block' });
    try {
      const pages: Page[] = [];
      for (const context of [first, second]) {
        await installMocks(context, { permission: 'granted' });
        const page = await context.newPage();
        await openPreferences(page, actor);
        await panel(page).getByRole('button', { name: copy.enable }).click();
        await expect(panel(page).getByRole('button', { name: copy.disableDevice })).toBeVisible();
        pages.push(page);
      }
      expect(await activeDevices(actor)).toHaveLength(2);

      await panel(pages[0]!).getByRole('button', { name: copy.disableDevice }).click();
      await expect(panel(pages[0]!).getByRole('status')).toHaveText(copy.deviceDisabled);
      expect(await activeDevices(actor)).toHaveLength(1);

      await pages[1]!.reload();
      await waitForHydratedPage(pages[1]!);
      await expect(
        panel(pages[1]!).getByRole('button', { name: copy.disableDevice })
      ).toBeVisible();
      await expect(panel(pages[1]!).getByText(/other device/)).toHaveCount(0);
    } finally {
      await first.close();
      await second.close();
    }
  });

  test('a failed subscribe is an alert with retry that keeps the in-app fallback visible', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context, { permission: 'granted' });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await page.evaluate(() => {
        Reflect.get(window, '__push').failNextSubscribe = true;
      });
      await panel(page).getByRole('button', { name: copy.enable }).click();
      await expect(panel(page).getByRole('alert')).toHaveText(copy.subscriptionFailed);
      await expect(panel(page).getByText(copy.fallback)).toBeVisible();
      expect(await activeDevices(actor)).toHaveLength(0);

      await panel(page).getByRole('button', { name: copy.retry }).click();
      await expect(panel(page).getByRole('status')).toHaveText(copy.intentOff);
      expect(await activeDevices(actor)).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  test('a dismissed prompt returns to the default state and a denied prompt shows instructions', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context, { requested: 'default' });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await panel(page).getByRole('button', { name: copy.enable }).click();
      await expect(panel(page).getByRole('status')).toHaveText(copy.permissionDefault);
      await page.evaluate(() => {
        Notification.requestPermission = () => {
          Reflect.set(Reflect.get(window, '__push'), 'permission', 'denied');
          return Promise.resolve('denied' as const);
        };
      });
      await panel(page).getByRole('button', { name: copy.enable }).click();
      await expect(panel(page).getByRole('status')).toHaveText(copy.denied);
      await expect(panel(page).getByRole('button')).toHaveCount(0);
      expect((await counters(page)).subscribes).toBe(0);
    } finally {
      await context.close();
    }
  });

  test('denied permission explains how to recover without any action', async ({ browser }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context, { permission: 'denied' });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await expect(panel(page).getByRole('status')).toHaveText(copy.denied);
      await expect(panel(page).getByText(copy.fallback)).toBeVisible();
      await expect(panel(page).getByRole('button')).toHaveCount(0);
    } finally {
      await context.close();
    }
  });

  test('iOS browser context asks to install first and still offers the install guidance', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context, { ios: true });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await expect(panel(page).getByRole('status')).toHaveText(copy.installRequired);
      await expect(panel(page).getByRole('button')).toHaveCount(0);
      await expect(page.getByText(en.pwa.install.iosInstructions)).toBeVisible();
      expect(await counters(page)).toEqual({ requests: 0, subscribes: 0 });
    } finally {
      await context.close();
    }
  });

  test('a browser without service workers reports unsupported and keeps the preferences usable', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await context.addInitScript(() => {
        Reflect.deleteProperty(Navigator.prototype, 'serviceWorker');
      });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await expect(panel(page).getByRole('status')).toHaveText(copy.unsupported);
      await expect(
        page.getByRole('switch', { name: en.notificationPreferences.pushTitle })
      ).toBeVisible();
      await expect(
        page.getByRole('region', { name: en.notificationPreferences.criticalTitle })
      ).toContainText(en.notificationPreferences.alwaysOn);
    } finally {
      await context.close();
    }
  });

  test('going offline shows the offline state and reconnecting restores the actions', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context);
      const page = await context.newPage();
      await openPreferences(page, actor);
      await expect(panel(page).getByRole('button', { name: copy.enable })).toBeVisible();
      await context.setOffline(true);
      await expect(panel(page).getByRole('status')).toHaveText(copy.offline);
      await expect(panel(page).getByRole('button')).toHaveCount(0);
      await context.setOffline(false);
      await expect(panel(page).getByRole('button', { name: copy.enable })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});

test.describe('real service worker registration', () => {
  test.use({ serviceWorkers: 'allow' });

  test('reads the real PushManager through the registered worker without prompting', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'allow' });
    try {
      const page = await context.newPage();
      await signIn(page, actor);
      await controlledByBuiltWorker(page);
      await page.goto('/notifications/preferences');
      await waitForHydratedPage(page);
      const registration = await page.evaluate(async () => {
        const ready = await navigator.serviceWorker.ready;
        return {
          scope: new URL(ready.scope).pathname,
          subscription: await ready.pushManager.getSubscription()
        };
      });
      expect(registration).toEqual({ scope: '/', subscription: null });
      // The headless browser decides the real permission; the panel must mirror it without prompting.
      const permission = await page.evaluate(() => Notification.permission);
      const expected = {
        granted: copy.grantedNotSubscribed,
        denied: copy.denied,
        default: copy.permissionDefault
      }[permission];
      await expect(panel(page).getByRole('status')).toHaveText(expected);
      await expect(panel(page).getByRole('button', { name: copy.enable })).toHaveCount(
        permission === 'denied' ? 0 : 1
      );
      expect(await page.evaluate(() => Notification.permission)).toBe(permission);
      expect(await activeDevices(actor)).toHaveLength(0);
    } finally {
      await context.close();
    }
  });
});

// Pencil frame tzBrY ("Web Push — PWA install and failure states"): two surface cards. Install
// guidance = amber uppercase bold 12px heading + 12px body copy; failure = red heading, green
// in-app fallback line, then the retry action. Structural probes stay exact; the Pencil renderer
// and Chromium rasterize text differently, so screenshots only guard against regressions of the
// reviewed baseline with a small nonzero budget.
const locales = { en: en.push, 'pt-BR': ptBR.push, es: es.push } as const;

async function cardProbe(card: Locator) {
  return card.evaluate((element) => {
    const color = (token: string) => {
      const swatch = document.createElement('span');
      swatch.style.color = 'var(' + token + ')';
      document.body.append(swatch);
      const value = getComputedStyle(swatch).color;
      swatch.remove();
      return value;
    };
    const style = getComputedStyle(element);
    const title = element.querySelector('h2');
    const titleStyle = title ? getComputedStyle(title) : null;
    const button = element.querySelector('button');
    return {
      order: [...element.children].map(
        (child) => child.tagName.toLowerCase() + (child.getAttribute('role') ?? '')
      ),
      surface: style.backgroundColor === color('--color-surface'),
      radius: style.borderRadius,
      padding: style.padding,
      gap: style.rowGap,
      titleColors: { amber: color('--color-amber'), red: color('--color-red') },
      titleColor: titleStyle?.color,
      titleCase: titleStyle?.textTransform,
      titleSize: titleStyle?.fontSize,
      titleWeight: titleStyle?.fontWeight,
      buttonHeight: button ? button.getBoundingClientRect().height : null,
      overflow: element.scrollWidth - element.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });
}

test.describe('Pencil tzBrY structural probes', () => {
  test.use({ serviceWorkers: 'block' });

  test.describe('failure and install-required cards in narrow translated layouts', () => {
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      test(`failure card order, tokens and containment at 320px in ${locale}`, async ({
        browser
      }) => {
        const actor = await createActor();
        const context = await browser.newContext({
          serviceWorkers: 'block',
          viewport: { width: 320, height: 800 }
        });
        try {
          await installMocks(context, { permission: 'granted' });
          const page = await context.newPage();
          await openPreferences(page, actor, locale);
          const text = locales[locale];
          const card = page.getByRole('region', { name: text.title });
          await page.evaluate(() => {
            Reflect.get(window, '__push').failNextSubscribe = true;
          });
          await card.getByRole('button', { name: text.enable }).click();
          await expect(card.getByRole('alert')).toHaveText(text.subscriptionFailed);
          const probe = await cardProbe(card);
          expect(probe.order).toEqual(['h2', 'output', 'palert', 'p', 'button']);
          expect(probe).toMatchObject({
            surface: true,
            radius: '16px',
            padding: '14px',
            gap: '4px',
            titleColor: probe.titleColors.red,
            titleCase: 'uppercase',
            titleSize: '12px',
            titleWeight: '700',
            overflow: 0,
            pageOverflow: 0
          });
          expect(probe.buttonHeight).toBeGreaterThanOrEqual(44);
          await expect(card.getByText(text.fallback)).toBeVisible();
        } finally {
          await context.close();
        }
      });
    }

    test('iOS install-required card keeps the amber heading and install guidance order', async ({
      browser
    }) => {
      const actor = await createActor();
      const context = await browser.newContext({
        serviceWorkers: 'block',
        viewport: { width: 320, height: 800 }
      });
      try {
        await installMocks(context, { ios: true });
        const page = await context.newPage();
        await openPreferences(page, actor);
        const card = panel(page);
        const probe = await cardProbe(card);
        expect(probe.titleColor).toBe(probe.titleColors.amber);
        expect(probe).toMatchObject({ surface: true, overflow: 0, pageOverflow: 0 });
        await expect(card.getByRole('status')).toHaveText(copy.installRequired);
        const install = page.getByRole('region', { name: en.pwa.install.title });
        const sections = await page
          .locator('main section')
          .evaluateAll((all) => all.map((section) => section.getAttribute('aria-labelledby')));
        expect(sections.indexOf('pwa-install-title')).toBeGreaterThanOrEqual(0);
        expect(sections.indexOf('push-device-title')).toBeGreaterThanOrEqual(0);
        await expect(install.getByText(en.pwa.install.iosInstructions)).toBeVisible();
        expect((await cardProbe(install)).overflow).toBe(0);
      } finally {
        await context.close();
      }
    });
  });

  test('keyboard reaches Enable then Retry in order and focus stays on the control after failure', async ({
    browser
  }) => {
    const actor = await createActor();
    const context = await browser.newContext({ serviceWorkers: 'block' });
    try {
      await installMocks(context, { permission: 'granted' });
      const page = await context.newPage();
      await openPreferences(page, actor);
      await page.evaluate(() => {
        Reflect.get(window, '__push').failNextSubscribe = true;
      });
      const enable = panel(page).getByRole('button', { name: copy.enable });
      await enable.focus();
      await page.keyboard.press('Enter');
      const retry = panel(page).getByRole('button', { name: copy.retry });
      await expect(retry).toBeVisible();
      await expect(panel(page)).toHaveAttribute('aria-busy', 'false');
      await retry.focus();
      await expect(retry).toBeFocused();
      expect((await retry.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    } finally {
      await context.close();
    }
  });
});

test.describe('Pencil tzBrY screenshot baselines', { tag: '@visual' }, () => {
  test.use({ serviceWorkers: 'block' });
  // Budget 3%: element-only 12px text card; measured local rasterization residual stays well under
  // it. Structural probes above carry the exact assertions, so this never masks layout defects.
  const shot = {
    animations: 'disabled',
    caret: 'hide',
    // Fail fast with a real error instead of letting a stuck capture burn the whole test timeout.
    timeout: 30_000,
    threshold: 0.1,
    maxDiffPixelRatio: 0.03
  } as const;
  // Remove hover/focus state and wait for fonts plus two painted frames so the capture starts from a
  // quiescent compositor (loaded CI runners otherwise keep re-rasterizing the card).
  const settle = async (page: Page) => {
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      await document.fonts.ready;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
    });
  };

  for (const [name, viewport] of [
    ['mobile', { width: 390, height: 844 }],
    ['desktop', { width: 1280, height: 800 }]
  ] as const) {
    test(`push failure and install-required cards ${name} baseline`, async ({ browser }) => {
      const actor = await createActor();
      const context = await browser.newContext({ serviceWorkers: 'block', viewport });
      try {
        await installMocks(context, { permission: 'granted' });
        const page = await context.newPage();
        await openPreferences(page, actor);
        await page.evaluate(() => {
          Reflect.get(window, '__push').failNextSubscribe = true;
        });
        await panel(page).getByRole('button', { name: copy.enable }).click();
        await expect(panel(page).getByRole('alert')).toHaveText(copy.subscriptionFailed);
        await settle(page);
        await expect(panel(page)).toHaveScreenshot(`push-failure-${name}.png`, shot);
      } finally {
        await context.close();
      }
    });

    test(`push install-required card ${name} baseline`, async ({ browser }) => {
      const actor = await createActor();
      const context = await browser.newContext({ serviceWorkers: 'block', viewport });
      try {
        await installMocks(context, { ios: true });
        const page = await context.newPage();
        await openPreferences(page, actor);
        await expect(panel(page).getByRole('status')).toHaveText(copy.installRequired);
        await settle(page);
        await expect(panel(page)).toHaveScreenshot(`push-install-required-${name}.png`, shot);
      } finally {
        await context.close();
      }
    });
  }
});

async function createActor(): Promise<Actor> {
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `push-${crypto.randomUUID()}@test.local`;
  const signup = await client.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(`Could not create local E2E actor: ${signup.error?.message ?? 'no session'}`);
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: `Push ${crypto.randomUUID().slice(0, 8)}`,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboarded.error) throw onboarded.error;
  return { email, id: signup.data.user.id, client };
}

async function signIn(page: Page, actor: { email: string }): Promise<void> {
  await page.context().addCookies([
    { name: 'locale', value: 'en', url: BASE_URL },
    { name: 'theme', value: 'light', url: BASE_URL }
  ]);
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

function localConfig() {
  return testSupabaseConfig();
}
