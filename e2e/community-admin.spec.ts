import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { testSupabaseConfig } from './test-supabase-config';
import { trustedClient } from '../test/helpers/trusted-client';
import { waitForHydratedPage } from './auth-helpers';

type Copy = {
  language: string;
  theme: string;
  appShell: { navigation: string; nav: { community: string } };
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
    sheetClose: string;
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
  'RgqPq.png': '4c176932b525a659559c326bd997079df416b115fe41bc2bdf001cf8af733051',
  'wFqGR.png': '56dd69f5103303f01345062f9b6dfa9c5122c33a656a8f3eb946ecacfe8fcda6',
  'jQDkx.png': 'f5a49a63bfeb7b3afdad48117627645a8ea87eaaaef1b1a62abaec9baaae1c84',
  'N18Mu4.png': 'a18f8f6383d2c6bc29a0670073772250d151935d748c3637bcbc55d75466c0b2',
  'A5Vio.png': '6025c007cd6e97071fbcbb2bc6ca777397959bd2640b584d76107d0ce00d2e1e',
  'E5CS5K.png': '62459bcb662e4820d08cdbc104f40ccd741567ce6723630dfa16ffedb559c767'
} as const;

// Clubhouse admin geometry at the 390×844 viewport: 20px page inset (350px content), 52px controls.
const pageInset = 20;
const contentWidth = 350;
const controlHeight = 52;
const screenshotRatio = 0.01;

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  serviceWorkers: 'block'
});

function localConfig() {
  return testSupabaseConfig();
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
  const profile = await retryFixtureDeadlock(() =>
    client.rpc('onboard_player', {
      p_display_name: label,
      p_preferred_side: 'EITHER',
      p_initial_level: 3.2
    })
  );
  if (profile.error) throw profile.error;
  return { email, client, id: created.data.user.id };
}

const DEADLOCK_SQLSTATE = '40P01';
const DEADLOCK_ATTEMPTS = 4;

/**
 * Fixture writes go through PostgREST while another worker's fixture cleanup toggles triggers
 * (strong table locks in a different order), so Postgres can pick the fixture write as a deadlock
 * victim. A victim is rolled back completely, so replaying the same write is safe; only SQLSTATE
 * 40P01 is retried (bounded) and every other error surfaces on the first attempt.
 */
async function retryFixtureDeadlock<T extends { error: { code?: string } | null }>(
  run: () => PromiseLike<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const result = await run();
    if (result.error?.code !== DEADLOCK_SQLSTATE || attempt >= DEADLOCK_ATTEMPTS) return result;
  }
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
  maxDiffPixelRatio: number,
  mask: Locator[] = []
) {
  // The Pencil export is hash-pinned design evidence (manifest.json); the pixel gate is a Chromium
  // browser baseline because fixture identities, dates and counts deliberately differ from the
  // sample data in the frame. Structure is gated by the separate exact geometry probes.
  const source = readFileSync(
    new URL(`./references/paf-202-community-admin/${file}`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(references[file]);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('main')).toHaveScreenshot(`${file.replace('.png', '')}-light.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio,
    mask
  });
}

// Clubhouse frames (padel-friend-clubhouse.pen, 390×844): 20px page inset, 350px content, 52px
// controls. Structure is probed with ±1px box checks; the admin section navigation is the only bar
// (x20/y774 350×56, app shell suppressed).
async function openCommunityTab(page: Page) {
  await page
    .getByRole('navigation', { name: en.appShell.navigation })
    .getByRole('link', { name: en.appShell.nav.community, exact: true })
    .click();
  await expect(page).toHaveURL(/\/community\/?(?:\?|$)/);
  await expect(page.locator('[data-community-entries]')).toBeVisible();
}

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
        // One pending request card (RgqPq): message-dialog trigger, then Decline, then Approve.
        return [
          back,
          { kind: 'button', name: admin.requestMessage.action },
          { kind: 'button', name: admin.action.deny! },
          { kind: 'button', name: admin.action.approve! }
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
        // The root-level SkipLink is an intentional, page-independent first Tab stop that precedes
        // the #locale anchor; it is not screen content and is covered by the release a11y spec.
        if (element.matches('a[href="#main-content"]')) return false;
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
  // The admin section navigation is the single bar on these screens: 20px page inset, 14px above
  // the bottom edge, 56px tall.
  expect(Math.abs(box.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.y - 774)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.width - contentWidth)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 56)).toBeLessThanOrEqual(1);
  const linksLocator = nav.getByRole('link');
  await expect(linksLocator).toHaveCount(5);
  const links = await linksLocator.all();
  for (const link of links) {
    const linkBox = await acquireBox(link);
    expect(linkBox.height).toBeGreaterThanOrEqual(48);
  }
  expect(await nav.locator('[aria-current="page"]').count()).toBe(1);
  // The app shell bar is suppressed on admin routes: exactly one navigation bar.
  await expect(page.getByRole('navigation', { name: en.appShell.navigation })).toHaveCount(0);
}

async function geometry(page: Page, expectedPending?: string) {
  const section = page.locator('main > section');
  const box = await section.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - contentWidth)).toBeLessThanOrEqual(1);
  await bottomNavGeometry(page);
  if (expectedPending) {
    // RgqPq: card with a 44px avatar identity row, then a Decline | Approve row of equal buttons.
    const card = page.getByTestId('community-request-card').filter({ hasText: expectedPending });
    const cardBox = await card.boundingBox();
    expect(cardBox).not.toBeNull();
    expect(Math.abs(cardBox!.x - pageInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(cardBox!.width - contentWidth)).toBeLessThanOrEqual(1);
    const avatar = await card.locator('[aria-hidden="true"]').first().boundingBox();
    expect(avatar).not.toBeNull();
    expect(Math.abs(avatar!.width - 44)).toBeLessThanOrEqual(1);
    expect(Math.abs(avatar!.height - 44)).toBeLessThanOrEqual(1);
    const heading = await card.getByRole('heading', { name: expectedPending }).boundingBox();
    const approve = await card
      .getByRole('button', { name: en.communityAdmin.action.approve })
      .boundingBox();
    const deny = await card
      .getByRole('button', { name: en.communityAdmin.action.deny })
      .boundingBox();
    expect(heading).not.toBeNull();
    expect(approve).not.toBeNull();
    expect(deny).not.toBeNull();
    expect(Math.abs(approve!.y - deny!.y)).toBeLessThanOrEqual(1);
    expect(deny!.x).toBeLessThan(approve!.x);
    expect(Math.abs(approve!.width - deny!.width)).toBeLessThanOrEqual(1);
    expect(approve!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
    expect(approve!.height).toBeGreaterThanOrEqual(controlHeight - 1);
    expect(deny!.height).toBeGreaterThanOrEqual(controlHeight - 1);
  }
}

async function memberCardGeometry(page: Page) {
  const cards = await page.getByTestId('community-member-card').all();
  expect(cards).toHaveLength(3);
  // wFqGR: one hairline list surface; 68px+ rows with a 36px avatar, separated by dividers.
  const surface = await cards[0]!.locator('xpath=..').boundingBox();
  expect(surface).not.toBeNull();
  expect(Math.abs(surface!.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(surface!.width - contentWidth)).toBeLessThanOrEqual(1);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - (pageInset + 1))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - (contentWidth - 2))).toBeLessThanOrEqual(1);
    expect(box!.height).toBeGreaterThanOrEqual(68);
    if (index > 0)
      expect(
        Math.abs(box!.y - (boxes[index - 1]!.y + boxes[index - 1]!.height))
      ).toBeLessThanOrEqual(1);
  }
  const avatar = await cards[0]!.locator('[aria-hidden="true"]').first().boundingBox();
  expect(avatar).not.toBeNull();
  expect(Math.abs(avatar!.width - 36)).toBeLessThanOrEqual(1);
  expect(Math.abs(avatar!.height - 36)).toBeLessThanOrEqual(1);
  const invite = await page
    .getByRole('button', { name: en.communityAdmin.inviteUnavailable })
    .boundingBox();
  expect(invite).not.toBeNull();
  expect(invite!.height).toBeGreaterThanOrEqual(controlHeight - 1);
  const search = await page.locator('#admin-member-search').boundingBox();
  expect(search).not.toBeNull();
  expect(Math.abs(search!.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(search!.width - contentWidth)).toBeLessThanOrEqual(1);
  expect(search!.height).toBeGreaterThanOrEqual(controlHeight - 1);
  for (const status of ['active', 'pending', 'inactive'] as const) {
    const chip = await page
      .getByRole('button', { name: en.communityAdmin.status[status]!, exact: true })
      .boundingBox();
    expect(chip).not.toBeNull();
    expect(chip!.height).toBeGreaterThanOrEqual(44);
  }
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
  expect(area.width).toBeGreaterThanOrEqual(48);
  expect(area.height).toBe(48);
}

async function memberSheetGeometry(page: Page) {
  // jQDkx: bottom sheet over the roster — full-width, bottom-anchored, 28px top radius, 16px inset,
  // 20/800 name, 36px rounded glyph tiles and 56px (60px when described) rows.
  const popup = page.getByTestId('community-member-sheet');
  const box = await popup.boundingBox();
  expect(box).not.toBeNull();
  expect(Math.abs(box!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.width - 390)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y + box!.height - 844)).toBeLessThanOrEqual(1);
  const style = await popup.evaluate((element) => {
    const computed = getComputedStyle(element);
    return { radius: computed.borderTopLeftRadius, bottomRadius: computed.borderBottomLeftRadius };
  });
  expect(style).toEqual({ radius: '28px', bottomRadius: '0px' });
  const title = await popup
    .getByRole('heading')
    .first()
    .evaluate((element) => {
      const computed = getComputedStyle(element);
      return { size: computed.fontSize, weight: computed.fontWeight };
    });
  expect(title).toEqual({ size: '20px', weight: '800' });
  const rows = await popup.locator('[data-sheet-row]').all();
  expect(rows).toHaveLength(3);
  for (const [index, row] of rows.entries()) {
    const rowBox = await row.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(rowBox!.x).toBeGreaterThanOrEqual(box!.x + 16);
    expect(rowBox!.x).toBeLessThanOrEqual(box!.x + 18);
    expect(Math.abs(rowBox!.width - 356)).toBeLessThanOrEqual(2);
    expect(rowBox!.height).toBeGreaterThanOrEqual((index === 0 ? 56 : 60) - 1);
    const glyph = await row.locator('[aria-hidden="true"]').first().boundingBox();
    expect(glyph).not.toBeNull();
    expect(Math.abs(glyph!.width - 36)).toBeLessThanOrEqual(1);
    expect(Math.abs(glyph!.height - 36)).toBeLessThanOrEqual(1);
  }
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
  // N18Mu4: full-width label card, then 52px controls in order, then the 52px save action.
  const rows = [
    ['settings-visibility-label', 48],
    ['settings-visibility-control', controlHeight],
    ['settings-join-policy-control', controlHeight]
  ] as const;
  let previousBottom = 0;
  for (const [selector, minimum] of rows) {
    const box = await page.getByTestId(selector).boundingBox();
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - pageInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - contentWidth)).toBeLessThanOrEqual(1);
    expect(box!.height).toBeGreaterThanOrEqual(minimum - 1);
    expect(box!.y).toBeGreaterThanOrEqual(previousBottom);
    previousBottom = box!.y + box!.height;
  }
  const save = await page.getByRole('button', { name: en.communityAdmin.save }).boundingBox();
  expect(save).not.toBeNull();
  expect(save!.height).toBeGreaterThanOrEqual(controlHeight - 1);
  expect(save!.y).toBeGreaterThanOrEqual(previousBottom);
}

async function venueGeometry(page: Page) {
  const cards = await page.getByTestId('community-venue-card').all();
  expect(cards).toHaveLength(2);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // A5Vio: cards with a 64×52 photo slot, 12px apart.
  for (const box of boxes) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - pageInset)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - contentWidth)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(boxes[1]!.y - (boxes[0]!.y + boxes[0]!.height) - 12)).toBeLessThanOrEqual(1);
  const photo = await cards[0]!.locator('[aria-hidden="true"], img').first().boundingBox();
  expect(photo).not.toBeNull();
  expect(Math.abs(photo!.width - 64)).toBeLessThanOrEqual(1);
  expect(Math.abs(photo!.height - 52)).toBeLessThanOrEqual(1);
  const note = await page.getByText(en.communityAdmin.venue.historyNote).boundingBox();
  expect(note).not.toBeNull();
  expect(Math.abs(note!.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(note!.width - contentWidth)).toBeLessThanOrEqual(1);
  expect(note!.y).toBeGreaterThanOrEqual(boxes[1]!.y + boxes[1]!.height);
  const add = await page.getByRole('button', { name: en.communityAdmin.venue.add }).boundingBox();
  expect(add).not.toBeNull();
  expect(add!.height).toBeGreaterThanOrEqual(controlHeight - 1);
  const archive = await cards[0]!
    .getByRole('button', { name: en.communityAdmin.venue.archive })
    .boundingBox();
  expect(archive).not.toBeNull();
  expect(archive!.height).toBeGreaterThanOrEqual(controlHeight - 1);
}

async function auditGeometry(page: Page) {
  const cards = await page.getByTestId('community-audit-event').all();
  expect(cards).toHaveLength(3);
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  // E5CS5K: one hairline log surface with divided entries led by a 10px dot.
  const surface = await cards[0]!.locator('xpath=..').boundingBox();
  expect(surface).not.toBeNull();
  expect(Math.abs(surface!.x - pageInset)).toBeLessThanOrEqual(1);
  expect(Math.abs(surface!.width - contentWidth)).toBeLessThanOrEqual(1);
  for (const [index, box] of boxes.entries()) {
    expect(box).not.toBeNull();
    expect(Math.abs(box!.x - (pageInset + 1))).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.width - (contentWidth - 2))).toBeLessThanOrEqual(1);
    if (index > 0)
      expect(
        Math.abs(box!.y - (boxes[index - 1]!.y + boxes[index - 1]!.height))
      ).toBeLessThanOrEqual(1);
  }
  const dot = await cards[0]!.locator('[aria-hidden="true"]').first().boundingBox();
  expect(dot).not.toBeNull();
  expect(Math.abs(dot!.width - 10)).toBeLessThanOrEqual(1);
}

test(
  'real admin requests, membership, settings, venues and audit stay protected and responsive',
  { tag: '@visual' },
  async ({ browser, page }) => {
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
    const joined = await request.client.rpc('join_public_community', {
      p_community_id: communityId
    });
    if (joined.error) throw joined.error;
    expect(joined.data).toMatchObject([{ status: 'pending' }]);
    const backupMembership = await trustedClient()
      .from('community_members')
      .insert({ community_id: communityId, user_id: backup.id, role: 'member', status: 'active' })
      .select('id')
      .single();
    if (backupMembership.error) throw backupMembership.error;
    // Second real venue (admin RLS insert) so the venues screen shows the supported two-card
    // structure of the A5Vio frame instead of masking it away; "South Court" sorts after the
    // UI-created "North Court" so card order stays deterministic.
    const seededVenue = await trustedClient()
      .from('community_venues')
      .insert({
        community_id: communityId,
        created_by: owner.id,
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
    const route = `/community/${communityId}/admin`;
    const adminEntry = { name: communityName, exact: true };
    await expect(page.getByRole('link', adminEntry)).toHaveCount(0);
    await openCommunityTab(page);
    const adminLink = page.locator('[data-community-entries]').getByRole('link', adminEntry);
    await expect(adminLink).toHaveAttribute('href', `${route}/requests`);
    await adminLink.click();
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', { name: en.communityAdmin.title.requests })
    ).toBeVisible();
    await geometry(page, 'Pending Player');
    // Mask the random community name and fixture-dependent request date; geometry is probed exactly.
    await visualDiff(page, 'RgqPq.png', screenshotRatio, [
      page.locator('#admin-screen-title + p'),
      page.getByTestId('community-request-card').locator('p').last()
    ]);
    for (const name of ['Pending Player']) {
      const card = page.getByTestId('community-request-card').filter({ hasText: name });
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
    const roster: Database['public']['Functions']['search_community_members']['Returns'] =
      rows.data;
    const backupRow = roster.find((row) => row.user_id === backup.id);
    const requestRow = roster.find((row) => row.user_id === request.id);
    const ownerRow = roster.find((row) => row.user_id === owner.id);
    if (!backupRow || !requestRow || !ownerRow)
      throw new Error('Expected fixture member not found');

    await page.goto(`${route}/members`);
    await waitForHydratedPage(page);
    await page.getByRole('heading', { name: en.communityAdmin.title.members }).waitFor();
    await geometry(page);
    await backLinkGeometry(page);
    await memberCardGeometry(page);
    await assertLinkHitArea(page.getByRole('link', { name: 'Backup Admin' }));
    // Mask fixture identity/metrics, role badges, avatars and the unsupported invitation copy only;
    // card layout, search and geometry stay exact and unmasked.
    // Pixel gate: Chromium baseline (masks: random community name, fixture-dependent dates).
    await visualDiff(page, 'wFqGR.png', screenshotRatio, [
      page.locator('#admin-screen-title + p'),
      page.getByTestId('community-member-card').locator('p')
    ]);
    // Roster state (search) must survive opening and closing the sheet over it.
    await page.locator('#admin-member-search').fill('Backup');
    await expect(page.getByTestId('community-member-card')).toHaveCount(1);
    await page.getByRole('link', { name: 'Backup Admin' }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/members/${backupRow.membership_id}$`));
    const sheet = page.getByRole('dialog', { name: 'Backup Admin' });
    await expect(sheet).toBeVisible();
    await memberSheetGeometry(page);
    // The live roster stays mounted behind the sheet but is inert to assistive tech and focus.
    await expect(page.getByTestId('community-member-card')).toBeAttached();
    await expect(page.getByRole('link', { name: 'Backup Admin' })).toHaveCount(0);
    // Pixel gate: Chromium baseline of the sheet (masks: member identity and metrics).
    await page.evaluate(() => document.fonts.ready);
    await expect(page.getByTestId('community-member-sheet')).toHaveScreenshot('jQDkx-light.png', {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixelRatio: screenshotRatio,
      mask: [page.getByTestId('community-member-sheet').locator('h2, p').first()]
    });
    const reference = readFileSync(
      new URL('./references/paf-202-community-admin/jQDkx.png', import.meta.url)
    );
    expect(createHash('sha256').update(reference).digest('hex')).toBe(references['jQDkx.png']);
    // History-originated close: Back semantics, roster state and focus restored to the row.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/admin\/members$/);
    await expect(sheet).toHaveCount(0);
    await expect(page.locator('#admin-member-search')).toHaveValue('Backup');
    await expect(page.getByRole('link', { name: 'Backup Admin' })).toBeFocused();
    await page.getByRole('link', { name: 'Backup Admin' }).click();
    await expect(sheet).toBeVisible();
    await page.getByRole('button', { name: en.communityAdmin.action.promote }).click();
    await expect(page.getByText('Admin role granted.')).toBeVisible();
    // Role change refreshes the sheet's role-based rows (and the live roster behind it).
    await expect(page.getByRole('button', { name: en.communityAdmin.action.demote })).toBeVisible();
    // Reload keeps the route-derived sheet open (SSR + hydration).
    await page.reload();
    await waitForHydratedPage(page);
    await expect(sheet).toBeVisible();
    // Deep link without a roster history entry: close falls back to Members with heading focus.
    await page.goto(`${route}/audit`);
    await page.goto(`${route}/members/${backupRow.membership_id}`);
    await waitForHydratedPage(page);
    await expect(sheet).toBeVisible();
    await page.getByRole('button', { name: en.communityAdmin.sheetClose }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/members$/);
    await expect(
      page.getByRole('heading', { name: en.communityAdmin.title.members })
    ).toBeFocused();

    const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, request);
    await openCommunityTab(memberPage);
    await expect(
      memberPage.locator('[data-community-entries]').getByRole('link', adminEntry)
    ).toHaveCount(0);
    await memberPage.goto(`${route}/members`);
    await expect(
      memberPage.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
    ).toBeVisible();
    await memberContext.close();

    await page.goto(`${route}/settings`);
    await waitForHydratedPage(page);
    await geometry(page);
    await settingsGeometry(page);
    // Pixel gate: Chromium baseline (masks: random community name, fixture-dependent dates).
    await visualDiff(page, 'N18Mu4.png', screenshotRatio, [
      page.locator('#admin-screen-title + p')
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
    await expect(
      page.getByRole('heading', { name: es.communityAdmin.title.settings })
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#locale').selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await assertLocaleControlSizing(page, en, 390);
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
    await page.waitForLoadState('networkidle');
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      320
    );
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390
    );

    await page.goto(`${route}/venues`);
    await page
      .context()
      .addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
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
    // Pixel gate: Chromium baseline (masks: random community name, fixture-dependent dates).
    await visualDiff(page, 'A5Vio.png', screenshotRatio, [page.locator('#admin-screen-title + p')]);
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
    // Pixel gate: Chromium baseline (masks: random community name, fixture-dependent dates).
    await visualDiff(page, 'E5CS5K.png', screenshotRatio, [
      page.locator('#admin-screen-title + p'),
      page.getByTestId('community-audit-event').locator('p')
    ]);
    await page.getByRole('button', { name: en.communityAdmin.loadMore }).click();
    await assertLinkHitArea(
      page.getByRole('link', { name: en.communityAdmin.audit.openMember }).first()
    );

    await page.goto(`${route}/members/${crypto.randomUUID()}`);
    await waitForHydratedPage(page);
    // The missing member renders as an error sheet over the live roster (one page main behind it).
    await expect(
      page.getByRole('dialog').getByRole('heading', { name: en.communityAdmin.title.member })
    ).toBeVisible();
    await expect(page.locator('main')).toHaveCount(1);

    await page.goto(`${route}/members/${ownerRow.membership_id}`);
    await waitForHydratedPage(page);
    await page.getByRole('button', { name: en.communityAdmin.action.demote }).click();
    await page.getByRole('button', { name: en.communityAdmin.confirmAction }).click();
    await expect(
      page.getByRole('heading', { name: en.communityAdmin.accessDeniedTitle })
    ).toBeVisible();
    expect(requestRow.status).toBe('active');
  }
);

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
  const ownerCommunity = await trustedClient()
    .from('communities')
    .update({ settings: { confidential: confidential.setting } })
    .eq('id', communityId);
  if (ownerCommunity.error) throw ownerCommunity.error;
  const activeMembership = await trustedClient()
    .from('community_members')
    .insert({ community_id: communityId, user_id: active.id, role: 'member', status: 'active' })
    .select('id')
    .single();
  if (activeMembership.error) throw activeMembership.error;
  const pendingMembership = await trustedClient()
    .from('community_members')
    .insert({ community_id: communityId, user_id: pending.id, role: 'member', status: 'pending' })
    .select('id')
    .single();
  if (pendingMembership.error) throw pendingMembership.error;
  const venue = await trustedClient()
    .from('community_venues')
    .insert({
      community_id: communityId,
      created_by: owner.id,
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
        const created = await retryFixtureDeadlock(() =>
          owner.client.rpc('create_community', {
            p_name: `Narrow ${crypto.randomUUID().slice(0, 6)}`,
            p_visibility: 'public',
            p_join_policy: 'admin_approval'
          })
        );
        if (created.error || typeof created.data !== 'string')
          throw created.error ?? new Error('Narrow-screen community fixture creation failed');
        const communityId = created.data;
        const base = `/community/${communityId}/admin`;
        const active = await retryFixtureDeadlock(() =>
          trustedClient()
            .from('community_members')
            .insert({
              community_id: communityId,
              user_id: applicant.id,
              role: 'member',
              status: 'active'
            })
            .select('id')
            .single()
        );
        if (active.error) throw active.error;
        const pending = await retryFixtureDeadlock(() =>
          trustedClient()
            .from('community_members')
            .insert({
              community_id: communityId,
              user_id: requester.id,
              role: 'member',
              status: 'pending'
            })
            .select('id')
            .single()
        );
        if (pending.error) throw pending.error;
        const venue = await retryFixtureDeadlock(() =>
          trustedClient().from('community_venues').insert({
            community_id: communityId,
            created_by: owner.id,
            name: 'Narrow court',
            address: 'Madrid',
            maps_url: 'https://maps.example.test/narrow'
          })
        );
        if (venue.error) throw venue.error;

        await signIn(page, owner);
        await page.locator('#locale').selectOption(locale);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        const path =
          destination === 'member' ? `${base}/members/${active.data.id}` : `${base}/${destination}`;
        await page.goto(path);
        await waitForHydratedPage(page);
        const localeCopy = locale === 'pt-BR' ? pt : locale === 'es' ? es : en;
        if (destination === 'member') {
          // The member screen is a bottom sheet: the page behind it (locale select, roster) is inert.
          const sheet = page.getByRole('dialog', {
            name: `Narrow applicant ${destination} ${locale}`
          });
          await expect(sheet).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('lang', locale);
          await expect(
            sheet.getByRole('button', { name: localeCopy.communityAdmin.action.promote })
          ).toBeVisible();
          const popup = await page.getByTestId('community-member-sheet').boundingBox();
          expect(popup).not.toBeNull();
          expect(popup!.x).toBeGreaterThanOrEqual(0);
          expect(popup!.x + popup!.width).toBeLessThanOrEqual(320);
          for (const control of await sheet.locator('[data-sheet-row]').all()) {
            const box = await control.boundingBox();
            expect(box).not.toBeNull();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.x + box!.width).toBeLessThanOrEqual(320);
          }
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth)
          ).toBeLessThanOrEqual(320);
          return;
        }
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
        const titleKey = destination;
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
            // Main is 100vh below the wrapping locale/theme row, not at viewport y=0.
            // Its optimal viewing region must end above the fixed navigation.
            obscuredScrollportBottom:
              main.getBoundingClientRect().bottom -
              document.querySelector('nav[aria-label]')!.getBoundingClientRect().top
          }));
          expect(
            clearance.scrollPaddingBottom,
            'settings scroll padding must clear bottom navigation including the scrollport offset'
          ).toBeGreaterThanOrEqual(clearance.obscuredScrollportBottom);
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
