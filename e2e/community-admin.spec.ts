import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

type Copy = {
  language: string;
  theme: string;
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  onboarding: {
    name: string;
    preciseLevel: string;
    side: string;
    sideEitherShort: string;
    save: string;
  };
  communityAdmin: {
    backToDashboard: string;
    title: Record<string, string>;
    navigation: string;
    nav: Record<string, string>;
    accessDeniedTitle: string;
    action: Record<string, string>;
    status: Record<string, string>;
    confirmAction: string;
    search: string;
    searchLabel: string;
    loadMore: string;
    inviteUnavailable: string;
    levelReadOnly: string;
    settingsAdminNote: string;
    settings: {
      name: string;
      city: string;
      description: string;
      details: string;
      timezone: string;
      memberCreatedLeagues: string;
      visibility: string;
      joinPolicy: string;
    };
    requestMessage: { action: string };
    save: string;
    venue: {
      add: string;
      name: string;
      address: string;
      mapsUrl: string;
      archive: string;
      edit: string;
      openMap: string;
      historyNote: string;
    };
    audit: { openMember: string; recentChanges: string };
    accessDenied: string;
  };
};

const visualEvidenceRunId =
  process.env.GITHUB_RUN_ID && process.env.GITHUB_RUN_ATTEMPT
    ? `${process.env.GITHUB_RUN_ID}-attempt-${process.env.GITHUB_RUN_ATTEMPT}`
    : `local-${Date.now()}-${process.pid}`;

const en: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const pt: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/pt-BR/translation.json', import.meta.url), 'utf8')
);
const es: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/es/translation.json', import.meta.url), 'utf8')
);
const references = {
  'RgqPq.png': 'a85a6235eefc9c8387f6ff463401ad4dbec8d7d158949df69518d3bd0b9c16df',
  'wFqGR.png': '9283fea3d94cc022c7e19718bed6d30f5958b08886b4a89a9d582a7f7218299d',
  'jQDkx.png': 'b2152acc83eb205abea4483d990e61d872140ed0dfbf414e66ab1483aff9db8b',
  'N18Mu4.png': '512027e33e546fa478206ed57806b06132306a4c6516d51ef9e6fb5be88b3fe6',
  'A5Vio.png': '707a4741bf6fef96bafc3b07cc429b208ab03f600c91cc681b72cb4cf83cceb7',
  'E5CS5K.png': '9f785a3cd61ea8e21075897b8d438c5be8c0ead4ff948f7ef09f73a1343d7eec'
} as const;

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  serviceWorkers: 'block'
});

function localConfig() {
  const vars = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
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
  const url = process.env.VITE_SUPABASE_URL ?? vars.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? vars.get('VITE_SUPABASE_PUBLISHABLE_KEY') ?? '';
  if (!url || !key || !['localhost', '127.0.0.1'].includes(new URL(url).hostname))
    throw new Error('Community admin E2E requires loopback Supabase');
  return { url, key };
}
const config = localConfig();
const password = 'Password123!';
type Actor = { email: string; client: SupabaseClient; id: string };

async function createActor(label: string): Promise<Actor> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const email = `admin-ui-${slug}-${crypto.randomUUID()}@test.local`;
  const anon = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const created = await anon.auth.signUp({ email, password });
  if (created.error || !created.data.session || !created.data.user)
    throw new Error(
      `Could not create real-Supabase E2E user (${created.error?.message ?? 'session unavailable'})`
    );
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const sessionResult = await client.auth.setSession(created.data.session);
  if (sessionResult.error) throw sessionResult.error;
  const profile = await client.rpc('onboard_player', {
    p_display_name: label,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (profile.error) throw profile.error;
  return { email, client, id: created.data.user.id };
}

async function signIn(page: Page, actor: Actor) {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

async function assertNoConfidentialPayload(page: Page, paths: string[], sentinels: string[]) {
  const observed: string[] = [];
  const collect = async (response: import('@playwright/test').Response) => {
    try {
      observed.push(await response.text());
    } catch {
      // Browser may cancel a response while navigating; successful payloads remain collected.
    }
  };
  page.on('response', collect);
  for (const path of paths) {
    const documentResponse = await page.goto(path);
    if (documentResponse) observed.push(await documentResponse.text());
    await page.waitForLoadState('networkidle');
    await waitForHydratedPage(page);
    observed.push(await page.locator('body').innerText());
  }
  page.off('response', collect);
  const payload = observed.join('\n');
  for (const sentinel of sentinels) {
    expect(payload, `confidential sentinel leaked: ${sentinel}`).not.toContain(sentinel);
  }
}

async function visualDiff(
  page: Page,
  file: keyof typeof references,
  budget: number,
  masks: [number, number, number, number][] = []
) {
  const source = readFileSync(new URL(`./references/paf-31/${file}`, import.meta.url));
  const baseline = readFileSync(
    new URL(`./community-admin.spec.ts-snapshots/${file}`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(references[file]);
  expect(baseline).toEqual(source);
  await page.evaluate(() => document.fonts.ready);
  const actual = await page.locator('main').screenshot({ animations: 'disabled', caret: 'hide' });
  const difference = await page.evaluate(
    async ({ expected, received, masks: maskAreas }) => {
      const decode = async (base64: string) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D context unavailable');
        context.drawImage(image, 0, 0);
        return {
          width: image.width,
          height: image.height,
          pixels: context.getImageData(0, 0, image.width, image.height).data
        };
      };
      const [a, b] = await Promise.all([decode(expected), decode(received)]);
      if (a.width !== b.width || a.height !== b.height) return Number.POSITIVE_INFINITY;
      let changed = 0;
      for (let i = 0; i < a.pixels.length; i += 4) {
        const pixel = i / 4;
        const x = pixel % a.width;
        const y = Math.floor(pixel / a.width);
        if (
          maskAreas.some(
            ([left, top, width, height]) =>
              x >= left && x < left + width && y >= top && y < top + height
          )
        )
          continue;
        const delta = Math.max(
          Math.abs(a.pixels[i]! - b.pixels[i]!),
          Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!),
          Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!)
        );
        if (delta > 24) changed++;
      }
      return changed;
    },
    { expected: source.toString('base64'), received: actual.toString('base64'), masks }
  );
  console.info(`${file} visual diff: ${difference}/${budget} changed pixels`);
  const testInfo = test.info();
  const evidenceDirectory = join(
    process.cwd(),
    'artifacts/community-admin-visual',
    visualEvidenceRunId,
    testInfo.project.name,
    testInfo.testId,
    `repeat-${testInfo.repeatEachIndex}-retry-${testInfo.retry}`
  );
  mkdirSync(evidenceDirectory, { recursive: true });
  const evidenceBase = join(evidenceDirectory, file.replace('.png', ''));
  const { width, height } = await page.evaluate((png) => {
    const image = new Image();
    image.src = `data:image/png;base64,${png}`;
    return new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => resolve({ width: image.width, height: image.height });
      image.onerror = reject;
    });
  }, actual.toString('base64'));
  const residual = {
    screen: file.replace('.png', ''),
    png: file,
    changedPixels: Number.isFinite(difference) ? difference : 'dimension-mismatch',
    budget,
    width,
    height,
    referenceHash: createHash('sha256').update(source).digest('hex'),
    masksHash: createHash('sha256').update(JSON.stringify(masks)).digest('hex'),
    platform: process.platform,
    commit: process.env.GITHUB_SHA ?? 'local-unrecorded'
  };
  writeFileSync(`${evidenceBase}.json`, JSON.stringify(residual, null, 2));
  writeFileSync(`${evidenceBase}-actual.png`, actual);
  writeFileSync(`${evidenceBase}-reference.png`, source);
  await testInfo.attach(`visual-residual-${file}.json`, {
    body: Buffer.from(JSON.stringify(residual, null, 2)),
    contentType: 'application/json'
  });
  await testInfo.attach(`visual-actual-${file}`, { body: actual, contentType: 'image/png' });
  await testInfo.attach(`visual-reference-${file}`, { body: source, contentType: 'image/png' });
  expect(
    difference,
    `${file}: per-screen changed-pixel budget ${budget}; actual ${difference}`
  ).toBeLessThanOrEqual(budget);
}

// Pencil source geometry (padel-friend.pen frames, 390×844): page margin x18, content width 354,
// bottom navigation x18/y774 354×56. All box probes are exact ±1px for CSS boxes. Static-page
// probes are frame-relative: global locale/theme controls above <main> shift the document, so
// absolute y expectations are compared against the frame offset (main top) captured per screen.
async function mainOffset(page: Page) {
  const main = await page.locator('main').boundingBox();
  expect(main).not.toBeNull();
  return main!.y;
}

/** Requires the browser's real keyboard-focus indicator on the currently focused locale select. */
async function assertVisibleKeyboardFocus(page: Page) {
  const evidence = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const style = getComputedStyle(element);
    return {
      id: element.id,
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      background: style.backgroundColor,
      pageBackground: getComputedStyle(document.documentElement).backgroundColor
    };
  });
  expect(evidence, 'keyboard focus must rest on a focusable element').not.toBeNull();
  expect(evidence!.id, 'focused element must be the locale select').toBe('locale');
  assertFocusIndicator(
    evidence!,
    [evidence!.background, evidence!.pageBackground],
    'locale select'
  );
  console.info(`locale keyboard focus evidence: ${JSON.stringify(evidence)}`);
}

/** Reaches #locale with sequential-focus navigation only (blur, then Tab from document start). */
async function keyboardFocusLocale(page: Page) {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  for (let tabStops = 1; tabStops <= 25; tabStops++) {
    await page.keyboard.press('Tab');
    if ((await page.evaluate(() => document.activeElement?.id)) === 'locale') {
      await expect(page.locator('#locale')).toBeFocused();
      await assertVisibleKeyboardFocus(page);
      return;
    }
  }
  const focused = await page.evaluate(
    () =>
      `${document.activeElement?.tagName.toLowerCase() ?? 'none'}#${document.activeElement?.id ?? ''}`
  );
  throw new Error(`Sequential Tab navigation never reached #locale (landed on ${focused})`);
}

/**
 * Changes the locale with native select type-ahead only (real keyboard events; no selectOption).
 * macOS headless Chromium swallows ArrowUp/ArrowDown/Home/End on the closed select, so keys are
 * derived from the rendered option labels: a unique first letter jumps straight to the option,
 * while a shared first letter cycles to the next matching option on every press. A leading wait
 * lets any earlier type-ahead buffer expire so letters from previous switches cannot concatenate.
 * Asserts full agreement: selector value, html[lang] and the persisted locale cookie.
 */
async function switchLocaleWithKeyboard(page: Page, target: string) {
  const locale = page.locator('#locale');
  await keyboardFocusLocale(page);
  const options = await locale.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('#locale must be a select');
    return Array.from(element.options).map((option) => ({
      value: option.value,
      letter: option.text.trim().charAt(0).toLowerCase()
    }));
  });
  const targetIndex = options.findIndex((option) => option.value === target);
  expect(targetIndex, `locale option ${target} must exist`).toBeGreaterThanOrEqual(0);
  const currentIndex = await locale.evaluate((element) => {
    if (!(element instanceof HTMLSelectElement)) throw new Error('#locale must be a select');
    return element.selectedIndex;
  });
  expect(currentIndex, 'locale select must report a selected option').toBeGreaterThanOrEqual(0);
  const targetLetter = options[targetIndex]!.letter;
  const letterMatches = options.reduce<number[]>(
    (matches, option, index) => (option.letter === targetLetter ? [...matches, index] : matches),
    []
  );
  const keys: string[] = [];
  if (letterMatches.length === 1) {
    if (currentIndex !== targetIndex) keys.push(targetLetter);
  } else {
    let scan = currentIndex;
    while (scan !== targetIndex) {
      scan = (scan + 1) % options.length;
      if (letterMatches.includes(scan)) keys.push(targetLetter);
    }
  }
  await page.waitForTimeout(1_200);
  for (const key of keys) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
  }
  await expect(locale).toHaveValue(target);
  await expect(page.locator('html')).toHaveAttribute('lang', target);
  await expect
    .poll(() =>
      page
        .context()
        .cookies()
        .then((cookies) => cookies.find((cookie) => cookie.name === 'locale')?.value)
    )
    .toBe(target);
}

// ---------------------------------------------------------------------------
// 320px sequential keyboard traversal (PAF-93): every enabled admin control
// must be reachable by Tab alone, keep a visible :focus-visible indicator,
// expose an accessible name, keep a ≥44px hit box fully inside the viewport
// and stay unobscured by the fixed bottom navigation while focused.
// ---------------------------------------------------------------------------

type ControlKind = 'link' | 'button' | 'textbox' | 'combobox' | 'switch' | 'summary';
type ExpectedControl = { kind: ControlKind; name: string };
type Rect = { x: number; y: number; width: number; height: number };

type FocusEvidence = {
  identity: string;
  tag: string;
  id: string;
  kind: string;
  focusVisible: boolean;
  outlineStyle: string;
  outlineWidth: string;
  outlineColor: string;
  background: string;
  pageBackground: string;
  /** Non-transparent ancestor surface colors: the backdrop the offset focus ring is painted over. */
  backdropBackgrounds: string[];
  rect: Rect;
  navRect: Rect | null;
  insideNav: boolean;
  hitTag: string | null;
  hitSelfOrDescendant: boolean;
  viewport: { width: number; height: number };
};

type InventoryEntry = { identity: string; kind: string; name: string };

const controlKey = (control: { kind: string; name: string }) =>
  `${control.kind}\u0000${control.name}`;

function multisetOf(entries: { kind: string; name: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const key = controlKey(entry);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function formatControls(entries: { kind: string; name: string }[]): string {
  return entries.map((entry) => `${entry.kind} "${entry.name}"`).join(', ') || '(none)';
}

/** Compares keyboard-reachable controls with the expected set; inventory may neither shrink nor grow. */
function expectInventory(
  actual: InventoryEntry[],
  expected: { kind: string; name: string }[],
  context: string
) {
  const remaining = multisetOf(expected);
  const unexpected: { kind: string; name: string }[] = [];
  for (const entry of actual) {
    const key = controlKey(entry);
    const count = remaining.get(key) ?? 0;
    if (count > 1) remaining.set(key, count - 1);
    else if (count === 1) remaining.delete(key);
    else unexpected.push(entry);
  }
  expect(
    unexpected,
    `${context}: unexpected keyboard-reachable controls ${formatControls(unexpected)}; expected only ${formatControls(expected)}`
  ).toHaveLength(0);
  expect(
    [...remaining.values()].reduce((total, count) => total + count, 0),
    `${context}: expected controls missing from the keyboard-reachable inventory: ${formatControls(
      actual
    )} does not contain ${[...remaining.entries()]
      .map(([key, count]) => `${count}× ${key.replace('\u0000', ' ')}`)
      .join(', ')}`
  ).toBe(0);
}

function navControls(copy: Copy): ExpectedControl[] {
  return (['requests', 'members', 'settings', 'venues', 'audit'] as const).map((key) => ({
    kind: 'link' as const,
    name: copy.communityAdmin.nav[key]!
  }));
}

/** Explicit per-screen enabled-control inventory; typed entries prevent silent inventory shrink. */
function adminTraversalPlan(
  destination: (typeof narrowDestinations)[number],
  copy: Copy,
  fixture: { ownerName: string; applicantName: string }
): {
  content: ExpectedControl[];
  expandedOnly?: ExpectedControl[];
  revealedDescriptionId?: string;
  label: string;
} {
  const admin = copy.communityAdmin;
  const back: ExpectedControl = { kind: 'link', name: admin.backToDashboard };
  const content: ExpectedControl[] = (() => {
    switch (destination) {
      case 'requests':
        // One pending request card: approve, deny and the message-dialog trigger.
        return [
          back,
          { kind: 'button', name: admin.action.approve! },
          { kind: 'button', name: admin.action.deny! },
          { kind: 'button', name: admin.requestMessage.action }
        ];
      case 'members':
        // Public community: invite button is disabled (excluded); active roster has owner + applicant.
        return [
          back,
          { kind: 'textbox', name: admin.searchLabel },
          { kind: 'button', name: admin.status.active! },
          { kind: 'button', name: admin.status.pending! },
          { kind: 'button', name: admin.status.inactive! },
          { kind: 'link', name: fixture.applicantName },
          { kind: 'link', name: fixture.ownerName }
        ];
      case 'member':
        // Active member with role=member shows promote and remove only.
        return [
          back,
          { kind: 'button', name: admin.action.promote! },
          { kind: 'button', name: admin.action.remove! }
        ];
      case 'settings':
        // Collapsed disclosure: the summary is a required Tab stop even without button semantics.
        // Accessible-name computation separates the summary's block-level text spans.
        return [
          back,
          { kind: 'combobox', name: admin.settings.visibility },
          { kind: 'combobox', name: admin.settings.joinPolicy },
          { kind: 'combobox', name: admin.settings.timezone },
          { kind: 'switch', name: admin.settings.memberCreatedLeagues },
          { kind: 'button', name: admin.save },
          { kind: 'summary', name: `${admin.settings.details} ${admin.settingsAdminNote}` }
        ];
      case 'venues':
        // One seeded venue card with a maps link, edit and archive action.
        return [
          back,
          { kind: 'button', name: admin.venue.add },
          { kind: 'link', name: admin.venue.openMap },
          { kind: 'button', name: admin.venue.edit },
          { kind: 'button', name: admin.venue.archive }
        ];
      case 'audit':
        // Four seeded audit events; three shown with two member links and a load-more control.
        return [
          back,
          { kind: 'link', name: admin.audit.openMember },
          { kind: 'link', name: admin.audit.openMember },
          { kind: 'button', name: admin.loadMore }
        ];
      default:
        return [];
    }
  })();
  return {
    content,
    expandedOnly:
      destination === 'settings'
        ? [
            { kind: 'textbox', name: admin.settings.name },
            { kind: 'textbox', name: admin.settings.city },
            { kind: 'textbox', name: admin.settings.description },
            { kind: 'combobox', name: admin.settings.visibility },
            { kind: 'combobox', name: admin.settings.joinPolicy }
          ]
        : undefined,
    revealedDescriptionId: destination === 'settings' ? 'community-admin-description' : undefined,
    label: `${destination} @320px`
  };
}

/** Outline-only visible-focus oracle shared by the locale helper and the admin traversal. */
function assertFocusIndicator(
  evidence: Pick<FocusEvidence, 'focusVisible' | 'outlineStyle' | 'outlineWidth' | 'outlineColor'>,
  backgrounds: string[],
  label: string
) {
  expect(
    evidence.focusVisible,
    `${label} must match :focus-visible after keyboard navigation`
  ).toBe(true);
  const outlineWidth = Number.parseFloat(evidence.outlineWidth);
  expect(
    evidence.outlineStyle !== 'none' && Number.isFinite(outlineWidth) && outlineWidth > 0,
    `${label} keyboard focus must paint a non-zero-width outline`
  ).toBe(true);
  const color = evidence.outlineColor.toLowerCase();
  const rgb = /^rgba?\(([^)]+)\)$/.exec(color);
  expect(
    rgb,
    `${label} focus outline color must be an rgb()/rgba() color, got ${evidence.outlineColor}`
  ).not.toBeNull();
  const parts = rgb![1]!
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number.parseFloat);
  const alpha = parts.length === 4 ? parts[3]! : 1;
  expect(alpha, `${label} focus outline must be fully opaque (alpha 1)`).toBe(1);
  // With a positive outline-offset the ring is painted outside the control, over the enclosing
  // surfaces; its color must differ from every background it is actually drawn over.
  for (const background of backgrounds) {
    expect(
      color,
      `${label} focus outline color must differ from background ${background}`
    ).not.toBe(background);
  }
}

/** Reads everything needed to judge the currently focused element in one pass. */
async function readFocusEvidence(page: Page): Promise<FocusEvidence | null> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const controlKind = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'summary') return 'summary';
      const explicitRole = el.getAttribute('role');
      if (explicitRole === 'switch' || explicitRole === 'combobox') return explicitRole;
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'input' || tag === 'textarea') return 'textbox';
      return explicitRole ?? tag;
    };
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const nav = document.querySelector('nav[aria-label]');
    const navRect = nav ? nav.getBoundingClientRect() : null;
    const center = {
      x: Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1),
      y: Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1)
    };
    const hit = document.elementFromPoint(center.x, center.y);
    const pageBackground = getComputedStyle(document.documentElement).backgroundColor;
    const transparent =
      /^rgba?\(\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*,\s*0(?:\.0+)?\s*(?:,\s*0\s*)?\)$/;
    const backdropBackgrounds = [pageBackground.toLowerCase()];
    let ancestor: Element | null = element.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth++, ancestor = ancestor.parentElement) {
      const surface = getComputedStyle(ancestor).backgroundColor.toLowerCase();
      if (surface && !transparent.test(surface) && !backdropBackgrounds.includes(surface))
        backdropBackgrounds.push(surface);
    }
    return {
      identity: element.getAttribute('data-e2e-focus-identity') ?? '(uninventoried)',
      tag: element.tagName.toLowerCase(),
      id: element.id,
      kind: controlKind(element),
      focusVisible: element.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      outlineColor: style.outlineColor,
      background: style.backgroundColor,
      pageBackground,
      backdropBackgrounds,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      navRect: navRect
        ? { x: navRect.x, y: navRect.y, width: navRect.width, height: navRect.height }
        : null,
      insideNav: nav ? nav.contains(element) : false,
      hitTag: hit ? hit.tagName.toLowerCase() : null,
      hitSelfOrDescendant: hit !== null && (hit === element || element.contains(hit)),
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight }
    };
  });
}

/** Enumerates real Tab-reachable controls: enabled, visible, non-negative tabindex, rendered. */
async function collectFocusableInventory(
  page: Page,
  expected: ExpectedControl[],
  label: string
): Promise<InventoryEntry[]> {
  const inventory = await page.evaluate(() => {
    const controlKind = (el: Element): string => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'summary') return 'summary';
      const explicitRole = el.getAttribute('role');
      if (explicitRole === 'switch' || explicitRole === 'combobox') return explicitRole;
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'select') return 'combobox';
      if (tag === 'input' || tag === 'textarea') return 'textbox';
      return explicitRole ?? tag;
    };
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, summary, [tabindex]'
      )
    )
      .filter((element) => {
        if (element.matches(':disabled')) return false;
        if (element.getAttribute('aria-disabled') === 'true') return false;
        if (element.closest('[inert]')) return false;
        // Chromium hides closed-details children via content-visibility (they keep boxes), so
        // exclude them explicitly: they are unreachable until the disclosure is opened. The
        // summary itself stays — it is the disclosure's keyboard stop.
        if (element.tagName.toLowerCase() !== 'summary' && element.closest('details:not([open])'))
          return false;
        const tabindex = element.getAttribute('tabindex');
        if (tabindex !== null && Number.parseInt(tabindex, 10) < 0) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (element.getClientRects().length === 0) return false;
        return true;
      })
      .map((element) => {
        // Assign once per DOM node; opening details must not renumber existing controls.
        if (!element.hasAttribute('data-e2e-focus-identity'))
          element.setAttribute('data-e2e-focus-identity', crypto.randomUUID());
        return {
          identity: element.getAttribute('data-e2e-focus-identity')!,
          kind: controlKind(element)
        };
      });
  });
  expect(
    inventory,
    `${label}: inventory must match the explicit screen control count`
  ).toHaveLength(expected.length);
  const namedInventory: InventoryEntry[] = [];
  for (const [index, entry] of inventory.entries()) {
    const control = expected[index]!;
    expect(entry.kind, `${label}: inventory control ${index}`).toBe(control.kind);
    await expect(
      page.locator(`[data-e2e-focus-identity="${entry.identity}"]`),
      `${label}: inventory control ${index} (${entry.identity})`
    ).toHaveAccessibleName(control.name);
    namedInventory.push({ ...entry, name: control.name });
  }
  expectInventory(namedInventory, expected, label);
  return namedInventory;
}

/** Focus-time assertions for one admin control: indicator, name, size, containment, clearance. */
function assertFocusedAdminControl(evidence: FocusEvidence, label: string) {
  const where = `${label}: ${evidence.kind} [${evidence.identity}]`;
  assertFocusIndicator(evidence, evidence.backdropBackgrounds, where);
  expect(evidence.rect.width, `${where} must keep a ≥44px hit box (width)`).toBeGreaterThanOrEqual(
    44
  );
  expect(
    evidence.rect.height,
    `${where} must keep a ≥44px hit box (height)`
  ).toBeGreaterThanOrEqual(44);
  const contained =
    evidence.rect.x >= 0 &&
    evidence.rect.y >= 0 &&
    evidence.rect.x + evidence.rect.width <= evidence.viewport.width &&
    evidence.rect.y + evidence.rect.height <= evidence.viewport.height;
  expect(
    contained,
    `${where} must sit fully inside the viewport after Tab-driven scrolling (rect ${JSON.stringify(
      evidence.rect
    )} in viewport ${JSON.stringify(evidence.viewport)})`
  ).toBe(true);
  expect(
    evidence.hitSelfOrDescendant,
    `${where} center-point hit test must resolve to the focused element or a descendant, got ${
      evidence.hitTag ?? 'nothing'
    }`
  ).toBe(true);
  if (!evidence.insideNav) {
    expect(
      evidence.navRect,
      `${where} requires the fixed bottom navigation for clearance`
    ).not.toBeNull();
    const navRect = evidence.navRect!;
    const intersects =
      evidence.rect.y < navRect.y + navRect.height &&
      evidence.rect.y + evidence.rect.height > navRect.y;
    expect(
      intersects,
      `${where} must not be obscured by the fixed bottom navigation (rect ${JSON.stringify(
        evidence.rect
      )} vs nav ${JSON.stringify(navRect)})`
    ).toBe(false);
  }
}

/**
 * Traverses one admin screen at 320px using real keyboard focus only: blur once, then advance
 * exclusively with Tab (the settings disclosure opens with Enter at its summary stop). Every
 * visited control is compared against the explicit expected inventory, and every enabled admin
 * control must receive focus with a visible indicator, an accessible name, a ≥44px box fully in
 * the viewport and no overlap with the fixed bottom navigation (center-point hit test). Global
 * #locale/#theme Tab stops are validated for keyboard focus but never counted as admin controls.
 * Base UI roving popups (timezone select options) are arrow-key stops by design, not Tab stops,
 * so the traversal requires their trigger but not the popup items. Destructive actions are only
 * focused, never activated.
 */
async function traverseEnabledAdminControls(
  page: Page,
  copy: Copy,
  plan: {
    content: ExpectedControl[];
    expandedOnly?: ExpectedControl[];
    revealedDescriptionId?: string;
    label: string;
  }
) {
  const globalStops: ExpectedControl[] = [
    { kind: 'combobox', name: copy.language },
    { kind: 'combobox', name: copy.theme }
  ];
  const expandedOnly = plan.expandedOnly ?? [];
  const adminControls = [...plan.content, ...navControls(copy)];

  // The document inventory may neither shrink (a control lost) nor grow (an extra Tab stop).
  const collapsedInventory = await collectFocusableInventory(
    page,
    [...globalStops, ...adminControls],
    `${plan.label}: document inventory before traversal`
  );
  let inventory = collapsedInventory;

  // Programmatic blur leaves Chromium's sequential-focus resume point unreliable on this page
  // (Tab can resume mid-document, e.g. at the bottom navigation). Blur once, then walk forward
  // with Tab only until the first global stop (#locale) is focused — the same bounded walk the
  // locale helper already proves always terminates (through the ring end and back to the top).
  // From that anchor the ring order is canonical, so the whole traversal becomes an order proof.
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  const anchorTrace: string[] = [];
  let anchored = false;
  for (let step = 1; step <= 25; step++) {
    await page.keyboard.press('Tab');
    const probe = await readFocusEvidence(page);
    if (!probe) continue;
    if (probe.id === 'locale') {
      anchored = true;
      break;
    }
    anchorTrace.push(`${probe.kind} [${probe.identity}]`);
  }
  expect(
    anchored,
    `${plan.label}: sequential Tab never reached the #locale anchor (walked ${anchorTrace.join(' → ')})`
  ).toBe(true);
  await expect(page.locator('#locale')).toBeFocused();

  // From the anchor, the ring must visit every expected control exactly once, in DOM order:
  // #locale (already focused), #theme, then the admin content controls and the bottom nav.
  // Hitting #locale again or leaving to <body> before completion means skipped controls.
  let pending = [...inventory];
  let disclosureOpened = false;
  const trace: string[] = [];
  const visited = new Set<string>();
  const visitedControls: InventoryEntry[] = [];
  const maxSteps = pending.length + expandedOnly.length + 4;

  for (let step = 0; step <= maxSteps && pending.length > 0; step++) {
    // The anchor itself is the first ring entry; do not press Tab again at step zero.
    if (step > 0) await page.keyboard.press('Tab');
    const evidence = await readFocusEvidence(page);
    expect(
      evidence,
      `${plan.label}: Tab ${step} must move focus to a focusable element`
    ).not.toBeNull();
    const focused = evidence!;
    trace.push(`${focused.kind}#${focused.id} [${focused.identity}]`);
    const context = `${plan.label}: Tab ${step}; visited ${trace.join(' → ')}`;
    expect(visited.has(focused.identity), `${context}: repeat visit to the same DOM identity`).toBe(
      false
    );
    const expected = pending.find((control) => control.identity === focused.identity);
    expect(
      expected,
      `${context}: unexpected identity; still missing ${JSON.stringify(pending)}`
    ).toBeDefined();
    // Name assertion targets the actual focused node, not a role/name lookup that could select
    // another identically named control. Playwright computes the real accessibility name.
    const focusedLocator = page.locator(`[data-e2e-focus-identity="${focused.identity}"]`);
    await expect(focusedLocator, context).toBeFocused();
    await expect(focusedLocator, context).toHaveAccessibleName(expected!.name);
    expect(focused.kind, context).toBe(expected!.kind);
    visited.add(focused.identity);
    visitedControls.push(expected!);
    pending = pending.filter((control) => control.identity !== focused.identity);

    if (focused.id === 'locale' || focused.id === 'theme') {
      assertFocusIndicator(focused, [focused.background, focused.pageBackground], context);
      continue;
    }
    assertFocusedAdminControl(focused, context);

    if (plan.revealedDescriptionId && focused.kind === 'summary' && !disclosureOpened) {
      // Open the collapsed disclosure with the keyboard; focus stays on the summary so the next
      // Tab walks the revealed controls, which become required ring stops from this point on.
      await page.keyboard.press('Enter');
      await expect(page.locator('main details[open]')).toHaveCount(1);
      await expect(page.locator(`#${plan.revealedDescriptionId}`)).toBeVisible();
      inventory = await collectFocusableInventory(
        page,
        [...globalStops, ...plan.content, ...expandedOnly, ...navControls(copy)],
        `${plan.label}: document inventory after opening the disclosure`
      );
      pending = inventory.filter((control) => !visited.has(control.identity));
      disclosureOpened = true;
    }
  }

  expect(
    pending,
    `${plan.label}: Tab traversal finished without reaching ${formatControls(
      pending
    )}; visited ${trace.join(' → ')}`
  ).toHaveLength(0);
  // Prove both states by DOM identity; duplicate names cannot substitute for an unvisited node.
  for (const [state, expectedInventory] of [
    ['collapsed', collapsedInventory],
    ['expanded', inventory]
  ] as const) {
    const identities = new Set(expectedInventory.map((control) => control.identity));
    expect(
      new Set([...visited].filter((identity) => identities.has(identity))),
      `${plan.label}: ${state} inventory identities never visited; trace ${trace.join(' → ')}`
    ).toEqual(identities);
  }
  expect(
    visited,
    `${plan.label}: visited identities must equal final inventory; trace ${trace.join(' → ')}`
  ).toEqual(new Set(inventory.map((control) => control.identity)));
  expectInventory(visitedControls, inventory, `${plan.label}: visited kind/name multiset`);
}

async function assertLocaleControlSizing(page: Page, copy: Copy, viewport: number) {
  const locale = page.locator('#locale');
  await expect(locale).toHaveAccessibleName(copy.language);
  // Measure only after the bundled webfonts are loaded: fallback font metrics differ between
  // macOS and Linux and skewed the 320px box measurements (PAF-87 F4).
  await page.evaluate(() => document.fonts.ready);
  const box = await locale.boundingBox();
  const themeBox = await page.locator('#theme').boundingBox();
  expect(box).not.toBeNull();
  expect(themeBox).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  // Anti-overlap oracle in both axes: side-by-side and stacked (wrapped) layouts are both
  // acceptable; only a true rectangle intersection fails.
  const separatedHorizontally =
    box!.x + box!.width <= themeBox!.x || themeBox!.x + themeBox!.width <= box!.x;
  const separatedVertically =
    box!.y + box!.height <= themeBox!.y || themeBox!.y + themeBox!.height <= box!.y;
  expect(
    separatedHorizontally || separatedVertically,
    `locale and theme controls must not overlap (locale ${JSON.stringify(box)}, theme ${JSON.stringify(themeBox)})`
  ).toBe(true);
  await keyboardFocusLocale(page);
  const dimensions = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0,
    viewport: document.documentElement.clientWidth
  }));
  expect(dimensions.document).toBeLessThanOrEqual(viewport);
  expect(dimensions.main).toBeLessThanOrEqual(viewport);
  const styledMainTop = await mainOffset(page);
  const styleClass = await locale.getAttribute('class');
  await locale.evaluate((element) => element.removeAttribute('class'));
  const unstyledMainTop = await mainOffset(page);
  if (styleClass !== null)
    await locale.evaluate((element, value) => element.setAttribute('class', value), styleClass);
  console.info(
    `locale box ${viewport}px ${copy.language}: ${box!.width}x${box!.height}; main top before/after ${unstyledMainTop}/${styledMainTop}`
  );
}

async function bottomNavGeometry(page: Page) {
  const nav = page.getByRole('navigation', { name: en.communityAdmin.navigation });
  await expect(nav).toBeVisible();
  const acquireBox = async (locator: Locator) => {
    const deadline = Date.now() + 5_000;
    let candidate: Awaited<ReturnType<Locator['boundingBox']>> = null;

    while (Date.now() < deadline) {
      candidate = await locator.boundingBox();
      if (candidate && candidate.width > 0 && candidate.height > 0) {
        return candidate;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Timed out waiting for a positive-size bounding box for ${locator.toString()}`);
  };
  const box = await acquireBox(nav);
  expect(Math.abs(box.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - 774)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - 354)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 56)).toBeLessThanOrEqual(1);
  const linksLocator = nav.getByRole('link');
  await expect(linksLocator).toHaveCount(5);
  const links = await linksLocator.all();
  for (const link of links) {
    const linkBox = await acquireBox(link);
    // Pencil tabs are 44px; rendered links keep the ≥44px touch target (48px at 354 width).
    expect(linkBox.height).toBeGreaterThanOrEqual(44);
  }
  expect(await nav.locator('[aria-current="page"]').count()).toBe(1);
}

async function geometry(page: Page, expectedPending?: string) {
  const section = page.locator('main > section');
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
  await bottomNavGeometry(page);
  if (expectedPending) {
    const card = page.getByRole('heading', { name: expectedPending }).locator('xpath=..');
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(Math.abs(cardBox!.x - 18)).toBeLessThanOrEqual(1);
    // RgqPq pending card at y109 from the 390×844 frame (section starts at y18).
    expect(Math.abs(cardBox!.y - (box!.y + 91))).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.height - 200)).toBeLessThanOrEqual(1);
    const approve = await card
      .getByRole('button', { name: en.communityAdmin.action.approve })
      .boundingBox();
    const deny = await card
      .getByRole('button', { name: en.communityAdmin.action.deny })
      .boundingBox();
    expect(approve).not.toBeNull();
    expect(deny).not.toBeNull();
    expect(Math.abs(approve!.y - (cardBox!.y + 92))).toBeLessThanOrEqual(1);
    expect(Math.abs(deny!.y - (cardBox!.y + 142))).toBeLessThanOrEqual(1);
    expect(Math.abs(approve!.height - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(deny!.height - 44)).toBeLessThanOrEqual(1);
  }
}

async function memberCardGeometry(page: Page) {
  const offset = await mainOffset(page);
  const cards = await page.getByTestId('community-member-card').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // wFqGR member cards: y234/y315/y396, 354×71, 10px gaps.
  const expectedY = [234, 315, 396];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 71)).toBeLessThanOrEqual(1);
  }
  const invite = await page
    .getByRole('button', { name: en.communityAdmin.inviteUnavailable })
    .boundingBox();
  expect(invite).not.toBeNull();
  expect(Math.abs(invite!.y - (offset + 72))).toBeLessThanOrEqual(1);
  expect(Math.abs(invite!.height - 44)).toBeLessThanOrEqual(1);
  const search = await page.locator('#admin-member-search').boundingBox();
  expect(search).not.toBeNull();
  expect(Math.abs(search!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.width - 354)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.height - 44)).toBeLessThanOrEqual(1);
}

async function assertLinkHitArea(link: Locator) {
  const area = await link.evaluate((element) => {
    const pseudo = getComputedStyle(element, '::before');
    return {
      width: Number.parseFloat(pseudo.width),
      height: Number.parseFloat(pseudo.height),
      position: getComputedStyle(element).position
    };
  });
  expect(area.position).toBe('relative');
  expect(area.width).toBeGreaterThanOrEqual(44);
  expect(area.height).toBe(44);
}

async function memberControlsGeometry(page: Page) {
  const profile = await page.getByTestId('community-member-profile').boundingBox();
  expect(profile).not.toBeNull();
  expect(Math.abs(profile!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(profile!.width - 354)).toBeLessThanOrEqual(1);
  // jQDkx member profile card is 354×66.
  expect(Math.abs(profile!.height - 66)).toBeLessThanOrEqual(1);
  const rolePanel = await page.getByTestId('community-member-role-panel').boundingBox();
  expect(rolePanel).not.toBeNull();
  expect(Math.abs(rolePanel!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(rolePanel!.width - 354)).toBeLessThanOrEqual(1);
  // jQDkx role control is 354×72.
  expect(Math.abs(rolePanel!.height - 72)).toBeLessThanOrEqual(1);
  const actions = await page
    .getByRole('button', { name: en.communityAdmin.action.promote })
    .boundingBox();
  expect(actions).not.toBeNull();
  // Pencil draws a 40px control; shipped controls keep the ≥44px touch target.
  expect(actions!.height).toBeGreaterThanOrEqual(44);
}

async function backLinkGeometry(page: Page) {
  const link = page.getByRole('link', { name: en.communityAdmin.backToDashboard });
  const linkBox = await link.boundingBox();
  expect(linkBox).not.toBeNull();
  expect(linkBox!.width).toBeGreaterThanOrEqual(44);
  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
  const icon = link.locator('[aria-hidden="true"]');
  const iconBox = await icon.boundingBox();
  expect(iconBox).not.toBeNull();
  expect(
    Math.abs(iconBox!.x + iconBox!.width / 2 - (linkBox!.x + linkBox!.width / 2))
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(iconBox!.y + iconBox!.height / 2 - (linkBox!.y + linkBox!.height / 2))
  ).toBeLessThanOrEqual(1);
}

async function settingsGeometry(page: Page) {
  // N18Mu4 settings rows: visibility y72, public control y126, join control y180, each 354×44.
  const offset = await mainOffset(page);
  const expectedRows = [
    ['settings-visibility-label', 72],
    ['settings-visibility-control', 126],
    ['settings-join-policy-control', 180]
  ] as const;
  for (const [selector, y] of expectedRows) {
    const box = await page.getByTestId(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + y))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 44)).toBeLessThanOrEqual(1);
  }
  const save = await page.getByRole('button', { name: en.communityAdmin.save }).boundingBox();
  expect(save).not.toBeNull();
  expect(Math.abs(save!.height - 44)).toBeLessThanOrEqual(1);
}

async function venueGeometry(page: Page) {
  const offset = await mainOffset(page);
  const cards = await page.getByTestId('community-venue-card').all();
  expect(cards).toHaveLength(2);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // A5Vio venue cards are 354×114 at source-relative y126 and y250, with a 10px gap.
  const expectedY = [126, 250];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 114)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(boxes[1]!.y - boxes[0]!.y - 124)).toBeLessThanOrEqual(1);
  const note = await page.getByText(en.communityAdmin.venue.historyNote).boundingBox();
  expect(note).not.toBeNull();
  expect(Math.abs(note!.x - 18)).toBeLessThanOrEqual(1);
  expect(Math.abs(note!.width - 354)).toBeLessThanOrEqual(1);
  // A5Vio flow annotation starts 248px below the first venue card.
  expect(Math.abs(note!.height - 35)).toBeLessThanOrEqual(1);
  expect(Math.abs(note!.y - (boxes[0]!.y + 248))).toBeLessThanOrEqual(1);
  const add = await page.getByRole('button', { name: en.communityAdmin.venue.add }).boundingBox();
  expect(add).not.toBeNull();
  expect(Math.abs(add!.height - 44)).toBeLessThanOrEqual(1);
  const archive = await cards[0]!
    .getByRole('button', { name: en.communityAdmin.venue.archive })
    .boundingBox();
  expect(archive).not.toBeNull();
  expect(Math.abs(archive!.height - 44)).toBeLessThanOrEqual(1);
}

async function auditGeometry(page: Page) {
  const cards = await page.getByTestId('community-audit-event').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // E5CS5K audit events: y111/y183/y255, 354×62, 10px gaps.
  const offset = await mainOffset(page);
  const expectedY = [111, 183, 255];
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - 18)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.y - (offset + expectedY[index]!))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - 354)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 62)).toBeLessThanOrEqual(1);
  }
}

test('real admin requests, membership, settings, venues and audit stay protected and responsive', async ({
  browser,
  page
}) => {
  test.setTimeout(120_000);
  const owner = await createActor('Owner Admin');
  const request = await createActor('Pending Player');
  const backup = await createActor('Backup Admin');
  const communityName = `Padel ${crypto.randomUUID().slice(0, 5)}`;
  const created = await owner.client.rpc('create_community', {
    p_name: communityName,
    p_visibility: 'public',
    p_join_policy: 'admin_approval'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community fixture creation failed');
  const communityId = created.data;
  const joined = await request.client.rpc('join_public_community', { p_community_id: communityId });
  if (joined.error) throw joined.error;
  expect(joined.data).toMatchObject([{ status: 'pending' }]);
  const backupMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: backup.id, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (backupMembership.error) throw backupMembership.error;
  // Second real venue (admin RLS insert) so the venues screen shows the supported two-card
  // structure of the A5Vio frame instead of masking it away; "South Court" sorts after the
  // UI-created "North Court" so card order stays deterministic.
  const seededVenue = await owner.client
    .from('community_venues')
    .insert({
      community_id: communityId,
      name: 'South Court',
      address: 'Madrid',
      maps_url: 'https://maps.example.test/south-court'
    })
    .select('id')
    .single();
  if (seededVenue.error) throw seededVenue.error;
  const pending = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_status: 'pending',
    p_offset: 0,
    p_limit: 50
  });
  if (pending.error || pending.data?.length !== 1)
    throw pending.error ?? new Error('Pending fixture rows missing');

  const guestContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1
  });
  const guest = await guestContext.newPage();
  await guest.goto(`/community/${communityId}/admin/audit`);
  await expect(guest).toHaveURL(/\/login\?next=/);
  await guestContext.close();

  await signIn(page, owner);
  await expect(page.getByRole('link', { name: communityName })).toBeVisible();
  const route = `/community/${communityId}/admin`;
  await page.goto(`${route}/requests`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.communityAdmin.title.requests })).toBeVisible();
  await geometry(page, 'Pending Player');
  // Mask only unsupported resolved/notification content and fixture-dependent applicant values; keep card geometry exact.
  // Measured macOS 14,864; Linux 15,723; 2,777px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'RgqPq.png', 18_500, [
    [0, 309, 390, 147],
    [28, 124, 334, 20],
    [28, 151, 334, 36]
  ]);
  for (const name of ['Pending Player']) {
    const card = page.getByRole('heading', { name }).locator('xpath=..');
    await card.getByRole('button', { name: en.communityAdmin.action.approve }).click();
    await expect(page.getByText('Request approved.')).toBeVisible();
  }
  const rows = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_offset: 0,
    p_limit: 50
  });
  if (rows.error || !rows.data) throw rows.error ?? new Error('Community roster unavailable');
  const roster: Database['public']['Functions']['search_community_members']['Returns'] = rows.data;
  const backupRow = roster.find((row) => row.user_id === backup.id);
  const requestRow = roster.find((row) => row.user_id === request.id);
  const ownerRow = roster.find((row) => row.user_id === owner.id);
  if (!backupRow || !requestRow || !ownerRow) throw new Error('Expected fixture member not found');

  await page.goto(`${route}/members`);
  await waitForHydratedPage(page);
  await page.getByRole('heading', { name: en.communityAdmin.title.members }).waitFor();
  await geometry(page);
  await backLinkGeometry(page);
  await memberCardGeometry(page);
  await assertLinkHitArea(page.getByRole('link', { name: 'Backup Admin' }));
  // Mask fixture identity/metrics, role badges, avatars and the unsupported invitation copy only;
  // card layout, search and geometry stay exact and unmasked.
  // Measured macOS 14,198; Linux 15,435; 65px headroom. Linux CI evidence and flakiness risk: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'wFqGR.png', 15_500, [
    [18, 46, 354, 22],
    [25, 82, 340, 26],
    [28, 243, 34, 44],
    [294, 239, 79, 31],
    [25, 239, 340, 25],
    [25, 263, 340, 18],
    [25, 280, 340, 18],
    [28, 324, 34, 44],
    [294, 320, 79, 31],
    [25, 320, 340, 25],
    [25, 344, 340, 18],
    [25, 361, 340, 18],
    [28, 405, 34, 44],
    [294, 401, 79, 31],
    [25, 401, 340, 25],
    [25, 425, 340, 18],
    [25, 442, 340, 18]
  ]);
  await page.getByRole('link', { name: 'Backup Admin' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/members/${backupRow.membership_id}$`));
  await geometry(page);
  await memberControlsGeometry(page);
  // Mask only dynamic member identity/metrics and community name; card/action geometry stays probed.
  // Measured macOS 17,397; Linux 19,038; 2,962px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'jQDkx.png', 22_000, [
    [18, 46, 354, 22],
    [28, 124, 334, 20],
    [28, 145, 334, 20]
  ]);
  await page.getByRole('button', { name: en.communityAdmin.action.promote }).click();
  await expect(page.getByText('Admin role granted.')).toBeVisible();

  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, request);
  await expect(memberPage.getByRole('link', { name: communityName })).toHaveCount(0);
  await memberPage.goto(`${route}/members`);
  await expect(
    memberPage.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  await memberContext.close();

  await page.goto(`${route}/settings`);
  await waitForHydratedPage(page);
  await geometry(page);
  await settingsGeometry(page);
  // Measured macOS 17,750; Linux 18,920; 3,580px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'N18Mu4.png', 22_500, [
    [18, 46, 354, 22],
    [18, 230, 354, 120]
  ]);
  await page.getByText(en.communityAdmin.settings.details).click();
  await page.getByLabel(en.communityAdmin.settings.city).fill('Madrid');
  await page.getByRole('button', { name: en.communityAdmin.save }).click();
  await expect(page.getByText('Community settings saved.')).toBeVisible();
  for (const [locale, copy] of [
    ['es', es],
    ['pt-BR', pt]
  ] as const) {
    await switchLocaleWithKeyboard(page, locale);
    await expect(
      page.getByRole('heading', { name: copy.communityAdmin.title.settings })
    ).toBeVisible();
    await assertLocaleControlSizing(page, copy, 390);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const [locale, copy] of [
    ['en', en],
    ['pt-BR', pt],
    ['es', es]
  ] as const) {
    await switchLocaleWithKeyboard(page, locale);
    await expect(
      page.getByRole('heading', { name: copy.communityAdmin.title.settings })
    ).toBeVisible();
    await assertLocaleControlSizing(page, copy, 1280);
  }
  await page.locator('#locale').selectOption('es');
  await expect(page.context().cookies()).resolves.toContainEqual(
    expect.objectContaining({ name: 'locale', value: 'es', path: '/' })
  );
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.locator('#locale')).toHaveValue('es');
  await expect(page.locator('#locale')).toHaveAccessibleName(es.language);
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { name: es.communityAdmin.title.settings })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#locale').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await assertLocaleControlSizing(page, en, 390);
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.waitForLoadState('networkidle');
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  await page.goto(`${route}/venues`);
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await geometry(page);
  await page.getByRole('button', { name: en.communityAdmin.venue.add }).click();
  await page.getByLabel(en.communityAdmin.venue.name).fill('North Court');
  await page.getByLabel(en.communityAdmin.venue.address).fill('Madrid');
  await page.getByLabel(en.communityAdmin.venue.mapsUrl).fill('https://maps.example.test/court');
  await page.getByRole('button', { name: en.communityAdmin.save }).click();
  await expect(page.getByRole('heading', { name: 'North Court' })).toBeVisible();
  await page.reload();
  await waitForHydratedPage(page);
  await venueGeometry(page);
  await assertLinkHitArea(
    page.getByRole('link', { name: en.communityAdmin.venue.openMap }).first()
  );
  // Mask fixture venue names and dynamic/unsupported detail copy only; card edges, action labels,
  // and the supported Open map links remain part of the pixel comparison.
  // Measured macOS 16,351; Linux 17,771; 3,229px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'A5Vio.png', 21_000, [
    [32, 140, 180, 15],
    [32, 161, 240, 15],
    [32, 264, 180, 15],
    [32, 285, 240, 15]
  ]);
  await page
    .getByTestId('community-venue-card')
    .first()
    .getByRole('button', { name: en.communityAdmin.venue.archive })
    .click();
  await expect(page.getByText('Venue archived.')).toBeVisible();

  await page.goto(`${route}/audit`);
  await waitForHydratedPage(page);
  await auditGeometry(page);
  await expect(page.getByText(/Actor identity unavailable ·/).first()).toBeVisible();
  await expect(page.getByText(/League result corrected/)).toHaveCount(0);
  // Actor identity is intentionally a translated generic fallback; timestamps are fixture-dependent.
  // The fourth Pencil event ("League result corrected") and the 3-row paging control are the
  // approved unsupported/adapted region, so the band below the third event stays masked.
  // Measured macOS 16,174; Linux 17,044; 2,956px headroom. Linux CI evidence: docs/visual/community-admin-residuals.md.
  // Original cap-selection target: ≥2,500px headroom, rounded up to the next 500.
  await visualDiff(page, 'E5CS5K.png', 20_000, [
    [18, 140, 354, 24],
    [18, 210, 354, 24],
    [18, 280, 354, 24],
    [18, 317, 354, 72]
  ]);
  await page.getByRole('button', { name: en.communityAdmin.loadMore }).click();
  await assertLinkHitArea(
    page.getByRole('link', { name: en.communityAdmin.audit.openMember }).first()
  );

  await page.goto(`${route}/members/${crypto.randomUUID()}`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.communityAdmin.title.member })).toBeVisible();
  await expect(page.getByRole('main')).toHaveCount(1);

  await page.goto(`${route}/members/${ownerRow.membership_id}`);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityAdmin.action.demote }).click();
  await page.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
  await expect(
    page.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
  ).toBeVisible();
  expect(requestRow.status).toBe('active');
});

test('unauthorized community admin routes never disclose confidential fixture payloads', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const suffix = crypto.randomUUID();
  const ownerName = `Private Owner ${suffix.slice(0, 8)}`;
  const activeName = `Private Active ${suffix.slice(0, 8)}`;
  const pendingName = `Private Pending ${suffix.slice(0, 8)}`;
  const owner = await createActor(ownerName);
  const active = await createActor(activeName);
  const pending = await createActor(pendingName);
  const outsider = await createActor(`Private Outsider ${suffix.slice(0, 8)}`);
  const confidential = {
    description: `PRIVATE_DESCRIPTION_${suffix}`,
    setting: `PRIVATE_SETTING_${suffix}`,
    venue: `PRIVATE_VENUE_${suffix}`,
    address: `PRIVATE_ADDRESS_${suffix}`,
    audit: `PRIVATE_AUDIT_${suffix}`
  };
  const community = await owner.client.rpc('create_community', {
    p_name: `Private ${suffix.slice(0, 8)}`,
    p_visibility: 'private',
    p_description: confidential.description,
    p_join_policy: 'admin_approval'
  });
  if (community.error || typeof community.data !== 'string')
    throw community.error ?? new Error('Private community fixture creation failed');
  const communityId = community.data;
  const ownerCommunity = await owner.client
    .from('communities')
    .update({ settings: { confidential: confidential.setting } })
    .eq('id', communityId);
  if (ownerCommunity.error) throw ownerCommunity.error;
  const activeMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: active.id, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (activeMembership.error) throw activeMembership.error;
  const pendingMembership = await owner.client
    .from('community_members')
    .insert({ community_id: communityId, user_id: pending.id, role: 'member', status: 'pending' })
    .select('id')
    .single();
  if (pendingMembership.error) throw pendingMembership.error;
  const venue = await owner.client
    .from('community_venues')
    .insert({
      community_id: communityId,
      name: confidential.venue,
      address: confidential.address,
      maps_url: 'https://maps.example.test/private'
    })
    .select('id')
    .single();
  if (venue.error) throw venue.error;
  const auditRows = await owner.client
    .from('community_audit_log')
    .select('id, entity_id')
    .eq('community_id', communityId);
  if (auditRows.error || !auditRows.data?.length)
    throw auditRows.error ?? new Error('Expected private community audit fixture');
  const ownerRoster = await owner.client.rpc('search_community_members', {
    p_community_id: communityId,
    p_query: '',
    p_offset: 0,
    p_limit: 50
  });
  if (
    ownerRoster.error ||
    !ownerRoster.data?.some((row: { user_id: string }) => row.user_id === active.id)
  )
    throw ownerRoster.error ?? new Error('Owner could not observe confidential roster fixture');

  const base = `/community/${communityId}/admin`;
  const destinations = [
    `${base}/requests`,
    `${base}/members`,
    `${base}/members/${activeMembership.data.id}`,
    `${base}/settings`,
    `${base}/venues`,
    `${base}/audit`
  ];
  const sentinels = [
    activeName,
    pendingName,
    confidential.description,
    confidential.setting,
    confidential.venue,
    confidential.address,
    pendingMembership.data.id,
    venue.data.id,
    ...auditRows.data
      .flatMap((row: { id: string; entity_id: string }) => [row.id, row.entity_id])
      .filter((id: string) => id !== communityId && id !== activeMembership.data.id)
  ];

  // Owner must be able to observe fixture values before the same payloads are tested against denials.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, owner);
  await ownerPage.goto(`${base}/venues`);
  await waitForHydratedPage(ownerPage);
  await expect(ownerPage.getByRole('heading', { name: confidential.venue })).toBeVisible();
  await ownerPage.goto(`${base}/members`);
  await waitForHydratedPage(ownerPage);
  await expect(ownerPage.getByText(activeName)).toBeVisible();
  await ownerPage.goto(`${base}/settings`);
  await waitForHydratedPage(ownerPage);
  await ownerPage.getByText(en.communityAdmin.settings.details).click();
  await expect(ownerPage.locator('#community-admin-description')).toHaveValue(
    confidential.description
  );
  await ownerContext.close();

  const guestContext = await browser.newContext();
  const guestPage = await guestContext.newPage();
  await assertNoConfidentialPayload(guestPage, destinations, sentinels);
  await guestContext.close();
  for (const actor of [active, pending, outsider]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, actor);
    await assertNoConfidentialPayload(page, destinations, sentinels);
    await context.close();
  }
});

const narrowDestinations = [
  'requests',
  'members',
  'member',
  'settings',
  'venues',
  'audit'
] as const;
const narrowLocales = [
  ['en', en],
  ['pt-BR', pt],
  ['es', es]
] as const;

test.describe('community admin 320px locale matrix', () => {
  test.use({ viewport: { width: 320, height: 844 } });

  for (const destination of narrowDestinations) {
    for (const [localeIndex, [locale]] of narrowLocales.entries()) {
      test(`${destination} heading and controls fit at 320px (${locale})`, async ({ page }) => {
        test.setTimeout(120_000);
        const owner = await createActor(`Narrow ${destination} ${locale}`);
        const applicant = await createActor(`Narrow applicant ${destination} ${locale}`);
        const requester = await createActor(`Narrow requester ${destination} ${locale}`);
        const created = await owner.client.rpc('create_community', {
          p_name: `Narrow ${crypto.randomUUID().slice(0, 6)}`,
          p_visibility: 'public',
          p_join_policy: 'admin_approval'
        });
        if (created.error || typeof created.data !== 'string')
          throw created.error ?? new Error('Narrow-screen community fixture creation failed');
        const communityId = created.data;
        const base = `/community/${communityId}/admin`;
        const active = await owner.client
          .from('community_members')
          .insert({
            community_id: communityId,
            user_id: applicant.id,
            role: 'member',
            status: 'active'
          })
          .select('id')
          .single();
        if (active.error) throw active.error;
        const pending = await owner.client
          .from('community_members')
          .insert({
            community_id: communityId,
            user_id: requester.id,
            role: 'member',
            status: 'pending'
          })
          .select('id')
          .single();
        if (pending.error) throw pending.error;
        const venue = await owner.client.from('community_venues').insert({
          community_id: communityId,
          name: 'Narrow court',
          address: 'Madrid',
          maps_url: 'https://maps.example.test/narrow'
        });
        if (venue.error) throw venue.error;

        await signIn(page, owner);
        await page.locator('#locale').selectOption(locale);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const path =
          destination === 'member' ? `${base}/members/${active.data.id}` : `${base}/${destination}`;
        await page.goto(path);
        await waitForHydratedPage(page);
        const localeCopy = locale === 'pt-BR' ? pt : locale === 'es' ? es : en;
        const localeControl = page.locator('#locale');
        await expect(localeControl).toBeVisible();
        await assertLocaleControlSizing(page, localeCopy, 320);
        await expect
          .poll(() =>
            page
              .context()
              .cookies()
              .then((cookies) => cookies.find((cookie) => cookie.name === 'locale')?.value)
          )
          .toBe(locale);
        const titleKey = destination === 'member' ? 'member' : destination;
        const screenHeading = page.getByRole('heading', {
          name: localeCopy.communityAdmin.title[titleKey],
          exact: true
        });
        await expect(screenHeading).toHaveCount(1);
        await expect(screenHeading).toBeVisible();
        if (destination === 'requests')
          await expect(
            page.getByText(`Narrow requester ${destination} ${locale}`, { exact: true })
          ).toBeVisible();
        if (destination === 'venues')
          await expect(page.getByRole('heading', { name: 'Narrow court' })).toBeVisible();
        if (destination === 'audit')
          await expect(page.getByTestId('community-audit-event').first()).toBeVisible();

        const dimensions = await page.evaluate(() => ({
          document: document.documentElement.scrollWidth,
          main: document.querySelector('main')?.scrollWidth ?? 0,
          viewport: document.documentElement.clientWidth
        }));
        expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
        expect(dimensions.main).toBeLessThanOrEqual(dimensions.viewport);
        await expect
          .poll(() =>
            page
              .context()
              .cookies()
              .then((cookies) => cookies.find((cookie) => cookie.name === 'locale')?.value)
          )
          .toBe(locale);
        const adminNavigation = page.getByRole('navigation', {
          name: localeCopy.communityAdmin.navigation
        });
        const contentControls = page.locator(
          'main button:visible:not(nav button), main a:visible:not(nav a), main input:visible:not(nav input), main select:visible:not(nav select), main textarea:visible:not(nav textarea)'
        );
        const navigationControls = adminNavigation.locator(
          'button:visible, a:visible, input:visible, select:visible, textarea:visible'
        );
        const controls = contentControls.or(navigationControls);
        for (const control of await controls.all()) {
          const box = await control.boundingBox();
          expect(box, 'visible interactive control must have a hit region').not.toBeNull();
          const accessibleName =
            (await control.getAttribute('aria-label')) ?? (await control.innerText());
          expect(box!.width, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
          expect(box!.height, `interactive control ${accessibleName}`).toBeGreaterThanOrEqual(44);
        }
        const nav = adminNavigation;
        const navBox = await nav.boundingBox();
        expect(navBox).not.toBeNull();
        if (destination === 'settings') {
          const clearance = await page.locator('main').evaluate((main) => ({
            scrollPaddingBottom: Number.parseFloat(getComputedStyle(main).scrollPaddingBottom),
            navHeight: Number.parseFloat(
              getComputedStyle(document.querySelector('nav[aria-label]')!).height
            )
          }));
          expect(
            clearance.scrollPaddingBottom,
            'settings scroll padding must clear bottom navigation'
          ).toBeGreaterThanOrEqual(clearance.navHeight);
        }
        for (const control of await contentControls.all()) {
          // `scrollIntoViewIfNeeded()` is a CDP nearest-edge scroll: it ignores CSS
          // `scroll-padding` and can align a control with the viewport bottom edge,
          // i.e. directly behind the fixed bottom navigation, even when the layout
          // itself has real clearance (the page padding + scroll-padding-bottom
          // prove it at max scroll in the final check below). Bring each control to
          // the middle of the scrollport instead — the genuinely unobscured region —
          // and then assert reachability against the viewport and the navigation.
          await control.evaluate((element) =>
            element.scrollIntoView({ block: 'center', inline: 'nearest' })
          );
          const box = await control.boundingBox();
          expect(box, 'scrolled interactive control must have a hit region').not.toBeNull();
          const viewport = await page.evaluate(() => ({
            width: document.documentElement.clientWidth,
            height: window.innerHeight
          }));
          expect(
            box!.x >= 0 &&
              box!.y >= 0 &&
              box!.x + box!.width <= viewport.width &&
              box!.y + box!.height <= viewport.height,
            'scrolled interactive control must sit fully inside the viewport after scrolling'
          ).toBe(true);
          const overlapsBottomNav =
            box!.y < navBox!.y + navBox!.height && box!.y + box!.height > navBox!.y;
          expect(
            overlapsBottomNav,
            'scrolled interactive control must not be obscured by bottom navigation'
          ).toBe(false);
        }
        // Sequential keyboard proof: every enabled admin control must be reachable by Tab alone,
        // focused with a visible indicator, ≥44px, fully in the viewport and unobscured by the
        // fixed bottom navigation. Replaces the former single-Tab sanity check; the settings
        // disclosure opens with Enter at its summary stop (no pointer click bypasses this).
        await traverseEnabledAdminControls(
          page,
          localeCopy,
          adminTraversalPlan(destination, localeCopy, {
            ownerName: `Narrow ${destination} ${locale}`,
            applicantName: `Narrow applicant ${destination} ${locale}`
          })
        );
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await expect(nav).toBeVisible();
        const lastControl = contentControls.last();
        await lastControl.scrollIntoViewIfNeeded();
        const finalControl = await lastControl.boundingBox();
        expect(finalControl, 'last interactive action must remain visible').not.toBeNull();
        expect(finalControl!.y + finalControl!.height).toBeLessThanOrEqual(navBox!.y);

        // Keyboard operability: one real type-ahead locale switch per matrix run, cycling
        // en → pt-BR → es → en so every locale is reached by keyboard across the matrix.
        const [nextLocale, nextCopy] = narrowLocales[(localeIndex + 1) % narrowLocales.length]!;
        await switchLocaleWithKeyboard(page, nextLocale);
        await expect(
          page.getByRole('heading', {
            name: nextCopy.communityAdmin.title[titleKey],
            exact: true
          })
        ).toBeVisible();
      });
    }
  }
});
