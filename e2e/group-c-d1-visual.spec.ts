import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, leagueFixtures, sql, type Actor } from './leagues-fixtures';
import { confirmGroup, pastEvent, removeProvisionalEvidence } from './player-ratings-fixtures';
import { resultFixtures } from './matches-results-fixtures';

// Clubhouse D1 frames (PAF-202, Group C): privacy policy, league index, profile edit and the rating
// journey chart, empty and error states, each with a dark twin. The 12 exports are committed
// unchanged under references/paf-202-d1-group-c and pinned by SHA-256. Structural probes assert
// exact geometry; per-region raster budgets (measured, documented in the manifest) absorb
// cross-renderer rasterization and the frame sample data the app cannot show.
type Frame = {
  frameId: string;
  source: string;
  sourceSha256: string;
  width: number;
  height: number;
};
const manifest: {
  frames: Record<string, Frame>;
  liveHeightBaselines: Record<string, { height: number; note: string }>;
  visualBudgets: { perScreen: Record<string, number> };
} = JSON.parse(
  readFileSync(new URL('./references/paf-202-d1-group-c/manifest.json', import.meta.url), 'utf8')
);

const WIDTH = 390;
const HEIGHT = 844;
const en = copies.en;
const rating = en.rating;

test.use({ serviceWorkers: 'block', deviceScaleFactor: 1, locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const frameUrl = (id: string) =>
  new URL('./references/paf-202-d1-group-c/' + manifest.frames[id]!.source, import.meta.url);

test('every pinned export matches its digest and size', () => {
  expect(Object.keys(manifest.frames)).toHaveLength(12);
  for (const frame of Object.values(manifest.frames)) {
    const bytes = readFileSync(frameUrl(frame.frameId));
    expect([frame.frameId, digest(bytes)]).toEqual([frame.frameId, frame.sourceSha256]);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([frame.width, frame.height]);
  }
});

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };
const box = (locator: Locator): Promise<Box> =>
  locator.first().evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y, right, bottom, width, height };
  });
const style = (locator: Locator, ...props: string[]) =>
  locator
    .first()
    .evaluate(
      (node, names) => names.map((name) => getComputedStyle(node).getPropertyValue(name)),
      props
    );

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  await page.evaluate(async () => {
    await Promise.all(
      ['400', '500', '600', '700', '800'].map((weight) =>
        document.fonts.load(`${weight} 16px Figtree`)
      )
    );
    await document.fonts.ready;
  });
}

/**
 * Perceptual difference (YIQ, threshold 0.1) of one live region against the same-size region of
 * the scale-1 frame. App frames carry a 44px status bar the app never renders, so the frame y of
 * a region is its live y + 44 (`frameY` is given in frame coordinates by the caller).
 */
async function compareRegion(
  page: Page,
  info: TestInfo,
  frameId: string,
  name: string,
  liveTop: number,
  frameY: number,
  height: number,
  fullPage = true
): Promise<number> {
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage,
    clip: { x: 0, y: Math.round(liveTop), width: WIDTH, height },
    path: info.outputPath(frameId + '-' + name + '-actual.png')
  });
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, area }) => {
      const load = async (url: string, offset: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        context.drawImage(image, 0, offset, area.width, area.height, 0, 0, area.width, area.height);
        return context.getImageData(0, 0, area.width, area.height).data;
      };
      const [rendered, reference] = await Promise.all([
        load(actualUrl, 0),
        load(approvedUrl, area.y)
      ]);
      let changed = 0;
      for (let index = 0; index < rendered.length; index += 4) {
        const red = rendered[index]! - reference[index]!;
        const green = rendered[index + 1]! - reference[index + 1]!;
        const blue = rendered[index + 2]! - reference[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        )
          changed++;
      }
      return changed / (area.width * area.height);
    },
    {
      actualUrl: 'data:image/png;base64,' + actual.toString('base64'),
      approvedUrl: 'data:image/png;base64,' + readFileSync(frameUrl(frameId)).toString('base64'),
      area: { width: WIDTH, height, y: frameY }
    }
  );
  console.info('PAF-202 D1 group C raster ' + frameId + ':' + name + ' ' + measured);
  return measured;
}

// `viewport` regions (the sticky action bar) are captured from the viewport, where they are pinned.
type Region = {
  name: string;
  frameY: number;
  height: number;
  top: Locator | number;
  viewport?: boolean;
};

async function compareFrame(page: Page, info: TestInfo, frameId: string, regions: Region[]) {
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const region of regions) {
    const top = typeof region.top === 'number' ? region.top : (await box(region.top)).y;
    const budget = manifest.visualBudgets.perScreen[frameId + ':' + region.name];
    expect(budget, 'manifest budget for ' + frameId + ':' + region.name).toBeGreaterThan(0);
    expect(
      await compareRegion(
        page,
        info,
        frameId,
        region.name,
        top,
        region.frameY,
        region.height,
        !region.viewport
      ),
      frameId + ' ' + region.name + ' raster budget'
    ).toBeLessThanOrEqual(budget!);
  }
}

async function noOverflow(page: Page) {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - width,
      offenders: Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .filter((element) => element.getBoundingClientRect().right > width + 0.5)
        .slice(0, 8)
        .map((element) => element.tagName + '.' + (element.textContent ?? '').trim().slice(0, 24))
    };
  });
  expect(overflow, 'no horizontal overflow ' + offenders.join(' | ')).toBeLessThanOrEqual(0);
}

/** Every visible interactive control keeps a 44x44 target. */
async function targets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'main a[href], main button, main select, main input:not([type=hidden]):not([type=radio]):not([type=checkbox]):not([type=file]), main textarea'
      )
    )
      .map((element) => ({
        name: element.textContent?.trim().slice(0, 30) ?? '',
        rect: element.getBoundingClientRect()
      }))
      .filter(
        ({ rect }) => rect.width > 0 && rect.height > 0 && (rect.height < 43.5 || rect.width < 43.5)
      )
      .map(({ name, rect }) => name + ' ' + Math.round(rect.width) + 'x' + Math.round(rect.height))
  );
  expect(small, 'targets below 44px').toEqual([]);
}

const themes = ['light', 'dark'] as const;
const round = (value: number) => Math.round(value);

async function probeTopBar(
  page: Page,
  title: string,
  backSelector = 'main header a, main header button'
) {
  const back = await box(page.locator(backSelector).first());
  expect([round(back.width), round(back.height), round(back.x)]).toEqual([48, 48, 8]);
  const nav = page.locator('main header').getByText(title, { exact: true }).first();
  expect(await style(nav, 'font-size', 'font-weight')).toEqual(['17px', '700']);
  const middle = await box(nav);
  expect(Math.abs(middle.x + middle.width / 2 - WIDTH / 2) <= 16, 'title is centered').toBe(true);
}

async function probeHeading(heading: Locator) {
  expect(await style(heading, 'font-size', 'font-weight')).toEqual(['28px', '800']);
}

// --- privacy (QqUGZ, pHgfV): public page, no auth ----------------------------------------------

test.describe('privacy policy', () => {
  for (const theme of themes) {
    const frameId = theme === 'light' ? 'QqUGZ' : 'pHgfV';
    test('matches ' + frameId + ' (' + theme + ')', async ({ browser, browserName }, info) => {
      expect(browserName).toBe('chromium');
      const context = await browser.newContext({
        viewport: { width: WIDTH, height: HEIGHT },
        deviceScaleFactor: 1,
        colorScheme: theme,
        serviceWorkers: 'block'
      });
      await context.addCookies([
        { name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' },
        { name: 'theme', value: theme, url: 'http://127.0.0.1:4173' }
      ]);
      const page = await context.newPage();
      await page.goto('/privacy');
      await ready(page);
      expect(new URL(page.url()).pathname, 'public: no sign-in redirect').toBe('/privacy');

      const header = page.locator('main > header');
      const brandRow = await box(header.locator('> div').first());
      expect([round(brandRow.x), round(brandRow.height)]).toEqual([24, 76]);
      // D8: the owner-approved app icon asset, never a redrawn mark.
      const logo = header.locator('img');
      await expect(logo).toHaveAttribute('src', /padel-friends-app-icon.*\.png$/);
      await expect(logo).toHaveAttribute('alt', '');
      const mark = await box(logo);
      expect([round(mark.width), round(mark.height), round(mark.x), round(mark.y)]).toEqual([
        40, 40, 24, 18
      ]);
      const wordmark = header.getByText(en.auth.loginBrand, { exact: true });
      expect(await style(wordmark, 'font-size', 'font-weight')).toEqual(['15px', '700']);

      const language = await box(page.getByRole('combobox', { name: en.language }).locator('..'));
      const themeChip = await box(page.getByRole('combobox', { name: en.theme }).locator('..'));
      expect([round(language.width), round(language.height), round(language.y)]).toEqual([
        44, 44, 16
      ]);
      expect(round(themeChip.right), 'theme chip sits on the 24px inset').toBe(WIDTH - 24);
      expect(round(themeChip.x - language.right), 'chips are one 8px step apart').toBe(8);

      const back = page.getByRole('link', { name: en.privacy.backHome });
      const backBox = await box(back);
      expect([round(backBox.height), round(backBox.x), round(backBox.y)]).toEqual([44, 24, 80]);
      expect(await back.getAttribute('href')).toBe('/');
      const title = page.getByRole('heading', { level: 1, name: en.privacy.title });
      expect(await style(title, 'font-size', 'font-weight', 'line-height')).toEqual([
        '30px',
        '800',
        '34.5px'
      ]);
      const sections = page.locator('main > section');
      const first = sections.first();
      expect(await style(first.locator('h2'), 'font-size', 'font-weight')).toEqual(['18px', '800']);
      expect(await style(first.locator('p').first(), 'font-size', 'line-height')).toEqual([
        '16px',
        '23.2px'
      ]);
      const firstBox = await box(first);
      expect([round(firstBox.x), round(firstBox.width)]).toEqual([24, 342]);
      const bullet = page.locator('main li').first();
      expect(await bullet.evaluate((node) => getComputedStyle(node, '::before').content)).toBe(
        '"•"'
      );
      await expect(page.locator('main a[href^="mailto:"]')).toHaveCount(1);
      await noOverflow(page);
      await targets(page);
      // The approved frame is 7232px tall. The page keeps its structure but legitimately grew with the privacy
      // request, account deletion and residual-processing sections (PAF-199): the pinned LIVE height is the
      // manifest's liveHeightBaselines entry (the frame height stays bound to its PNG). Wrapping differences
      // between renderers move it by a few lines.
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const baseline = manifest.liveHeightBaselines[frameId]!.height;
      expect(
        Math.abs(pageHeight - baseline) / baseline,
        'privacy page height ' + String(pageHeight) + ' vs pinned ' + String(baseline)
      ).toBeLessThan(0.03);
      await compareFrame(page, info, frameId, [
        { name: 'head', frameY: 0, height: 217, top: 0 },
        { name: 'about', frameY: 217, height: 168, top: first }
      ]);
      await context.close();
    });
  }

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 }
  ]) {
    test('fits and keeps 44px targets at ' + viewport.width + 'px', async ({ browser }) => {
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      const page = await context.newPage();
      await page.goto('/privacy');
      await ready(page);
      await noOverflow(page);
      await targets(page);
      const chips = await box(page.getByRole('combobox', { name: en.theme }).locator('..'));
      const title = await box(page.getByRole('link', { name: en.privacy.backHome }));
      expect(chips.right, 'controls stay inside the viewport').toBeLessThanOrEqual(viewport.width);
      expect(title.x).toBeGreaterThanOrEqual(0);
      await context.close();
    });
  }
});

// --- league index (Fj5bc, ssomJ) ----------------------------------------------------------------

type LeagueFixtures = Awaited<ReturnType<typeof leagueFixtures>>;

test.describe('league index', () => {
  let f: LeagueFixtures;
  let owner: Actor;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    f = await leagueFixtures(browser, {
      creatorName: 'Thiago Ribeiro',
      memberNames: ['Ana Souza'],
      communityName: 'Northside Padel',
      memberCount: 1
    });
    owner = f.creator;
    const summer = await f.createLeague(owner, {
      name: 'Summer League',
      endMode: 'manual',
      start: day(0)
    });
    const [current] = await sql(`select version from public.leagues where id='${summer}'`);
    const closed = await owner.client.rpc('close_league', {
      p_league_id: summer,
      p_expected_version: current?.version
    });
    if (closed.error) throw closed.error;
    await f.createLeague(owner, {
      name: 'Autumn League',
      endMode: 'fixed_date',
      start: day(0),
      end: day(30)
    });
  });
  test.afterAll(async () => {
    test.setTimeout(180_000);
    await f?.cleanup();
  });
  test.beforeEach(() => test.setTimeout(180_000));

  for (const theme of themes) {
    const frameId = theme === 'light' ? 'Fj5bc' : 'ssomJ';
    test('matches ' + frameId + ' (' + theme + ')', async ({ browserName }, info) => {
      expect(browserName).toBe('chromium');
      const page = await f.page(owner, 'en', WIDTH, theme, HEIGHT);
      await page.goto('/community/' + f.community + '/leagues');
      await ready(page);
      await probeTopBar(page, en.leagues.list.navTitle);
      const heading = page.getByRole('heading', { level: 1, name: en.leagues.title });
      await probeHeading(heading);
      await expect(page.locator('main header + div p')).toHaveText('Northside Padel');
      const create = page.getByRole('link', { name: en.leagues.list.create, exact: true });
      const createBox = await box(create);
      expect([round(createBox.x), round(createBox.width), round(createBox.height)]).toEqual([
        20, 350, 52
      ]);
      expect(await style(create, 'border-top-left-radius', 'font-size', 'font-weight')).toEqual([
        '14px',
        '16px',
        '700'
      ]);
      const sectionTitle = page.getByRole('heading', {
        level: 2,
        name: en.leagues.list.sections.active
      });
      expect(await style(sectionTitle, 'font-size', 'font-weight')).toEqual(['18px', '800']);
      const card = page.getByRole('link', { name: /Autumn League/ });
      const cardBox = await box(card);
      expect([round(cardBox.x), round(cardBox.width)]).toEqual([20, 350]);
      expect(
        await style(card, 'border-top-left-radius', 'border-top-width', 'padding-top')
      ).toEqual(['20px', '1px', '16px']);
      expect(
        await style(
          card.locator('> span').first().locator('> span').first(),
          'font-size',
          'font-weight'
        )
      ).toEqual(['18px', '800']);
      await expect(card.getByText(en.leagues.status.active, { exact: true })).toBeVisible();
      const closedCard = page.getByRole('link', { name: /Summer League/ });
      await expect(closedCard.getByText(en.leagues.status.closed, { exact: true })).toBeVisible();
      const gap = (
        await box(page.getByRole('heading', { level: 2, name: en.leagues.list.sections.closed }))
      ).y;
      expect(gap).toBeGreaterThan(cardBox.bottom);
      expect(
        await page
          .getByRole('link', { name: en.leagues.list.create, exact: true })
          .getAttribute('href')
      ).toBe('/community/' + f.community + '/leagues/create');
      await card.click();
      await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
      await page.goBack();
      await ready(page);
      await targets(page);
      await noOverflow(page);
      await compareFrame(page, info, frameId, [
        { name: 'topbar', frameY: 44, height: 56, top: 0 },
        { name: 'heading', frameY: 104, height: 61, top: heading },
        { name: 'create', frameY: 179, height: 52, top: create },
        { name: 'section', frameY: 245, height: 22, top: sectionTitle },
        { name: 'card', frameY: 275, height: 76, top: card }
      ]);
    });
  }

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 }
  ]) {
    test('fits and keeps 44px targets at ' + viewport.width + 'px', async () => {
      const page = await f.page(owner, 'en', viewport.width, 'light', viewport.height);
      await page.goto('/community/' + f.community + '/leagues');
      await ready(page);
      await noOverflow(page);
      await targets(page);
      await page.context().close();
    });
  }
});

// --- profile edit (VpcMM, xlgw8) and the rating journey (lNj83 ... d9rkmE) --------------------

type ResultFixtures = Awaited<ReturnType<typeof resultFixtures>>;

test.describe('profile edit and rating journey', () => {
  let r: ResultFixtures;
  let host: Actor;
  let newcomer: Actor;
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    r = await resultFixtures(browser, {
      creatorName: 'Thiago Ribeiro',
      memberNames: ['Ana M.', 'Pedro L.', 'Carlos F.', 'Luis G.', 'Nina Newcomer'],
      communityName: 'Padel Friends',
      memberCount: 5
    });
    host = r.creator;
    newcomer = r.members[4]!;
    const [a, b, c, d] = r.members.map((member) => member.id);
    const games: [string, [string, string, string, string], 'team_a' | 'team_b' | 'draw'][] = [
      ['2026-10-10T18:00:00Z', [host.id, a!, b!, c!], 'team_a'],
      ['2026-10-12T18:00:00Z', [host.id, b!, a!, d!], 'team_b'],
      ['2026-10-14T18:00:00Z', [host.id, d!, c!, a!], 'draw']
    ];
    for (const [playedAt, players, classification] of games)
      await confirmGroup({
        eventId: await pastEvent(r),
        players,
        playedAt,
        submittedBy: host.id,
        classification
      });
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await removeProvisionalEvidence([]);
    await r?.cleanup();
  });
  test.beforeEach(() => test.setTimeout(180_000));

  const journey = (page: Page) => page.getByRole('region', { name: rating.journey.title });

  async function openMe(actor: Actor, theme: 'light' | 'dark', width = WIDTH, height = HEIGHT) {
    const page = await r.page(actor, 'en', width, theme, height);
    await page.goto('/me');
    await ready(page);
    await expect(journey(page)).toBeVisible();
    return page;
  }

  async function openEdit(page: Page) {
    await page.getByRole('button', { name: en.profile.edit }).click();
    await expect(page.getByRole('heading', { level: 1, name: en.profile.edit })).toBeVisible();
  }

  for (const theme of themes) {
    const frameId = theme === 'light' ? 'VpcMM' : 'xlgw8';
    test('profile edit matches ' + frameId + ' (' + theme + ')', async ({ browserName }, info) => {
      expect(browserName).toBe('chromium');
      const page = await openMe(host, theme);
      await openEdit(page);
      await probeTopBar(page, en.profile.navTitle, 'main header button');
      const heading = page.getByRole('heading', { level: 1, name: en.profile.edit });
      await probeHeading(heading);

      const avatarRow = page.locator('main form h1 + div');
      const avatar = await box(avatarRow.locator('> span, > img').first());
      expect([round(avatar.width), round(avatar.height), round(avatar.x)]).toEqual([56, 56, 20]);
      expect(
        await style(avatarRow.locator('> span, > img').first(), 'border-top-left-radius')
      ).toEqual(['36px']);
      const change = page.getByText(en.profile.changePhoto, { exact: true });
      expect(await style(change, 'font-size', 'font-weight')).toEqual(['15px', '700']);
      expect((await box(change)).height).toBeGreaterThanOrEqual(44);

      const name = page.getByLabel(en.onboarding.name);
      const nameBox = await box(name);
      expect([round(nameBox.x), round(nameBox.width), round(nameBox.height)]).toEqual([
        20, 350, 52
      ]);
      expect(await style(name, 'border-top-left-radius', 'font-size')).toEqual(['12px', '16px']);
      await expect(name).toHaveValue(host.name);

      const availability = page.getByRole('heading', { level: 2, name: en.profile.availability });
      expect(await style(availability, 'font-size', 'font-weight')).toEqual(['18px', '800']);
      const days = page.getByRole('group', { name: en.profile.preferredDays });
      const dayChips = days.locator('label');
      await expect(dayChips).toHaveCount(7);
      for (let index = 0; index < 7; index++) {
        const chip = await box(dayChips.nth(index));
        expect(round(chip.height)).toBe(44);
        expect(chip.width).toBeGreaterThanOrEqual(44);
      }
      expect(await style(dayChips.first(), 'border-top-left-radius')).toEqual(['36px']);
      await dayChips.nth(1).click();
      await dayChips.nth(3).click();
      expect(await style(dayChips.nth(1), 'background-color')).not.toEqual(
        await style(dayChips.nth(0), 'background-color')
      );
      const times = page.getByRole('group', { name: en.profile.preferredTimes });
      await expect(times.locator('label')).toHaveCount(3);

      const preferences = page.getByRole('heading', { level: 2, name: en.profile.preferences });
      const language = page.locator('#edit-language');
      const languageBox = await box(language);
      expect([round(languageBox.x), round(languageBox.width), round(languageBox.height)]).toEqual([
        20, 350, 52
      ]);
      const themeGroup = page.getByRole('group', { name: en.theme });
      await expect(themeGroup.getByLabel(en[theme])).toBeChecked();
      const options = await box(themeGroup.locator('> div'));
      expect([round(options.x), round(options.width)]).toEqual([20, 350]);
      expect(
        await style(themeGroup.locator('> div'), 'border-top-left-radius', 'padding-top')
      ).toEqual(['14px', '4px']);

      const cancel = page.getByRole('button', { name: en.profile.cancel, exact: true });
      const save = page.getByRole('button', { name: en.profile.save, exact: true });
      const [cancelBox, saveBox] = [await box(cancel), await box(save)];
      expect([round(cancelBox.width), round(cancelBox.height), round(saveBox.height)]).toEqual([
        112, 52, 52
      ]);
      expect(round(saveBox.x - cancelBox.right), 'actions are one 8px step apart').toBe(8);
      const bar = save.locator('..');
      const barBox = await box(bar);
      expect([round(barBox.x), round(barBox.width), round(HEIGHT - barBox.bottom)]).toEqual([
        0,
        WIDTH,
        0
      ]);
      expect(round(saveBox.y - barBox.y), 'bar top inset').toBe(13);
      expect(round(barBox.bottom - saveBox.bottom), 'bar bottom inset').toBe(24);
      expect(await style(bar, 'border-top-width')).toEqual(['1px']);
      await targets(page);
      await noOverflow(page);
      await compareFrame(page, info, frameId, [
        { name: 'topbar', frameY: 44, height: 56, top: 0 },
        { name: 'title', frameY: 104, height: 32, top: heading },
        { name: 'avatar', frameY: 150, height: 56, top: avatarRow },
        { name: 'name', frameY: 220, height: 76, top: name.locator('xpath=ancestor::div[1]') },
        { name: 'availability', frameY: 310, height: 174, top: availability },
        { name: 'preferences', frameY: 498, height: 190, top: preferences },
        { name: 'actions', frameY: 756, height: 88, top: barBox.y, viewport: true }
      ]);
    });
  }

  test('profile edit keeps validation, cancel and keyboard flow', async () => {
    const page = await openMe(host, 'light');
    await openEdit(page);
    const name = page.getByLabel(en.onboarding.name);
    await name.fill('   ');
    await page.getByRole('button', { name: en.profile.save, exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText(en.onboarding.validationName);
    await expect(name).toBeFocused();
    await name.fill(host.name);
    await page.keyboard.press('Tab');
    // Keyboard order follows the frame: the first day chip is next.
    await expect(
      page.getByRole('group', { name: en.profile.preferredDays }).locator('input').first()
    ).toBeFocused();
    await page.getByRole('button', { name: en.profile.cancel, exact: true }).click();
    await expect(page.getByRole('button', { name: en.profile.edit })).toBeVisible();
    await page.context().close();
  });

  for (const theme of themes) {
    const [expanded, empty, failed] =
      theme === 'light' ? ['lNj83', 'DtbIE', 'JYWDi'] : ['PYxIz', 'tgXcg', 'd9rkmE'];

    test(
      'journey expanded matches ' + expanded + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const page = await openMe(host, theme);
        const region = journey(page);
        const heading = region.getByRole('heading', { level: 2, name: rating.journey.title });
        expect(await style(heading, 'font-size', 'font-weight')).toEqual(['28px', '800']);
        const card = region.locator('> div').first();
        const cardBox = await box(card);
        expect([round(cardBox.x), round(cardBox.width)]).toEqual([20, 350]);
        expect(
          await style(card, 'border-top-left-radius', 'border-top-width', 'padding-top')
        ).toEqual(['20px', '1px', '16px']);
        const level = card.locator('p').first();
        expect(await style(level, 'font-size', 'font-weight')).toEqual(['40px', '800']);
        await expect(card.getByText(rating.progress.scopeCaption, { exact: true })).toBeVisible();
        const plot = card.locator('[aria-hidden="true"]').first();
        const bars = plot.locator('> div').nth(1).locator('> div').first().locator('> div');
        expect(round((await box(bars.first().locator('..'))).height)).toBe(144);
        expect(await bars.count()).toBeGreaterThanOrEqual(2);
        expect(await style(bars.last(), 'background-color')).not.toEqual(
          await style(bars.first(), 'background-color')
        );
        const recent = region.getByRole('heading', { level: 3, name: rating.history.title });
        expect(await style(recent, 'font-size', 'font-weight')).toEqual(['18px', '800']);
        const list = recent.locator('xpath=following-sibling::div[1]');
        const rows = list.locator('li');
        await expect(rows).toHaveCount(3);
        expect(await style(list, 'border-top-left-radius')).toEqual(['20px']);
        expect(await style(rows.first().locator('h4'), 'font-size', 'color')).toBeTruthy();
        await expect(region.getByRole('button', { name: rating.progress.showTable })).toBeVisible();
        await targets(page);
        await noOverflow(page);
        await compareFrame(page, info, expanded, [
          { name: 'title', frameY: 104, height: 32, top: heading },
          { name: 'chart', frameY: 150, height: 230, top: card },
          { name: 'recent', frameY: 486, height: 22, top: recent },
          { name: 'row', frameY: 516, height: 46, top: list }
        ]);
      }
    );

    test('journey empty matches ' + empty + ' (' + theme + ')', async ({ browserName }, info) => {
      expect(browserName).toBe('chromium');
      const page = await openMe(newcomer, theme);
      const region = journey(page);
      const heading = region.getByRole('heading', { level: 2, name: rating.journey.title });
      const card = region.locator('> div').first();
      await expect(card.getByText(rating.history.emptyTitle)).toBeVisible();
      await expect(card.getByText(rating.progress.emptyBody)).toBeVisible();
      await expect(card.getByText(rating.progress.startingLevel)).toBeVisible();
      await expect(
        region.getByRole('heading', { level: 3, name: rating.history.title })
      ).toHaveCount(0);
      const tile = await box(card.locator('span[aria-hidden="true"]'));
      expect([round(tile.width), round(tile.height)]).toEqual([44, 44]);
      expect(await style(card, 'border-top-left-radius')).toEqual(['20px']);
      await noOverflow(page);
      await compareFrame(page, info, empty, [
        { name: 'title', frameY: 104, height: 32, top: heading },
        { name: 'card', frameY: 150, height: 203, top: card }
      ]);
    });

    test('journey error matches ' + failed + ' (' + theme + ')', async ({ browserName }, info) => {
      expect(browserName).toBe('chromium');
      const page = await r.page(host, 'en', WIDTH, theme, HEIGHT);
      await ready(page);
      // Client navigation from the dashboard so the rating reads go through the browser. Server
      // function ids are opaque in the production build, so the rating reads are identified by
      // their payload on a first visit and aborted on the next one.
      const ratingPaths = new Set<string>();
      const prime = await r.page(host, 'en', WIDTH, theme, HEIGHT);
      prime.on('response', (response) => {
        if (!response.url().includes('/_serverFn/')) return;
        void response
          .text()
          .then((text) => {
            if (/revision/.test(text)) ratingPaths.add(new URL(response.url()).pathname);
          })
          .catch(() => undefined);
      });
      await prime.locator('a[href="/me"]').first().click();
      await expect(
        journey(prime).getByRole('heading', { level: 3, name: rating.history.title })
      ).toBeVisible();
      expect(ratingPaths.size, 'rating server functions seen').toBeGreaterThan(0);
      await prime.context().close();
      await page.route(
        (url) => ratingPaths.has(url.pathname),
        (route) => route.abort()
      );
      await page.locator('a[href="/me"]').first().click();
      const region = journey(page);
      await expect(region.getByRole('alert')).toHaveText(rating.errors.unavailable);
      const heading = region.getByRole('heading', { level: 2, name: rating.journey.title });
      const banner = region.getByRole('alert');
      const bannerBox = await box(banner);
      expect([round(bannerBox.x), round(bannerBox.width)]).toEqual([20, 350]);
      expect(await style(banner, 'border-top-left-radius', 'padding-top', 'padding-left')).toEqual([
        '14px',
        '12px',
        '14px'
      ]);
      const reload = region.getByRole('button', { name: rating.errors.reload, exact: true });
      const reloadBox = await box(reload);
      expect([round(reloadBox.x), round(reloadBox.width), round(reloadBox.height)]).toEqual([
        20, 350, 52
      ]);
      expect(
        round(reloadBox.y - bannerBox.bottom),
        'banner and action are one 14px step apart'
      ).toBe(14);
      await expect(region.getByText(rating.progress.scopeCaption)).toHaveCount(0);
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await noOverflow(page);
      await compareFrame(page, info, failed, [
        { name: 'title', frameY: 104, height: 32, top: heading },
        { name: 'banner', frameY: 150, height: 46, top: banner },
        { name: 'reload', frameY: 210, height: 52, top: reload }
      ]);
      await reload.click();
      await expect(
        region.getByRole('heading', { level: 3, name: rating.history.title })
      ).toBeVisible();
    });
  }

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 }
  ]) {
    test(
      'profile, edit and journey fit and keep 44px targets at ' + viewport.width + 'px',
      async () => {
        const page = await openMe(host, 'light', viewport.width, viewport.height);
        await noOverflow(page);
        await targets(page);
        await openEdit(page);
        await noOverflow(page);
        await targets(page);
        await page.context().close();
      }
    );
  }
});
