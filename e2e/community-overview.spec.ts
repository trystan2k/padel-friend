import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, leagueFixtures, sql, type Actor } from './leagues-fixtures';
import { fixtures } from './matches-management-fixtures';

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

// Resolves a design token to the rgb() string the browser computes, so token-colour checks compare
// like with like (a probe element takes var(--token) as the property under test).
async function tokenColor(page: Page, property: 'color' | 'background-color', token: string) {
  return page.evaluate(
    ({ property: prop, token: name }) => {
      const probeNode = document.createElement('span');
      probeNode.style.setProperty(prop, 'var(' + name + ')');
      document.body.append(probeNode);
      const value = getComputedStyle(probeNode).getPropertyValue(prop);
      probeNode.remove();
      return value;
    },
    { property, token }
  );
}

// The selected segment paints ink (--color-text) on a surface pill, never the green link colour.
async function expectSelectedInk(page: Page, nav: ReturnType<Page['getByRole']>, name: string) {
  const selected = nav.getByRole('link', { name });
  await expect(selected).toHaveAttribute('aria-current', 'page');
  await expect(selected).toHaveCSS('color', await tokenColor(page, 'color', '--color-text'));
  await expect(selected).toHaveCSS(
    'background-color',
    await tokenColor(page, 'background-color', '--color-surface')
  );
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
      await expectSelectedInk(page, sections, en.communitySurface.overview);
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
      const rankingKinds = page.getByRole('navigation', { name: en.communitySurface.rankingKind });
      await expectSelectedInk(page, rankingKinds, en.communitySurface.skill);
      const selfAvatar = skill.locator('span[aria-hidden="true"]');
      await expect(selfAvatar).toBeVisible();
      await expect(selfAvatar).toHaveText(/^\S{1,2}$/);
      await expect(selfAvatar).toHaveCSS(
        'background-color',
        await tokenColor(page, 'background-color', '--color-lime')
      );
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

  test('admins see the real join-request count and a link to Requests; members never read it', async () => {
    test.setTimeout(90_000);
    const admin = await f.page(f.creator);
    await admin.goto(path());
    await waitForHydratedPage(admin);
    // No pending requests: an exact zero (one authorized page proves it), linked to the queue.
    const zero = admin.getByRole('link', { name: en.communitySurface.joinRequestsNone });
    await expect(zero).toHaveAttribute('href', path() + '/admin/requests');
    await expect(admin.getByText(en.communitySurface.joinCountUnavailable)).toHaveCount(0);
    const member = await f.page(f.members[0]!);
    await member.goto(path());
    await waitForHydratedPage(member);
    await expect(member.getByText(en.communitySurface.joinCountUnavailable)).toBeVisible();
    await expect(
      member.getByRole('link', { name: en.communitySurface.joinRequestsNone })
    ).toHaveCount(0);
  });

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

// A scoped entry hands the selected community to Create match; the unscoped entry keeps the first
// membership. The member belongs to two communities and browses the SECOND one.
test.describe('Create match from the community overview', () => {
  test.use({ serviceWorkers: 'block' });
  test.describe.configure({ mode: 'serial' });
  let g: Awaited<ReturnType<typeof fixtures>>;
  let member: Actor;
  let second: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(240_000);
    g = await fixtures(browser, { memberCount: 1, communityName: 'Create Alpha Club' });
    member = g.members[0]!;
    const created = await g.creator.client.rpc('create_community', {
      p_name: 'Create Beta Club',
      p_visibility: 'public',
      p_join_policy: 'instant'
    });
    if (created.error || typeof created.data !== 'string')
      throw created.error ?? new Error('No second community');
    second = created.data;
    const joined = await member.client.rpc('join_public_community', { p_community_id: second });
    if (joined.error) throw joined.error;
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
    await g?.cleanup();
  });

  test('the second community hands its id to Create match; the unscoped entry defaults to the first', async () => {
    test.setTimeout(90_000);
    const page = await g.page(member);
    await page.goto(`/community/${second}`);
    await waitForHydratedPage(page);
    const create = page.getByRole('link', { name: en.matches.create });
    await expect(create).toHaveAttribute('href', `/matches/create?communityId=${second}`);
    await create.click();
    await expect(page.getByRole('heading', { name: en.matchCreate.title })).toBeVisible();
    expect(new URL(page.url()).searchParams.get('communityId')).toBe(second);
    await expect(page.getByLabel(en.matchCreate.fields.community)).toHaveValue(second);

    const unscoped = await g.page(member);
    await unscoped.goto('/matches/create');
    await waitForHydratedPage(unscoped);
    await expect(unscoped.getByLabel(en.matchCreate.fields.community)).toHaveValue(g.community);
  });
});
