import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { testSupabaseConfig } from './test-supabase-config';
import { createClient } from '@supabase/supabase-js';
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

type LocaleCopy = {
  auth: {
    signupLink: string;
    emailAddress: string;
    signupPasswordLabel: string;
    signupSubmit: string;
  };
  onboarding: {
    name: string;
    preciseLevel: string;
    side: string;
    sideLeftShort: string;
    save: string;
  };
  communityOnboarding: { [key: string]: string } & {
    lead: string;
    skip: string;
    createLead: string;
    createEntry: string;
    nameLabel: string;
    visibilityLegend: string;
    private: string;
    cityLabel: string;
    createSubmit: string;
    adminNote: string;
    back: string;
    created: string;
    finish: string;
    emptySearch: string;
    searchLoading: string;
    loadFailed: string;
    searchLabel: string;
    descriptionLabel: string;
    openJoin: string;
    join: string;
    requestToJoin: string;
    requestPending: string;
    joined: string;
    invalidName: string;
  };
};
const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  serviceWorkers: 'block',
  colorScheme: 'light'
});

function localClient() {
  const { url, key } = testSupabaseConfig();
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function player(page: Page): Promise<string> {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await waitForHydratedPage(page);
  const email = page.locator('#signup-email');
  await expect(email).toBeEnabled();
  const address = `community-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
  await email.fill(address);
  await page.getByLabel(en.auth.signupPasswordLabel).fill('Password123!');
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await waitForHydratedPage(page);
  await page.getByLabel(en.onboarding.name).fill('Discovery Player');
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page
    .getByRole('group', { name: en.onboarding.side })
    .getByRole('radio', { name: en.onboarding.sideLeftShort })
    .check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community$/);
  await waitForHydratedPage(page);
  return address;
}

async function geometry(
  locator: Locator,
  expected: Partial<{ x: number; y: number; width: number; height: number }>
) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const value = expected[key];
    if (value !== undefined)
      expect(
        Math.abs(box![key] - value),
        `${key}: Pencil ${value}, browser ${box![key]}`
      ).toBeLessThanOrEqual(1);
  }
}

function assertDecodedImage(
  expected: { width: number; height: number; bytes: number },
  actual: { width: number; height: number; bytes: number },
  endY: number,
  masks: [number, number, number, number][]
) {
  expect(expected.width).toBe(390);
  expect(expected.height).toBe(844);
  expect(actual.width).toBe(390);
  expect(actual.height).toBe(844);
  expect(expected).toEqual(actual);
  expect(expected.bytes).toBe(expected.width * expected.height * 4);
  expect(actual.bytes).toBe(actual.width * actual.height * 4);
  expect(endY).toBeGreaterThanOrEqual(0);
  expect(endY).toBeLessThanOrEqual(expected.height);
  for (const [left, top, width, height] of masks) {
    expect([left, top, width, height].every(Number.isInteger)).toBe(true);
    expect(left).toBeGreaterThanOrEqual(0);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
    expect(left + width).toBeLessThanOrEqual(expected.width);
    expect(top + height).toBeLessThanOrEqual(endY);
  }
}

async function assertRawLocale(
  page: Page,
  response: Awaited<ReturnType<Page['goto']>>,
  locale: string,
  title: string
) {
  expect(response, 'navigation must return an HTML response').not.toBeNull();
  expect(response!.ok()).toBeTruthy();
  expect(response!.headers()['content-type']).toContain('text/html');
  await assertRawMarkupLocale(page, await response!.text(), locale, title);
}

async function assertRawMarkupLocale(page: Page, markup: string, locale: string, title: string) {
  const actual = await page.evaluate((source) => {
    const detached = new DOMParser().parseFromString(source, 'text/html');
    return {
      lang: detached.documentElement.lang,
      heading: detached.querySelector('h1')?.textContent?.trim()
    };
  }, markup);
  expect(actual.lang).toBe(locale);
  expect(actual.heading).toBe(title);
}

type ComparePngInputs = {
  expected: string;
  received: string;
  masks: [number, number, number, number][];
  endY: number;
  referenceOffset?: number;
  regionEnds?: number[];
};

type ComparePngResult = {
  expected: { width: number; height: number; bytes: number };
  actual: { width: number; height: number; bytes: number };
  count: number | null;
  regionCounts?: number[];
  diff: string | null;
  error: string | null;
};

// Browser-serializable PNG comparator shared by visualDiff and the synthetic
// canvas tests: page.evaluate serializes this function, so it must stay
// self-contained and never close over spec-file imports or helpers.
async function comparePngImages({
  expected,
  received,
  masks: maskAreas,
  endY: lastRow,
  referenceOffset = 0,
  regionEnds = []
}: ComparePngInputs): Promise<ComparePngResult> {
  const decode = async (base64: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return {
      width: image.width,
      height: image.height,
      pixels: context.getImageData(0, 0, image.width, image.height).data
    };
  };
  const [a, b] = await Promise.all([decode(expected), decode(received)]);
  const dimensionsMatch = a.width === b.width && a.height === b.height;
  if (
    !dimensionsMatch ||
    a.width <= 0 ||
    a.height <= 0 ||
    b.width <= 0 ||
    b.height <= 0 ||
    a.pixels.length !== a.width * a.height * 4 ||
    b.pixels.length !== b.width * b.height * 4
  )
    return {
      expected: { width: a.width, height: a.height, bytes: a.pixels.length },
      actual: { width: b.width, height: b.height, bytes: b.pixels.length },
      count: null,
      diff: null,
      error: 'PNG dimensions or RGBA buffer length mismatch'
    };
  if (a.width !== 390 || a.height !== 844 || b.width !== 390 || b.height !== 844)
    return {
      expected: { width: a.width, height: a.height, bytes: a.pixels.length },
      actual: { width: b.width, height: b.height, bytes: b.pixels.length },
      count: null,
      diff: null,
      error: 'PNG must be exactly 390×844'
    };
  if (!Number.isInteger(lastRow) || lastRow < 0 || lastRow + referenceOffset > a.height)
    return {
      expected: { width: a.width, height: a.height, bytes: a.pixels.length },
      actual: { width: b.width, height: b.height, bytes: b.pixels.length },
      count: null,
      diff: null,
      error: 'endY outside decoded image'
    };
  for (const [left, top, width, height] of maskAreas) {
    if (
      ![left, top, width, height].every(Number.isInteger) ||
      left < 0 ||
      top < 0 ||
      width <= 0 ||
      height <= 0 ||
      left + width > a.width ||
      top + height > a.height ||
      top + height > lastRow
    )
      return {
        expected: { width: a.width, height: a.height, bytes: a.pixels.length },
        actual: { width: b.width, height: b.height, bytes: b.pixels.length },
        count: null,
        diff: null,
        error: 'Mask region outside compared image bounds'
      };
  }
  const canvas = document.createElement('canvas');
  canvas.width = a.width;
  canvas.height = a.height;
  const context = canvas.getContext('2d')!;
  const output = context.createImageData(a.width, a.height);
  output.data.set(b.pixels);
  let count = 0;
  const regionCounts = regionEnds.map(() => 0);
  let region = 0;
  for (let y = 0; y < lastRow; y++) {
    while (region < regionEnds.length && y >= regionEnds[region]!) region++;
    for (let x = 0; x < a.width; x++) {
      if (
        maskAreas.some(
          ([left, top, width, height]) =>
            x >= left && x < left + width && y >= top && y < top + height
        )
      )
        continue;
      const i = (y * a.width + x) * 4;
      const reference = i + referenceOffset * a.width * 4;
      const r = a.pixels[reference]! - b.pixels[i]!,
        g = a.pixels[reference + 1]! - b.pixels[i + 1]!,
        blue = a.pixels[reference + 2]! - b.pixels[i + 2]!;
      const deltaY = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
      const deltaI = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
      const deltaQ = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
      const different =
        0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2;
      if (different) {
        count++;
        if (region < regionCounts.length) regionCounts[region]!++;
      }
      output.data[i] = different ? 255 : b.pixels[i]!;
      output.data[i + 1] = different ? 0 : b.pixels[i + 1]!;
      output.data[i + 2] = different ? 0 : b.pixels[i + 2]!;
      output.data[i + 3] = 255;
    }
  }
  context.putImageData(output, 0, 0);
  return {
    expected: { width: a.width, height: a.height, bytes: a.pixels.length },
    actual: { width: b.width, height: b.height, bytes: b.pixels.length },
    count,
    regionCounts,
    diff: canvas.toDataURL('image/png').split(',')[1]!,
    error: null
  };
}

type FrameId = 'dSEX3' | 'JO4DC';
type VisualManifest = {
  statusBarHeight: number;
  frames: Record<FrameId, { sha256: string }>;
  toleranceEvidence: Record<FrameId, { clipHeight: number; maxDiffPixelRatio: number }>;
};

const visualManifest: VisualManifest = JSON.parse(
  readFileSync(new URL('./references/paf-202-community/manifest.json', import.meta.url), 'utf8')
);

async function visualDiff(page: Page, frame: FrameId, testInfo: TestInfo) {
  const source = readFileSync(
    new URL(`./references/paf-202-community/${frame}.png`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    visualManifest.frames[frame].sha256
  );
  const screenshotPath = testInfo.outputPath(`${frame}-actual.png`);
  const actual = await page.screenshot({
    path: screenshotPath,
    animations: 'disabled',
    caret: 'hide'
  });
  const { clipHeight, maxDiffPixelRatio } = visualManifest.toleranceEvidence[frame];
  const regions = {
    header: 56,
    progress: 72,
    step: 104,
    heading: 145,
    description: 204,
    search: 261
  };
  const comparison = await page.evaluate(comparePngImages, {
    expected: source.toString('base64'),
    received: actual.toString('base64'),
    masks: [],
    endY: clipHeight,
    referenceOffset: visualManifest.statusBarHeight,
    regionEnds: frame === 'dSEX3' ? Object.values(regions) : []
  });
  await testInfo.attach(`${frame}-expected`, { body: source, contentType: 'image/png' });
  await testInfo.attach(`${frame}-actual`, { path: screenshotPath, contentType: 'image/png' });
  if (comparison.diff) {
    await testInfo.attach(`${frame}-diff`, {
      body: Buffer.from(comparison.diff, 'base64'),
      contentType: 'image/png'
    });
  }
  expect(comparison.error).toBeNull();
  assertDecodedImage(comparison.expected, comparison.actual, clipHeight, []);
  const pixels = comparison.expected.width * clipHeight;
  const ratio = comparison.count! / pixels;
  console.info(`${frame} residual: ${comparison.count}/${pixels} = ${ratio}`);
  if (frame === 'dSEX3') {
    const counts = comparison.regionCounts!;
    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(comparison.count);
    console.info(
      `dSEX3 region pixels: ${JSON.stringify(
        Object.fromEntries(Object.keys(regions).map((name, index) => [name, counts[index]]))
      )}`
    );
  }
  expect(ratio).toBeLessThanOrEqual(maxDiffPixelRatio);
}

test(
  'Pencil dSEX3: discovery header, search and action hierarchy',
  { tag: '@visual' },
  async ({ page }, testInfo) => {
    await player(page);
    const main = page.locator('[data-community-screen="discovery"]');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(en.communityOnboarding.lead);
    await geometry(main.locator('header'), { x: 20, y: 0, width: 350, height: 56 });
    const titleCenter = await main.locator('header p').evaluate((node) => {
      const style = getComputedStyle(node);
      const bounds = node.getBoundingClientRect();
      return (
        bounds.left +
        (bounds.width +
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)) /
          2
      );
    });
    expect(Math.abs(titleCenter - 183)).toBeLessThanOrEqual(1);
    await expect(main.locator('[aria-current="step"]')).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await geometry(main.getByRole('searchbox', { name: en.communityOnboarding.searchLabel }), {
      x: 20,
      y: 209,
      width: 350,
      height: 52
    });
    await geometry(main.getByRole('button', { name: en.communityOnboarding.createEntry }), {
      x: 20,
      width: 350,
      height: 52
    });
    const actions = main.locator('[data-community-actions]');
    await expect(actions.getByRole('button', { name: en.communityOnboarding.skip })).toBeVisible();
    await expect(actions).toHaveCSS('position', 'sticky');
    // F45: one sticky Finish with the skip action, and an accessible 48px Back chevron in the bar.
    await expect(actions.getByRole('button', { name: en.communityOnboarding.done })).toHaveCount(1);
    const back = main.getByRole('button', { name: en.communityOnboarding.discoveryBack });
    const backBox = await back.boundingBox();
    expect(backBox!.width).toBeGreaterThanOrEqual(44);
    expect(backBox!.height).toBeGreaterThanOrEqual(44);
    expect(backBox!.x).toBeLessThanOrEqual(24);
    await page.evaluate(() => document.fonts.ready);
    await visualDiff(page, 'dSEX3', testInfo);
  }
);

test(
  'Pencil JO4DC: creation order, control geometry and footer',
  { tag: '@visual' },
  async ({ page }, testInfo) => {
    await player(page);
    await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
    const main = page.locator('[data-community-screen="creation"]');
    await expect(main.getByRole('heading', { level: 1 })).toHaveText(
      en.communityOnboarding.createLead
    );
    await geometry(main.locator('header'), { x: 20, y: 0, width: 350, height: 56 });
    await expect(
      main.locator('header').getByRole('button', { name: en.communityOnboarding.back })
    ).toBeVisible();
    const fields = main.getByRole('textbox');
    await expect(fields.nth(0)).toHaveAccessibleName(en.communityOnboarding.nameLabel);
    await expect(fields.nth(1)).toHaveAccessibleName(en.communityOnboarding.cityLabel);
    await expect(fields.nth(2)).toHaveAccessibleName(en.communityOnboarding.descriptionLabel);
    await page.evaluate(() => document.fonts.ready);
    await expect(fields).toHaveCount(3);
    for (const [index, field] of (await fields.all()).entries()) {
      await geometry(field, { x: 20, y: 128 + index * 88, width: 350, height: 52 });
    }
    const options = main.getByRole('radiogroup', { name: en.communityOnboarding.visibilityLegend });
    await expect(options.getByRole('radio')).toHaveCount(2);
    await expect(options.getByRole('radio').first()).toBeChecked();
    const actions = main.locator('[data-community-actions]');
    await expect(actions.getByText(en.communityOnboarding.adminNote)).toBeVisible();
    await geometry(actions.getByRole('button', { name: en.communityOnboarding.createSubmit }), {
      x: 20,
      width: 350,
      height: 52
    });
    await expect(actions).toHaveCSS('position', 'sticky');
    await page.evaluate(() => document.fonts.ready);
    await visualDiff(page, 'JO4DC', testInfo);
  }
);

async function tokenColor(page: Page, name: string) {
  return page.evaluate((token) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${token})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);
}

for (const theme of ['light', 'dark'] as const) {
  test(`JO4DC visibility radios keep a 22px ring and selected card border (${theme})`, async ({
    page
  }) => {
    await player(page);
    await page
      .context()
      .addCookies([{ name: 'theme', value: theme, url: 'http://127.0.0.1:4173' }]);
    await page.goto('/onboarding/community?view=create');
    await waitForHydratedPage(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const group = page.getByRole('radiogroup', { name: en.communityOnboarding.visibilityLegend });
    const radios = group.getByRole('radio');
    const read = (radio: Locator) =>
      radio.evaluate((node) => {
        const style = getComputedStyle(node);
        const label = node.closest('label')!;
        const labelStyle = getComputedStyle(label);
        const box = node.getBoundingClientRect();
        return {
          width: box.width,
          height: box.height,
          ringWidth: style.borderTopWidth,
          ringColor: style.borderTopColor,
          labelWidth: labelStyle.borderTopWidth,
          labelColor: labelStyle.borderTopColor
        };
      });
    const green = await tokenColor(page, '--color-green');
    const muted = await tokenColor(page, '--color-muted');
    const line = await tokenColor(page, '--color-line');

    const checked = await read(radios.nth(0));
    const unchecked = await read(radios.nth(1));
    expect(checked).toMatchObject({ width: 22, height: 22, ringColor: green, labelColor: green });
    expect(Number.parseFloat(checked.ringWidth)).toBeGreaterThan(2);
    expect(unchecked).toMatchObject({
      width: 22,
      height: 22,
      ringWidth: '2px',
      ringColor: muted,
      labelWidth: '1px',
      labelColor: line
    });

    await group.getByText(en.communityOnboarding.private, { exact: true }).click();
    await expect(radios.nth(1)).toBeChecked();
    const swappedChecked = await read(radios.nth(1));
    const swappedUnchecked = await read(radios.nth(0));
    expect(swappedChecked).toMatchObject({
      width: 22,
      height: 22,
      ringColor: green,
      labelColor: green
    });
    expect(Number.parseFloat(swappedChecked.ringWidth)).toBeGreaterThan(2);
    expect(swappedUnchecked).toMatchObject({
      ringWidth: '2px',
      ringColor: muted,
      labelColor: line
    });

    await radios.nth(1).focus();
    await page.keyboard.press('ArrowUp');
    await expect(radios.nth(0)).toBeChecked();
  });
}

test('wide dark creation keeps its controls centered and keyboard accessible', async ({ page }) => {
  await player(page);
  await page.setViewportSize({ width: 1280, height: 844 });
  await page.context().addCookies([{ name: 'theme', value: 'dark', url: 'http://127.0.0.1:4173' }]);
  await page.goto('/onboarding/community?view=create');
  await waitForHydratedPage(page);
  const name = page.getByRole('textbox', { name: en.communityOnboarding.nameLabel });
  await name.focus();
  await page.keyboard.press('Tab');
  const city = page.getByRole('textbox', { name: en.communityOnboarding.cityLabel });
  await expect(city).toBeFocused();
  await geometry(city, { x: 420, width: 440, height: 52 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('live search keeps keyboard focus across debounce and server results', async ({ page }) => {
  await player(page);
  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
  await input.focus();
  await input.pressSequentially('NeverMatch');
  await expect(page).toHaveURL(/q=NeverMatch/);
  await expect(page.getByText(en.communityOnboarding.emptySearch)).toBeVisible();
  await expect(input).toBeFocused();
  await input.pressSequentially('Again');
  await expect(page).toHaveURL(/q=NeverMatchAgain/);
  await expect(input).toHaveValue('NeverMatchAgain');
  await expect(input).toBeFocused();
});

test('search announces pending loader and settles after deterministic response release', async ({
  page
}) => {
  await player(page);
  let release!: () => void;
  let signalRequest!: () => void;
  const responseGate = new Promise<void>((resolve) => (release = resolve));
  const requestSeen = new Promise<void>((resolve) => (signalRequest = resolve));
  await page.route(
    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
    async (route) => {
      signalRequest();
      await responseGate;
      await route.continue();
    }
  );
  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
  await input.fill(`Pending${crypto.randomUUID().slice(0, 6)}`);
  await requestSeen;
  const main = page.getByRole('main');
  await expect(main.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
  expect(
    await main.getByRole('status').evaluate((status) => status.closest('[aria-busy="true"]'))
  ).toBeNull();
  await expect(page.getByText(en.communityOnboarding.emptySearch)).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  release();
  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
  await expect(main.getByRole('status')).not.toHaveText(en.communityOnboarding.searchLoading);
});

test('retry reports pending, blocks duplicate invalidation, and recovers from one controlled failure', async ({
  page
}) => {
  await player(page);
  let calls = 0;
  let release!: () => void;
  let signalRetry!: () => void;
  const retryGate = new Promise<void>((resolve) => (release = resolve));
  const retrySeen = new Promise<void>((resolve) => (signalRetry = resolve));
  await page.route(
    /\/_serverFn\/6cf6671334014b970362dc54c0cce26a91d4da36e41403af07a6c0cf2750fa7d(?:\?.*)?$/,
    async (route) => {
      calls++;
      if (calls === 1) {
        await route.fulfill({ status: 500, body: 'controlled loader failure' });
        return;
      }
      signalRetry();
      await retryGate;
      await route.continue();
    }
  );
  const input = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
  await input.fill(`Retry${crypto.randomUUID().slice(0, 6)}`);
  const main = page.getByRole('main');
  await expect(main.getByRole('alert')).toHaveText(en.communityOnboarding.loadFailed);
  const retry = page.getByRole('button', { name: en.communityOnboarding.retry });
  await retry.click();
  await retrySeen;
  await expect(main.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
  await expect(retry).toBeDisabled();
  release();
  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
  await expect(main.getByRole('alert')).toHaveCount(0);
  expect(calls).toBe(2);
});

test('successful create resets after browser Back and create re-entry', async ({ page }) => {
  await player(page);
  const search = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
  await search.fill('Madrid');
  await expect(page).toHaveURL(/q=Madrid/);
  await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
  await page.getByLabel(en.communityOnboarding.nameLabel).fill(`First ${crypto.randomUUID()}`);
  await page.getByRole('button', { name: en.communityOnboarding.createSubmit }).click();
  await expect(page.getByText(en.communityOnboarding.created)).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue('Madrid');
  await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
  await expect(page.getByLabel(en.communityOnboarding.nameLabel)).toHaveValue('');
  await expect(
    page.getByRole('button', { name: en.communityOnboarding.createSubmit })
  ).toBeVisible();
  await expect(page.getByText(en.communityOnboarding.created)).toHaveCount(0);
});

test('browser Back restores settled query after Create consumes a pending search edit', async ({
  page
}) => {
  await player(page);
  const search = page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel });
  await search.fill('Mad');
  await expect(page).toHaveURL(/\?q=Mad$/);
  await search.fill('Madrid');
  await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
  await expect(page).toHaveURL(/\?q=Madrid&view=create$/);
  await expect(
    page.getByRole('heading', { name: en.communityOnboarding.createLead })
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\?q=Mad$/);
  await expect(search).toHaveValue('Mad');
  await page.waitForTimeout(400);
  await expect(page).toHaveURL(/\?q=Mad$/);
  await expect(search).toHaveValue('Mad');
});

test('guest and incomplete users cannot read discovery or create', async ({ page }) => {
  await page.goto('/onboarding/community?view=create');
  await expect(page).toHaveURL(/\/login/);
  await page.goto('/onboarding/account');
  await waitForHydratedPage(page);
  const email = page.locator('#signup-email');
  await expect(email).toBeEnabled();
  await email.fill(
    `incomplete-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`
  );
  await page.getByLabel(en.auth.signupPasswordLabel).fill('Password123!');
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await page.goto('/onboarding/community?q=Madrid');
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('profile save reaches discovery, skip makes no membership and direct access remains open', async ({
  page
}) => {
  const email = await player(page);
  await expect(page.getByRole('heading', { name: en.communityOnboarding.lead })).toBeVisible();
  await page.getByRole('button', { name: en.communityOnboarding.skip }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const client = localClient();
  const session = await client.auth.signInWithPassword({ email, password: 'Password123!' });
  expect(session.error).toBeNull();
  const membership = await client.from('community_members').select('id');
  expect(membership.error).toBeNull();
  expect(membership.data).toEqual([]);
  await page.goto('/onboarding/community?view=create');
  await expect(
    page.getByRole('heading', { name: en.communityOnboarding.createLead })
  ).toBeVisible();
});

test('discovery Back and Finish use the validated return path, never history', async ({ page }) => {
  await player(page);
  // Default: the dashboard; deep link: the validated next; unsafe next: back to the default.
  for (const [search, destination, control] of [
    ['', /\/dashboard$/, 'back'],
    ['?next=%2Fmatches%2Fmy', /\/matches\/my$/, 'back'],
    ['?next=%2F%2Fevil.example', /\/dashboard$/, 'back'],
    ['?next=%2Fmatches%2Fmy', /\/matches\/my$/, 'finish']
  ] as const) {
    await page.goto(`/onboarding/community${search}`);
    await waitForHydratedPage(page);
    await page
      .getByRole('button', {
        name:
          control === 'back' ? en.communityOnboarding.discoveryBack : en.communityOnboarding.done
      })
      .click();
    await expect(page).toHaveURL(destination);
  }
});

test('SSR and hydration preserve locale across both views at 320px', async ({ page }) => {
  await player(page);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const locale of ['en', 'pt-BR', 'es'] as const) {
    const copy: LocaleCopy = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
    );
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
    for (const path of ['/onboarding/community', '/onboarding/community?view=create']) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });
      const title = path.includes('create')
        ? copy.communityOnboarding.createLead
        : copy.communityOnboarding.lead;
      await assertRawLocale(page, response, locale, title);
      await waitForHydratedPage(page);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        320
      );
    }
  }
});

test('raw locale oracle rejects English SSR even when live DOM is Portuguese', async ({ page }) => {
  await page.setContent('<html lang="pt-BR"><body><h1>Comunidades</h1></body></html>');
  await expect(
    assertRawMarkupLocale(
      page,
      '<html lang="en"><body><h1>Communities</h1></body></html>',
      'pt-BR',
      'Comunidades'
    )
  ).rejects.toThrow();
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.locator('h1')).toHaveText('Comunidades');
});

test('optional labels stay visible and inputs remain usable at 320px in every locale', async ({
  page
}) => {
  await player(page);
  await page.setViewportSize({ width: 320, height: 844 });
  for (const locale of ['en', 'pt-BR', 'es'] as const) {
    const copy: LocaleCopy = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
    );
    await page
      .context()
      .addCookies([{ name: 'locale', value: locale, url: 'http://127.0.0.1:4173' }]);
    await page.goto('/onboarding/community?view=create');
    await waitForHydratedPage(page);
    for (const [id, label] of [
      ['community-description', copy.communityOnboarding.descriptionLabel],
      ['community-city', copy.communityOnboarding.cityLabel]
    ] as const) {
      const input = page.locator(`#${id}`);
      const associated = page.getByText(label, { exact: true });
      await input.fill('Entered value');
      await expect(associated).toBeVisible();
      await expect(input).toHaveAttribute('id', id);
      await expect(associated).toHaveAttribute('for', id);
      const measured = await input.evaluate((node) => {
        const inputRect = node.getBoundingClientRect();
        const fieldLabel = document.querySelector(`label[for="${node.id}"]`)!;
        const labelRect = fieldLabel.getBoundingClientRect();
        return {
          inputHeight: inputRect.height,
          overlap: labelRect.bottom > inputRect.top + inputRect.height / 2
        };
      });
      expect(measured.inputHeight).toBeGreaterThanOrEqual(44);
      expect(measured.overlap).toBe(false);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320
    );
  }
});

test('create path validates then creates real public and private communities', async ({ page }) => {
  await player(page);
  await page.getByRole('button', { name: en.communityOnboarding.createEntry }).click();
  await expect(page).toHaveURL(/view=create/);
  await page.reload();
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityOnboarding.createSubmit }).click();
  await expect(page.getByText(en.communityOnboarding.invalidName)).toBeVisible();
  const name = `Onboarding ${crypto.randomUUID()}`;
  await page.getByLabel(en.communityOnboarding.nameLabel).fill(name);
  await page.getByRole('radio', { name: /Private/ }).click();
  await page.getByRole('button', { name: en.communityOnboarding.createSubmit }).click();
  await expect(page.getByText(en.communityOnboarding.created)).toBeVisible();
  await page.getByRole('button', { name: en.communityOnboarding.finish }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`/onboarding/community?q=${encodeURIComponent(name)}`);
  await expect(page.getByText(en.communityOnboarding.emptySearch)).toBeVisible();
  await page.goto('/onboarding/community?view=create');
  await waitForHydratedPage(page);
  await page.getByLabel(en.communityOnboarding.nameLabel).fill(`Open ${crypto.randomUUID()}`);
  await page.getByRole('button', { name: en.communityOnboarding.createSubmit }).click();
  await expect(page.getByText(en.communityOnboarding.created)).toBeVisible();
});

test('city search finds real public community; join follows instant vs approval policy', async ({
  browser
}) => {
  const creator = await browser.newPage();
  const joiner = await browser.newPage();
  try {
    const creatorEmail = await player(creator);
    const city = `City${crypto.randomUUID().slice(0, 8)}`;
    const client = localClient();
    const session = await client.auth.signInWithPassword({
      email: creatorEmail,
      password: 'Password123!'
    });
    expect(session.error).toBeNull();
    const ids: string[] = [];
    for (const policy of ['instant', 'admin_approval'] as const) {
      // Short single-line names keep both discovery cards at the designed dSEX3 geometry
      // (one 19px title row inside the 142px card). A wrapped random-UUID name would
      // overflow the designed card height and shift every probe below it, measuring content
      // overflow instead of the frame.
      const created = await client.rpc('create_community', {
        p_name: `${policy === 'instant' ? 'Instant' : 'Approval'} ${city}`,
        p_city_label: city,
        p_visibility: 'public',
        p_join_policy: policy
      });
      expect(created.error).toBeNull();
      ids.push(created.data);
    }
    const joinerEmail = await player(joiner);
    await joiner.getByRole('searchbox', { name: en.communityOnboarding.searchLabel }).fill(city);
    await expect(joiner).toHaveURL(/q=City/);
    await expect(joiner.getByText(`${city} · ${en.communityOnboarding.openJoin}`)).toBeVisible();
    const cards = joiner
      .locator('[data-community-screen="discovery"] [aria-busy="false"] > div')
      .filter({ has: joiner.getByRole('heading', { level: 2 }) });
    await expect(cards).toHaveCount(2);
    for (const card of await cards.all()) {
      await geometry(card, { x: 20, width: 350 });
      const [action, title] = await Promise.all([
        card.getByRole('button').boundingBox(),
        card.getByRole('heading', { level: 2 }).boundingBox()
      ]);
      expect(action!.height).toBeGreaterThanOrEqual(52);
      expect(title!.x).toBeGreaterThan(34);
      expect(action!.x).toBeGreaterThan(title!.x);
    }
    await joiner.getByRole('button', { name: en.communityOnboarding.join }).click();
    await expect(joiner.getByText(en.communityOnboarding.joined)).toBeVisible();
    await joiner.getByRole('button', { name: en.communityOnboarding.requestToJoin }).click();
    await expect(joiner.getByText(en.communityOnboarding.requestPending)).toBeVisible();
    const membershipClient = localClient();
    const memberSession = await membershipClient.auth.signInWithPassword({
      email: joinerEmail,
      password: 'Password123!'
    });
    expect(memberSession.error).toBeNull();
    const memberships = await membershipClient
      .from('community_members')
      .select('community_id,status')
      .in('community_id', ids);
    expect(memberships.error).toBeNull();
    expect(memberships.data).toEqual(
      expect.arrayContaining([
        { community_id: ids[0], status: 'active' },
        { community_id: ids[1], status: 'pending' }
      ])
    );
  } finally {
    await creator.close();
    await joiner.close();
  }
});

test(
  'real visual comparator counts synthetic PNG changes and rejects invalid regions',
  { tag: '@visual' },
  async ({ page }) => {
    // Fixture generator only: paints known opaque pixels with the browser canvas.
    // Every expectation below flows through comparePngImages, the same
    // page.evaluate comparator used by visualDiff — no duplicated colour maths.
    const images = await page.evaluate(() => {
      const png = (width: number, height: number, points: [number, number][]) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.fillStyle = '#000';
        for (const [x, y] of points) context.fillRect(x, y, 1, 1);
        return canvas.toDataURL('image/png').split(',')[1]!;
      };
      return {
        blank: png(390, 844, []),
        single: png(390, 844, [[7, 8]]),
        edges: png(390, 844, [
          [0, 0],
          [389, 0],
          [0, 843],
          [389, 843],
          [194, 421]
        ]),
        insideMask: png(390, 844, [[55, 50]]),
        outsideMask: png(390, 844, [
          [55, 50],
          [60, 50]
        ]),
        endRows: png(390, 844, [
          [10, 100],
          [10, 600]
        ]),
        narrow: png(389, 844, []),
        short: png(390, 843, []),
        wrongSize: png(300, 150, [])
      };
    });
    const compare = (received: string, masks: [number, number, number, number][], endY: number) =>
      page.evaluate(comparePngImages, { expected: images.blank, received, masks, endY });

    const identical = await compare(images.blank, [], 844);
    expect(identical.error).toBeNull();
    expect(identical.count).toBe(0);
    expect(identical.expected).toEqual({ width: 390, height: 844, bytes: 390 * 844 * 4 });
    expect(identical.actual).toEqual({ width: 390, height: 844, bytes: 390 * 844 * 4 });

    const single = await compare(images.single, [], 844);
    expect(single.error).toBeNull();
    expect(single.count).toBe(1);
    expect(single.expected.bytes).toBe(390 * 844 * 4);
    expect(single.actual.bytes).toBe(390 * 844 * 4);
    expect(single.diff).not.toBeNull();
    expect([...Buffer.from(single.diff!, 'base64').subarray(0, 8)]).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a
    ]);

    const edges = await compare(images.edges, [], 844);
    expect(edges.error).toBeNull();
    // First pixel, first-row last column, last-row first/last columns and centre.
    expect(edges.count).toBe(5);

    // Half-open masks skip the painted inside pixel; the pixel at x = left + width
    // sits immediately outside the mask and must still be counted.
    const maskedInside = await compare(images.insideMask, [[50, 50, 10, 10]], 844);
    expect(maskedInside.error).toBeNull();
    expect(maskedInside.count).toBe(0);
    const maskedBoundary = await compare(images.outsideMask, [[50, 50, 10, 10]], 844);
    expect(maskedBoundary.error).toBeNull();
    expect(maskedBoundary.count).toBe(1);

    // Rows at or below endY are ignored: (10, 600) is outside the compared band
    // when endY is 500 but counted when the band covers the full image.
    const belowEndY = await compare(images.endRows, [], 500);
    expect(belowEndY.error).toBeNull();
    expect(belowEndY.count).toBe(1);
    const withinEndY = await compare(images.endRows, [], 844);
    expect(withinEndY.error).toBeNull();
    expect(withinEndY.count).toBe(2);

    const widthMismatch = await compare(images.narrow, [], 844);
    expect(widthMismatch.error).toBe('PNG dimensions or RGBA buffer length mismatch');
    expect(widthMismatch.count).toBeNull();
    expect(widthMismatch.diff).toBeNull();

    const heightMismatch = await compare(images.short, [], 844);
    expect(heightMismatch.error).toBe('PNG dimensions or RGBA buffer length mismatch');
    expect(heightMismatch.count).toBeNull();
    expect(heightMismatch.diff).toBeNull();

    const equallyWrong = await page.evaluate(comparePngImages, {
      expected: images.wrongSize,
      received: images.wrongSize,
      masks: [],
      endY: 844
    });
    expect(equallyWrong.error).toBe('PNG must be exactly 390×844');
    expect(equallyWrong.count).toBeNull();
    expect(equallyWrong.diff).toBeNull();

    for (const endY of [-1, 845, 500.5]) {
      const rejected = await compare(images.blank, [], endY);
      expect(rejected.error, `endY ${endY}`).toBe('endY outside decoded image');
      expect(rejected.count, `endY ${endY}`).toBeNull();
      expect(rejected.diff, `endY ${endY}`).toBeNull();
    }

    const maskRejections: {
      reason: string;
      masks: [number, number, number, number][];
      endY: number;
    }[] = [
      { reason: 'beyond right edge', masks: [[389, 0, 2, 1]], endY: 844 },
      { reason: 'beyond bottom edge', masks: [[0, 843, 1, 2]], endY: 844 },
      { reason: 'negative left', masks: [[-1, 0, 1, 1]], endY: 844 },
      { reason: 'negative top', masks: [[0, -1, 1, 1]], endY: 844 },
      { reason: 'zero width', masks: [[0, 0, 0, 1]], endY: 844 },
      { reason: 'zero height', masks: [[0, 0, 1, 0]], endY: 844 },
      { reason: 'fractional coordinates', masks: [[0.5, 0, 1, 1]], endY: 844 },
      { reason: 'extends beyond endY', masks: [[0, 499, 1, 2]], endY: 500 }
    ];
    for (const { reason, masks, endY } of maskRejections) {
      const rejected = await compare(images.blank, masks, endY);
      expect(rejected.error, reason).toBe('Mask region outside compared image bounds');
      expect(rejected.count, reason).toBeNull();
      expect(rejected.diff, reason).toBeNull();
    }
  }
);

test(
  'masked title, metadata and action geometry probes reject displaced fixture nodes',
  { tag: '@visual' },
  async ({ page }) => {
    await page.setContent(
      '<h3 id="title">Fixture title</h3><p id="metadata">Fixture metadata</p><button id="action">Fixture action</button>'
    );
    await page.locator('#title').evaluate((element) =>
      Object.assign(element.style, {
        position: 'absolute',
        left: '40px',
        top: '260px',
        width: '326px',
        height: '19px'
      })
    );
    await page.locator('#metadata').evaluate((element) =>
      Object.assign(element.style, {
        position: 'absolute',
        left: '40px',
        top: '286px',
        width: '326px',
        height: '15px'
      })
    );
    await page.locator('#action').evaluate((element) =>
      Object.assign(element.style, {
        position: 'absolute',
        left: '40px',
        top: '324px',
        width: '326px',
        height: '44px'
      })
    );
    await expect(
      geometry(page.locator('#title'), { x: 32, y: 254, width: 326, height: 19 })
    ).rejects.toThrow();
    await expect(
      geometry(page.locator('#metadata'), { x: 32, y: 280, width: 326, height: 15 })
    ).rejects.toThrow();
    await expect(
      geometry(page.locator('#action'), { x: 32, y: 324, width: 326, height: 44 })
    ).rejects.toThrow();
  }
);
