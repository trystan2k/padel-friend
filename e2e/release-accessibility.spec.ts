import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  copies,
  resultFixtures,
  openRecord,
  correctTeams,
  enterScore,
  review
} from './matches-results-fixtures';
import { day, leagueFixtures } from './leagues-fixtures';

const baseURL = 'http://127.0.0.1:4173';
const target = 44;

/** Real computed geometry, never source-string or screenshot-only target proof. */
async function auditControls(page: Page) {
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true
  );
  const controls = page.locator(
    'a[href], button, input:not([type=hidden]):not([aria-hidden=true][tabindex="-1"]), select, textarea, [role=combobox], [role=switch], summary'
  );
  for (const control of await controls.all()) {
    if (!(await control.isVisible())) continue;
    await expect(control).toHaveAccessibleName(/\S/);
    const geometry = await control.evaluate((element) => {
      // Native checkboxes/radios include their explicitly associated clickable label.
      const label =
        element instanceof HTMLInputElement && ['checkbox', 'radio'].includes(element.type)
          ? element.labels?.[0]
          : null;
      const box = (label ?? element).getBoundingClientRect();
      return { width: box.width, height: box.height, html: element.outerHTML.slice(0, 180) };
    });
    expect(geometry.width, geometry.html).toBeGreaterThanOrEqual(target);
    expect(geometry.height, geometry.html).toBeGreaterThanOrEqual(target);
  }
}

async function bypass(page: Page, name: string) {
  const skip = page.getByRole('link', { name });
  await skip.focus();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
}

for (const locale of ['en', 'pt-BR', 'es'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`login bypass, names, targets and 400% equivalent reflow — ${locale} ${theme}`, async ({
      page
    }) => {
      await page.context().addCookies([
        { name: 'locale', value: locale, url: baseURL },
        { name: 'theme', value: theme, url: baseURL }
      ]);
      // 1280 CSS px at 400% yields a 320 CSS px layout viewport. This is a reflow
      // probe, not a substitute for actual browser zoom / screen-reader walkthrough.
      for (const width of [1280, 640, 320]) {
        await page.setViewportSize({ width, height: 900 });
        await page.goto('/login');
        await waitForHydratedPage(page);
        await bypass(page, copies[locale].accessibility.skipToContent);
        await auditControls(page);
        await expect(page.getByLabel(copies[locale].auth.loginPasswordLabel)).toHaveAttribute(
          'autocomplete',
          'current-password'
        );
      }
    });
  }
}

test.describe('authorized primary-flow accessibility', () => {
  test.describe.configure({ mode: 'serial' });
  let f: Awaited<ReturnType<typeof resultFixtures>>;
  let completed: string;
  let upcoming: string;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    f = await resultFixtures(browser, { memberCount: 8 });
    completed = await f.completedEvent();
    upcoming = await f.event(9);
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await f?.cleanup();
  });

  test('Home, discovery, registration/Reserve, creation, rating, preferences and authorized diagnostics', async () => {
    test.setTimeout(240_000);
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const page = await f.page(f.creator, locale, 320, locale === 'es' ? 'dark' : 'light');
      for (const path of [
        '/dashboard',
        '/onboarding/community',
        '/matches/create',
        `/matches/${upcoming}`,
        `/players/${f.creator.id}`,
        '/notifications',
        '/notifications/preferences',
        `/community/${f.community}/repairs`
      ]) {
        await test.step(`${locale} ${path}`, async () => {
          await page.goto(path);
          await waitForHydratedPage(page);
          await bypass(page, copies[locale].accessibility.skipToContent);
          for (const width of [1280, 640, 320]) {
            await page.setViewportSize({ width, height: 900 });
            await auditControls(page);
          }
          if (path === '/dashboard') {
            const copy = copies[locale];
            const date = page.locator('#home-top > div:first-child time');
            await expect(date).toBeVisible();
            const asOf = await date.getAttribute('datetime');
            expect(asOf).not.toBeNull();
            // F27: the Home date is the labeled UTC calendar day, never passed off as local.
            await expect(date).toHaveText(
              `${new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
                new Date(asOf!)
              )} · UTC`
            );
            const hero = page.getByRole('region', { name: copy.profile.globalLevel, exact: true });
            await expect(hero.getByRole('heading', { level: 2 })).toHaveText(
              copy.profile.globalLevel
            );
            await expect(hero.locator('strong')).toHaveText(/\d/);
            await expect(hero).toContainText(copy.profile.reliability);
            expect(await date.evaluate((element) => Boolean(element.closest('main')))).toBe(true);
            expect(
              await hero.evaluate((element) =>
                Boolean(
                  element.compareDocumentPosition(
                    document.querySelector('#home-top > div:first-child time')!
                  ) & Node.DOCUMENT_POSITION_PRECEDING
                )
              )
            ).toBe(true);
          }
        });
      }
      await page.context().close();
    }
  });

  test('teams and unfinished score preview retain names, keyboard focus and text outcome', async () => {
    test.setTimeout(120_000);
    const page = await f.page(f.creator);
    await openRecord(page, completed);
    await correctTeams(page);
    await auditControls(page);
    await enterScore(page);
    await auditControls(page);
    await review(page);
    await auditControls(page);
    const copy = copies.en.matches.results;
    await expect(page.getByRole('heading', { name: copy.preview, exact: true })).toBeVisible();
    // The fixture's third set is unfinished. Text remains available independent of colour.
    await expect(page.getByText(copy.outcome.draw, { exact: true })).toBeVisible();
    await page.context().close();
  });
});

test('selected League close dialog traps focus, dismisses and returns focus', async ({
  browser
}) => {
  test.setTimeout(180_000);
  const f = await leagueFixtures(browser);
  try {
    const id = await f.createLeague(f.creator, { endMode: 'manual', start: day(0) });
    const page = await f.page(f.creator, 'pt-BR', 320, 'dark');
    await page.goto(`/community/${f.community}/leagues/${id}`);
    await waitForHydratedPage(page);
    await auditControls(page);
    const close = page.getByRole('button', {
      name: copies['pt-BR'].leagues.detail.close,
      exact: true
    });
    await close.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press(index % 2 ? 'Shift+Tab' : 'Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
        true
      );
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(close).toBeFocused();
  } finally {
    await f.cleanup();
  }
});
