import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import manifest from './references/paf-12/manifest.json' with { type: 'json' };

// PAF-12 visual certification helpers (same method as PAF-11 `leagues-visual.spec.ts`): capture at
// the exact half-scale reference size, compare against the uncropped 2x Pencil export with the
// pinned perceptual threshold and a documented nonzero per-screen budget. Structural probes live
// in the journeys and never depend on these budgets.
export type StandingsFrame = keyof typeof manifest.visualBudgets.perScreen;

export const standingsViewport = { width: 390, height: 844 };

export type Box = {
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Bounding box in document coordinates, so scroll position never matters. */
export async function docBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return {
      x,
      y: y + window.scrollY,
      right,
      bottom: bottom + window.scrollY,
      width,
      height
    };
  });
}

/**
 * Viewport-relative geometry, measured as the page is first shown: every target must lie fully
 * inside the visible viewport (top >= 0, bottom <= height, left >= 0, right <= width) with the
 * page still at scroll 0, so "reachable by scrolling" can never pass for "visible initially".
 */
export async function assertInInitialViewport(
  page: Page,
  targets: Record<string, Locator>,
  label: string
) {
  expect(
    await page.evaluate(() => window.scrollY),
    `${label} is measured before any scrolling`
  ).toBe(0);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  for (const [name, locator] of Object.entries(targets)) {
    const rect = await locator.evaluate((element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    });
    expect.soft(rect.top, `${label} ${name} top inside viewport`).toBeGreaterThanOrEqual(0);
    expect
      .soft(rect.bottom, `${label} ${name} bottom (${rect.bottom}) inside ${viewport.height}px`)
      .toBeLessThanOrEqual(viewport.height);
    expect.soft(rect.left, `${label} ${name} left inside viewport`).toBeGreaterThanOrEqual(0);
    expect
      .soft(rect.right, `${label} ${name} right inside viewport`)
      .toBeLessThanOrEqual(viewport.width);
  }
}

/** The primary ranking's header row and first ranking row: every cell, in table order. */
export function primaryRankingTargets(table: Locator) {
  const rows = table.getByRole('row');
  const targets: Record<string, Locator> = {};
  const header = rows.first();
  const first = rows.nth(1);
  for (const [name, row] of [
    ['header', header],
    ['first ranking row', first]
  ] as const) {
    targets[name] = row;
  }
  targets['place header'] = header.getByRole('columnheader').nth(0);
  targets['award header'] = header.getByRole('columnheader').nth(4);
  targets['first row place'] = first.getByRole('cell').nth(0);
  targets['first row player'] = first.getByRole('rowheader');
  targets['first row record'] = first.getByRole('cell').nth(1);
  targets['first row set difference'] = first.getByRole('cell').nth(2);
  targets['first row award'] = first.getByRole('cell').nth(3);
  return targets;
}

/** No horizontal scroll and every visible control stays inside the viewport. */
export async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    clipped: [
      ...document.querySelectorAll<HTMLElement>(
        'main a, main button, main input, main select, main textarea, main summary'
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

/** Interactive controls are at least 44px tall (WCAG 2.5.5 / project rule). */
export async function assertTouchHeights(root: Locator, label: string) {
  const targets = await root
    .locator('a:visible, button:visible, select:visible, summary:visible')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: (node.textContent || node.id || node.tagName).trim().slice(0, 40),
        height: node.getBoundingClientRect().height
      }))
    );
  expect.soft(targets.length, `${label}: touch-target probe found controls`).toBeGreaterThan(0);
  for (const target of targets)
    expect.soft(target.height, `${label}: ${target.name} touch height`).toBeGreaterThanOrEqual(44);
}

type Theme = 'light' | 'dark';

const tokenSource = readFileSync(
  new URL('../design-tokens/dist/tokens.css', import.meta.url),
  'utf8'
);

/** `--palette-<name>[-dark]` hex value from the built design tokens, as the computed `rgb(...)` string. */
function paletteRgb(name: string, theme: Theme): string {
  const key = theme === 'dark' ? `${name}-dark` : name;
  const hex = new RegExp(`--palette-${key}:\\s*#([0-9a-fA-F]{6})`).exec(tokenSource)?.[1];
  if (!hex) throw new Error(`Design token --palette-${key} not found`);
  const [red, green, blue] = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
  return `rgb(${red}, ${green}, ${blue})`;
}

/**
 * Style expectations for one production element. `tokens` maps a CSS property to the design-token
 * expression it must resolve to (checked against the live theme through a computed-style probe, so
 * a hardcoded value or a wrong token fails). `palette` maps a color property to a palette entry of
 * `design-tokens/dist/tokens.css` for the active theme (catches a broken theme cascade). `literals`
 * pins a few concrete values that mirror the Pencil frame's visual character.
 */
export type StyleCheck = {
  name: string;
  locator: Locator;
  tokens?: Record<string, string>;
  palette?: Record<string, string>;
  literals?: Record<string, string>;
};

/**
 * Visual (style) coverage for content the screenshot compare masks: Pencil frames carry different
 * content than production, so the masked regions are certified by exact geometry probes plus these
 * token/style assertions instead of by content pixels.
 */
export async function assertDesignSystemStyles(
  page: Page,
  theme: Theme,
  checks: StyleCheck[],
  label: string
) {
  expect(
    await page.evaluate(() => document.documentElement.dataset.theme),
    `${label} renders the ${theme} theme`
  ).toBe(theme);
  for (const check of checks) {
    const tokens = check.tokens ?? {};
    const palette = check.palette ?? {};
    const resolved = await check.locator.evaluate(
      (element, { tokenMap, props }) => {
        const probe = document.createElement('span');
        document.body.append(probe);
        const computed = getComputedStyle(element);
        const result: Record<string, { actual: string; expected: string }> = {};
        for (const [property, expression] of Object.entries(tokenMap)) {
          probe.style.setProperty(property, expression);
          result[property] = {
            actual: computed.getPropertyValue(property),
            expected: getComputedStyle(probe).getPropertyValue(property)
          };
          probe.style.removeProperty(property);
        }
        probe.remove();
        const actual: Record<string, string> = {};
        for (const property of props) actual[property] = computed.getPropertyValue(property);
        return { result, actual };
      },
      {
        tokenMap: tokens,
        props: [...Object.keys(palette), ...Object.keys(check.literals ?? {})]
      }
    );
    for (const [property, { actual, expected }] of Object.entries(resolved.result)) {
      expect.soft(expected, `${label} ${check.name} token for ${property} resolves`).not.toBe('');
      expect
        .soft(actual, `${label} ${check.name} ${property} resolves to ${tokens[property]}`)
        .toBe(expected);
    }
    for (const [property, name] of Object.entries(palette))
      expect
        .soft(
          resolved.actual[property],
          `${label} ${check.name} ${property} is palette ${name} (${theme})`
        )
        .toBe(paletteRgb(name, theme));
    for (const [property, value] of Object.entries(check.literals ?? {}))
      expect.soft(resolved.actual[property], `${label} ${check.name} ${property}`).toBe(value);
  }
}

/** Own summary card, primary ranking table, viewer row: shared by the live and the final frame. */
export function standingsStyleChecks(
  page: Page,
  copy: { yourPlace: string; matches: string; title: string }
): StyleCheck[] {
  const summary = page
    .locator('dl')
    .filter({ has: page.getByText(copy.yourPlace, { exact: true }) });
  const table = page.getByRole('table', { name: copy.title, exact: true });
  return [
    {
      name: 'own summary card',
      locator: summary,
      tokens: {
        'background-color': 'var(--color-surface)',
        'border-top-left-radius': 'var(--radius-14)',
        'padding-top': 'var(--space-12)',
        'column-gap': 'var(--space-8)'
      },
      palette: { 'background-color': 'surface' },
      literals: { 'border-top-left-radius': '14px', 'padding-top': '12px' }
    },
    {
      name: 'summary label',
      locator: summary.locator('dt', { hasText: copy.yourPlace }),
      tokens: {
        color: 'var(--color-muted)',
        'font-size': 'var(--font-size-11)',
        'font-weight': 'var(--font-weight-semibold)'
      },
      palette: { color: 'muted' },
      literals: { 'font-size': '11px', 'font-weight': '600', 'text-transform': 'uppercase' }
    },
    {
      name: 'summary place value (accent)',
      locator: summary.locator('dd').first(),
      tokens: {
        color: 'var(--color-green)',
        'font-family': 'var(--font-family-heading)',
        'font-size': 'var(--font-size-24)',
        'font-weight': 'var(--font-weight-bold)'
      },
      palette: { color: 'green' },
      literals: { 'font-size': '24px', 'font-weight': '700' }
    },
    {
      name: 'summary matches value',
      locator: summary.locator('dt', { hasText: copy.matches }).locator('..').locator('dd'),
      tokens: {
        color: 'var(--color-text)',
        'font-family': 'var(--font-family-heading)',
        'font-size': 'var(--font-size-24)',
        'font-weight': 'var(--font-weight-bold)'
      },
      palette: { color: 'text' }
    },
    {
      name: 'primary table',
      locator: table,
      tokens: {
        'background-color': 'var(--color-surface)',
        'font-size': 'var(--font-size-12)',
        'font-family': 'var(--font-family-body)'
      },
      palette: { 'background-color': 'surface' },
      literals: { 'font-size': '12px', 'font-variant-numeric': 'tabular-nums' }
    },
    {
      name: 'primary table column header',
      locator: table.getByRole('columnheader').first(),
      tokens: {
        color: 'var(--color-muted)',
        'font-size': 'var(--font-size-11)',
        'font-weight': 'var(--font-weight-semibold)',
        'padding-top': 'var(--space-8)',
        'padding-left': 'var(--space-6)',
        'border-bottom-color': 'var(--color-line)'
      },
      palette: { color: 'muted', 'border-bottom-color': 'line' },
      literals: {
        'font-size': '11px',
        'font-weight': '600',
        'border-bottom-style': 'solid',
        'border-bottom-width': '1px'
      }
    },
    {
      name: 'viewer row (highlighted)',
      locator: table.locator('tr[aria-current]'),
      tokens: {
        'background-color': 'var(--color-green-soft)',
        color: 'var(--color-green)'
      },
      palette: { 'background-color': 'green-soft', color: 'green' }
    },
    {
      name: 'primary table body cell',
      locator: table.locator('tbody tr:not([aria-current])').first().getByRole('cell').first(),
      tokens: {
        'padding-top': 'var(--space-8)',
        'padding-left': 'var(--space-6)',
        'border-bottom-color': 'var(--color-line)'
      },
      palette: { color: 'text', 'border-bottom-color': 'line' }
    }
  ];
}

type MaskRect = { x: number; y: number; width: number; height: number };

/**
 * Production blocks that carry a documented composition/content delta against the Pencil frame
 * (real details card, heading row, own summary, tables, disclosure, callout, rules, version
 * history, page header). Viewport-relative rects at scroll 0; each block is gated by exact
 * structural probes in the journeys, so the screenshot budget never has to absorb them.
 */
async function productionMasks(page: Page): Promise<MaskRect[]> {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const standings = document.querySelector('section[aria-labelledby="league-standings-heading"]');
    const nodes: Element[] = [...document.querySelectorAll('main header')];
    if (standings) {
      nodes.push(...standings.children);
      if (standings.previousElementSibling) nodes.push(standings.previousElementSibling);
      for (let next = standings.nextElementSibling; next; next = next.nextElementSibling)
        nodes.push(next);
    }
    return nodes.map(rect).filter(({ width, height }) => width > 0 && height > 0);
  });
}

/** Viewport capture compared with the uncropped 2x Pencil export of `frame`. */
export async function measureStandingsFrame(page: Page, frame: StandingsFrame, info: TestInfo) {
  await page.setViewportSize(standingsViewport);
  const masks = [
    ...manifest.visualBudgets.referenceMasks[frame].map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height
    })),
    ...(await productionMasks(page))
  ];
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-12/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, maskRects }) => {
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
        readPixels(approvedUrl, 2)
      ]);
      if (rendered.width !== reference.width || rendered.height !== reference.height)
        return {
          dimensionMismatch: true,
          perceptualPixelDifference: null as number | null,
          fullFramePixelDifference: null as number | null,
          maskedFraction: null as number | null
        };
      let changed = 0;
      let changedAll = 0;
      let masked = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const pixel = index / 4;
        const x = (pixel % rendered.width) + 0.5;
        const y = Math.floor(pixel / rendered.width) + 0.5;
        const inMask = maskRects.some(
          (rect) =>
            x >= rect.x - 1 &&
            x < rect.x + rect.width + 1 &&
            y >= rect.y - 1 &&
            y < rect.y + rect.height + 1
        );
        if (inMask) masked++;
        const red = rendered.data[index]! - reference.data[index]!;
        const green = rendered.data[index + 1]! - reference.data[index + 1]!;
        const blue = rendered.data[index + 2]! - reference.data[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        ) {
          changedAll++;
          if (!inMask) changed++;
        }
      }
      const total = rendered.width * rendered.height;
      return {
        dimensionMismatch: false,
        perceptualPixelDifference: changed / (total - masked),
        fullFramePixelDifference: changedAll / total,
        maskedFraction: masked / total
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      maskRects: masks
    }
  );
  console.info(`${frame} PAF-12 scoped measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.visualBudgets.perScreen[frame];
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions must match the 2x Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).toBeGreaterThan(0);
  if (measured.perceptualPixelDifference !== null)
    expect
      .soft(measured.perceptualPixelDifference, `${frame} reviewed raster budget (unmasked area)`)
      .toBeLessThanOrEqual(budget);
  if (measured.maskedFraction !== null)
    expect
      .soft(measured.maskedFraction, `${frame} masks stay a bounded share of the frame`)
      .toBeLessThanOrEqual(manifest.visualBudgets.maxMaskedFraction[frame]);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
  return measured;
}
