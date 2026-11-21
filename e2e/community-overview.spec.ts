import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, leagueFixtures } from './leagues-fixtures';

const club = 'Northside Padel Club';
const en = copies.en;
const minTarget = 44;
const screenshotOptions = { animations: 'disabled', maxDiffPixelRatio: 0.01 } as const;

async function probe(page: Page, selectors: string[]) {
  const failures = await page.evaluate(
    ({ selectors: ordered, minTarget: minimum }) => {
      const elements = ordered.map((selector) => document.querySelector(selector));
      if (elements.some((element) => element === null)) return ['Missing required region'];
      const issues: string[] = [];
      for (let i = 1; i < elements.length; i++) {
        if (
          elements[i]!.getBoundingClientRect().top <
          elements[i - 1]!.getBoundingClientRect().bottom - 0.5
        )
          issues.push(ordered[i]! + ' overlaps or precedes the previous region');
      }
      const links = document.querySelectorAll(
        '[data-community-view] nav a, [data-community-view] header a, [data-community-view] [role="combobox"]'
      );
      for (const link of links) {
        const bounds = link.getBoundingClientRect();
        if (bounds.height < minimum || bounds.width < minimum)
          issues.push('Small target: ' + link.textContent);
        if (bounds.left < 0 || bounds.right > document.documentElement.clientWidth + 0.5)
          issues.push('Target outside viewport: ' + link.textContent);
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth)
        issues.push('Horizontal document overflow');
      return issues;
    },
    { selectors, minTarget }
  );
  expect(failures, failures.join('\n')).toEqual([]);
}

test.describe('Community overview and ranking', () => {
  test.describe.configure({ mode: 'serial' });
  let f: Awaited<ReturnType<typeof leagueFixtures>>;
  let leagueId: string;
  const path = () => `/community/${f.community}`;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    f = await leagueFixtures(browser, {
      communityName: club,
      creatorName: 'Club Admin',
      memberNames: ['Thiago Ribeiro'],
      memberCount: 1
    });
    leagueId = await f.createLeague(f.creator, { name: 'Club league', start: day(0) });
  });

  test.afterAll(async () => {
    test.setTimeout(120_000);
    await f?.cleanup();
  });

  test(
    'overview follows Ex7RD, uses real counts and points to existing Leagues',
    { tag: '@visual' },
    async () => {
      test.setTimeout(90_000);
      const page = await f.page(f.members[0]!);
      const communityNav = page
        .getByRole('navigation', { name: en.appShell.navigation })
        .getByRole('link', { name: en.appShell.nav.community });
      await expect(communityNav).toHaveAttribute('href', '/community');
      await communityNav.click();
      const sections = page.getByRole('navigation', { name: en.communitySurface.navigation });
      await expect(sections.getByRole('link')).toHaveText([
        en.communitySurface.overview,
        en.home.ranking.title,
        en.communitySurface.leagues
      ]);
      await expect(
        sections.getByRole('link', { name: en.communitySurface.overview })
      ).toHaveAttribute('aria-current', 'page');
      await expect(
        sections.getByRole('link', { name: en.communitySurface.leagues })
      ).toHaveAttribute('href', path() + '/leagues');
      await expect(communityNav).toHaveAttribute('aria-current', 'page');
      const summary = page.locator('[data-community-summary]');
      await expect(summary.locator('dd')).toHaveText(['2', en.communitySurface.unavailable]);
      await expect(page.getByText(en.communitySurface.joinCountUnavailable)).toBeVisible();
      await expect(page.getByRole('region', { name: en.home.activity.title })).toBeAttached();
      await expect(page.locator('[data-rank-row]')).toHaveCount(0);
      await probe(page, [
        '[data-community-view] header',
        '[data-community-view] nav',
        '[data-community-summary]',
        'section[aria-labelledby="community-upcoming"]'
      ]);
      await expect(page).toHaveScreenshot('overview-light.png', screenshotOptions);
    }
  );

  test(
    'cold ranking deep link renders y4Zeg without a dashboard flash; standings stay separate',
    { tag: '@visual' },
    async () => {
      test.setTimeout(90_000);
      const page = await f.page(f.members[0]!);
      await page.addInitScript(() => {
        const mark = () => {
          if (document.getElementById('home-top'))
            document.documentElement.setAttribute('data-home-flashed', '');
        };
        new MutationObserver(mark).observe(document, { childList: true, subtree: true });
        mark();
      });
      const response = await page.goto(path() + '/ranking');
      expect(response?.ok()).toBe(true);
      const html = await response!.text();
      expect(html).toContain('data-community-view="ranking"');
      expect(html).not.toContain('id="home-top"');
      await waitForHydratedPage(page);
      await expect(page.locator('html[data-home-flashed]')).toHaveCount(0);
      await expect(
        page.locator('nav[data-app-nav]').getByRole('link', { name: en.appShell.nav.community })
      ).toHaveAttribute('aria-current', 'page');
      const skill = page.locator('[data-rank-row="skill"]');
      await expect(skill).toHaveCount(1);
      await expect(skill).toHaveAttribute('data-rank-self', 'true');
      await expect(skill).toContainText(en.communitySurface.provisional);
      await expect(page.getByText(en.communitySurface.skillListUnavailable)).toBeVisible();
      await expect(page.locator('[data-rank-row="league"]')).toHaveCount(0);
      await probe(page, [
        '[data-community-view] header',
        '[data-community-view] > nav',
        'section[aria-label="Ranking"] nav',
        '[data-rank-row="skill"]'
      ]);
      await expect(page).toHaveScreenshot('ranking-light.png', screenshotOptions);
      const kinds = page.getByRole('navigation', { name: en.communitySurface.rankingKind });
      await kinds.getByRole('link', { name: en.communitySurface.league }).click();
      await expect(page).toHaveURL(/\/ranking\?by=league$/);
      await expect(
        kinds.getByRole('link', { name: en.communitySurface.skill })
      ).not.toHaveAttribute('aria-current', 'page');
      await expect(kinds.getByRole('link', { name: en.communitySurface.league })).toHaveAttribute(
        'aria-current',
        'page'
      );
      await expect(page.locator('[data-rank-row="skill"]')).toHaveCount(0);
      const rows = page.locator('[data-rank-row="league"]');
      await expect(rows.first()).toBeVisible();
      await expect(rows.locator('span').last()).toContainText('0W 0L');
      await expect(page.getByRole('link', { name: 'League: Club league' })).toHaveAttribute(
        'href',
        path() + '/leagues/' + leagueId
      );
    }
  );

  for (const [locale, width] of [
    ['pt-BR', 320],
    ['es', 1280]
  ] as const) {
    test(`dark ${locale} ${width}px preserves targets, keyboard focus and authorization`, async () => {
      test.setTimeout(90_000);
      const copy = copies[locale];
      const page = await f.page(f.creator, locale, width, 'dark');
      await page.goto(path());
      await waitForHydratedPage(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(page.getByRole('link', { name: copy.communitySurface.settings })).toBeVisible();
      const switcher = page.getByRole('combobox', { name: new RegExp(copy.home.switcherLabel) });
      await switcher.focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('option', { name: club })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(switcher).toBeFocused();
      await probe(page, [
        '[data-community-view] header',
        '[data-community-view] nav',
        '[data-community-summary]'
      ]);
      const guest = await f.page(f.guest, locale, width, 'dark');
      const denied = await guest.goto(path() + '/ranking');
      expect(await denied?.text()).not.toContain(club);
      await expect(guest.getByText(copy.home.ranking.notMember)).toBeVisible();
      await expect(guest.locator('[data-rank-row]')).toHaveCount(0);
    });
  }
});
