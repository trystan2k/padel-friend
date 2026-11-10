import { expect, test, type Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { waitForHydratedPage } from './auth-helpers';
import { copies, fixtures, sql, type Actor } from './matches-management-fixtures';

const BASE_URL = 'http://127.0.0.1:4173';

function localeCopy(locale: string): {
  auth: { welcomeTitle: string; loginSubmit: string; or: string; accountPrompt: string };
} {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
}

test('anonymous root redirects server-side to localized login, without public demo content', async ({
  request,
  page
}) => {
  const response = await request.get('/', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(response.status());
  expect(new URL(response.headers()['location']!, BASE_URL).pathname).toBe('/login');
  expect(response.headers()['cache-control']).toBe('private, no-store');

  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const login = await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(await login?.text()).toContain(copy.auth.welcomeTitle);
    await expect(page.getByRole('heading', { name: copy.auth.welcomeTitle })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByText(copy.auth.or, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.auth.accountPrompt)).toBeVisible();
  }
});

test('login controls retain design typography across themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'theme', value: theme, url: BASE_URL }]);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeVisible();
    expect(await submit.evaluate((element) => getComputedStyle(element).fontSize)).toBe('13px');
  }
});

test('OAuth callback rejects missing or denied codes without redirecting off-site', async ({
  request,
  page
}) => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe(`${BASE_URL}/login?authError=1`);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  }

  await page.goto('/login?authError=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Google sign-in was not completed. Please try again.')).toBeVisible();
});

test.describe('Google sign-in OAuth failure handling', () => {
  test.use({ serviceWorkers: 'block' });

  test('OAuth start targets Google PKCE authorization and stays disabled while navigation is held', async ({
    page
  }) => {
    let authorizeAttempts = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/auth/v1/authorize**', async (route) => {
      authorizeAttempts += 1;
      await held;
      await route.abort();
    });
    const samples: boolean[] = [];
    let sampling = false;
    page.on('console', (message) => {
      if (sampling && message.text().startsWith('pf-google-disabled:'))
        samples.push(message.text() === 'pf-google-disabled:true');
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
    const request = page.waitForRequest('**/auth/v1/authorize**');
    const click = page.getByRole('button', { name: 'Continue with Google' }).click();
    const authorize = new URL((await request).url());
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    const callback = new URL(authorize.searchParams.get('redirect_to')!);
    expect(callback.origin).toBe(BASE_URL);
    expect(callback.pathname).toBe('/auth/callback');
    sampling = true;
    await expect.poll(() => samples.length).toBeGreaterThanOrEqual(10);
    expect(samples.every(Boolean)).toBe(true);
    expect(authorizeAttempts).toBe(1);
    release();
    await click;
  });

  test('failed OAuth initialization displays translated error and allows retry', async ({
    page
  }) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (!descriptor?.get || !descriptor.set) return;
      const get = descriptor.get.bind(document);
      const set = descriptor.set.bind(document);
      Object.defineProperty(document, 'cookie', {
        get: () => get(),
        set(value: string) {
          if (value.includes('-code-verifier=')) throw new TypeError('cookie storage unavailable');
          set(value);
        }
      });
    });
    await page.goto('/login');
    await waitForHydratedPage(page);
    const google = page.getByRole('button', { name: 'Continue with Google' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await google.click();
      await expect(
        page.getByText('Google sign-in was not completed. Please try again.')
      ).toBeVisible();
      await expect(google).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe('/login');
    }
  });
});

// Selected-community Home: URL-backed context, deterministic default membership, generic
// fallback for a stale selection and no private names for non-members.
test.describe('community Home', () => {
  const home = copies.en.home;
  test.use({ serviceWorkers: 'block' });
  test.describe.configure({ mode: 'serial' });

  let f: Awaited<ReturnType<typeof fixtures>>;
  let member: Actor;
  let second: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    f = await fixtures(browser, { memberCount: 2, communityName: 'Home Alpha Club' });
    member = f.members[0]!;
    const created = await f.creator.client.rpc('create_community', {
      p_name: 'Home Beta Club',
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    if (created.error || typeof created.data !== 'string')
      throw created.error ?? new Error('No second community');
    second = created.data;
    const joined = await member.client.rpc('join_public_community', { p_community_id: second });
    if (joined.error) throw joined.error;
    await f.event(2);
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    if (second)
      await sql(`do $$ begin
        lock table public.communities in share row exclusive mode;
        alter table public.community_members disable trigger community_member_guard;
        delete from public.notifications where community_id='${second}';
        delete from public.community_members where community_id='${second}';
        delete from public.community_audit_log where community_id='${second}';
        delete from public.communities where id='${second}';
        alter table public.community_members enable trigger community_member_guard;
      end $$`);
    await f?.cleanup();
  });
  test.beforeEach(() => {
    test.setTimeout(90_000);
  });

  test('defaults to the first membership, shows its next match and switches by keyboard', async () => {
    const page = await f.page(member);
    const switcher = page.getByRole('combobox', { name: new RegExp(home.switcherLabel) });
    await expect(switcher).toContainText('Home Alpha Club');
    const next = page.getByRole('region', { name: home.nextMatch.title });
    await expect(
      next
        .getByRole('heading', { level: 4 })
        .getByRole('link', { name: 'Management court', exact: true })
    ).toBeVisible();

    await switcher.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Home Beta Club' }).click();
    await expect(page).toHaveURL(new RegExp(`/dashboard\\?community=${second}$`));
    await expect(switcher).toContainText('Home Beta Club');
    await expect(next.getByText(home.nextMatch.empty)).toBeVisible();
    await expect(next.getByRole('link', { name: 'Management court' })).toHaveCount(0);

    // Deep link and reload keep the selected community.
    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('combobox', { name: new RegExp(home.switcherLabel) })
    ).toContainText('Home Beta Club');
    await page.goBack();
    await expect(
      page.getByRole('combobox', { name: new RegExp(home.switcherLabel) })
    ).toContainText('Home Alpha Club');
  });

  test('a stale or foreign selection falls back without naming any community', async () => {
    const page = await f.page(member);
    await page.goto(`/dashboard?community=${crypto.randomUUID()}`);
    await waitForHydratedPage(page);
    await expect(page.getByText(home.selectionUnavailable)).toBeVisible();
    await expect(
      page.getByRole('combobox', { name: new RegExp(home.switcherLabel) })
    ).toContainText('Home Alpha Club');
  });

  test('a player without a community is offered discovery and sees no community data', async () => {
    const page = await f.page(f.guest);
    await page.goto(`/dashboard?community=${f.community}`);
    await waitForHydratedPage(page);
    await expect(page.getByRole('link', { name: home.noCommunity.action })).toBeVisible();
    await expect(page.getByText('Home Alpha Club')).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: new RegExp(home.switcherLabel) })).toHaveCount(
      0
    );
  });

  test('keeps profile, community and notification entries and gives every nav item a target', async () => {
    const page = await f.page(member);
    await expect(page.getByRole('link', { name: /Notifications/ })).toBeVisible();
    const nav = page.getByRole('navigation', { name: copies.en.matches.results.navigation });
    for (const key of ['home', 'matches', 'community', 'ranking', 'profile'] as const)
      await expect(
        nav.getByRole('link', { name: copies.en.matches.results.nav[key] })
      ).toBeVisible();
    await nav.getByRole('link', { name: copies.en.matches.results.nav.ranking }).click();
    await expect(page.locator('#home-ranking')).toBeVisible();
    for (const link of await nav.getByRole('link').all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });

  test('keeps the bottom navigation visible at the top and after scrolling to the end', async () => {
    const page = await f.page(member);
    const nav = page.getByRole('navigation', { name: copies.en.matches.results.navigation });
    const viewport = page.viewportSize();
    const withinViewport = async () => {
      const box = await nav.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height);
    };
    await page.evaluate(() => window.scrollTo(0, 0));
    await withinViewport();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await withinViewport();
    await expect(nav).toBeVisible();
  });

  test('gives every Home text link a 44px target in both dimensions', async () => {
    const page = await f.page(member);
    for (const link of await page
      .locator('#home-actions a, #home-next-match a, #home-ranking a')
      .all()) {
      const box = await link.boundingBox();
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
  });
});

// --- F28: Home structural + visual regression evidence -------------------------------------
// Pencil frames hKncV (mobile) and AlfRD (desktop): header title/subtitle/bell, level hero,
// attention cards, next-match card, ranking, activity and the fixed bottom navigation. Two layers:
//  1. exact structural probes over live DOM rectangles (strict, never relaxed): containment, order,
//     no overlap, no text clipping, >=44px targets, fixed nav visible at top and end of scroll;
//  2. screenshot references (viewport) per theme x viewport x translated locale. Pixels are only a
//     regression net: the header date is normalised (it changes daily) and the budget below is
//     deliberately non-zero for cross-platform font rasterization. The residual against the stored
//     reference is measured and logged on every run ("PAF-16 Home residual ...") so the budget
//     stays an evidenced number; it must never be raised to hide a structural defect.
// Tagged @visual: excluded from the fast lane (VISUAL_GREP), part of the full pnpm test:e2e gate.
//
// Tolerance evidence (F41):
//  - Structure is carried by the strict DOM-geometry probes above; they are renderer-independent
//    and never relaxed. The pixel budget is not a structural gate.
//  - The 1% budget exists solely to absorb font-rasterization drift within the supported CI
//    renderer (one pinned Chromium config, raster flags fixed in playwright.config.ts).
//  - Measured Chromium residuals against the stored references (2026-11-10): home-mobile-light 0,
//    home-mobile-dark 0, home-desktop-light 0, home-desktop-dark 0, home-mobile-pt-br 0,
//    home-mobile-es 0. The budget is a ceiling over a measured zero.
//  - Cross-renderer (WebKit/Firefox) residuals: not measured (unavailable in the verification
//    environment: no non-Chromium Playwright project is configured). Cross-renderer pixel equality
//    (including Pencil vs Chromium font rasterization) is explicitly out of scope per AGENTS.md.
//  - Keep at 0.01 unless new measured evidence justifies a change; never widen it to mask a defect.

/** Measured: same-renderer residual is 0 with the pinned Chromium flags; 0.01 absorbs font raster drift. */
const HOME_VISUAL_BUDGET = 0.01;
const NORMALIZED_DATE = 'Fixed day · UTC';

async function homeStructureFailures(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const failures: string[] = [];
    const doc = document.documentElement;
    const rect = (element: Element) => element.getBoundingClientRect();
    const visible = (element: Element | null): element is Element => {
      if (!element) return false;
      const box = rect(element);
      const style = getComputedStyle(element);
      return box.width > 0 && box.height > 0 && style.visibility !== 'hidden';
    };
    if (doc.scrollWidth - doc.clientWidth > 0)
      failures.push('horizontal overflow ' + (doc.scrollWidth - doc.clientWidth) + 'px');

    // Header: title, subtitle(s) stacked, bell beside or below, all contained.
    const title = document.querySelector('#home-top h1');
    if (document.querySelectorAll('#home-top h1').length !== 1) failures.push('expected one h1');
    const titles = title?.parentElement ?? null;
    const headerRow = titles?.parentElement ?? null;
    const bell = headerRow?.querySelector('a[href="/notifications"]') ?? null;
    const dateLine = titles?.querySelector('time') ?? null;
    const communityLine = titles?.querySelector('p') ?? null;
    if (!visible(title) || !visible(dateLine) || !visible(communityLine) || !visible(bell))
      failures.push('header title/date/community/bell must all be visible');
    else if (titles && headerRow) {
      if (rect(dateLine).top < rect(title).bottom - 0.5) failures.push('date overlaps title');
      if (rect(communityLine).top < rect(dateLine).bottom - 0.5)
        failures.push('community line overlaps date');
      const side = rect(bell).left >= rect(titles).right - 0.5;
      const below = rect(bell).top >= rect(titles).bottom - 0.5;
      if (!side && !below) failures.push('bell overlaps title block');
      if (rect(bell).width < 44 || rect(bell).height < 44)
        failures.push('bell target ' + rect(bell).width + 'x' + rect(bell).height);
    }

    // The app-wide language/theme chips are absolutely positioned over the page's top right; no
    // header text or target may sit under them (PAF-16 F28: the title was covered at 390px).
    const chips = document.querySelector('#locale')?.closest('div') ?? null;
    if (visible(chips))
      for (const [name, element] of [
        ['title', title],
        ['date', dateLine],
        ['community', communityLine],
        ['bell', bell]
      ] as const) {
        if (!element) continue;
        const a = rect(element);
        const b = rect(chips);
        if (
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5
        )
          failures.push(name + ' is covered by the language/theme controls');
      }

    // Level hero: below the header, carries the level figure.
    const heroHeading = document.querySelector('#home-level-heading');
    const hero = heroHeading?.closest('section') ?? null;
    if (!visible(hero) || !visible(hero.querySelector('strong')))
      failures.push('level hero with level figure must be visible');
    else if (headerRow && rect(hero).top < rect(headerRow).bottom - 0.5)
      failures.push('level hero overlaps header');

    // Home sections: ordered, non-overlapping, contained.
    const sectionIds = ['home-actions', 'home-next-match', 'home-ranking', 'home-activity'];
    let previous: Element | null = hero;
    for (const id of sectionIds) {
      const section = document.getElementById(id);
      if (!visible(section)) {
        failures.push(id + ' must be visible');
        continue;
      }
      if (previous && rect(section).top < rect(previous).bottom - 0.5)
        failures.push(id + ' overlaps or precedes the previous block');
      previous = section;
    }

    // Attention cards (reserve standby fixture) and next-match card.
    const attention = [...document.querySelectorAll('#home-actions li')];
    if (attention.length < 1) failures.push('no attention cards');
    for (const card of attention) {
      if (!visible(card)) failures.push('attention card hidden');
      const link = card.querySelector('a');
      if (!visible(link) || rect(link).width < 44 || rect(link).height < 44)
        failures.push('attention card link under 44px');
    }
    const next = document.querySelector('#home-next-match article');
    if (!visible(next) || !visible(next.querySelector('h3 a')))
      failures.push('next-match card with venue link must be visible');

    // Containment, text clipping and 44px links across the whole Home block.
    const home = document.getElementById('home-top');
    for (const element of home?.querySelectorAll('*') ?? []) {
      if (!visible(element)) continue;
      const box = rect(element);
      const name =
        element.tagName.toLowerCase() + '"' + (element.textContent ?? '').trim().slice(0, 24) + '"';
      if (box.right > doc.clientWidth + 0.5 || box.left < -0.5) failures.push('escaped ' + name);
      const style = getComputedStyle(element);
      if (
        element.children.length === 0 &&
        (element.textContent ?? '').trim() !== '' &&
        ((/(hidden|clip)/.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) ||
          (/(hidden|clip)/.test(style.overflowY) &&
            element.scrollHeight > element.clientHeight + 1))
      )
        failures.push('clipped ' + name);
      if (element.tagName === 'A' && (box.width < 44 || box.height < 44))
        failures.push(
          'small link ' + name + ' ' + Math.round(box.width) + 'x' + Math.round(box.height)
        );
    }

    // Fixed bottom navigation: five targets, viewport-fixed, centered, visible at top and at end.
    const nav = document.querySelector('main > nav');
    if (!nav) return [...failures, 'no bottom navigation'];
    if (getComputedStyle(nav).position !== 'fixed') failures.push('nav is not position:fixed');
    const links = [...nav.querySelectorAll('a')];
    if (links.length !== 5) failures.push('nav expected 5 links, found ' + links.length);
    for (const link of links)
      if (rect(link).height < 44 || rect(link).width < 44)
        failures.push(
          'nav target ' + Math.round(rect(link).width) + 'x' + Math.round(rect(link).height)
        );
    const navBox = () => rect(nav);
    const inViewport = (label: string) => {
      const box = navBox();
      if (box.top < 0 || box.bottom > window.innerHeight + 0.5)
        failures.push('nav outside viewport ' + label);
      if (box.left < -0.5 || box.right > doc.clientWidth + 0.5)
        failures.push('nav escapes horizontally ' + label);
      if (Math.abs((box.left + box.right) / 2 - doc.clientWidth / 2) > 1)
        failures.push('nav not centered ' + label);
    };
    window.scrollTo(0, 0);
    inViewport('at top');
    window.scrollTo(0, doc.scrollHeight);
    inViewport('at end');
    const community = document.getElementById('home-community');
    if (community && rect(community).bottom > navBox().top + 0.5)
      failures.push('content is covered by the nav at the end of the page');
    window.scrollTo(0, 0);
    return failures;
  });
}

/** Share of pixels that differ from the stored reference (same YIQ metric as Playwright). */
async function residualAgainst(page: Page, actual: Buffer, reference: Buffer): Promise<number> {
  return page.evaluate(
    async ({ actualUrl, referenceUrl }) => {
      const load = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const [a, b] = await Promise.all([load(actualUrl), load(referenceUrl)]);
      if (a.width !== b.width || a.height !== b.height) return 1;
      let changed = 0;
      for (let index = 0; index < a.data.length; index += 4) {
        const red = a.data[index]! - b.data[index]!;
        const green = a.data[index + 1]! - b.data[index + 1]!;
        const blue = a.data[index + 2]! - b.data[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.2 ** 2
        )
          changed++;
      }
      return changed / (a.width * a.height);
    },
    {
      actualUrl: 'data:image/png;base64,' + actual.toString('base64'),
      referenceUrl: 'data:image/png;base64,' + reference.toString('base64')
    }
  );
}

test.describe('Home structure and visual regression @visual', () => {
  test.use({ serviceWorkers: 'block' });
  test.describe.configure({ mode: 'serial' });

  let f: Awaited<ReturnType<typeof fixtures>>;
  let player: Actor;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    f = await fixtures(browser, { memberCount: 5, communityName: 'Home Visual Club' });
    player = f.members[4]!;
    // Five registrations on an uncapped event: four play, the fifth is Reserve and raises an attention card.
    await f.event(6);
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await f?.cleanup();
  });
  test.beforeEach(() => {
    test.setTimeout(120_000);
  });

  const configs = [
    { locale: 'en', theme: 'light', width: 390, height: 844, shot: 'home-mobile-light' },
    { locale: 'en', theme: 'dark', width: 390, height: 844, shot: 'home-mobile-dark' },
    { locale: 'en', theme: 'light', width: 1280, height: 900, shot: 'home-desktop-light' },
    { locale: 'en', theme: 'dark', width: 1280, height: 900, shot: 'home-desktop-dark' },
    { locale: 'pt-BR', theme: 'light', width: 390, height: 844, shot: 'home-mobile-pt-br' },
    { locale: 'es', theme: 'light', width: 390, height: 844, shot: 'home-mobile-es' },
    { locale: 'pt-BR', theme: 'light', width: 320, height: 700 },
    { locale: 'es', theme: 'light', width: 320, height: 700 },
    { locale: 'pt-BR', theme: 'dark', width: 1280, height: 900 },
    { locale: 'es', theme: 'dark', width: 1280, height: 900 }
  ] as const;

  for (const config of configs) {
    test(
      'Home matches the Pencil composition: ' +
        config.locale +
        ' ' +
        config.theme +
        ' ' +
        config.width,
      async () => {
        const page = await f.page(player, config.locale, config.width, config.theme, config.height);
        await expect(page.locator('html')).toHaveAttribute('data-theme', config.theme);
        await expect(page.locator('#home-actions li').first()).toBeVisible();
        await expect(page.locator('#home-next-match article').first()).toBeVisible();
        await expect(page.getByRole('heading', { level: 1 })).toContainText(player.name);
        await expect(page.locator('#home-top h1 + time')).toContainText('UTC');

        const failures = await homeStructureFailures(page);
        expect(failures, failures.join('\n')).toEqual([]);

        if (!('shot' in config)) return;
        await page.evaluate((text) => {
          // Header date and activity days follow the wall clock; fixture match times are fixed.
          for (const time of document.querySelectorAll('#home-top h1 + time, #home-activity time'))
            time.textContent = text;
        }, NORMALIZED_DATE);
        await page.evaluate(() => window.scrollTo(0, 0));
        const name = config.shot + '.png';
        const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
        const referencePath = test.info().snapshotPath(name);
        if (existsSync(referencePath)) {
          const measured = await residualAgainst(page, actual, readFileSync(referencePath));
          console.info('PAF-16 Home residual ' + config.shot + ': ' + measured);
        }
        await expect(page).toHaveScreenshot(name, { maxDiffPixelRatio: HOME_VISUAL_BUDGET });
      }
    );
  }
});
