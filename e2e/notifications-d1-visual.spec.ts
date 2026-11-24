import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { waitForHydratedPage } from './auth-helpers';
import {
  approveRequest,
  cleanupLevelReviews,
  grantPlatformAdmin,
  lr,
  rejectRequest,
  resolutionNotices,
  submitRequest
} from './level-reviews-fixtures';
import { copies, fixtures, sql, type Actor } from './matches-management-fixtures';
import {
  enterScore,
  openRecord,
  resultFixtures,
  review as previewResult
} from './matches-results-fixtures';

// Clubhouse D1 frames (PAF-202, Group B): notification detail (match result and level review
// outcome, read and unread), player level review history, platform review queue and platform
// review detail with the approve and deny confirmations, each with a dark twin. The 18 exports
// are committed unchanged under references/paf-202-d1-notifications and pinned by SHA-256.
// Structural probes assert exact geometry; per-region raster budgets (measured, documented in the
// manifest) absorb cross-renderer rasterization and the frame sample data the app cannot show.
type Frame = {
  frameId: string;
  source: string;
  sourceSha256: string;
  width: number;
  height: number;
};
const manifest: {
  frames: Record<string, Frame>;
  visualBudgets: { perScreen: Record<string, number> };
} = JSON.parse(
  readFileSync(
    new URL('./references/paf-202-d1-notifications/manifest.json', import.meta.url),
    'utf8'
  )
);

const WIDTH = 390;
const HEIGHT = 800;
const notifications = copies.en.notifications;
const REASON =
  'My recent ranked matches have been against pairs at 3.6 and above, and I’ve been winning consistently.';

test.use({ serviceWorkers: 'block', deviceScaleFactor: 1, locale: 'en-US' });
test.describe.configure({ mode: 'serial' });

const digest = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');
const frameUrl = (id: string) =>
  new URL('./references/paf-202-d1-notifications/' + manifest.frames[id]!.source, import.meta.url);

test('every pinned export matches its digest and size', () => {
  expect(Object.keys(manifest.frames)).toHaveLength(18);
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

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await ready(page);
}

/**
 * Perceptual difference (YIQ, threshold 0.1) of one live region against the same-size region of the
 * scale-1 frame. The frame's 44px status bar is device chrome the app never renders, so the frame
 * y of a region is its live y + 44; the live region is clipped from a full-page capture.
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
  console.info('PAF-202 D1 notifications raster ' + frameId + ':' + name + ' ' + measured);
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

/** Compares every region of one frame against its manifest budget. */
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
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(0);
}

/** Every visible interactive control keeps a 44x44 target. */
async function targets(page: Page) {
  const small = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        'main a[href], main button, main select, main input:not([type=hidden]):not([type=radio]), main textarea'
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

async function probeTopBar(page: Page, navTitle: string) {
  const backBox = await box(page.locator('main header a').first());
  expect([Math.round(backBox.width), Math.round(backBox.height), Math.round(backBox.x)]).toEqual([
    48, 48, 8
  ]);
  const title = page.locator('main header').getByText(navTitle, { exact: true }).first();
  expect(
    await title.evaluate((node) => [
      getComputedStyle(node).fontSize,
      getComputedStyle(node).fontWeight
    ])
  ).toEqual(['17px', '700']);
}

async function probeCard(card: Locator) {
  expect(
    await card.evaluate((node) => {
      const computed = getComputedStyle(node);
      return [computed.borderTopLeftRadius, computed.borderTopWidth, computed.paddingTop];
    })
  ).toEqual(['20px', '1px', '16px']);
}

// --- level review world: history, queue, detail, outcome notifications --------------------

type Fixtures = Awaited<ReturnType<typeof fixtures>>;
let f: Fixtures;
let admin: Actor;
let leo: Actor;
let mariana: Actor;
let ana: Actor;
let noticeId = '';
let leoRequest = '';

test.describe('level review frames', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    f = await fixtures(browser, {
      creatorName: 'Thiago Ribeiro',
      memberNames: ['Platform Admin', 'Ana Souza'],
      communityName: 'Northside Padel',
      memberCount: 2
    });
    admin = f.members[0]!;
    ana = f.members[1]!;
    await grantPlatformAdmin(admin.id);
    const anaRequest = await submitRequest(ana, { min: 3.6, max: 3.9, reason: REASON });
    await approveRequest(
      admin,
      anaRequest,
      3.82,
      'Your recent competitive results support the updated level.'
    );
    const [notice] = await resolutionNotices(ana.id, anaRequest);
    noticeId = notice!.id;
  });
  test.afterAll(async () => {
    test.setTimeout(180_000);
    await cleanupLevelReviews(f?.members.map((member) => member.id) ?? []);
    await f?.cleanup();
  });
  test.beforeEach(() => test.setTimeout(180_000));

  for (const theme of ['light', 'dark'] as const) {
    const unread = theme === 'light' ? 'd0Qcrm' : 'PshW9';
    const read = theme === 'light' ? 'U3UJJj' : 'ngrKi';
    for (const [state, frameId] of [
      ['unread', unread],
      ['read', read]
    ] as const) {
      test(
        'level review notification detail ' + state + ' matches ' + frameId + ' (' + theme + ')',
        async ({ browserName }, info) => {
          expect(browserName).toBe('chromium');
          const page = await f.page(ana, 'en', WIDTH, theme, HEIGHT);
          const held: Array<() => Promise<void>> = [];
          if (state === 'unread')
            await page.route(/\/_serverFn\//, (route) => {
              held.push(() => route.continue());
            });
          await open(page, '/notifications/' + noticeId);
          const meta = page.locator('main section > div').first();
          await expect(meta).toContainText(
            state === 'unread' ? notifications.unreadRow : notifications.readRow
          );
          await probeTopBar(page, notifications.title);
          const title = page.getByRole('heading', { level: 1 });
          await expect(title).toHaveText(notifications.kinds.level_review_approved);
          expect(
            await title.evaluate((node) => [
              getComputedStyle(node).fontSize,
              getComputedStyle(node).fontWeight
            ])
          ).toEqual(['28px', '800']);
          const tile = await box(meta.locator('span').first());
          expect([Math.round(tile.width), Math.round(tile.height)]).toEqual([44, 44]);
          await probeCard(page.locator('main section > div').nth(1));
          const action = page.getByRole('link', { name: notifications.levelReview.open });
          const actionBox = await box(action);
          expect([Math.round(actionBox.height), Math.round(actionBox.x)]).toEqual([52, 20]);
          await targets(page);
          await noOverflow(page);
          await compareFrame(page, info, frameId, [
            { name: 'topbar', frameY: 44, height: 56, top: 0 },
            { name: 'meta', frameY: 104, height: 44, top: meta },
            { name: 'title', frameY: 162, height: 68, top: title },
            { name: 'action', frameY: 533, height: 52, top: action }
          ]);
          for (const release of held) await release();
        }
      );
    }
  }
});

// --- history, queue and detail (A9f626, SCPeI, Y7NRH + dark twins) --------------------------------

test.describe('level review pages', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    f = await fixtures(browser, {
      creatorName: 'Thiago Ribeiro',
      memberNames: ['Platform Admin', 'Leo Martín', 'Mariana Costa', 'Bruno Silva'],
      communityName: 'Northside Padel',
      memberCount: 4
    });
    admin = f.members[0]!;
    leo = f.members[1]!;
    mariana = f.members[2]!;
    const bruno = f.members[3]!;
    await grantPlatformAdmin(admin.id);
    // History owner: newest first reads Pending, Approved, Denied.
    const denied = await submitRequest(mariana, { min: 3.5, max: 3.75, reason: 'Denied sample.' });
    await rejectRequest(admin, denied, 'The match history was too limited to support a change.');
    const approvedId = await submitRequest(mariana, {
      min: 3.5,
      max: 3.75,
      reason: 'Approved sample.'
    });
    await approveRequest(
      admin,
      approvedId,
      3.6,
      'Recent competitive results supported this range.'
    );
    await submitRequest(bruno, { min: 4, max: 4.25, reason: REASON });
    await submitRequest(mariana, { min: 3.75, max: 4, reason: REASON });
    leoRequest = await submitRequest(leo, { min: 3.6, max: 3.85, reason: REASON });
  });
  test.afterAll(async () => {
    test.setTimeout(180_000);
    await cleanupLevelReviews(f?.members.map((member) => member.id) ?? []);
    await f?.cleanup();
  });
  test.beforeEach(() => test.setTimeout(180_000));

  for (const theme of ['light', 'dark'] as const) {
    test(
      'history matches ' + (theme === 'light' ? 'A9f626' : 'ftEUR') + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const frameId = theme === 'light' ? 'A9f626' : 'ftEUR';
        const page = await f.page(mariana, 'en', WIDTH, theme, HEIGHT);
        await open(page, '/level-reviews');
        await probeTopBar(page, lr.entry.title);
        const heading = page.getByRole('heading', { level: 1, name: lr.history.title });
        expect(
          await heading.evaluate((node) => [
            getComputedStyle(node).fontSize,
            getComputedStyle(node).fontWeight
          ])
        ).toEqual(['28px', '800']);
        const cards = page.locator('main ul > li > div');
        await expect(cards).toHaveCount(3);
        for (const index of [0, 1, 2]) await probeCard(cards.nth(index));
        const [first, second] = [await box(cards.nth(0)), await box(cards.nth(1))];
        expect(Math.round(second.y - first.bottom), 'cards are one 14px step apart').toBe(14);
        expect([Math.round(first.x), Math.round(WIDTH - first.right)]).toEqual([20, 20]);
        const link = page.getByRole('link', { name: lr.history.viewActive });
        expect(Math.round((await box(link)).height)).toBe(44);
        await expect(cards.nth(0)).toContainText(lr.status.pending);
        await expect(cards.nth(1)).toContainText(lr.status.approved);
        await expect(cards.nth(2)).toContainText(lr.status.rejected);
        await targets(page);
        await noOverflow(page);
        await compareFrame(page, info, frameId, [
          { name: 'topbar', frameY: 44, height: 56, top: 0 },
          { name: 'heading', frameY: 104, height: 70, top: heading },
          { name: 'card', frameY: 180, height: 150, top: cards.first() }
        ]);
      }
    );
  }

  for (const theme of ['light', 'dark'] as const) {
    test(
      'queue matches ' + (theme === 'light' ? 'SCPeI' : 'SeklE') + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const frameId = theme === 'light' ? 'SCPeI' : 'SeklE';
        const page = await f.page(admin, 'en', WIDTH, theme, HEIGHT);
        await open(page, '/platform-admin/level-reviews');
        await probeTopBar(page, lr.admin.entryTitle);
        const heading = page.getByRole('heading', { level: 1, name: lr.admin.title });
        expect(
          await heading.evaluate((node) => [
            getComputedStyle(node).fontSize,
            getComputedStyle(node).fontWeight
          ])
        ).toEqual(['28px', '800']);
        const cards = page.locator('main ul > li > div');
        expect(await cards.count()).toBeGreaterThanOrEqual(3);
        await probeCard(cards.first());
        const avatar = await box(cards.first().locator('span[aria-hidden="true"]').first());
        expect([Math.round(avatar.width), Math.round(avatar.height)]).toEqual([44, 44]);
        const pendingChip = page.locator('main > p').filter({ hasText: /pending request/ });
        await expect(pendingChip).toBeVisible();
        expect(
          await pendingChip.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)
        ).toBe('36px');
        const filter = await box(page.getByRole('combobox', { name: lr.admin.filter }));
        expect([Math.round(filter.x), Math.round(filter.width), Math.round(filter.height)]).toEqual(
          [20, 350, 52]
        );
        await targets(page);
        await noOverflow(page);
        await compareFrame(page, info, frameId, [
          { name: 'topbar', frameY: 44, height: 56, top: 0 },
          { name: 'heading', frameY: 104, height: 34, top: heading },
          { name: 'summary', frameY: 152, height: 26, top: pendingChip },
          { name: 'card', frameY: 188, height: 190, top: cards.first() }
        ]);
      }
    );
  }

  for (const theme of ['light', 'dark'] as const) {
    test(
      'detail matches ' + (theme === 'light' ? 'Y7NRH' : 'zkFgA') + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const frameId = theme === 'light' ? 'Y7NRH' : 'zkFgA';
        const page = await f.page(admin, 'en', WIDTH, theme, HEIGHT);
        await open(page, '/platform-admin/level-reviews/' + leoRequest);
        await probeTopBar(page, lr.admin.detail);
        const card = page
          .locator('main > div')
          .filter({ has: page.getByRole('heading', { level: 2, name: 'Leo Martín' }) });
        await probeCard(card);
        const avatar = await box(card.locator('span[aria-hidden="true"]').first());
        expect([Math.round(avatar.width), Math.round(avatar.height)]).toEqual([52, 52]);
        const name = card.getByRole('heading', { level: 2, name: 'Leo Martín' });
        expect(
          await name.evaluate((node) => [
            getComputedStyle(node).fontSize,
            getComputedStyle(node).fontWeight
          ])
        ).toEqual(['20px', '800']);
        await expect(page.getByText(REASON)).toBeVisible();
        const deny = page.getByRole('button', { name: lr.adminDecision.reject, exact: true });
        const approve = page.getByRole('button', { name: lr.adminDecision.approve, exact: true });
        const [denyBox, approveBox] = [await box(deny), await box(approve)];
        expect([
          Math.round(denyBox.width),
          Math.round(denyBox.height),
          Math.round(approveBox.height)
        ]).toEqual([108, 52, 52]);
        expect(Math.round(approveBox.x - denyBox.right), 'actions are one 8px step apart').toBe(8);
        const bar = await box(deny.locator('..'));
        expect([Math.round(bar.x), Math.round(bar.width)]).toEqual([0, WIDTH]);
        expect(Math.round(denyBox.y - bar.y), 'bar top inset').toBe(13);
        expect(Math.round(bar.bottom - denyBox.bottom), 'bar bottom inset').toBe(24);
        expect(
          await deny.locator('..').evaluate((node) => getComputedStyle(node).borderTopWidth)
        ).toBe('1px');
        const order = await page.evaluate(() => {
          const names = Array.from(document.querySelectorAll('main button')).map((node) =>
            node.textContent?.trim()
          );
          return names;
        });
        expect(order.indexOf(lr.adminDecision.reject)).toBeLessThan(
          order.indexOf(lr.adminDecision.approve)
        );
        await targets(page);
        await noOverflow(page);
        await compareFrame(page, info, frameId, [
          { name: 'topbar', frameY: 44, height: 56, top: 0 },
          { name: 'header', frameY: 104, height: 110, top: card },
          { name: 'actions', frameY: 756, height: 88, top: bar.y, viewport: true }
        ]);
      }
    );
  }

  for (const [decision, theme] of [
    ['approve', 'light'],
    ['approve', 'dark'],
    ['deny', 'light'],
    ['deny', 'dark']
  ] as const) {
    const frameId = {
      'approve-light': 'e8Z3Rb',
      'approve-dark': 'QWdyf',
      'deny-light': 'rBhs4',
      'deny-dark': 'w34ZL'
    }[decision + '-' + theme]!;
    test(
      decision + ' confirmation matches ' + frameId + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const page = await f.page(admin, 'en', WIDTH, theme, HEIGHT);
        await open(page, '/platform-admin/level-reviews/' + leoRequest);
        const note =
          decision === 'approve'
            ? 'Recent ranked results support this adjustment.'
            : 'More ranked results are needed to support this range.';
        if (decision === 'approve')
          await page.getByRole('textbox', { name: lr.adminDecision.target }).fill('3.7');
        await page.getByRole('textbox', { name: lr.adminDecision.note }).fill(note);
        await page
          .getByRole('button', {
            name: decision === 'approve' ? lr.adminDecision.approve : lr.adminDecision.reject,
            exact: true
          })
          .click();
        const dialog = page.getByRole('alertdialog', {
          name:
            decision === 'approve'
              ? lr.adminDecision.confirmApprove
              : lr.adminDecision.confirmReject
        });
        await expect(dialog).toBeVisible();
        await expect(dialog.getByText(note, { exact: true })).toBeVisible();
        const confirm = dialog.getByRole('button', {
          name:
            decision === 'approve'
              ? lr.adminDecision.confirmApproval
              : lr.adminDecision.confirmDenial,
          exact: true
        });
        const cancel = dialog.getByRole('button', { name: lr.adminDecision.cancel, exact: true });
        const [confirmBox, cancelBox, sheet] = [
          await box(confirm),
          await box(cancel),
          await box(dialog)
        ];
        expect([
          Math.round(cancelBox.width),
          Math.round(cancelBox.height),
          Math.round(confirmBox.height)
        ]).toEqual([108, 52, 52]);
        expect(Math.round(confirmBox.x - cancelBox.right), 'actions are one 8px step apart').toBe(
          8
        );
        // 24px padding plus the sheet's 1px hairline border.
        expect(Math.round(sheet.bottom - confirmBox.bottom), 'sheet bottom inset').toBe(25);
        expect([Math.round(sheet.x), Math.round(sheet.width)]).toEqual([0, WIDTH]);
        expect(await dialog.evaluate((node) => getComputedStyle(node).borderTopLeftRadius)).toBe(
          '20px'
        );
        await expect(dialog.getByRole('button')).toHaveCount(2);
        await noOverflow(page);
        const frameHeight = manifest.frames[frameId]!.height;
        const barTop = confirmBox.y - 12;
        await compareRegion(
          page,
          info,
          frameId,
          'actions',
          barTop,
          frameHeight - 88,
          88,
          false
        ).then((measured) => {
          const budget = manifest.visualBudgets.perScreen[frameId + ':actions'];
          expect(budget, 'manifest budget for ' + frameId + ':actions').toBeGreaterThan(0);
          expect(measured, frameId + ' actions raster budget').toBeLessThanOrEqual(budget!);
        });
      }
    );
  }

  for (const viewport of [
    { width: 320, height: 640 },
    { width: 1280, height: 800 }
  ]) {
    test('pages fit and keep 44px targets at ' + viewport.width + 'px', async () => {
      for (const [actor, path] of [
        [mariana, '/level-reviews'],
        [admin, '/platform-admin/level-reviews'],
        [admin, '/platform-admin/level-reviews/' + leoRequest]
      ] as const) {
        const page = await f.page(actor, 'en', viewport.width, 'light', viewport.height);
        await open(page, path);
        await noOverflow(page);
        await targets(page);
        await page.context().close();
      }
    });
  }
});

// --- match result notification detail (dkFFb, MAIv0, k2CxJR, D4aVvd) -------------------------

type ResultFixtures = Awaited<ReturnType<typeof resultFixtures>>;
let results: ResultFixtures;
let reviewer: Actor;
let resultNoticeId = '';

test.describe('match result notification frames', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);
    results = await resultFixtures(browser, { memberCount: 4 });
    const eventId = await results.completedEvent('competitive', 4);
    const submitter = await results.page(results.creator);
    await openRecord(submitter, eventId);
    await enterScore(submitter);
    await previewResult(submitter);
    await submitter
      .getByRole('button', { name: copies.en.matches.results.submit, exact: true })
      .click();
    await expect(
      submitter.getByRole('region', { name: copies.en.matches.results.pending, exact: true })
    ).toBeVisible();
    await submitter.context().close();
    const [row] = await sql(
      `select id::text, recipient_user_id::text as recipient from public.notifications
        where kind='result_review_needed' and target_id='${eventId}' limit 1`
    );
    const actor = [results.creator, ...results.members, results.guest].find(
      (candidate) => candidate.id === String(row?.['recipient'])
    );
    if (!row || !actor) throw new Error('Result notification fixture missing');
    reviewer = actor;
    resultNoticeId = String(row['id']);
  });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await results?.cleanup();
  });
  test.beforeEach(() => test.setTimeout(180_000));

  for (const [state, theme, frameId] of [
    ['unread', 'light', 'dkFFb'],
    ['unread', 'dark', 'MAIv0'],
    ['read', 'light', 'k2CxJR'],
    ['read', 'dark', 'D4aVvd']
  ] as const) {
    test(
      'match result detail ' + state + ' matches ' + frameId + ' (' + theme + ')',
      async ({ browserName }, info) => {
        expect(browserName).toBe('chromium');
        const page = await results.page(reviewer, 'en', WIDTH, theme, HEIGHT);
        const held: Array<() => Promise<void>> = [];
        if (state === 'unread')
          await page.route(/\/_serverFn\//, (route) => {
            held.push(() => route.continue());
          });
        await open(page, '/notifications/' + resultNoticeId);
        const meta = page.locator('main section > div').first();
        await expect(meta).toContainText(
          state === 'unread' ? notifications.unreadRow : notifications.readRow
        );
        await probeTopBar(page, notifications.title);
        const title = page.getByRole('heading', { level: 1 });
        await expect(title).toHaveText(notifications.kinds.result_review_needed);
        const card = page.locator('main section > div').nth(1);
        await probeCard(card);
        await expect(
          card.getByRole('heading', { level: 2, name: notifications.result.cardTitle })
        ).toBeVisible();
        const action = page.getByRole('link', { name: notifications.result.openResult });
        const actionBox = await box(action);
        expect([Math.round(actionBox.height), Math.round(actionBox.x)]).toEqual([52, 20]);
        await targets(page);
        await noOverflow(page);
        await compareFrame(page, info, frameId, [
          { name: 'topbar', frameY: 44, height: 56, top: 0 },
          { name: 'meta', frameY: 104, height: 44, top: meta },
          { name: 'card', frameY: 347, height: 46, top: card },
          { name: 'action', frameY: 543, height: 52, top: action }
        ]);
        for (const release of held) await release();
      }
    );
  }

  test('match result detail fits and keeps 44px targets at 320px and 1280px', async () => {
    for (const viewport of [
      { width: 320, height: 640 },
      { width: 1280, height: 800 }
    ]) {
      const page = await results.page(reviewer, 'en', viewport.width, 'light', viewport.height);
      await open(page, '/notifications/' + resultNoticeId);
      await noOverflow(page);
      await targets(page);
      await page.context().close();
    }
  });
});
