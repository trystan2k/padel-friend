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
// gGNxk Platform Admin decision). Two independent gates:
//  1. exact structural GEOMETRY probes (alignment, column, spacing, header offsets, frame card
//     heights, >=44x44 controls, no overflow/clipping): deterministic, never widened by a budget;
//  2. a FULL-VIEWPORT (390x844) raster comparison against the whole frame. Its budget only
//     absorbs cross-renderer font rasterization and the documented, deliberate differences listed
//     in the manifest; it is calibrated from the measured baseline and is never the structural guard.
// Screen-state variants (OKYtp) are compared per ACTUAL state: the frame stacks four states that
// never coexist on a real request, so its expected image is composed from the frame's own regions.

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
const HEIGHT = 844;
const REASON =
  'I’ve consistently played at this level for years. My recent results have been against much stronger opponents.';
// Exact Pencil frame geometry (CSS px = frame px / 2): page gutter and card stack gap.
const FRAME = { gutter: 18, gap: 10 } as const;

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
      expect(previous.box.bottom, previous.name + ' ends before ' + name).toBeLessThanOrEqual(
        current.y + 1
      );
    previous = { name, box: current };
  }
}

/**
 * Raster- and locale-independent layout defects over the WHOLE document (page controls, dialog
 * portals included): horizontal overflow, clipped content, interactive controls below 44x44 in
 * EITHER dimension (selects, inputs, buttons, links, radio/checkbox labels, pagination), and
 * controls without an accessible name.
 */
async function layoutViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const root = document.documentElement;
    if (root.scrollWidth - root.clientWidth > 0)
      out.push('page overflows horizontally by ' + (root.scrollWidth - root.clientWidth) + 'px');
    if (!document.querySelector('main')) return ['main landmark missing'];
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (
        style.position === 'fixed' ||
        element.closest('[aria-hidden="true"], [data-base-ui-focus-guard]')
      )
        continue;
      if (bounds.right > root.clientWidth + 1 || bounds.left < -1)
        out.push(element.tagName + ' leaves the viewport');
      if (
        style.overflowX !== 'visible' &&
        element.scrollWidth - element.clientWidth > 1 &&
        element.tagName !== 'TEXTAREA' &&
        element.tagName !== 'INPUT'
      )
        out.push(element.tagName + ' clips its content horizontally');
    }
    const controls = document.body.querySelectorAll(
      'a[href], button, input:not([type=hidden]), textarea, select, summary, [role=button], [role=link], [role=tab], [role=menuitem], [tabindex="0"]'
    );
    for (const control of controls) {
      if (control.closest('[aria-hidden="true"], [data-base-ui-focus-guard]')) continue;
      const checkable =
        control instanceof HTMLInputElement &&
        (control.type === 'radio' || control.type === 'checkbox');
      // A native radio/checkbox is operated through its label: the label is the touch target.
      const target = checkable ? (control.closest('label') ?? control) : control;
      const bounds = target.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      const labelled =
        'labels' in control && control.labels instanceof NodeList
          ? [...control.labels].map((label) => label.textContent).join('')
          : '';
      const name =
        control.getAttribute('aria-label') || (control.textContent ?? '').trim() || labelled;
      if (!name && !checkable) out.push(control.tagName + ' has no accessible name');
      if (checkable && !labelled && !control.getAttribute('aria-label'))
        out.push(control.tagName + ' has no accessible name');
      if (bounds.width < 43.5 || bounds.height < 43.5)
        out.push(
          control.tagName +
            ' "' +
            name.slice(0, 24) +
            '" is ' +
            bounds.width.toFixed(1) +
            'x' +
            bounds.height.toFixed(1) +
            'px (needs 44x44)'
        );
    }
    return out;
  });
}

type Block = { name: string; x: number; right: number; y: number; bottom: number };

/** Direct visible children of a container, skipping the header row, back link, title and live regions. */
async function blocksOf(page: Page, container: string): Promise<Block[]> {
  return page
    .locator(container)
    .first()
    .evaluate((element) =>
      [...element.children]
        .filter((child) => !child.matches('header, a, h1, output, [aria-hidden="true"]'))
        .map((child) => {
          const bounds = child.getBoundingClientRect();
          const label = (
            child.querySelector('h2, h3, button')?.textContent ??
            child.textContent ??
            ''
          )
            .trim()
            .slice(0, 24);
          return {
            name: child.tagName.toLowerCase() + ':' + label,
            x: bounds.x,
            right: bounds.right,
            y: bounds.y,
            bottom: bounds.bottom,
            height: bounds.height
          };
        })
        .filter((block) => block.height > 2)
    );
}

const TOLERANCE = 0.5;
const near = (a: number, b: number) => Math.abs(a - b) <= TOLERANCE;

/** Column + rhythm: every block shares the page gutter edges and consecutive blocks are exactly one gap apart. */
function stackViolations(
  blocks: Block[],
  expected: { left: number; right: number; gap: number }
): string[] {
  const out: string[] = [];
  if (blocks.length === 0) return ['no blocks found'];
  blocks.forEach((block, index) => {
    if (!near(block.x, expected.left))
      out.push(block.name + ' left edge ' + block.x + ' != ' + expected.left);
    if (!near(block.right, expected.right))
      out.push(block.name + ' right edge ' + block.right + ' != ' + expected.right);
    const previous = blocks[index - 1];
    if (previous && !near(block.y - previous.bottom, expected.gap))
      out.push(
        previous.name +
          ' -> ' +
          block.name +
          ' gap ' +
          (block.y - previous.bottom) +
          ' != ' +
          expected.gap
      );
  });
  return out;
}

/** Exact per-block heights, independent of the stack spacing and raster budget. */
function heightViolations(blocks: Block[], expected: number[]): string[] {
  if (blocks.length !== expected.length)
    return ['block count ' + blocks.length + ' != ' + expected.length];
  return blocks.flatMap((block, index) => {
    const actual = block.bottom - block.y;
    return near(actual, expected[index]!)
      ? []
      : [block.name + ' height ' + actual + ' != ' + expected[index]];
  });
}

/** Child geometry relative to its containing card; unaffected by document scrolling. */
async function expectRelative(locator: Locator, parent: Locator, top: number, height: number) {
  const child = await box(locator);
  const outer = await box(parent);
  expect(Math.abs(child.y - outer.y - top), 'relative top').toBeLessThanOrEqual(TOLERANCE);
  expect(Math.abs(child.height - height), 'height').toBeLessThanOrEqual(TOLERANCE);
}

/** The standard back-link header: 44x44 back link at the gutter, title beside it, context line below. */
async function expectBackHeader(page: Page) {
  const back = await box(page.locator('main header a').first());
  const title = await box(page.locator('main h1'));
  const context = await box(page.locator('main header > p'));
  const header = await box(page.locator('main header'));
  expect(back, 'back link').toMatchObject({
    x: FRAME.gutter,
    y: FRAME.gutter,
    width: 44,
    height: 44
  });
  expect(title.x, 'title follows the back link by 6px').toBeCloseTo(back.right + 6, 0);
  expect(
    Math.abs(title.y + title.height / 2 - (back.y + back.height / 2)),
    'title is centered on the back link row'
  ).toBeLessThanOrEqual(1);
  expect(context.y, 'context line sits 5px under the title row').toBeCloseTo(back.bottom + 5, 0);
  expect(context.x).toBeCloseTo(FRAME.gutter, 0);
  expect(header.right).toBeCloseTo(WIDTH - FRAME.gutter, 0);
  return header;
}

async function expectGutter(page: Page) {
  const gutter = await page
    .locator('main')
    .evaluate((main) => Number.parseFloat(getComputedStyle(main).paddingLeft));
  expect(gutter, 'page gutter equals the Pencil frame gutter').toBeCloseTo(FRAME.gutter, 0);
}

/** Card inner inset: heading and body text keep the 10px card padding on both sides. */
async function expectCardInset(card: Locator) {
  const outer = await box(card);
  const heading = await box(card.locator('h2, h3, p, label').first());
  expect(heading.x - outer.x, 'card inset').toBeCloseTo(10, 0);
  expect(outer.right - heading.right, 'card inset right').toBeCloseTo(10, 0);
}

type Tile = { src: number; height: number; dest: number };

/**
 * Share of perceptibly different pixels (YIQ, threshold 0.1) between the FULL live 390x844
 * viewport and an expected image composed from the approved frame (one or more frame regions
 * placed at the position where the live screen renders the same region).
 */
async function rasterDifference(
  page: Page,
  info: TestInfo,
  frame: string,
  label: string,
  tiles: Tile[]
): Promise<number> {
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    path: info.outputPath(frame + '-' + label + '-actual.png')
  });
  const referencePng = readFileSync(
    new URL('./references/paf-17/' + frame + '.png', import.meta.url)
  );
  const result = await page.evaluate(
    async ({ actualUrl, approvedUrl, area }) => {
      const decode = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
      };
      const [shot, reference] = await Promise.all([decode(actualUrl), decode(approvedUrl)]);
      const draw = (paint: (context: CanvasRenderingContext2D) => void) => {
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        paint(context);
        return canvas;
      };
      const rendered = draw((context) => context.drawImage(shot, 0, 0, area.width, area.height));
      const expectedCanvas = draw((context) => {
        // Page background sampled from an empty frame area, then each frame region at its live position.
        const sample = document.createElement('canvas');
        sample.width = 1;
        sample.height = 1;
        const sampleContext = sample.getContext('2d')!;
        sampleContext.drawImage(reference, 8, 1300, 1, 1, 0, 0, 1, 1);
        const [red, green, blue] = sampleContext.getImageData(0, 0, 1, 1).data;
        context.fillStyle = 'rgb(' + red + ',' + green + ',' + blue + ')';
        context.fillRect(0, 0, area.width, area.height);
        for (const tile of area.tiles)
          context.drawImage(
            reference,
            0,
            tile.src * 2,
            area.width * 2,
            tile.height * 2,
            0,
            tile.dest,
            area.width,
            tile.height
          );
      });
      const a = rendered.getContext('2d')!.getImageData(0, 0, area.width, area.height).data;
      const b = expectedCanvas.getContext('2d')!.getImageData(0, 0, area.width, area.height).data;
      let changed = 0;
      for (let index = 0; index < a.length; index += 4) {
        const red = a[index]! - b[index]!;
        const green = a[index + 1]! - b[index + 1]!;
        const blue = a[index + 2]! - b[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        )
          changed++;
      }
      return {
        share: changed / (area.width * area.height),
        expected: expectedCanvas.toDataURL('image/png')
      };
    },
    {
      actualUrl: 'data:image/png;base64,' + actual.toString('base64'),
      approvedUrl: 'data:image/png;base64,' + referencePng.toString('base64'),
      area: { width: WIDTH, height: HEIGHT, tiles }
    }
  );
  console.info('PAF-17 raster ' + frame + ' ' + label + ': ' + result.share);
  await info.attach(frame + '-' + label + '-actual', { body: actual, contentType: 'image/png' });
  await info.attach(frame + '-' + label + '-expected', {
    body: Buffer.from(result.expected.split(',')[1]!, 'base64'),
    contentType: 'image/png'
  });
  return result.share;
}

function budget(key: string): number {
  const value = (manifest.visualBudgets.perScreen as Record<string, number>)[key];
  expect(value, 'manifest budget for ' + key).toBeGreaterThan(0);
  return value!;
}

// --- provenance --------------------------------------------------------------------------

test('reference provenance pins the design source and all three exported frames', () => {
  const design = readFileSync(new URL('../docs/design/padel-friend.pen', import.meta.url));
  expect(createHash('sha256').update(design).digest('hex')).toBe(manifest.sourceDesign.sha256);
  for (const [frame, reference] of Object.entries(manifest.approvedReferences)) {
    const png = readFileSync(new URL('./references/paf-17/' + reference.file, import.meta.url));
    expect(createHash('sha256').update(png).digest('hex'), frame).toBe(reference.sha256);
    expect([png.readUInt32BE(16), png.readUInt32BE(20)], frame).toEqual(reference.pixelSize);
  }
});

// --- request (qWosG) ---------------------------------------------------------------------

// Frame regions (CSS px): header band above the first card, cards from y72.
const FRAME_TITLE_TOP = 20;
const FRAME_HEADER = 72;

test('request form keeps the Pencil geometry and a calibrated full-screen raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const page = await f.page(requester, 'en', WIDTH, 'light', HEIGHT);
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
  // Geometry: gutter, header offsets, one column, 10px rhythm, full-width submit.
  await expectGutter(page);
  const header = await expectBackHeader(page);
  const blocks = await blocksOf(page, 'main > form');
  const form = page.locator('main > form');
  const current = form.locator(':scope > section').first();
  const fieldset = form.locator(':scope > fieldset');
  const reason = form.locator(':scope > section').nth(1);
  const disclosure = form.locator(':scope > div').first();
  await expectRelative(current.locator('h2'), current, 10, 15);
  await expectRelative(current.locator('p').first(), current, 31, 15);
  await expectRelative(current.locator('p').last(), current, 52, 15);
  await expectRelative(
    page.getByRole('textbox', { name: lr.request.levelExact }),
    fieldset,
    86,
    44
  );
  await expectRelative(
    page.getByRole('textbox', { name: lr.request.reasonLabel }),
    reason,
    31,
    120
  );
  await page.locator('main input[type=radio][value=range]').check();
  await expectRelative(fieldset, form, 87, 277);
  await expectRelative(fieldset.locator('input:not([type=radio])').nth(0), fieldset, 86, 44);
  await expectRelative(fieldset.locator('input:not([type=radio])').nth(1), fieldset, 195, 44);
  await page.locator('main input[type=radio][value=exact]').check();
  await page.getByRole('button', { name: lr.request.evidenceShow }).click();
  await expectRelative(disclosure, form, 457, 227);
  await expectRelative(
    page.getByRole('textbox', { name: lr.request.evidenceLabel }),
    disclosure,
    71,
    120
  );
  await page.getByRole('button', { name: lr.request.evidenceHide }).click();
  expect(heightViolations(blocks, [77, 168, 182, 44, 65, 50])).toEqual([]);
  expect(blocks.map((block) => block.name.split(':')[0])).toEqual([
    'section',
    'fieldset',
    'section',
    'div',
    'p',
    'button'
  ]);
  expect(
    stackViolations(blocks, { left: FRAME.gutter, right: WIDTH - FRAME.gutter, gap: FRAME.gap })
  ).toEqual([]);
  expect(blocks[0]!.y - header.bottom, 'first card sits one gap under the header').toBeCloseTo(
    FRAME.gap,
    0
  );
  const submit = await box(page.getByRole('button', { name: lr.request.submit }));
  expect(submit).toMatchObject({ x: FRAME.gutter, width: WIDTH - 2 * FRAME.gutter });
  expect(submit.height).toBeGreaterThanOrEqual(44);
  await expectCardInset(page.locator('main > form > section').first());
  expect(await layoutViolations(page)).toEqual([]);

  const titleTop = (await box(title)).y;
  const cardTop = blocks[0]!.y;
  const shift = Math.round(titleTop) - FRAME_TITLE_TOP;
  const measured = await rasterDifference(page, info, 'qWosG', 'form', [
    { src: 0, height: Math.min(FRAME_HEADER, cardTop - shift), dest: shift },
    { src: FRAME_HEADER, height: HEIGHT - FRAME_HEADER, dest: Math.round(cardTop) }
  ]);
  expect(measured, 'qWosG raster budget').toBeLessThanOrEqual(budget('qWosG'));
});

// --- status (OKYtp), per actual state ----------------------------------------------------

// Reference card regions (CSS px of the frame) for the four state cards; annotation + nav bands.
const STATE_CARDS = {
  pending: { y: 72, height: 54 },
  reviewing: { y: 136, height: 54 },
  approved: { y: 200, height: 69 },
  rejected: { y: 279, height: 54 }
} as const;
const FRAME_ANNOTATION = { y: 343, height: 50 } as const;
const FRAME_NAV = { y: 774, height: 70 } as const;
const STATE_ACTORS = () => ({ pending, reviewing, approved, rejected });
const STATE_LABELS = {
  pending: lr.status.pending,
  reviewing: lr.status.under_review,
  approved: lr.status.approved,
  rejected: lr.status.rejected
} as const;

for (const state of ['pending', 'reviewing', 'approved', 'rejected'] as const) {
  test(
    'status screen (' +
      state +
      ') keeps the Pencil geometry and a calibrated full-screen raster budget',
    async ({ browserName }, info) => {
      expect(browserName).toBe('chromium');
      const page = await f.page(STATE_ACTORS()[state], 'en', WIDTH, 'light', HEIGHT);
      await open(page, '/level-reviews/' + ids[state]);
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
          await expect(
            page.getByRole('heading', { level: 2, name: label, exact: true })
          ).toHaveCount(0);

      // Geometry: gutter, header offsets, one column, 10px rhythm, frame-exact status card height.
      await expectGutter(page);
      const header = await expectBackHeader(page);
      const blocks = await blocksOf(page, 'main');
      expect(blocks.length).toBeGreaterThanOrEqual(3);
      expect(
        stackViolations(blocks, { left: FRAME.gutter, right: WIDTH - FRAME.gutter, gap: FRAME.gap })
      ).toEqual([]);
      expect(blocks[0]!.y - header.bottom, 'status card sits one gap under the header').toBeCloseTo(
        FRAME.gap,
        0
      );
      const card = status.locator('xpath=ancestor::section[1]');
      const cardBox = await box(card);
      expect(cardBox.height, 'status card height equals the Pencil card').toBeCloseTo(
        STATE_CARDS[state].height,
        0
      );
      expect(cardBox.y).toBeCloseTo(blocks[0]!.y, 0);
      await expectCardInset(card);
      const annotation = await box(page.getByText(lr.detail.annotation));
      expect(annotation.x).toBeCloseTo(FRAME.gutter, 0);
      expect(annotation.right).toBeCloseTo(WIDTH - FRAME.gutter, 0);
      expect(await layoutViolations(page)).toEqual([]);

      const shift = Math.round((await box(title)).y) - FRAME_TITLE_TOP;
      const cardTop = Math.round(cardBox.y);
      const measured = await rasterDifference(page, info, 'OKYtp', state, [
        { src: 0, height: Math.min(FRAME_HEADER, cardTop - shift), dest: shift },
        { src: STATE_CARDS[state].y, height: STATE_CARDS[state].height, dest: cardTop },
        {
          src: FRAME_ANNOTATION.y,
          height: FRAME_ANNOTATION.height,
          dest: Math.round(annotation.y)
        },
        { src: FRAME_NAV.y, height: FRAME_NAV.height, dest: FRAME_NAV.y }
      ]);
      expect(measured, 'OKYtp ' + state + ' raster budget').toBeLessThanOrEqual(
        budget('OKYtp:' + state)
      );
    }
  );
}

// --- Platform Admin decision (gGNxk) -----------------------------------------------------

const FRAME_ADMIN_TITLE_TOP = 24;
const FRAME_ADMIN_BODY = 79;

test('platform admin decision keeps the Pencil geometry and a calibrated full-screen raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const page = await f.page(admin, 'en', WIDTH, 'light', HEIGHT);
  await open(page, '/platform-admin/level-reviews/' + ids.pending);
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
  // Geometry: back link row, title under it, one column of cards on the 10px rhythm.
  await expectGutter(page);
  const back = await box(page.locator('main > a').first());
  const title = await box(page.getByRole('heading', { level: 1 }));
  expect(back, 'back link').toMatchObject({ x: FRAME.gutter, y: FRAME.gutter, height: 44 });
  expect(back.width).toBeGreaterThanOrEqual(44);
  expect(title.x).toBeCloseTo(FRAME.gutter, 0);
  expect(title.y, 'title sits one gap under the back link').toBeCloseTo(back.bottom + FRAME.gap, 0);
  const blocks = await blocksOf(page, 'main');
  expect(heightViolations(blocks, [180, 75, 60, 96, 501])).toEqual([]);
  expect(blocks.map((block) => block.name.split(':')[0])).toEqual([
    'section',
    'section',
    'section',
    'section',
    'section'
  ]);
  expect(
    stackViolations(blocks, { left: FRAME.gutter, right: WIDTH - FRAME.gutter, gap: FRAME.gap })
  ).toEqual([]);
  expect(blocks[0]!.y - (title.y + title.height), 'identity card one gap under title').toBeCloseTo(
    FRAME.gap,
    0
  );
  await expectCardInset(page.locator('main > section').first());
  // Approve and Reject are full-width, full-size actions inside the decision card's inset.
  const decisionCard = await box(page.locator('main > section').last());
  const decision = page.locator('main > section').last();
  await expectRelative(
    page.getByRole('textbox', { name: lr.adminDecision.target }),
    decision,
    81,
    44
  );
  await expectRelative(decision.locator('fieldset'), decision, 131, 111);
  await expectRelative(
    page.getByRole('textbox', { name: lr.adminDecision.note }),
    decision,
    269,
    120
  );
  await expectRelative(approve, decision, 395, 44);
  await expectRelative(reject, decision, 447, 44);
  const approveBox = await box(approve);
  const rejectBox = await box(reject);
  for (const action of [approveBox, rejectBox]) {
    expect(action.height).toBeGreaterThanOrEqual(44);
    expect(action.x).toBeCloseTo(decisionCard.x + 10, 0);
    expect(action.right).toBeCloseTo(decisionCard.right - 10, 0);
  }
  expect(rejectBox.y - approveBox.bottom, 'Approve and Reject are one 8px step apart').toBeCloseTo(
    8,
    0
  );
  expect(await layoutViolations(page)).toEqual([]);

  const audited = await f.page(admin, 'en', WIDTH, 'light', HEIGHT);
  await open(audited, '/platform-admin/level-reviews/' + ids.approved);
  const auditedBlocks = await blocksOf(audited, 'main');
  expect(heightViolations(auditedBlocks, [180, 75, 60, 131, 210])).toEqual([]);
  expect(
    stackViolations(auditedBlocks, {
      left: FRAME.gutter,
      right: WIDTH - FRAME.gutter,
      gap: FRAME.gap
    })
  ).toEqual([]);
  const shift = Math.round(title.y) - FRAME_ADMIN_TITLE_TOP;
  const bodyTop = Math.round(blocks[0]!.y);
  const measured = await rasterDifference(page, info, 'gGNxk', 'detail', [
    { src: 0, height: Math.min(FRAME_ADMIN_BODY, bodyTop - shift), dest: shift },
    { src: FRAME_ADMIN_BODY, height: HEIGHT - FRAME_ADMIN_BODY, dest: bodyTop }
  ]);
  expect(measured, 'gGNxk raster budget').toBeLessThanOrEqual(budget('gGNxk'));
});

test('admin queue keeps one column, a full-width 44px filter and an 8px list rhythm', async () => {
  const page = await f.page(admin, 'en', WIDTH, 'light', HEIGHT);
  await open(page, '/platform-admin/level-reviews');
  await expectGutter(page);
  const filter = await box(page.getByRole('combobox', { name: lr.admin.filter }));
  expect(filter).toMatchObject({ x: FRAME.gutter, width: WIDTH - 2 * FRAME.gutter });
  expect(filter.height).toBeGreaterThanOrEqual(44);
  const items = await blocksOf(page, 'main ul');
  expect(items.length).toBeGreaterThanOrEqual(4);
  expect(
    stackViolations(items, { left: FRAME.gutter, right: WIDTH - FRAME.gutter, gap: 8 })
  ).toEqual([]);
  expect(await layoutViolations(page)).toEqual([]);
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
  test(
    'layout stays sound: ' + variant.width + 'px ' + variant.theme + ' ' + variant.locale,
    async () => {
      const copy = copies[variant.locale].levelReview;
      const owner = await f.page(
        requester,
        variant.locale,
        variant.width,
        variant.theme,
        variant.height
      );
      await open(owner, '/level-reviews/new');
      await expect(
        owner.getByRole('heading', { level: 1, name: copy.request.title })
      ).toBeVisible();
      expect(await layoutViolations(owner), 'request form').toEqual([]);
      await owner.getByRole('button', { name: copy.request.evidenceShow }).click();
      await expect(owner.getByRole('textbox', { name: copy.request.evidenceLabel })).toBeVisible();
      expect(await layoutViolations(owner), 'expanded evidence').toEqual([]);
      await open(owner, '/level-reviews');
      expect(await layoutViolations(owner), 'history').toEqual([]);

      const decided = await f.page(
        rejected,
        variant.locale,
        variant.width,
        variant.theme,
        variant.height
      );
      await open(decided, '/level-reviews/' + ids.rejected);
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
      await open(reviewer, '/platform-admin/level-reviews/' + ids.pending);
      await expect(
        reviewer.getByRole('heading', { name: copy.adminDecision.preview })
      ).toBeVisible();
      expect(await layoutViolations(reviewer), 'admin detail').toEqual([]);
      await reviewer.getByRole('radio', { name: copy.adminDecision.reduce }).check();
      await expect(
        reviewer.getByRole('textbox', { name: copy.adminDecision.reduction })
      ).toBeVisible();
      await expect(
        reviewer.getByRole('textbox', { name: copy.adminDecision.justification })
      ).toBeVisible();
      expect(await layoutViolations(reviewer), 'reduce controls').toEqual([]);
      await reviewer.getByRole('radio', { name: copy.adminDecision.reset }).check();
      await expect(
        reviewer.getByRole('textbox', { name: copy.adminDecision.justification })
      ).toBeVisible();
      expect(await layoutViolations(reviewer), 'reset controls').toEqual([]);
      await open(reviewer, '/platform-admin/level-reviews');
      expect(await layoutViolations(reviewer), 'admin queue').toEqual([]);
    }
  );
}

// --- 200% zoom ---------------------------------------------------------------------------

// 200% browser zoom halves the CSS viewport: 1280x800 -> 640x400 and 390x844 -> 195x422.
const ZOOMED = [
  { width: 640, height: 400, label: '1280px desktop at 200%' },
  { width: 195, height: 422, label: '390px mobile at 200%' }
] as const;

for (const zoom of ZOOMED) {
  test(
    '200% zoom reflows without horizontal scrolling and keeps controls reachable: ' + zoom.label,
    async () => {
      const owner = await f.page(requester, 'en', zoom.width, 'light', zoom.height);
      await open(owner, '/level-reviews/new');
      // Probe only once the request form exposes its labelled controls.
      await expect(owner.getByRole('textbox', { name: lr.request.levelExact })).toBeVisible();
      await expect(owner.getByRole('textbox', { name: lr.request.reasonLabel })).toBeVisible();
      expect(await layoutViolations(owner), 'request form').toEqual([]);
      const submit = owner.getByRole('button', { name: lr.request.submit });
      await submit.scrollIntoViewIfNeeded();
      await expect(submit, 'submit reachable by scrolling').toBeInViewport({ ratio: 1 });

      const decided = await f.page(pending, 'en', zoom.width, 'light', zoom.height);
      await open(decided, '/level-reviews/' + ids.pending);
      expect(await layoutViolations(decided), 'status').toEqual([]);
      const cancel = decided.getByRole('button', { name: lr.detail.cancel });
      await cancel.scrollIntoViewIfNeeded();
      await expect(cancel, 'cancel reachable by scrolling').toBeInViewport({ ratio: 1 });

      const reviewer = await f.page(admin, 'en', zoom.width, 'light', zoom.height);
      await open(reviewer, '/platform-admin/level-reviews/' + ids.pending);
      // Probe only once the decision form exposes its labelled controls.
      await expect(reviewer.getByRole('textbox', { name: lr.adminDecision.note })).toBeVisible();
      expect(await layoutViolations(reviewer), 'admin detail').toEqual([]);
      for (const name of [lr.adminDecision.approve, lr.adminDecision.reject]) {
        const action = reviewer.getByRole('button', { name, exact: true });
        await action.scrollIntoViewIfNeeded();
        await expect(action, name + ' reachable by scrolling').toBeInViewport({ ratio: 1 });
      }
      await open(reviewer, '/platform-admin/level-reviews');
      expect(await layoutViolations(reviewer), 'admin queue').toEqual([]);
    }
  );
}

// --- contrast (WCAG AA) ------------------------------------------------------------------

/** Text contrast against the composited ancestor background; large text needs 3:1, other text 4.5:1. */
async function contrastViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const scratch = document.createElement('canvas');
    scratch.width = scratch.height = 1;
    const context = scratch.getContext('2d', { willReadFrequently: true })!;
    // Any CSS color (rgb, oklch, color-mix, color(srgb)) normalized to sRGB through a canvas.
    const parse = (value: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = '#000';
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return { r: r!, g: g!, b: b!, a: a! / 255 };
    };
    const blend = (top: ReturnType<typeof parse>, bottom: ReturnType<typeof parse>) => ({
      r: top.r * top.a + bottom.r * (1 - top.a),
      g: top.g * top.a + bottom.g * (1 - top.a),
      b: top.b * top.a + bottom.b * (1 - top.a),
      a: 1
    });
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const out: string[] = [];
    const seen = new Set<string>();
    for (const element of document.body.querySelectorAll('*')) {
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== ''
      );
      if (!own) continue;
      const bounds = element.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) continue;
      if (element.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || Number(style.opacity) === 0) continue;
      let background = { r: 255, g: 255, b: 255, a: 1 };
      const chain: Element[] = [];
      for (let node: Element | null = element; node; node = node.parentElement) chain.push(node);
      for (const node of chain.reverse())
        background = blend(parse(getComputedStyle(node).backgroundColor), background);
      const text = blend(parse(style.color), background);
      const l1 = luminance(text);
      const l2 = luminance(background);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const bold = Number.parseInt(style.fontWeight, 10) >= 700;
      const required = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
      if (ratio < required) {
        const key = element.tagName + (element.textContent ?? '').trim().slice(0, 24);
        if (!seen.has(key)) {
          seen.add(key);
          out.push(key + ' ' + ratio.toFixed(2) + ':1 (needs ' + required + ')');
        }
      }
    }
    // Check visible control boundaries against their adjacent surface. Filled controls use
    // their fill as the boundary; outlined controls use their border.
    const controls = document.querySelectorAll(
      'main input:not([type=hidden]), main textarea, main select, main button, [role=alertdialog] :is(a[href], button, input:not([type=hidden]), textarea, select, summary, [tabindex]:not([tabindex="-1"]))'
    );
    for (const control of controls) {
      if (control.closest('[disabled], [aria-disabled="true"], [aria-hidden="true"]')) continue;
      const bounds = control.getBoundingClientRect();
      const style = getComputedStyle(control);
      if (!bounds.width || !bounds.height || style.visibility === 'hidden') continue;
      // Radio choices render as a labelled tile; native radio chrome is not exposed
      // as a computed CSS border, so inspect the surrounding tile instead.
      const target =
        control instanceof HTMLInputElement && control.type === 'radio'
          ? (control.closest('label') ?? control)
          : control;
      const boundaryStyle = getComputedStyle(target);
      let adjacent = { r: 255, g: 255, b: 255, a: 1 };
      const parents: Element[] = [];
      for (let node = target.parentElement; node; node = node.parentElement) parents.push(node);
      for (const node of parents.reverse())
        adjacent = blend(parse(getComputedStyle(node).backgroundColor), adjacent);
      const fill = blend(parse(boundaryStyle.backgroundColor), adjacent);
      const border = parse(boundaryStyle.borderTopColor);
      const boundary =
        boundaryStyle.borderTopStyle !== 'none' &&
        Number.parseFloat(boundaryStyle.borderTopWidth) > 0 &&
        border.a > 0
          ? blend(border, adjacent)
          : fill;
      const l1 = luminance(boundary);
      const l2 = luminance(adjacent);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio < 3)
        out.push(
          control.tagName +
            ' "' +
            (control.getAttribute('aria-label') ||
              (control.textContent ?? '').trim().slice(0, 24)) +
            '" boundary ' +
            ratio.toFixed(2) +
            ':1 (needs 3)'
        );
      if (control === document.activeElement) {
        const outline = style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0;
        const shadowColor = style.boxShadow.match(/(?:rgba?|oklch|color)\([^)]*\)/)?.[0];
        const ringColor = outline ? style.outlineColor : shadowColor;
        if (!ringColor) {
          out.push(control.tagName + ' focus indicator missing');
        } else {
          const ring = blend(parse(ringColor), adjacent);
          const ringLuminance = luminance(ring);
          const ringRatio =
            (Math.max(ringLuminance, l2) + 0.05) / (Math.min(ringLuminance, l2) + 0.05);
          if (ringRatio < 3)
            out.push(control.tagName + ' focus indicator ' + ringRatio.toFixed(2) + ':1 (needs 3)');
        }
      }
    }
    return out;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(
    'text and control contrast meets WCAG AA on every level review screen (' + theme + ')',
    async () => {
      const screens: [Actor, string][] = [
        [requester, '/level-reviews/new'],
        [requester, '/level-reviews'],
        [pending, '/level-reviews/' + ids.pending],
        [reviewing, '/level-reviews/' + ids.reviewing],
        [approved, '/level-reviews/' + ids.approved],
        [rejected, '/level-reviews/' + ids.rejected],
        [admin, '/platform-admin/level-reviews'],
        [admin, '/platform-admin/level-reviews/' + ids.pending]
      ];
      for (const [actor, path] of screens) {
        const page = await f.page(actor, 'en', WIDTH, theme, HEIGHT);
        await open(page, path);
        expect.soft(await contrastViolations(page), path).toEqual([]);
        if (path === '/level-reviews/new' || path.startsWith('/platform-admin/level-reviews')) {
          const controls = page.locator(
            'main input:not([type=hidden]):not(:disabled), main textarea:not(:disabled), main select:not(:disabled), main button:not(:disabled)'
          );
          for (let index = 0; index < (await controls.count()); index++) {
            const control = controls.nth(index);
            if (!(await control.isVisible())) continue;
            await control.focus();
            expect.soft(await contrastViolations(page), path + ' focus ' + index).toEqual([]);
          }
        }
      }
    }
  );
}

// --- keyboard traversal, focus restoration, reduced motion (admin decision flow) ---------

async function focusedName(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) return { name: '', y: -1 };
    const labels =
      'labels' in element && element.labels instanceof NodeList ? [...element.labels] : [];
    return {
      name:
        element.getAttribute('aria-label') ||
        labels
          .map((label) => label.textContent)
          .join('')
          .trim() ||
        (element.textContent ?? '').trim().slice(0, 40),
      y: element.getBoundingClientRect().y + window.scrollY
    };
  });
}

async function expectFocusAppearance(page: Page) {
  const indicator = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const outline =
      style.outlineStyle !== 'none' &&
      Number.parseFloat(style.outlineWidth) > 0 &&
      style.outlineColor !== 'rgba(0, 0, 0, 0)';
    const shadow = style.boxShadow !== 'none' && !style.boxShadow.includes('rgba(0, 0, 0, 0)');
    return outline || shadow;
  });
  expect(indicator, 'focused element has a visible outline or ring').toBe(true);
}

test('keyboard traversal follows the visual order and the confirmation dialog restores focus', async () => {
  const owner = await f.page(requester, 'en', WIDTH, 'light', HEIGHT);
  await open(owner, '/level-reviews/new');
  await owner.getByRole('button', { name: lr.request.submit }).click();
  await expect(owner.getByRole('textbox', { name: lr.request.levelExact })).toBeFocused();
  await expectFocusAppearance(owner);
  const page = await f.page(admin, 'en', WIDTH, 'light', HEIGHT);
  await open(page, '/platform-admin/level-reviews/' + ids.pending);
  const approve = page.getByRole('button', { name: lr.adminDecision.approve, exact: true });
  const reject = page.getByRole('button', { name: lr.adminDecision.reject, exact: true });
  await page.getByRole('textbox', { name: lr.adminDecision.target }).fill('3.6');
  await page.getByRole('textbox', { name: lr.adminDecision.note }).fill('Keyboard note.');

  // Tab from the page start: every stop is visible, after the page-level controls the order
  // never moves upward, and Approve is reached before Reject.
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const stops: { name: string; y: number }[] = [];
  for (let step = 0; step < 24; step++) {
    await page.keyboard.press('Tab');
    const stop = await focusedName(page);
    stops.push(stop);
    if (stop.name === lr.adminDecision.reject) break;
  }
  const names = stops.map((stop) => stop.name);
  expect(names).toContain(lr.adminDecision.approve);
  expect(names.indexOf(lr.adminDecision.approve)).toBeLessThan(
    names.indexOf(lr.adminDecision.reject)
  );
  const content = stops.slice(names.indexOf(lr.adminDecision.target) >= 0 ? 0 : 2);
  const ys = content.map((stop) => stop.y);
  expect(ys.every((y) => y >= 0)).toBe(true);
  // Page chrome (locale/theme selects) comes first; afterwards focus only moves down the page.
  const afterChrome = ys.slice(ys.findIndex((y, index) => index > 1 && y > 60));
  expect([...afterChrome].sort((a, b) => a - b)).toEqual(afterChrome);

  for (const [trigger, dialogName] of [
    [approve, lr.adminDecision.confirmApprove],
    [reject, lr.adminDecision.confirmReject]
  ] as const) {
    await trigger.focus();
    await expectFocusAppearance(page);
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: dialogName });
    await expect(dialog).toBeVisible();
    // Focus is trapped: five Tab presses never leave the dialog.
    for (let step = 0; step < 5; step++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
        .toBe(true);
      await expectFocusAppearance(page);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger, 'focus returns to the trigger after Escape').toBeFocused();
  }

  // Cancel through the keyboard-activated "Go back" action also restores focus.
  await approve.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: lr.adminDecision.cancel }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog).toBeHidden();
  await expect(approve).toBeFocused();
});

for (const theme of ['light', 'dark'] as const) {
  test(
    'the open confirmation dialog keeps 44x44 controls and contrast (' + theme + ')',
    async () => {
      const page = await f.page(admin, 'en', WIDTH, theme, HEIGHT);
      await open(page, '/platform-admin/level-reviews/' + ids.pending);
      await page.getByRole('textbox', { name: lr.adminDecision.target }).fill('3.6');
      await page.getByRole('textbox', { name: lr.adminDecision.note }).fill('Dialog probe.');
      for (const action of [lr.adminDecision.approve, lr.adminDecision.reject]) {
        await page.getByRole('button', { name: action, exact: true }).focus();
        await page.keyboard.press('Enter');
        const dialog = page.getByRole('alertdialog');
        await expect(dialog).toBeVisible();
        expect(await layoutViolations(page), 'dialog open').toEqual([]);
        expect(await contrastViolations(page), 'dialog open').toEqual([]);
        const focusable = dialog.locator(
          'a[href], button, input:not([type=hidden]), textarea, select, summary, [tabindex]:not([tabindex="-1"])'
        );
        for (const control of await focusable.all()) {
          if (!(await control.isVisible())) continue;
          const bounds = await box(control);
          expect(bounds.width, 'dialog focusable width').toBeGreaterThanOrEqual(44);
          expect(bounds.height, 'dialog focusable height').toBeGreaterThanOrEqual(44);
          await control.focus();
          await expect(control).toBeFocused();
          expect.soft(await contrastViolations(page), action + ' dialog focus').toEqual([]);
        }
        for (const name of [lr.adminDecision.cancel, lr.adminDecision.confirm]) {
          const control = await box(dialog.getByRole('button', { name }));
          expect(control.width, name + ' width').toBeGreaterThanOrEqual(44);
          expect(control.height, name + ' height').toBeGreaterThanOrEqual(44);
        }
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden();
      }
    }
  );
}

/**
 * The level review screens register no CSS transition, CSS animation or Web Animation: under
 * prefers-reduced-motion every element reports zero-length motion, so the preference cannot be violated.
 */
async function motionViolations(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const seconds = (value: string) =>
      value.split(',').reduce((total, part) => total + (Number.parseFloat(part) || 0), 0);
    for (const element of document.body.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (seconds(style.transitionDuration) > 0)
        out.push(element.tagName + ' transitions ' + style.transitionDuration);
      if (style.animationName !== 'none' && seconds(style.animationDuration) > 0)
        out.push(element.tagName + ' animates ' + style.animationName);
    }
    const running = document.getAnimations().length;
    if (running > 0) out.push(running + ' running web animations');
    return out;
  });
}

test('reduced motion: no level review screen or dialog registers motion', async () => {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    const page = await f.page(admin, 'en', WIDTH, 'light', HEIGHT);
    await page.emulateMedia({ reducedMotion });
    await open(page, '/platform-admin/level-reviews/' + ids.pending);
    expect(await motionViolations(page), 'admin detail ' + reducedMotion).toEqual([]);
    await page.getByRole('textbox', { name: lr.adminDecision.target }).fill('3.6');
    await page.getByRole('textbox', { name: lr.adminDecision.note }).fill('Motion probe.');
    await page.getByRole('button', { name: lr.adminDecision.approve, exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    expect(await motionViolations(page), 'dialog ' + reducedMotion).toEqual([]);
    await page.keyboard.press('Escape');
    const owner = await f.page(requester, 'en', WIDTH, 'light', HEIGHT);
    await owner.emulateMedia({ reducedMotion });
    await open(owner, '/level-reviews/new');
    expect(await motionViolations(owner), 'request form ' + reducedMotion).toEqual([]);
  }
});

// --- probe sensitivity -------------------------------------------------------------------

test('the layout, geometry, contrast and motion probes report injected defects, so they cannot pass vacuously', async () => {
  const page = await f.page(requester, 'en', WIDTH, 'light', HEIGHT);
  await open(page, '/level-reviews/new');
  expect(await layoutViolations(page)).toEqual([]);
  const clean = await blocksOf(page, 'main > form');
  expect(
    stackViolations(clean, { left: FRAME.gutter, right: WIDTH - FRAME.gutter, gap: FRAME.gap })
  ).toEqual([]);
  await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const wide = document.createElement('div');
    wide.style.cssText = 'width: 700px; height: 10px';
    main.append(wide);
    const button = main.querySelector('button')!;
    button.style.minHeight = '0';
    button.style.height = '20px';
    // A control that is tall enough but too narrow, and one select below 44px.
    const narrow = document.createElement('a');
    narrow.href = '/';
    narrow.textContent = 'x';
    narrow.style.cssText = 'display:inline-block;width:30px;height:48px';
    main.append(narrow);
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'injected select');
    select.style.cssText = 'width:48px;height:20px;min-height:0';
    main.append(select);
    // Shift one card sideways and open an extra 6px between two cards.
    const [first, second] = main.querySelectorAll<HTMLElement>('form > section');
    if (first) {
      first.style.marginLeft = '6px';
      first.style.height = first.getBoundingClientRect().height + 20 + 'px';
      first.style.boxSizing = 'border-box';
    }
    if (second) second.style.marginTop = '6px';
    // Low contrast text.
    const faint = document.createElement('p');
    faint.textContent = 'faint';
    faint.style.cssText = 'color:#bbb;background:#fff';
    main.append(faint);
  });
  const violations = (await layoutViolations(page)).join('\n');
  expect(violations).toMatch(/overflows horizontally|leaves the viewport/);
  expect(violations).toMatch(/is \d+\.\dx20\.0px/);
  expect(violations).toMatch(/"x" is 30\.0x48\.0px/);
  expect(violations).toMatch(/SELECT "injected select" is 48\.0x20\.0px/);
  const moved = stackViolations(await blocksOf(page, 'main > form'), {
    left: FRAME.gutter,
    right: WIDTH - FRAME.gutter,
    gap: FRAME.gap
  }).join('\n');
  expect(
    heightViolations(await blocksOf(page, 'main > form'), [77, 168, 182, 44, 65, 50]).join('\n')
  ).toMatch(/height 97 != 77/);
  expect(moved).toMatch(/left edge/);
  expect(moved).toMatch(/gap 16 != 10|gap/);
  expect((await contrastViolations(page)).join('\n')).toMatch(/faint/);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'main button { transition: transform 200ms; }';
    document.head.append(style);
  });
  expect((await motionViolations(page)).join('\n')).toMatch(/transitions/);
});
