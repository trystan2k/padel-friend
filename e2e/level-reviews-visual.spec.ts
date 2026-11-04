import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import manifest from './references/paf-17/manifest.json' with { type: 'json' };
import {
  approveRequest,
  cleanupLevelReviews,
  grantPlatformAdmin,
  lr,
  markUnderReview,
  rejectRequest,
  submitRequest
} from './level-reviews-fixtures';
import { copies, fixtures, type Actor } from './matches-management-fixtures';

// Visual oracle for the three approved level review frames (Pencil qWosG request, OKYtp status,
// gGNxk Platform Admin decision). Exact structural/layout probes are the gate for defects; the
// raster comparison only absorbs cross-renderer font rasterization and the documented,
// deliberate differences listed in the manifest. Screen-state variants (OKYtp) are compared per
// ACTUAL state: the frame stacks four states that never coexist on a real request.

type Fixtures = Awaited<ReturnType<typeof fixtures>>;
let f: Fixtures;
let admin: Actor;
let pending: Actor;
let reviewing: Actor;
let approved: Actor;
let rejected: Actor;
let requester: Actor;
const ids: Record<'pending' | 'reviewing' | 'approved' | 'rejected', string> = {
  pending: '',
  reviewing: '',
  approved: '',
  rejected: ''
};

const WIDTH = 390;
const REASON =
  'I’ve consistently played at this level for years. My recent results have been against much stronger opponents.';

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await fixtures(browser, {
    creatorName: 'Thiago Ribeiro',
    memberNames: ['Platform Admin', 'Lucía Martín', 'Ana M.', 'Pedro L.', 'Carlos F.', 'Luis G.'],
    communityName: 'Padel Friends',
    memberCount: 6
  });
  admin = f.members[0]!;
  pending = f.members[1]!;
  reviewing = f.members[2]!;
  approved = f.members[3]!;
  rejected = f.members[4]!;
  requester = f.members[5]!;
  await grantPlatformAdmin(admin.id);
  ids.pending = await submitRequest(pending, { min: 3.6, max: 3.6, reason: REASON });
  ids.reviewing = await submitRequest(reviewing, { min: 3.6, max: 3.6, reason: REASON });
  await markUnderReview(admin, ids.reviewing);
  ids.approved = await submitRequest(approved, { min: 3.6, max: 3.6, reason: REASON });
  await approveRequest(admin, ids.approved, 3.6, 'Recent results support the requested level.');
  ids.rejected = await submitRequest(rejected, { min: 3.6, max: 3.6, reason: REASON });
  await rejectRequest(admin, ids.rejected, 'More rated games are needed first.');
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await cleanupLevelReviews(f?.members.map((member) => member.id) ?? []);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(180_000));

// --- helpers -----------------------------------------------------------------------------

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };
const box = (locator: Locator): Promise<Box> =>
  locator.first().evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y, right, bottom, width, height };
  });

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}

/** Elements must appear top-to-bottom in the given order and never overlap vertically. */
async function expectOrder(named: [string, Locator][]) {
  let previous: { name: string; box: Box } | undefined;
  for (const [name, locator] of named) {
    await expect(locator.first(), name).toBeVisible();
    const current = await box(locator);
    if (previous)
      expect(previous.box.bottom, `${previous.name} ends before ${name}`).toBeLessThanOrEqual(
        current.y + 1
      );
    previous = { name, box: current };
  }
}

/**
 * Raster- and locale-independent layout defects: horizontal overflow, clipped content,
 * controls below 44px, and controls without an accessible name.
 */
async function layoutViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth - root.clientWidth > 0)
      out.push(`page overflows horizontally by ${root.scrollWidth - root.clientWidth}px`);
    const main = document.querySelector('main');
    if (!main) return ['main landmark missing'];
    for (const element of main.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (bounds.right > root.clientWidth + 1 || bounds.left < -1)
        out.push(`${element.tagName} leaves the viewport`);
      if (
        style.overflowX !== 'visible' &&
        element.scrollWidth - element.clientWidth > 1 &&
        element.tagName !== 'TEXTAREA' &&
        element.tagName !== 'INPUT'
      )
        out.push(`${element.tagName} clips its content horizontally`);
    }
    const controls = main.querySelectorAll(
      'a[href], button, input:not([type=radio]), textarea, label:has(input[type=radio])'
    );
    for (const control of controls) {
      const bounds = control.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      const name =
        control.getAttribute('aria-label') ||
        (control.textContent ?? '').trim() ||
        ('labels' in control && control.labels instanceof NodeList
          ? [...control.labels].map((label) => label.textContent).join('')
          : '');
      if (!name) out.push(`${control.tagName} has no accessible name`);
      if (bounds.height < 43.5)
        out.push(
          `${control.tagName} "${name?.slice(0, 24)}" is ${bounds.height.toFixed(1)}px tall`
        );
    }
    return out;
  });
}

type Crop = { y: number; height: number };

/** Share of pixels that differ perceptibly (YIQ, threshold 0.1) between a live crop and the frame. */
async function rasterDifference(
  page: Page,
  info: TestInfo,
  frame: string,
  label: string,
  actualTop: number,
  reference: Crop
): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    clip: { x: 0, y: actualTop, width: WIDTH, height: reference.height },
    path: info.outputPath(`${frame}-${label}-actual.png`)
  });
  const referencePng = readFileSync(new URL(`./references/paf-17/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, area }) => {
      const load = async (url: string, crop: number, offset: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(
          image,
          0,
          offset * crop,
          area.width * crop,
          area.height * crop,
          0,
          0,
          area.width,
          area.height
        );
        return context.getImageData(0, 0, area.width, area.height).data;
      };
      const [rendered, expected] = await Promise.all([
        load(actualUrl, 1, 0),
        load(approvedUrl, 2, area.y)
      ]);
      let changed = 0;
      for (let index = 0; index < rendered.length; index += 4) {
        const red = rendered[index]! - expected[index]!;
        const green = rendered[index + 1]! - expected[index + 1]!;
        const blue = rendered[index + 2]! - expected[index + 2]!;
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
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${referencePng.toString('base64')}`,
      area: { width: WIDTH, height: reference.height, y: reference.y }
    }
  );
  console.info(`PAF-17 raster ${frame} ${label}: ${measured}`);
  await info.attach(`${frame}-${label}-actual`, { body: actual, contentType: 'image/png' });
  return measured;
}

function budget(key: string): number {
  const value = (manifest.visualBudgets.perScreen as Record<string, number>)[key];
  expect(value, `manifest budget for ${key}`).toBeGreaterThan(0);
  return value!;
}

// --- provenance --------------------------------------------------------------------------

test('reference provenance pins the design source and all three exported frames', () => {
  const design = readFileSync(new URL('../docs/design/padel-friend.pen', import.meta.url));
  expect(createHash('sha256').update(design).digest('hex')).toBe(manifest.sourceDesign.sha256);
  for (const [frame, reference] of Object.entries(manifest.approvedReferences)) {
    const png = readFileSync(new URL(`./references/paf-17/${reference.file}`, import.meta.url));
    expect(createHash('sha256').update(png).digest('hex'), frame).toBe(reference.sha256);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], frame).toEqual(reference.pixelSize);
  }
});

// --- request (qWosG) ---------------------------------------------------------------------

test('request form keeps the Pencil structure and a calibrated raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const page = await f.page(requester, 'en', WIDTH, 'light', 844);
  await open(page, '/level-reviews/new');
  const title = page.getByRole('heading', { level: 1, name: lr.request.title });
  await expectOrder([
    ['title', title],
    ['current card', page.getByRole('heading', { level: 2, name: lr.request.currentLabel })],
    ['level field', page.getByRole('textbox', { name: lr.request.levelExact })],
    ['reason field', page.getByRole('textbox', { name: lr.request.reasonLabel })],
    ['evidence toggle', page.getByRole('button', { name: lr.request.evidenceShow })],
    ['forward-only note', page.getByText(lr.request.forwardOnly)],
    ['submit', page.getByRole('button', { name: lr.request.submit })]
  ]);
  // Cards share the page gutter with the title and the full-width submit action.
  const gutter = await page
    .locator('main')
    .evaluate((main) => Number.parseFloat(getComputedStyle(main).paddingLeft));
  for (const control of [
    page.getByRole('textbox', { name: lr.request.reasonLabel }),
    page.getByRole('button', { name: lr.request.submit })
  ]) {
    const b = await box(control);
    expect(b.x).toBeGreaterThanOrEqual(gutter - 2);
    expect(b.right).toBeLessThanOrEqual(WIDTH - gutter + 2);
  }
  expect(await layoutViolations(page)).toEqual([]);
  const titleTop = (await box(title)).y;
  const measured = await rasterDifference(
    page,
    info,
    'qWosG',
    'form',
    Math.max(0, Math.round(titleTop) - 20),
    {
      y: 0,
      height: 400
    }
  );
  expect(measured, 'qWosG raster budget').toBeLessThanOrEqual(budget('qWosG'));
});

// --- status (OKYtp), per actual state ----------------------------------------------------

// Reference card crops (CSS px of the frame) for the four state cards.
const STATE_CARDS = {
  pending: { y: 72, height: 54 },
  reviewing: { y: 136, height: 54 },
  approved: { y: 200, height: 69 },
  rejected: { y: 279, height: 54 }
} as const;
const STATE_ACTORS = () => ({ pending, reviewing, approved, rejected });
const STATE_LABELS = {
  pending: lr.status.pending,
  reviewing: lr.status.under_review,
  approved: lr.status.approved,
  rejected: lr.status.rejected
} as const;

for (const state of ['pending', 'reviewing', 'approved', 'rejected'] as const) {
  test(`status screen (${state}) keeps the Pencil structure and a calibrated raster budget`, async ({
    browserName
  }, info) => {
    expect(browserName).toBe('chromium');
    const page = await f.page(STATE_ACTORS()[state], 'en', WIDTH, 'light', 844);
    await open(page, `/level-reviews/${ids[state]}`);
    const title = page.getByRole('heading', { level: 1, name: lr.detail.title });
    const status = page.getByRole('heading', { level: 2, name: STATE_LABELS[state] });
    const ordered: [string, Locator][] = [
      ['title', title],
      ['status card', status],
      ['request details', page.getByRole('heading', { name: lr.detail.reasonLabel })]
    ];
    if (state === 'approved' || state === 'rejected')
      ordered.push([
        'decision card',
        page.getByRole('heading', { name: lr.detail.decisionHeading })
      ]);
    ordered.push(['annotation', page.getByText(lr.detail.annotation)]);
    await expectOrder(ordered);
    // Only the actual state is shown: no other status label appears.
    for (const [other, label] of Object.entries(STATE_LABELS))
      if (other !== state)
        await expect(page.getByRole('heading', { level: 2, name: label, exact: true })).toHaveCount(
          0
        );
    expect(await layoutViolations(page)).toEqual([]);

    const card = status.locator('xpath=ancestor::*[self::section or self::div][1]');
    const cardTop = (await box(card)).y;
    const measured = await rasterDifference(
      page,
      info,
      'OKYtp',
      state,
      Math.max(0, Math.round(cardTop)),
      STATE_CARDS[state]
    );
    expect(measured, `OKYtp ${state} raster budget`).toBeLessThanOrEqual(budget(`OKYtp:${state}`));
  });
}

// --- Platform Admin decision (gGNxk) -----------------------------------------------------

test('platform admin decision keeps the Pencil structure and a calibrated raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const page = await f.page(admin, 'en', WIDTH, 'light', 844);
  await open(page, `/platform-admin/level-reviews/${ids.pending}`);
  const approve = page.getByRole('button', { name: lr.adminDecision.approve, exact: true });
  const reject = page.getByRole('button', { name: lr.adminDecision.reject, exact: true });
  await expectOrder([
    ['title', page.getByRole('heading', { level: 1 })],
    ['player identity', page.getByText(pending.name).first()],
    ['request reason', page.getByText(REASON)],
    ['rating preview', page.getByRole('heading', { name: lr.adminDecision.preview })],
    ['forward-only note', page.getByText(lr.adminDecision.forward)],
    ['approve', approve]
  ]);
  // Approve and Reject are both reachable full-size actions inside the page gutter.
  for (const action of [approve, reject]) {
    const b = await box(action);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.right).toBeLessThanOrEqual(WIDTH);
    expect(b.x).toBeGreaterThanOrEqual(0);
  }
  expect(await layoutViolations(page)).toEqual([]);
  const title = page.getByRole('heading', { level: 1 });
  const measured = await rasterDifference(
    page,
    info,
    'gGNxk',
    'detail',
    Math.max(0, Math.round((await box(title)).y) - 20),
    {
      y: 0,
      height: 640
    }
  );
  expect(measured, 'gGNxk raster budget').toBeLessThanOrEqual(budget('gGNxk'));
});

// --- supplemental structural matrix: viewport x theme x locale ---------------------------

const MATRIX = [
  { width: 320, height: 640, theme: 'light', locale: 'en' },
  { width: 390, height: 844, theme: 'dark', locale: 'en' },
  { width: 390, height: 844, theme: 'light', locale: 'pt-BR' },
  { width: 390, height: 844, theme: 'dark', locale: 'es' },
  { width: 1280, height: 800, theme: 'light', locale: 'en' }
] as const;

for (const variant of MATRIX) {
  test(`layout stays sound: ${variant.width}px ${variant.theme} ${variant.locale}`, async () => {
    const copy = copies[variant.locale].levelReview;
    const owner = await f.page(
      requester,
      variant.locale,
      variant.width,
      variant.theme,
      variant.height
    );
    await open(owner, '/level-reviews/new');
    await expect(owner.getByRole('heading', { level: 1, name: copy.request.title })).toBeVisible();
    expect(await layoutViolations(owner), 'request form').toEqual([]);
    await open(owner, '/level-reviews');
    expect(await layoutViolations(owner), 'history').toEqual([]);

    const decided = await f.page(
      rejected,
      variant.locale,
      variant.width,
      variant.theme,
      variant.height
    );
    await open(decided, `/level-reviews/${ids.rejected}`);
    await expect(
      decided.getByRole('heading', { level: 2, name: copy.status.rejected })
    ).toBeVisible();
    expect(await layoutViolations(decided), 'status').toEqual([]);

    const reviewer = await f.page(
      admin,
      variant.locale,
      variant.width,
      variant.theme,
      variant.height
    );
    await open(reviewer, `/platform-admin/level-reviews/${ids.pending}`);
    await expect(reviewer.getByRole('heading', { name: copy.adminDecision.preview })).toBeVisible();
    expect(await layoutViolations(reviewer), 'admin detail').toEqual([]);
    await open(reviewer, '/platform-admin/level-reviews');
    expect(await layoutViolations(reviewer), 'admin queue').toEqual([]);
  });
}

// --- probe sensitivity -------------------------------------------------------------------

test('the layout probe reports injected defects, so it cannot pass vacuously', async () => {
  const page = await f.page(requester, 'en', WIDTH, 'light', 844);
  await open(page, '/level-reviews/new');
  expect(await layoutViolations(page)).toEqual([]);
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const wide = document.createElement('div');
    wide.style.cssText = 'width: 700px; height: 10px';
    main.append(wide);
    const button = main.querySelector('button')!;
    button.style.minHeight = '0';
    button.style.height = '20px';
  });
  const violations = (await layoutViolations(page)).join('\n');
  expect(violations).toMatch(/overflows horizontally|leaves the viewport/);
  expect(violations).toMatch(/is 20\.0px tall/);
});
