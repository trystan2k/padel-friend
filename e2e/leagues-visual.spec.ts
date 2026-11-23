import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { waitForHydratedPage } from './auth-helpers';
import { assertFrameRegions, type FrameRegionRecord } from './frame-regions';
import { copies, day, fill, leagueFixtures, sql, type Actor } from './leagues-fixtures';
import manifest from './references/paf-202-leagues/manifest.json' with { type: 'json' };

// League visual + structural certification. ik5JC and MYsDp are compared with the Clubhouse 1x
// exports (paf-202-leagues); U13 owns the wHaAb wizard raster comparator. Exact layout, association,
// keyboard, target-size and locale probes (never relaxed by the budgets) gate the structure.
type Frame = 'ik5JC' | 'MYsDp';

// wHaAb is owned by the create wizard: its Pencil export and measured regions live with the wizard.
const wizardReferences: {
  frames: Record<string, { sha256: string }>;
  frameRegions: Record<string, Record<string, FrameRegionRecord>>;
} = JSON.parse(
  readFileSync(new URL('./references/paf-202-create-wizard/manifest.json', import.meta.url), 'utf8')
);
type Locale = keyof typeof copies;

const sizes: Record<Frame, { width: number; height: number }> = {
  ik5JC: { width: 390, height: 844 },
  MYsDp: { width: 430, height: 430 }
};
const LONG_NAME = 'Liga Interclubes de Padel Primavera-Verano de los Amigos del Barrio Norte';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let member: Actor;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await leagueFixtures(browser, { memberCount: 2, communityName: 'Pádel & Amigos' });
  member = f.members[0]!;
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(120_000);
});

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };
async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y, right, bottom, width, height };
  });
}

/** No horizontal scroll and every visible control stays inside the viewport. */
async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    clipped: [
      ...document.querySelectorAll<HTMLElement>(
        'main a, main button, main input, main select, main textarea'
      )
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        name: element.textContent?.trim() || element.id,
        rect: element.getBoundingClientRect()
      }))
      .filter(
        ({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1)
      )
      .map(({ name }) => name)
  }));
  expect(metrics.scroll, `${label} horizontal overflow`).toBeLessThanOrEqual(metrics.inner);
  expect(metrics.clipped, `${label} controls outside viewport`).toEqual([]);
}

// Reference geometry (Clubhouse frames): the content column keeps a 20px margin on each side
// (x 20..370 on 390px).
const MARGIN = 20;
const GEOMETRY_TOLERANCE = 2;

/**
 * Exact column geometry: the control's edges sit on the reference content column (or, for
 * `inset` children, inside it). Independent of the raster budget, so structural drift fails here.
 */
async function assertColumn(
  locator: Locator,
  label: string,
  { fullWidth = true, tolerance = GEOMETRY_TOLERANCE, maxInset = 16, viewport = 390 } = {}
) {
  const column = { left: MARGIN, right: viewport - MARGIN };
  const rect = await box(locator);
  // The widest ancestor that still fits the column is the control's section box (the Pencil
  // frame draws the field as that card). Production nests the control inside it with padding.
  const section = await locator.evaluate(
    (element, columnWidth) => {
      let widest = element.getBoundingClientRect();
      for (
        let parent = element.parentElement;
        parent && parent.tagName !== 'MAIN';
        parent = parent.parentElement
      ) {
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width > columnWidth) break;
        widest = parentRect;
      }
      return { x: widest.x, right: widest.right };
    },
    column.right - column.left + 2
  );
  console.info(`${label} geometry: ${JSON.stringify({ rect, section })}`);
  expect.soft(rect.x, `${label} left edge`).toBeGreaterThanOrEqual(column.left - tolerance);
  expect.soft(rect.right, `${label} right edge`).toBeLessThanOrEqual(column.right + tolerance);
  if (fullWidth) {
    expect
      .soft(Math.abs(section.x - column.left), `${label} section aligned to column`)
      .toBeLessThanOrEqual(tolerance);
    expect
      .soft(Math.abs(section.right - column.right), `${label} section spans column`)
      .toBeLessThanOrEqual(tolerance);
    expect.soft(rect.x - section.x, `${label} left inset`).toBeLessThanOrEqual(maxInset);
    expect.soft(section.right - rect.right, `${label} right inset`).toBeLessThanOrEqual(maxInset);
  }
  return rect;
}

/**
 * Interactive controls (or the label that hosts a custom radio) are at least 44×44px: the
 * documented WCAG 2.5.5 / project rule applied to both axes of the rendered hit area.
 */
async function assertTouchTargets(root: Locator, label: string) {
  const targets = await root
    .locator(
      'a:visible, button:visible, input:visible:not([type=radio]):not([type=checkbox]), select:visible, textarea:visible, label:has(input[type=radio]), label:has([role=radio]), [role=switch]:visible'
    )
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          name: (node.textContent || node.id || node.tagName).trim().slice(0, 40),
          height: rect.height,
          width: rect.width
        };
      })
    );
  expect.soft(targets.length, `${label}: touch-target probe found controls`).toBeGreaterThan(0);
  for (const target of targets) {
    expect.soft(target.height, `${label}: ${target.name} touch height`).toBeGreaterThanOrEqual(44);
    expect.soft(target.width, `${label}: ${target.name} touch width`).toBeGreaterThanOrEqual(44);
  }
}

/**
 * Vertical geometry (document coordinates, so scroll position never matters), independent of the
 * raster budgets: a displaced section fails here even when the pixel diff stays under budget.
 *
 * The Pencil frames are mock compositions (no app shell, no description/date rows), so absolute
 * reference offsets do not transfer. Two reference-derived rules are used instead:
 *  - RHYTHM: the frames stack sibling cards/controls with a 10px gap (ik5JC submit -> guidance
 *    10px; wHaAb selector -> guidance copy ~8px plus one line of leading; MYsDp card padding
 *    ~14px). Rhythm gaps are asserted with RHYTHM_TOLERANCE (4px), well under one 10px gap.
 *  - ANCHOR: the vertical position of each certified control in the approved production
 *    composition (the frame's route adaptation), within ANCHOR_TOLERANCE (12px, just over one
 *    10px reference gap: any section-sized displacement fails, sub-pixel font metrics do not).
 */
// wHaAb is the create-match Ranked selector, restyled by the Clubhouse create wizard after its PAF-11
// reference was exported. Its raster is wizard-owned: the Match type control and Ranked switch card are
// compared with aligned Pencil crops (paf-202-create-wizard frameRegions; measured 0.0442 / 0.0591) and
// the vertical anchors below were re-measured on the Switch layout. No league surface is involved.
const RHYTHM_TOLERANCE = 4;
const ANCHOR_TOLERANCE = 12;

async function docBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    const top = y + window.scrollY;
    return { x, y: top, right, bottom: bottom + window.scrollY, width, height };
  });
}

function expectNear(actual: number, expected: number, tolerance: number, label: string) {
  expect
    .soft(Math.abs(actual - expected), `${label}: ${actual} expected ${expected}±${tolerance}`)
    .toBeLessThanOrEqual(tolerance);
}

/** Named anchors (top edge in document px) and gaps (next.top - previous.bottom). */
function assertVertical(
  boxes: Record<string, Box>,
  anchors: Record<string, number>,
  gaps: Array<[from: string, to: string, expected: number, tolerance: number]>,
  label: string
) {
  for (const [name, expected] of Object.entries(anchors))
    expectNear(boxes[name]!.y, expected, ANCHOR_TOLERANCE, `${label} ${name} top`);
  for (const [from, to, expected, tolerance] of gaps)
    expectNear(boxes[to]!.y - boxes[from]!.bottom, expected, tolerance, `${label} ${from}->${to}`);
}

type Variant = 'endNotAfterStart' | 'endRequired';

/** Name the captured MYsDp variant; both variants use the approved frame budget. */
async function measure(page: Page, frame: Frame, info: TestInfo, variant?: Variant) {
  const { width, height } = sizes[frame];
  const name = variant ? `${frame}-${variant}` : frame;
  await page.setViewportSize({ width, height });
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${name}-actual.png`)
  });
  const approved = readFileSync(
    new URL(`./references/paf-202-leagues/${frame}.png`, import.meta.url)
  );
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, referenceScale }) => {
      async function readPixels(url: string, scale: number) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width / scale;
        canvas.height = image.height / scale;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data
        };
      }
      const [rendered, reference] = await Promise.all([
        readPixels(actualUrl, 1),
        readPixels(approvedUrl, referenceScale)
      ]);
      if (rendered.width !== reference.width || rendered.height !== reference.height)
        return { dimensionMismatch: true, perceptualPixelDifference: null as number | null };
      let changed = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const red = rendered.data[index]! - reference.data[index]!;
        const green = rendered.data[index + 1]! - reference.data[index + 1]!;
        const blue = rendered.data[index + 2]! - reference.data[index + 2]!;
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
        dimensionMismatch: false,
        perceptualPixelDifference: changed / (rendered.width * rendered.height)
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      referenceScale: 1
    }
  );
  console.info(`${name} full-frame measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.rasterBudgets[frame].maxPerceptualDiff;
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions must match the Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).toBeGreaterThan(0);
  if (measured.perceptualPixelDifference !== null)
    expect
      .soft(measured.perceptualPixelDifference, `${frame} reviewed raster budget`)
      .toBeLessThanOrEqual(budget);
  await info.attach(`${name}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${name}-approved`, { body: approved, contentType: 'image/png' });
  return measured;
}

async function openCreateLeague(page: Page) {
  await page.goto(`/community/${f.community}/leagues/create`);
  await waitForHydratedPage(page);
}

const l = (locale: Locale) => copies[locale].leagues;

test('ik5JC League creation: Pencil frame budget and structure', async ({
  browser: _browser
}, info) => {
  const page = await f.page(member, 'en', 390, 'light', 844);
  await openCreateLeague(page);
  await page.getByLabel(l('en').form.nameLabel, { exact: true }).fill('Autumn League');
  await page.getByLabel(l('en').form.startDateLabel, { exact: true }).fill(day(1));
  await page.getByLabel(l('en').form.endDateLabel, { exact: true }).fill(day(80));
  await measure(page, 'ik5JC', info);

  // Section order: header, name, dates (mode then dates), minimum, submit, guidance.
  const t = l('en');
  const order = [
    page.getByRole('heading', { level: 1, name: t.form.title }),
    page.getByLabel(t.form.nameLabel, { exact: true }),
    page.getByRole('group', { name: t.form.endModeLegend }),
    page.getByLabel(t.form.startDateLabel, { exact: true }),
    page.getByLabel(t.form.endDateLabel, { exact: true }),
    page.getByLabel(t.form.minimumLabel, { exact: true }),
    page.getByRole('button', { name: t.form.submit, exact: true }),
    page.getByText(t.form.guidance, { exact: true })
  ];
  const boxes = await Promise.all(order.map(box));
  for (let index = 1; index < boxes.length; index++)
    expect(boxes[index]!.y, `section ${index} follows ${index - 1}`).toBeGreaterThanOrEqual(
      boxes[index - 1]!.y - 1
    );
  // Exact geometry (reference column 18..372): full-width fields, mode group, submit and guidance.
  await assertColumn(order[1]!, 'ik5JC name field');
  await assertColumn(order[2]!, 'ik5JC end-mode group');
  await assertColumn(order[5]!, 'ik5JC minimum field');
  const submit = await assertColumn(order[6]!, 'ik5JC submit');
  expect.soft(submit.height, 'ik5JC submit height').toBeGreaterThanOrEqual(44);
  expect.soft(submit.height, 'ik5JC submit height').toBeLessThanOrEqual(52);
  await assertColumn(order[7]!, 'ik5JC guidance', { fullWidth: false });
  // Vertical: title, name, mode group, minimum, submit and guidance keep their approved positions;
  // submit -> guidance is the frame's 14px content rhythm; the 52px submit sits on its own row.
  assertVertical(
    {
      title: await docBox(order[0]!),
      name: await docBox(order[1]!),
      mode: await docBox(order[2]!),
      minimum: await docBox(order[5]!),
      submit: await docBox(order[6]!),
      guidance: await docBox(order[7]!)
    },
    { title: 29, name: 126, mode: 313, minimum: 691, submit: 800, guidance: 866 },
    [['submit', 'guidance', 14, RHYTHM_TOLERANCE]],
    'ik5JC'
  );
  await assertNoOverflow(page, 'ik5JC');
  await assertTouchTargets(page.locator('main'), 'ik5JC');
});

// ik5JC lays the end-mode group directly on the page: the UA fieldset border must not render.
for (const theme of ['light', 'dark'] as const) {
  test(`ik5JC League creation fieldsets render no border (${theme})`, async () => {
    const page = await f.page(member, 'en', 390, theme, 844);
    await openCreateLeague(page);
    const borders = await page.locator('main fieldset').evaluateAll((nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          legend: node.querySelector('legend')?.textContent ?? '',
          widths: [
            style.borderTopWidth,
            style.borderRightWidth,
            style.borderBottomWidth,
            style.borderLeftWidth
          ],
          styles: [
            style.borderTopStyle,
            style.borderRightStyle,
            style.borderBottomStyle,
            style.borderLeftStyle
          ]
        };
      })
    );
    expect(borders.length).toBeGreaterThan(0);
    for (const border of borders) {
      expect(border.widths, border.legend).toEqual(['0px', '0px', '0px', '0px']);
      expect(border.styles, border.legend).toEqual(['none', 'none', 'none', 'none']);
    }
  });
}

/** Create-match details step with a Competitive draft and the League selector ready. */
async function openRankedSelector(page: Page, locale: Locale) {
  const m = copies[locale].matchCreate;
  await page.goto('/matches/create');
  await waitForHydratedPage(page);
  await page.getByLabel(m.fields.date, { exact: true }).fill(day(3));
  await page.getByLabel(m.fields.startTime, { exact: true }).fill('10:30');
  await page
    .getByRole('radio', { name: copies[locale].matches.type.competitive, exact: true })
    .click();
  const group = page.getByRole('group', { name: m.competition.legend });
  await expect(group.getByRole('combobox')).toBeVisible();
  return group;
}

test('wHaAb Create match Ranked selector: structure and keyboard', async ({ browserName }) => {
  expect(browserName).toBe('chromium');
  await f.createLeague(member, { name: 'Autumn League', start: day(1), end: day(80) });
  const page = await f.page(member, 'en', 390, 'light', 916);
  const t = copies.en;
  const group = await openRankedSelector(page, 'en');
  const ranked = group.getByRole('switch', { name: t.matches.competition.ranked, exact: true });
  await expect(ranked).toBeChecked();

  // Frame regions: the Competitive segmented control and the Ranked switch card (state wHaAb draws:
  // Competitive selected, Ranked on, "Counts for levels and <League>") against the pinned Pencil export.
  const frame = readFileSync(
    new URL('./references/paf-202-create-wizard/wHaAb.png', import.meta.url)
  );
  expect(createHash('sha256').update(frame).digest('hex')).toBe(
    wizardReferences.frames.wHaAb!.sha256
  );
  await expect(
    group.getByText(
      t.matchCreate.competition.switchMetaLeague.replace('{{league}}', 'Autumn League')
    )
  ).toBeVisible();
  await assertFrameRegions({
    page,
    frame: 'wHaAb',
    reference: frame,
    regions: wizardReferences.frameRegions.wHaAb!,
    locators: {
      matchType: page.getByRole('radiogroup', { name: t.matchCreate.fields.type, exact: true }),
      rankedCard: ranked
    }
  });

  // Several covering Leagues → explicit selection; selector, guidance and error stay associated.
  const select = group.getByRole('combobox', {
    name: t.matchCreate.competition.league,
    exact: true
  });
  const guidance = await group.getAttribute('aria-describedby');
  expect(guidance).toBeTruthy();
  await expect(page.locator(`[id="${guidance!.split(' ')[0]}"]`)).toContainText(
    t.matchCreate.competition.guidance.defaultOne
  );
  // Section order: type segments, Ranked switch, League selector, guidance.
  const order = [
    page.getByRole('radiogroup', { name: t.matchCreate.fields.type, exact: true }),
    ranked,
    select,
    group.getByText(t.matchCreate.competition.members)
  ];
  const boxes = await Promise.all(order.map(box));
  for (let index = 1; index < boxes.length; index++)
    expect(boxes[index]!.y, `selector part ${index} follows ${index - 1}`).toBeGreaterThanOrEqual(
      boxes[index - 1]!.y - 1
    );

  // Keyboard: Space toggles Ranked off (Unranked) and back on; the League selector follows.
  await ranked.focus();
  await page.keyboard.press('Space');
  await expect(ranked).not.toBeChecked();
  await expect(select).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(ranked).toBeChecked();
  await expect(select).toBeVisible();

  // Exact geometry: competition group and League selector stay inside the reference column, the
  // switch sits inside the group, and the guidance is a child of the group (association by box).
  const groupBox = await assertColumn(group, 'wHaAb competition group', { fullWidth: false });
  const selectBox = await assertColumn(select, 'wHaAb League selector', { fullWidth: false });
  expect.soft(selectBox.width, 'wHaAb League selector is a full-row control').toBeGreaterThan(200);
  for (const part of [boxes[1]!, selectBox, boxes[3]!]) {
    expect.soft(part.x, 'wHaAb part inside group left').toBeGreaterThanOrEqual(groupBox.x - 1);
    expect
      .soft(part.right, 'wHaAb part inside group right')
      .toBeLessThanOrEqual(groupBox.right + 1);
    expect.soft(part.y, 'wHaAb part inside group top').toBeGreaterThanOrEqual(groupBox.y - 1);
    expect
      .soft(part.bottom, 'wHaAb part inside group bottom')
      .toBeLessThanOrEqual(groupBox.bottom + 1);
  }
  // Vertical: type segments, status group, Ranked switch, League selector and guidance keep their
  // approved positions; selector -> guidance copy is the reference ~8px gap (the wizard group gap).
  assertVertical(
    {
      type: await docBox(order[0]!),
      group: await docBox(group),
      ranked: await docBox(order[1]!),
      select: await docBox(select),
      guidance: await docBox(order[3]!)
    },
    { type: 240, group: 310, ranked: 310, select: 414.5, guidance: 474.5 },
    [
      ['type', 'group', 14, RHYTHM_TOLERANCE],
      ['select', 'guidance', 8, RHYTHM_TOLERANCE]
    ],
    'wHaAb'
  );
  await assertNoOverflow(page, 'wHaAb');
  await assertTouchTargets(group, 'wHaAb competition');
  expect(
    (await box(ranked)).height,
    'wHaAb Ranked switch card is the 68px hit area'
  ).toBeGreaterThanOrEqual(64);
});

test('MYsDp validation and conflict variants: association, live errors, focus', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const t = l('en');
  const activeId = await f.createLeague(member, {
    name: 'Summer Ladder',
    endMode: 'manual',
    start: day(0)
  });
  const page = await f.page(member, 'en', 430, 'light', 430);
  await openCreateLeague(page);

  // Active conflict card names the Active League and links to it.
  const note = page.getByRole('note');
  await expect(note).toContainText(fill(t.form.conflict.title, { name: 'Summer Ladder' }));
  await expect(note).toContainText(fill(t.form.conflict.body, { name: 'Summer Ladder' }));
  const review = note.getByRole('link', {
    name: fill(t.form.conflict.review, { name: 'Summer Ladder' })
  });
  await expect(review).toHaveAttribute('href', new RegExp(`/leagues/${activeId}$`));

  // End before start and missing end date: exact copy, associated, announced, focus on first.
  await page.getByLabel(t.form.nameLabel, { exact: true }).fill('Autumn League');
  await page.getByLabel(t.form.startDateLabel, { exact: true }).fill(day(20));
  await page.getByLabel(t.form.endDateLabel, { exact: true }).fill(day(10));
  const end = page.getByLabel(t.form.endDateLabel, { exact: true });
  const submit = page.getByRole('button', { name: t.form.submit, exact: true });
  const bodyColor = await page
    .locator('main')
    .evaluate((element) => getComputedStyle(element).color);

  /** One validation variant: exact copy, association, alert, colour and geometry, then capture. */
  async function certifyVariant(
    variant: 'endNotAfterStart' | 'endRequired',
    message: string,
    expectedFocus: boolean
  ) {
    await submit.click();
    const alert = page.getByRole('alert').filter({ hasText: message });
    await expect(alert).toBeVisible();
    // Exactly the variant's message is announced; the other variant's copy is not shown.
    const other =
      variant === 'endRequired' ? t.form.errors.endNotAfterStart : t.form.errors.endRequired;
    await expect(page.getByRole('alert').filter({ hasText: other })).toHaveCount(0);
    if (expectedFocus) await expect(end).toBeFocused();
    await expect(end).toHaveAttribute('aria-invalid', 'true');
    const describedBy = (await end.getAttribute('aria-describedby'))?.split(' ') ?? [];
    const messages = await Promise.all(
      describedBy.map((id) => page.locator(`[id="${id}"]`).textContent())
    );
    expect(messages.join(' '), `${variant} message associated with the end field`).toContain(
      message
    );
    expect(await alert.evaluate((element) => getComputedStyle(element).color)).not.toBe(bodyColor);

    // Exact geometry: the error line sits directly under its own field, inside the same column.
    const fieldBox = await box(end);
    const alertBox = await box(alert);
    console.info(`MYsDp ${variant} geometry: ${JSON.stringify({ fieldBox, alertBox })}`);
    expect
      .soft(alertBox.y, `${variant} error below its field`)
      .toBeGreaterThanOrEqual(fieldBox.bottom - 1);
    expect
      .soft(alertBox.y - fieldBox.bottom, `${variant} error adjacent to its field`)
      .toBeLessThanOrEqual(32);
    expect
      .soft(alertBox.x, `${variant} error aligned with field`)
      .toBeGreaterThanOrEqual(fieldBox.x - 2);
    expect
      .soft(alertBox.right, `${variant} error within field column`)
      .toBeLessThanOrEqual(fieldBox.right + 2);
    // Vertical (document px): the end field keeps its position and its error sits 27px under it
    // (reference error line directly under its field; one 15px line + 12px spacing token).
    const endDoc = await docBox(end);
    const alertDoc = await docBox(alert);
    assertVertical(
      { end: endDoc, alert: alertDoc },
      { end: 726, alert: 809 },
      [['end', 'alert', 27, RHYTHM_TOLERANCE]],
      `MYsDp ${variant}`
    );
    await assertColumn(end, `MYsDp ${variant} end field`, { viewport: 430 });
    await assertNoOverflow(page, `MYsDp ${variant}`);

    // Frame capture of this variant at the reference viewport.
    // Bring the variant's own error into the captured viewport (the conflict card is above it).
    await alert.scrollIntoViewIfNeeded();
    await measure(page, 'MYsDp', info, variant);
  }

  const noteBox = await assertColumn(note, 'MYsDp conflict card', {
    fullWidth: false,
    viewport: 430
  });
  const reviewBox = await box(review);
  expect.soft(reviewBox.y, 'review link follows the conflict body').toBeGreaterThan(noteBox.y);
  expect
    .soft(reviewBox.bottom, 'review link inside the conflict card')
    .toBeLessThanOrEqual(noteBox.bottom + 1);
  expect
    .soft(reviewBox.x, 'review link inside the conflict card')
    .toBeGreaterThanOrEqual(noteBox.x - 1);

  // Vertical: conflict card and review link keep their positions; the link sits inside the card
  // with the reference ~14px bottom padding (frame: link bottom -> card bottom ~14px).
  const noteDoc = await docBox(note);
  const reviewDoc = await docBox(review);
  assertVertical({ note: noteDoc, review: reviewDoc }, { note: 92, review: 200 }, [], 'MYsDp card');
  expectNear(
    noteDoc.bottom - reviewDoc.bottom,
    14,
    RHYTHM_TOLERANCE,
    'MYsDp review -> card bottom'
  );

  await certifyVariant('endNotAfterStart', t.form.errors.endNotAfterStart, true);
  await end.fill('');
  await certifyVariant('endRequired', t.form.errors.endRequired, false);

  // Keyboard: the mode radios switch with arrow keys and the date field follows.
  await page.getByRole('radio', { name: new RegExp(t.form.mode.fixed_date) }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByLabel(t.form.endDateLabel, { exact: true })).toHaveCount(0);
  await page.keyboard.press('ArrowUp');
  await expect(page.getByLabel(t.form.endDateLabel, { exact: true })).toBeVisible();
});

test('required League choice is announced and associated when several Leagues overlap', async () => {
  await f.createLeague(member, { name: 'Overlap League', start: day(2), end: day(30) });
  const page = await f.page(member, 'en', 390, 'light', 916);
  const t = copies.en.matchCreate;
  const group = await openRankedSelector(page, 'en');
  const select = group.getByRole('combobox', { name: t.competition.league, exact: true });
  await expect(select).toHaveValue('');
  await expect(group).toContainText(t.competition.guidance.chooseOne);
  await page.getByLabel(t.fields.venueName, { exact: true }).fill('Visual court');
  await page
    .getByLabel(t.fields.mapsUrl, { exact: true })
    .fill('https://www.google.com/maps/place/?q=place_id:visual');
  await page.getByLabel(t.fields.photo).setInputFiles({
    name: 'venue.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    )
  });
  await expect(page.getByRole('button', { name: t.photo.remove })).toBeVisible({ timeout: 15_000 });
  for (const step of [t.steps.players, t.steps.teams]) {
    await page.getByRole('button', { name: t.next }).click();
    await expect(page.getByText(step, { exact: true })).toBeVisible();
  }
  await page.getByRole('radio', { name: copies.en.matches.teamMode.POST_MATCH_TEAMS }).check();
  await page.getByRole('button', { name: t.next }).click();
  await page.getByRole('button', { name: t.publish }).click();
  const alert = group.getByRole('alert');
  await expect(alert).toContainText(t.errors.leagueRequired);
  await expect(select).toHaveAttribute('aria-invalid', 'true');
  const describedBy = (await select.getAttribute('aria-describedby')) ?? '';
  expect(describedBy).toContain((await alert.getAttribute('id')) ?? 'missing');
});

for (const locale of ['pt-BR', 'es'] as const)
  for (const [theme, width] of [
    ['light', 390],
    ['dark', 320]
  ] as const)
    test(`${locale} ${theme} ${width}px: League form and Ranked selector fit without clipping`, async () => {
      const page = await f.page(member, locale, width, theme, 900);
      const t = l(locale);
      await openCreateLeague(page);
      await expect(page.getByRole('heading', { level: 1, name: t.form.title })).toBeVisible();
      await page.getByLabel(t.form.nameLabel, { exact: true }).fill(LONG_NAME);
      await page.getByRole('button', { name: t.form.submit, exact: true }).click();
      await assertNoOverflow(page, `${locale} ${theme} League form`);
      await assertTouchTargets(page.locator('main'), `${locale} ${theme} League form`);
      const group = await openRankedSelector(page, locale);
      await assertNoOverflow(page, `${locale} ${theme} create match`);
      await assertTouchTargets(group, `${locale} ${theme} selector`);
      const select = group.getByRole('combobox').first();
      const selectBox = await box(select);
      expect(selectBox.right, 'League selector fits the viewport').toBeLessThanOrEqual(width);
      const colors = await page.evaluate(() => ({
        text: getComputedStyle(document.body).color,
        background: getComputedStyle(document.body).backgroundColor
      }));
      expect(colors.text).not.toBe(colors.background);
    });

test('long League names wrap in list and detail on desktop and mobile', async () => {
  const longLeague = await f.createLeague(member, { name: LONG_NAME, start: day(1), end: day(60) });
  for (const width of [320, 390, 1280]) {
    const page = await f.page(member, 'en', width, 'light', 800);
    for (const url of [
      `/community/${f.community}/leagues`,
      `/community/${f.community}/leagues/${longLeague}`
    ]) {
      await page.goto(url);
      await waitForHydratedPage(page);
      await expect(page.getByText(LONG_NAME).first()).toBeVisible();
      await assertNoOverflow(page, `${url} @${width}`);
    }
    await page.context().close();
  }
  expect(await sql(`select 1 from public.leagues where name='${LONG_NAME}'`)).toHaveLength(1);
});
