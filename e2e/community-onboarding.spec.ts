import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
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
    title: string;
    skip: string;
    createTitle: string;
    createEntry: string;
    nameLabel: string;
    visibilityLegend: string;
    cityLabel: string;
    createSubmit: string;
    optionalDetails: string;
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
  const vars = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        ] as const;
      })
  );
  const url = vars.get('VITE_SUPABASE_URL');
  const key = vars.get('VITE_SUPABASE_PUBLISHABLE_KEY');
  if (!url || !key || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('E2E requires loopback Supabase');
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

async function typography(
  locator: Locator,
  expected: { family: string; size: string; weight: string; lineHeight: string; color: string }
) {
  const styles = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      family: style.fontFamily,
      size: style.fontSize,
      weight: style.fontWeight,
      lineHeight: style.lineHeight,
      color: style.color
    };
  });
  expect(styles.family).toContain(expected.family);
  expect(styles.size).toBe(expected.size);
  expect(styles.weight).toBe(expected.weight);
  expect(styles.lineHeight).toBe(expected.lineHeight);
  expect(styles.color).toBe(expected.color);
}

type ComparePngInputs = {
  expected: string;
  received: string;
  masks: [number, number, number, number][];
  endY: number;
};

type ComparePngResult = {
  expected: { width: number; height: number; bytes: number };
  actual: { width: number; height: number; bytes: number };
  count: number | null;
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
  endY: lastRow
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
  if (!Number.isInteger(lastRow) || lastRow < 0 || lastRow > a.height)
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
  for (let y = 0; y < lastRow; y++)
    for (let x = 0; x < a.width; x++) {
      if (
        maskAreas.some(
          ([left, top, width, height]) =>
            x >= left && x < left + width && y >= top && y < top + height
        )
      )
        continue;
      const i = (y * a.width + x) * 4;
      const r = a.pixels[i]! - b.pixels[i]!,
        g = a.pixels[i + 1]! - b.pixels[i + 1]!,
        blue = a.pixels[i + 2]! - b.pixels[i + 2]!;
      const deltaY = 0.29889531 * r + 0.58662247 * g + 0.11448223 * blue;
      const deltaI = 0.59597799 * r - 0.2741761 * g - 0.32180178 * blue;
      const deltaQ = 0.21147017 * r - 0.52261711 * g + 0.31114694 * blue;
      const different =
        0.5053 * deltaY ** 2 + 0.299 * deltaI ** 2 + 0.1957 * deltaQ ** 2 > 35215 * 0.1 ** 2;
      if (different) count++;
      output.data[i] = different ? 255 : b.pixels[i]!;
      output.data[i + 1] = different ? 0 : b.pixels[i + 1]!;
      output.data[i + 2] = different ? 0 : b.pixels[i + 2]!;
      output.data[i + 3] = 255;
    }
  context.putImageData(output, 0, 0);
  return {
    expected: { width: a.width, height: a.height, bytes: a.pixels.length },
    actual: { width: b.width, height: b.height, bytes: b.pixels.length },
    count,
    diff: canvas.toDataURL('image/png').split(',')[1]!,
    error: null
  };
}

// Only fixture-dependent glyphs are excluded: search text, two names, city/policy
// metadata and Pencil's unavailable member/level examples. Card edges and both
// card action labels remain compared. Source PNG and baseline bytes stay untouched.
async function visualDiff(
  page: Page,
  name: keyof typeof references,
  masks: [number, number, number, number][],
  endY = 844,
  testInfo?: TestInfo,
  region = 'full'
) {
  const source = readFileSync(new URL(`./references/paf-30/${name}`, import.meta.url));
  const baseline = readFileSync(
    new URL(`./community-onboarding.spec.ts-snapshots/${name}`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(references[name]);
  expect(baseline).toEqual(source);
  const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const comparison = await page.evaluate(comparePngImages, {
    expected: source.toString('base64'),
    received: actual.toString('base64'),
    masks,
    endY
  });
  await testInfo?.attach(`${name}-${region}-expected`, { body: source, contentType: 'image/png' });
  await testInfo?.attach(`${name}-${region}-actual`, { body: actual, contentType: 'image/png' });
  if (comparison.diff)
    await testInfo?.attach(`${name}-${region}-diff`, {
      body: Buffer.from(comparison.diff, 'base64'),
      contentType: 'image/png'
    });
  else
    await testInfo?.attach(`${name}-${region}-diff-unavailable`, {
      body: comparison.error ?? 'Diff unavailable',
      contentType: 'text/plain'
    });
  if (!comparison.error) assertDecodedImage(comparison.expected, comparison.actual, endY, masks);
  expect(comparison.error, `visual comparator rejected ${name}: ${comparison.error}`).toBeNull();
  expect(comparison.count).not.toBeNull();
  expect(
    readFileSync(new URL(`./community-onboarding.spec.ts-snapshots/${name}`, import.meta.url))
  ).toEqual(source);
  return comparison.count!;
}

test('Pencil structure: discovery and create preserve exact CSS boxes', async ({
  page
}, testInfo) => {
  await player(page);
  await page.evaluate(() => document.fonts.ready);
  await geometry(page.locator('main > div').first().locator('span').first(), {
    x: 18,
    y: 18,
    height: 25
  });
  await geometry(page.locator('main header'), { x: 18, y: 55, width: 354 });
  await geometry(page.locator('main > div:last-child > div:first-child'), {
    x: 18,
    y: 116,
    width: 354
  });
  await geometry(page.locator('#community-search'), { x: 18, y: 186, width: 354, height: 44 });
  await page.goto('/onboarding/community?view=create');
  await waitForHydratedPage(page);
  await geometry(page.locator('main > div').first().locator('span').first(), {
    x: 18,
    y: 18,
    height: 25
  });
  await geometry(page.locator('main header'), { x: 18, y: 55, width: 354 });
  await geometry(page.locator('form > div').first(), { x: 18, y: 116, width: 354 });
  await geometry(page.locator('#community-name'), { x: 18, y: 191, width: 354, height: 44 });
  await geometry(page.getByText(en.communityOnboarding.visibilityLegend).locator('..'), {
    x: 18,
    y: 245,
    width: 354,
    height: 193
  });
  await geometry(page.getByText(en.communityOnboarding.optionalDetails).locator('..'), {
    x: 18,
    y: 448,
    width: 354,
    height: 134
  });
  await geometry(page.locator('#community-description'), { x: 30, y: 482, width: 330, height: 44 });
  await geometry(page.locator('#community-city'), { x: 30, y: 526, width: 330, height: 44 });
  await geometry(page.getByText(en.communityOnboarding.adminNote), { x: 18, y: 592, width: 354 });
  await geometry(page.getByRole('button', { name: en.communityOnboarding.createSubmit }), {
    x: 18,
    y: 632,
    width: 354,
    height: 44
  });
  await geometry(page.getByRole('button', { name: en.communityOnboarding.back }), {
    x: 18,
    y: 686,
    width: 354,
    height: 44
  });
  const upper = await visualDiff(page, 'community-create.png', [], 448, testInfo, 'upper-create');
  console.log(`JO4DC unaffected region: ${upper}/174720 (${((upper / 174720) * 100).toFixed(3)}%)`);
  // Cross-platform cap: macOS 12,611/174,720 = 7.218%; Linux CI 14,863/174,720 = 8.507%;
  // worse (Linux) residual + 0.15pp headroom. Residual is Pencil/Chromium glyph
  // rasterization and native input/radio treatment, not displaced boxes.
  expect(upper / 174720).toBeLessThanOrEqual(0.0866);
});

test('create view compares against JO4DC Pencil reference', async ({ page }, testInfo) => {
  await player(page);
  await page.goto('/onboarding/community?view=create');
  await waitForHydratedPage(page);
  await page.evaluate(() => document.fonts.ready);
  const source = readFileSync(new URL('./references/paf-30/community-create.png', import.meta.url));
  const baseline = readFileSync(
    new URL('./community-onboarding.spec.ts-snapshots/community-create.png', import.meta.url)
  );
  expect(baseline).toEqual(source);
  try {
    await expect(page).toHaveScreenshot('community-create.png', {
      threshold: 0.1,
      // Cross-platform cap: macOS 38,251/329,160 = 11.621%; Linux CI 41,132/329,160 = 12.497%;
      // worse (Linux) residual + 0.15pp headroom. Mandatory 44px optional controls
      // shift lower content; exact geometry and an independent upper-region cap still apply.
      maxDiffPixelRatio: 0.1265,
      animations: 'disabled',
      caret: 'hide'
    });
    const different = await visualDiff(
      page,
      'community-create.png',
      [],
      844,
      testInfo,
      'full-create'
    );
    console.log(
      `JO4DC visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
    );
  } finally {
    expect(
      readFileSync(
        new URL('./community-onboarding.spec.ts-snapshots/community-create.png', import.meta.url)
      )
    ).toEqual(source);
  }
});

test('discovery view compares card structure and actions against dSEX3 Pencil reference', async ({
  page
}, testInfo) => {
  const email = await player(page);
  const city = `Visual${crypto.randomUUID().slice(0, 8)}`;
  const client = localClient();
  expect(
    (await client.auth.signInWithPassword({ email, password: 'Password123!' })).error
  ).toBeNull();
  for (const [name, policy] of [
    ['Pádel & Amigos', 'admin_approval'],
    ['Padel Collective Madrid', 'instant']
  ] as const) {
    const created = await client.rpc('create_community', {
      p_name: name,
      p_city_label: city,
      p_visibility: 'public',
      p_join_policy: policy
    });
    expect(created.error).toBeNull();
  }
  await page.getByRole('searchbox', { name: en.communityOnboarding.searchLabel }).fill(city);
  await expect(page).toHaveURL(/q=Visual/);
  const cards = page
    .locator('main > div:last-child [aria-busy="false"] > div')
    .filter({ has: page.getByRole('heading', { level: 3 }) });
  await expect(cards).toHaveCount(2);
  await expect(
    cards.nth(0).getByRole('heading', { name: 'Padel Collective Madrid' })
  ).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
  await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
  const firstTitle = cards.nth(0).getByRole('heading', { level: 3 });
  const secondTitle = cards.nth(1).getByRole('heading', { level: 3 });
  const firstMeta = cards.nth(0).locator('p').nth(0);
  const secondMeta = cards.nth(1).locator('p').nth(0);
  // Pencil dSEX3 source: content inset 14; name box 19px high; 7px vertical gap;
  // Metadata and member-count lines occupy the existing text column.
  await geometry(firstTitle, { x: 32, y: 254, width: 326, height: 19 });
  await geometry(firstMeta, { x: 32, y: 280, width: 326, height: 15 });
  await geometry(cards.nth(0).locator('p').nth(1), { x: 32, y: 302, width: 326, height: 15 });
  await geometry(secondTitle, { x: 32, y: 406, width: 326, height: 19 });
  await geometry(secondMeta, { x: 32, y: 432, width: 326, height: 15 });
  await geometry(cards.nth(1).locator('p').nth(1), { x: 32, y: 454, width: 326, height: 15 });
  for (const title of [firstTitle, secondTitle])
    await typography(title, {
      family: 'Manrope',
      size: '14px',
      weight: '700',
      lineHeight: 'normal',
      color: 'rgb(18, 37, 29)'
    });
  for (const meta of [firstMeta, secondMeta])
    await typography(meta, {
      family: 'Inter',
      size: '12px',
      weight: '400',
      lineHeight: 'normal',
      color: 'rgb(92, 107, 98)'
    });
  for (const count of [cards.nth(0).locator('p').nth(1), cards.nth(1).locator('p').nth(1)])
    await typography(count, {
      family: 'Inter',
      size: '12px',
      weight: '400',
      lineHeight: 'normal',
      color: 'rgb(92, 107, 98)'
    });
  await geometry(cards.nth(0).getByRole('button', { name: en.communityOnboarding.join }), {
    x: 32,
    y: 324,
    width: 326,
    height: 44
  });
  await geometry(cards.nth(1).getByRole('button', { name: en.communityOnboarding.requestToJoin }), {
    x: 32,
    y: 476,
    width: 326,
    height: 44
  });
  await geometry(page.getByRole('button', { name: en.communityOnboarding.createEntry }), {
    x: 18,
    y: 544,
    width: 354,
    height: 44
  });
  await geometry(page.getByRole('button', { name: en.communityOnboarding.skip }), {
    x: 18,
    y: 598,
    width: 354,
    height: 44
  });
  const different = await visualDiff(
    page,
    'community-discovery.png',
    [
      [30, 198, 310, 23],
      [31, 252, 308, 65],
      [31, 404, 308, 65]
    ],
    844,
    testInfo,
    'discovery'
  );
  console.log(
    `dSEX3 visual residual: ${different}/329160 (${((different / 329160) * 100).toFixed(3)}%)`
  );
  // Cross-platform cap: macOS 11,255/329,160 = 3.419%; Linux CI 14,980/329,160 = 4.551%;
  // worse (Linux) residual + 0.15pp headroom for font rasterization.
  expect(different / 329160).toBeLessThanOrEqual(0.047);
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
  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
  expect(
    await page.getByRole('status').evaluate((status) => status.closest('[aria-busy="true"]'))
  ).toBeNull();
  await expect(page.getByText(en.communityOnboarding.emptySearch)).toHaveCount(0);
  await expect(input).toBeEnabled();
  await expect(input).toBeFocused();
  release();
  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
  await expect(page.getByRole('status')).not.toHaveText(en.communityOnboarding.searchLoading);
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
  await expect(page.getByRole('alert')).toHaveText(en.communityOnboarding.loadFailed);
  const retry = page.getByRole('button', { name: en.communityOnboarding.retry });
  await retry.click();
  await retrySeen;
  await expect(page.getByRole('status')).toHaveText(en.communityOnboarding.searchLoading);
  await expect(page.locator('div[aria-busy="true"]')).toHaveCount(1);
  await expect(retry).toBeDisabled();
  release();
  await expect(page.locator('[aria-busy="false"]')).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
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
    page.getByRole('heading', { name: en.communityOnboarding.createTitle })
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
  await expect(page.getByRole('heading', { name: en.communityOnboarding.title })).toBeVisible();
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
    page.getByRole('heading', { name: en.communityOnboarding.createTitle })
  ).toBeVisible();
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
        ? copy.communityOnboarding.createTitle
        : copy.communityOnboarding.title;
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
      .locator('main > div:last-child [aria-busy="false"] > div')
      .filter({ has: joiner.getByRole('heading', { level: 3 }) });
    // Pencil dSEX3 frame: the discovery card is 142px tall (y 240, join button y 324, next
    // card y 392). The member-count line occupies the existing text column inside that
    // designed height — it fills the slack above the bottom-pinned action, so the card, the
    // entry buttons and the skip button keep their frame positions (same probes as the
    // dSEX3 structural test above, which is anchored to the sha-pinned reference PNG).
    await geometry(cards.nth(0), { x: 18, y: 240, width: 354, height: 142 });
    await geometry(cards.nth(1), { x: 18, y: 392, width: 354, height: 142 });
    await geometry(joiner.getByRole('button', { name: en.communityOnboarding.createEntry }), {
      x: 18,
      y: 544,
      width: 354,
      height: 44
    });
    await geometry(joiner.getByRole('button', { name: en.communityOnboarding.skip }), {
      x: 18,
      y: 598,
      width: 354,
      height: 44
    });
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

// Pencil Export(['dSEX3','JO4DC'], 'png', e2e/references, {scale:1});
// Source frames dSEX3 and JO4DC, 390×844, SHA-256 pinned. Baselines are copies of
// source bytes, never browser-rendered screenshots. Cards intentionally omit unsupported
// member counts and skill ranges; direct screenshot comparison requires reviewed masks.
const references = {
  'community-discovery.png': '4c6f8488157afbce364b0cbb15fea257784d93ee963135f8044d654b94cde748',
  'community-create.png': 'c4ab0af1dc6d210e680dc27a1490b43d243081bb6dc2afd8edf1e9a83337aac1'
} as const;
test('Pencil references and baselines retain provenance', () => {
  for (const [name, sha] of Object.entries(references)) {
    const source = readFileSync(new URL(`./references/paf-30/${name}`, import.meta.url));
    const baseline = readFileSync(
      new URL(`./community-onboarding.spec.ts-snapshots/${name}`, import.meta.url)
    );
    expect(createHash('sha256').update(source).digest('hex')).toBe(sha);
    expect(baseline).toEqual(source);
  }
});

test('real visual comparator counts synthetic PNG changes and rejects invalid regions', async ({
  page
}) => {
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
});

test('masked title, metadata and action geometry probes reject displaced fixture nodes', async ({
  page
}) => {
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
});
