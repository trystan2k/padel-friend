import { serializeMatchFixtureSql, withDeadlockRetry } from './match-fixture-sql';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from '@playwright/test';
import { spawnTestSql, testSupabaseConfig } from './test-supabase-config';
import { waitForHydratedPage } from './auth-helpers';
import { assertFrameRegions, type FrameRegionRecord } from './frame-regions';
import { assertChipsOnUnmarkedRoute, assertChipsStepAside } from './route-chrome';

// Pixel baselines superseded by the PAF-6 frame-driven redesign; re-baselining requires product approval.
// Retain structural/role/a11y coverage. Historical exports remain provenance only.

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  matches: {
    title: string;
    navigationLabel: string;
    back: string;
    tabs: { available: string; my: string; past: string };
    visibility: { community_open: string; invite_only: string };
    type: { competitive: string; friendly: string };
    teamMode: { PREDEFINED_TEAMS: string; POST_MATCH_TEAMS: string };
    unavailable: string;
    offline: string;
    loading: string;
    error: string;
    retry: string;
    loadMore: string;
    empty: { available: string; past: string };
    emptyHint: { available: string; my: string; past: string };
    badges: { invited: string; reserve: string };
    invitations: { accept: string; decline: string };
    counts: Record<string, string>;
    card: { pricePerPlayer: string; openMaps: string };
    detail: {
      title: string;
      barTitle: string;
      visibility: { community_open: string; invite_only: string };
      participants: string;
      participation: string;
      accepted: string;
      creatorAccepted: string;
      invitationInfo: string;
      pastScheduled: string;
      outcomeUnavailable: string;
      guestApprovalRequired: string;
      share: string;
      shareUrl: string;
      viewCourtLocationFor: string;
    };
  };
  // PAF-5 added the real registration surface to the detail screens; the guest
  // view now carries the genuine request CTA (see the guest test).
  matchRegistration: { join: { requestButton: string } };
  matchCreate: {
    title: string;
    next: string;
    previous: string;
    cancel: string;
    stepOf: string;
    readyTitle: string;
    reviewRows: { when: string; where: string; level: string; teams: string; yes: string };
    review: string;
    publish: string;
    informationalOnly: string;
    steps: { details: string; players: string; teams: string; review: string };
    fields: {
      community: string;
      date: string;
      startTime: string;
      timezone: string;
      type: string;
      visibility: string;
      savedVenue: string;
      venueName: string;
      mapsUrl: string;
      photo: string;
      price: string;
      currency: string;
      paymentNote: string;
      maximumRegistrations: string;
      cutoff: string;
      courtNotes: string;
      duration: string;
      notes: string;
      minLevel: string;
      maxLevel: string;
      courtBooked: string;
    };
    helpers: { defaultCutoff: string; suggestedDays: string };
    players: {
      format: string;
      formatGroups_one: string;
      formatGroups_other: string;
      registration: string;
      registrationOptions: { community_open: string; invite_only: string };
      levelRange: string;
      anyLevel: string;
      customRange: string;
    };
    invitees: { search: string; selected: string };
    photo: { remove: string; unavailable: string };
  };
};

const localeCopy = (locale: string): Copy =>
  JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
const en = localeCopy('en');
const ptBr = localeCopy('pt-BR');
const es = localeCopy('es');
const copyFor = (locale: string): Copy => (locale === 'pt-BR' ? ptBr : locale === 'es' ? es : en);

// ---------------------------------------------------------------------------
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Local loopback stack fixtures (same trust rules as e2e/matches.spec.ts: real
// publishable-key JWTs, trusted local SQL only for elapsed/filler rows and the
// second FIFO registration, no service-role client anywhere).
// ---------------------------------------------------------------------------

const password = 'Password123!';
const config = localConfig();

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
  serviceWorkers: 'block'
});

type Actor = { id: string; email: string; displayName: string; client: SupabaseClient };

function localConfig() {
  return testSupabaseConfig();
}

/** A real, decodable 1x1 PNG (70 bytes) — valid magic bytes and a real browser image. */
function matchPhoto(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/** UTC calendar date offset by whole days; fixture instants resolve in the community UTC zone. */
function ymd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function createActor(displayName: string, level = 3.2): Promise<Actor> {
  const bootstrap = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `match-visual-${crypto.randomUUID()}@test.local`;
  const signup = await bootstrap.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(
      `Could not create local visual E2E actor: ${signup.error?.message ?? 'no session'}`
    );
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: displayName,
    p_preferred_side: 'EITHER',
    p_initial_level: level
  });
  if (onboarded.error) throw onboarded.error;
  return { id: signup.data.user.id, email, displayName, client };
}

async function createPublicCommunity(admin: Actor): Promise<string> {
  const created = await admin.client.rpc('create_community', {
    p_name: 'Vale Padel Society',
    p_visibility: 'public',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community fixture failed');
  await pinCommunityUtc(created.data);
  return created.data;
}

/** The frames under visual QA resolve every event instant in the UTC zone; pin the
 * effective admin defaults so the community never inherits a localized default
 * (Europe/Madrid) that would shift every scheduled start. */
async function pinCommunityUtc(communityId: string): Promise<void> {
  await fixtureSql(
    `update public.communities set settings = coalesce(settings,'{}'::jsonb) || ` +
      `'{"timezone":"UTC","admin_defaults":{"timezone":"UTC","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb ` +
      `where id = '${communityId}';`
  );
}

async function joinAsActiveMember(communityId: string, member: Actor): Promise<void> {
  const joined = await member.client.rpc('join_public_community', { p_community_id: communityId });
  if (joined.error) throw joined.error;
}

async function stagePhoto(actor: Actor, communityId: string, eventId: string): Promise<string> {
  const path = `${communityId}/${eventId}/${actor.id}/${crypto.randomUUID()}.png`;
  const upload = await actor.client.storage
    .from('match-event-photos')
    .upload(path, matchPhoto(), { contentType: 'image/png' });
  if (upload.error) throw upload.error;
  return path;
}

function publishInput(
  communityId: string,
  draft: {
    date: string;
    startTime: string;
    eventType: 'competitive' | 'friendly';
    visibility: 'community_open' | 'invite_only';
    teamMode: 'PREDEFINED_TEAMS' | 'POST_MATCH_TEAMS';
    venueName: string;
    mapsUrl: string;
    photoPath: string;
    price?: string;
    maximum?: number;
  }
): Record<string, unknown> {
  return {
    community_id: communityId,
    date: draft.date,
    start_time: draft.startTime,
    event_type: draft.eventType,
    visibility: draft.visibility,
    team_assignment_mode: draft.teamMode,
    venue_name: draft.venueName,
    maps_url: draft.mapsUrl,
    photo_path: draft.photoPath,
    saved_venue_id: null,
    court_notes: null,
    duration_minutes: null,
    notes: null,
    court_booked: false,
    restriction_enabled: true,
    min_level: 2.7,
    max_level: 4.7,
    price: draft.price ?? null,
    currency: draft.price ? 'EUR' : null,
    payment_note: null,
    maximum_registrations: draft.maximum ?? null,
    cutoff_at: null
  };
}

async function publishFixture(
  actor: Actor,
  eventId: string,
  input: Record<string, unknown>,
  inviteeIds: string[] = []
): Promise<void> {
  const result = await actor.client.rpc('publish_match_event', {
    p_event_id: eventId,
    p_input: input,
    p_invitee_ids: inviteeIds
  });
  if (result.error || result.data !== eventId)
    throw result.error ?? new Error(`Publication fixture failed for ${eventId}`);
}

/** Trusted local SQL harness (single atomic DO block; only immutability/future-start
 * triggers are bypassed, exactly like the functional and integration fixture suites). */
function fixtureSql(sql: string): Promise<void> {
  return withDeadlockRetry(() => runFixtureSql(sql));
}

async function runFixtureSql(sql: string): Promise<void> {
  const child = spawnTestSql(serializeMatchFixtureSql(`do $$ begin ${sql} end $$;`));
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (code !== 0) throw new Error(`Trusted fixture SQL failed (${code}): ${stdout}\n${stderr}`);
}

// ---------------------------------------------------------------------------
// Browser helpers
// ---------------------------------------------------------------------------

type Viewport = { width: number; height: number };

async function newContext(
  browser: Browser,
  options: { viewport?: Viewport; locale?: string; theme?: 'light' | 'dark' } = {}
): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    locale: 'en-US',
    serviceWorkers: 'block'
  });
  await context.addCookies([
    { name: 'locale', value: options.locale ?? 'en', url: 'http://127.0.0.1:4173' },
    { name: 'theme', value: options.theme ?? 'light', url: 'http://127.0.0.1:4173' }
  ]);
  return context;
}

async function signIn(page: Page, actor: Actor, copy: Copy = en): Promise<void> {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(copy.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(copy.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: copy.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  await page.evaluate(async () => {
    // Text-driven font loading is lazy: force the exact faces the app renders with so
    // screenshots never race a pending webfont.
    await Promise.all(
      ['400', '500', '600', '700', '800'].map((weight) =>
        document.fonts.load(`${weight} 16px Figtree`)
      )
    );
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        if (!image.complete) await image.decode().catch(() => undefined);
      })
    );
  });
  const fonts = await page.evaluate(() => ({
    figtree: ['400', '600', '700', '800'].every((weight) =>
      document.fonts.check(`${weight} 16px Figtree`)
    )
  }));
  expect(fonts, 'Figtree must be available before screenshot').toEqual({ figtree: true });
}

// ---------------------------------------------------------------------------
// Structural probes (exact assertions, not eyeballing)
// ---------------------------------------------------------------------------

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    main: document.querySelector('main')?.scrollWidth ?? 0
  }));
  expect(
    metrics.document <= metrics.innerWidth &&
      metrics.body <= metrics.innerWidth &&
      metrics.main <= metrics.innerWidth,
    `${label}: horizontal overflow at ${metrics.innerWidth}px viewport (document ${metrics.document}, body ${metrics.body}, main ${metrics.main})`
  ).toBe(true);
}

/** Every primary interactive control in main must expose a ≥44px hit target. Inline text
 * links (WCAG target-size inline exception) and native checkboxes behind text labels are
 * excluded; radio labels are measured as the actual comfortable hit area. */
async function assertPrimaryHitTargets(
  page: Page,
  label: string,
  exemptSelectors: string[] = []
): Promise<void> {
  const controls = page.locator(
    'main a:visible, main button:visible, main select:visible, main input:visible, main label:has(input[type="radio"]):visible'
  );
  for (const control of await controls.all()) {
    const info = await control.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName.toLowerCase() + (node instanceof HTMLInputElement ? `:${node.type}` : ''),
        display: style.display,
        height: node.getBoundingClientRect().height
      };
    });
    if (info.tag === 'input:checkbox' || info.tag === 'input:radio') continue;
    if (info.tag === 'a' && info.display === 'inline') continue;
    expect(
      await control.evaluate(
        (node, selectors) => selectors.some((selector) => node.matches(selector)),
        exemptSelectors
      ),
      `${label}: no primary control exemptions`
    ).toBe(false);
    expect(
      info.height,
      `${label}: ${info.tag} hit target must be ≥44px (got ${info.height}px)`
    ).toBeGreaterThanOrEqual(44);
  }
}

// F25 touch-label evidence. The rendered hit area is read from the LABEL element itself
// with getBoundingClientRect() — neither the min-block-size CSS declaration nor the
// checkbox input's own box proves the rendered area. measureTouchLabel runs in the page
// and returns the label rect, the rendered text-line layout (Range.getClientRects over
// the label's own text nodes) and the implicit label↔input association.
type TouchLabelKey = (typeof TOUCH_LABEL_KEYS)[number];

const TOUCH_LABEL_KEYS = ['courtBooked'] as const;

type TouchLabelReading = {
  width: number;
  height: number;
  textLines: number;
  textWidth: number;
  textOverhangRight: number;
  textOverhangBottom: number;
  associated: boolean;
  inputInsetRight: number;
};

function touchLabel(page: Page, copy: Copy, key: TouchLabelKey): Locator {
  return page
    .locator('main label')
    .filter({ has: page.getByRole('checkbox', { name: copy.matchCreate.fields[key] }) });
}

function measureTouchLabel(node: HTMLLabelElement): TouchLabelReading {
  const rect = node.getBoundingClientRect();
  const input = node.querySelector('input[type="checkbox"]');
  const inputRect = input?.getBoundingClientRect() ?? null;
  const lineRects: DOMRect[] = [];
  for (const child of node.childNodes)
    if (child.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.selectNodeContents(child);
      lineRects.push(...Array.from(range.getClientRects()));
    }
  const visible = lineRects.filter((line) => line.width > 0 && line.height > 0);
  return {
    width: rect.width,
    height: rect.height,
    textLines: new Set(visible.map((line) => line.top.toFixed(1))).size,
    textWidth: visible.reduce((widest, line) => Math.max(widest, line.width), 0),
    textOverhangRight: visible.reduce((worst, line) => Math.max(worst, line.right - rect.right), 0),
    textOverhangBottom: visible.reduce(
      (worst, line) => Math.max(worst, line.bottom - rect.bottom),
      0
    ),
    associated:
      input instanceof HTMLInputElement && input.labels !== null
        ? Array.from(input.labels).includes(node)
        : false,
    inputInsetRight: inputRect ? rect.right - inputRect.right : Number.NaN
  };
}

/** Both checkbox labels must render at ≥44px in BOTH dimensions, measured on the label
 * element itself; the measured numbers are printed so the run records real evidence. */
async function assertCheckboxLabelTargets(page: Page, copy: Copy, label: string): Promise<void> {
  for (const key of TOUCH_LABEL_KEYS) {
    const text = copy.matchCreate.fields[key];
    const target = touchLabel(page, copy, key);
    await expect(target).toHaveCount(1);
    const reading = await target.evaluate(measureTouchLabel);
    console.log(
      `[touch-label] ${label} ${key} "${text}": ${reading.width.toFixed(2)} × ${reading.height.toFixed(2)}px`
    );
    expect(
      reading.width,
      `${label}: checkbox label ${text} rendered width (got ${reading.width}px)`
    ).toBeGreaterThanOrEqual(44);
    expect(
      reading.height,
      `${label}: checkbox label ${text} rendered height (got ${reading.height}px)`
    ).toBeGreaterThanOrEqual(44);
    expect(
      reading.associated,
      `${label}: checkbox label ${text} must be programmatically associated with its input`
    ).toBe(true);
  }
}

/** Clicking the LABEL at its trailing edge — a point measurably past the checkbox input's
 * own box — must toggle the checkbox and restore it on the second click. */
async function assertTouchLabelActivation(
  page: Page,
  copy: Copy,
  key: TouchLabelKey,
  label: string
): Promise<void> {
  const text = copy.matchCreate.fields[key];
  const target = touchLabel(page, copy, key);
  await expect(target).toHaveCount(1);
  const reading = await target.evaluate(measureTouchLabel);
  const clickX = reading.width - 4;
  expect(
    clickX,
    `${label}: ${key} ("${text}") label-edge click point ${clickX}px must clear the checkbox input itself (input right inset ${reading.inputInsetRight}px)`
  ).toBeGreaterThan(reading.width - reading.inputInsetRight);
  const checkbox = target.locator('input[type="checkbox"]');
  const before = await checkbox.isChecked();
  await target.click({ position: { x: clickX, y: reading.height / 2 } });
  await expect(
    checkbox,
    `${label}: clicking the ${key} ("${text}") label edge must toggle the checkbox`
  ).toBeChecked({ checked: !before });
  await target.click({ position: { x: clickX, y: reading.height / 2 } });
  await expect(
    checkbox,
    `${label}: second ${key} ("${text}") label-edge click must restore the checkbox`
  ).toBeChecked({ checked: before });
}

/** Photo aspect treatment: 16/9 cover cropping, matching the design's venue imagery. */
/** Clubhouse detail top bar (frames eYIgj/fo8Zn): back on the start edge, centered 17/700 title and
 * Share as a 15/700 green text action on the end edge, every target ≥44px. */
async function assertHeaderShare(page: Page, label: string): Promise<void> {
  const share = page.locator('main header').getByRole('button', { name: en.matches.detail.share });
  await expect(share, `${label}: header share must be visible`).toBeVisible();
  const reading = await page.evaluate(() => {
    const header = document.querySelector('main header')!;
    const box = (selector: string) => header.querySelector(selector)!.getBoundingClientRect();
    const button = header.querySelector('button')!;
    const computed = getComputedStyle(button);
    const bar = header.getBoundingClientRect();
    const title = box('h1');
    const back = box('a');
    const action = button.getBoundingClientRect();
    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      height: action.height,
      width: action.width,
      backWidth: back.width,
      backHeight: back.height,
      backInset: back.left - bar.left,
      actionInset: bar.right - action.right,
      titleOffset: (title.left + title.right) / 2 - (bar.left + bar.right) / 2
    };
  });
  expect(reading.backgroundColor, `${label}: text action has no fill`).toBe('rgba(0, 0, 0, 0)');
  expect(reading.color, `${label}: text copy`).toBe(await tokenColor(page, '--color-green'));
  expect(reading.fontSize, `${label}: action is --font-size-15`).toBe('15px');
  expect(reading.fontWeight, `${label}: action is bold`).toBe('700');
  expect(reading.height, `${label}: ≥44px target`).toBeGreaterThanOrEqual(44);
  expect(reading.width, `${label}: ≥44px target`).toBeGreaterThanOrEqual(44);
  expect([reading.backWidth, reading.backHeight], `${label}: 48px back target`).toEqual([48, 48]);
  expect(reading.backInset, `${label}: back sits on the 8px bar inset`).toBeCloseTo(8, 0);
  expect(reading.actionInset, `${label}: action sits on the 8px bar inset`).toBeCloseTo(8, 0);
  expect(
    Math.abs(reading.titleOffset),
    `${label}: title is centered between equal slots`
  ).toBeLessThan(1);
}

/** One sticky registration action (frames eYIgj, nNzWb, fo8Zn, SYMLa): a full-bleed white bar, last in
 * the content column, pinned to the viewport bottom, holding exactly the one existing control. */
async function assertActionBar(page: Page, label: string, action: Locator): Promise<void> {
  const bar = page.locator('[data-match-action-bar]');
  await expect(bar, `${label}: exactly one action bar`).toHaveCount(1);
  await expect(action, `${label}: the action lives in the bar`).toHaveCount(1);
  expect(await bar.getByRole('button').count(), `${label}: one control in the bar`).toBe(1);
  await bar.getByRole('button').first().scrollIntoViewIfNeeded();
  const reading = await bar.evaluate((node) => {
    const style = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    const column = node.parentElement!;
    const before = node.previousElementSibling?.getBoundingClientRect();
    window.scrollTo(0, document.documentElement.scrollHeight);
    const end = node.getBoundingClientRect();
    const endBefore = node.previousElementSibling?.getBoundingClientRect();
    window.scrollTo(0, 0);
    return {
      position: style.position,
      background: style.backgroundColor,
      isLast: column.lastElementChild === node,
      left: box.left,
      right: innerWidth - box.right,
      bottom: box.bottom,
      innerHeight,
      endGap: endBefore ? end.top - endBefore.bottom : null,
      beforeTop: before?.top ?? null
    };
  });
  expect(reading.position, `${label}: bar is sticky`).toBe('sticky');
  expect(reading.isLast, `${label}: bar is the last block of the content column`).toBe(true);
  expect(reading.background, `${label}: bar is the surface color`).toBe(
    await tokenColor(page, '--color-surface')
  );
  expect([reading.left, reading.right], `${label}: bar bleeds to both viewport edges`).toEqual([
    0, 0
  ]);
  expect(reading.bottom, `${label}: bar sits on the viewport bottom`).toBeCloseTo(
    reading.innerHeight,
    0
  );
  expect(
    reading.endGap,
    `${label}: the last content row stays reachable above the bar at the end of the page`
  ).toBeGreaterThanOrEqual(0);
}

/** Detail order (frames fo8Zn/SYMLa/tYXlh): top bar, hero, registration status, then the lower-priority participation detail. */
async function assertHeroOrder(page: Page, label: string): Promise<void> {
  const tops = await page.evaluate(() => {
    const top = (selector: string) =>
      document.querySelector(selector)?.getBoundingClientRect().top ?? null;
    return [
      top('main header'),
      top('#match-overview-heading'),
      top('#match-registration-heading'),
      top('#match-participation-heading')
    ];
  });
  for (const [index, value] of tops.entries())
    expect(value, `${label}: landmark ${index} must render`).not.toBeNull();
  const ordered = tops.map(Number);
  expect(
    ordered.every((value, index) => index === 0 || value > ordered[index - 1]!),
    `${label}: header → hero → registration → participation must read top-down (${ordered.join(', ')})`
  ).toBe(true);
}

async function assertPhotoAspectTreatment(
  page: Page,
  label: string,
  detail = false
): Promise<void> {
  // Frame photo placeholder: 132px tall (3 x --space-40 + --space-12).
  const detailHeight = detail
    ? 3 * Number.parseFloat(await tokenValue(page, '--space-40')) +
      Number.parseFloat(await tokenValue(page, '--space-12'))
    : null;
  const images = page.locator('main img');
  const count = await images.count();
  for (let index = 0; index < count; index += 1) {
    const image = images.nth(index);
    const treatment = await image.evaluate((node) => {
      if (!(node instanceof HTMLImageElement)) return null;
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        aspectRatio: style.aspectRatio,
        objectFit: style.objectFit,
        width: box.width,
        height: box.height
      };
    });
    expect(treatment, `${label}: photo ${index} must render`).not.toBeNull();
    expect(treatment!.aspectRatio, `${label}: photo ${index} aspect`).toBe(
      detail ? 'auto' : '16 / 9'
    );
    expect(treatment!.objectFit, `${label}: photo ${index} fit`).toBe('cover');
    expect(
      Math.abs(treatment!.height - (detailHeight ?? (treatment!.width * 9) / 16)),
      `${label}: photo ${index} rendered box must follow its pinned frame treatment`
    ).toBeLessThanOrEqual(1);
  }
}

// ---------------------------------------------------------------------------
// Reference-derived structural gates (F18, tightened after the F26–F30 fix round).
// Expectations below are measured from the exported Pencil references
// (e2e/references/paf-4/*.png) and the generated design tokens — never from the
// implementation. The F26–F30 deltas (18px gutter axis, 8/10px rhythm, white pill on
// the surface-2 tab track, 12px card radius, green full-width continue actions) are
// FIXED and are now asserted at their exact reference values, so a screenshot
// budget can never absorb geometry drift in either direction.
// ---------------------------------------------------------------------------

/** Normalize a color to the `rgb(r, g, b)` form getComputedStyle reports, so raw
 * token text (#0E714D) and computed styles compare equal. */
function normColor(value: string): string {
  const hexForm = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hexForm) {
    const digits = hexForm[1] ?? '';
    const expanded =
      digits.length === 3
        ? digits
            .split('')
            .map((d) => d + d)
            .join('')
        : digits;
    const int = parseInt(expanded, 16);
    return `rgb(${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255})`;
  }
  const rgbForm = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(value.trim());
  if (rgbForm && (rgbForm[4] === undefined || Number.parseFloat(rgbForm[4]) === 1))
    return `rgb(${rgbForm[1]}, ${rgbForm[2]}, ${rgbForm[3]})`;
  return value.trim();
}

async function tokenColor(page: Page, token: string): Promise<string> {
  return normColor(
    await page.evaluate(
      (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
      token
    )
  );
}

async function tokenValue(page: Page, token: string): Promise<string> {
  return (
    await page.evaluate(
      (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
      token
    )
  ).trim();
}

/** Clubhouse detail top bar title (frames eYIgj family "Match"): 17px bold in the heading face. */
async function assertHeadingTypography(page: Page, label: string): Promise<void> {
  const heading = page.locator('main h1').first();
  const style = await heading.evaluate((node) => {
    const computed = getComputedStyle(node);
    return {
      fontFamily: computed.fontFamily,
      fontSize: computed.fontSize,
      fontWeight: computed.fontWeight,
      color: computed.color
    };
  });
  expect(
    style.fontFamily.startsWith('Figtree'),
    `${label}: h1 must use the Figtree heading face`
  ).toBe(true);
  expect(style.fontSize, `${label}: h1 must be --font-size-17 (frame top bar title)`).toBe('17px');
  expect(style.fontWeight, `${label}: h1 must be bold`).toBe('700');
  expect(style.color, `${label}: h1 must render on --color-text`).toBe(
    await tokenColor(page, '--color-text')
  );
}

/** Reference measurement: primary actions render as 44px-tall #0e714d blocks with
 * near-white copy (create-details y=777..820, detail-friendly-creator y=749..792). The
 * reference copy tone is measured, not assumed: the pixel histogram of the green blocks
 * (wHaAb y=787..810, eYIgj y=749..792) holds exactly TWO colors — the green fill and
 * #f4f6f1, i.e. --color-bg, NOT pure white --color-on-hero. The implementation renders
 * --color-bg copy, so the gate pins that token exactly (token-relative so the dark-theme
 * run gates its own palette). Pre-fix these controls rendered on the surface color with
 * body copy color. */
async function assertPrimaryActionTokens(
  page: Page,
  action: Locator,
  label: string,
  copyToken: '--color-on-hero' | '--color-bg' | '--color-on-green' = '--color-bg'
): Promise<void> {
  const green = await tokenColor(page, '--color-green');
  const copy = await tokenColor(page, copyToken);
  const style = await action.evaluate((node) => {
    const computed = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      minHeight: computed.minHeight,
      height: box.height
    };
  });
  expect(
    style.backgroundColor,
    `${label}: primary action background must be --color-green (reference #0e714d)`
  ).toBe(green);
  expect(style.color, `${label}: primary action copy must be ${copyToken}`).toBe(copy);
  expect(
    Number.parseFloat(style.minHeight),
    `${label}: primary action must meet the 44px target`
  ).toBeGreaterThanOrEqual(44);
  expect(style.height, `${label}: primary action rendered height`).toBeGreaterThanOrEqual(44);
}

// ---------------------------------------------------------------------------
// Clubhouse create wizard (frames wHaAb, vAxZh, b5RR4, RDV2r) — exact structural probes plus
// hash-pinned reference frames. The predefined-team pair pickers of b5RR4 have no data source (D6):
// only the two team-mode radios exist and are asserted as such.
// ---------------------------------------------------------------------------

type WizardReferences = {
  frames: Record<string, { sha256: string }>;
  frameRegions: Record<string, Record<string, FrameRegionRecord>>;
  toleranceEvidence: Record<string, { maxDiffPixelRatio: number }>;
};
const wizardReferences: WizardReferences = JSON.parse(
  readFileSync(new URL('./references/paf-202-create-wizard/manifest.json', import.meta.url), 'utf8')
);

/** Pencil-region layer (manifest.frameRegions[regionKey]) when the frame has live controls to compare,
 * then the Chromium regression snapshot (browser-to-browser stability only). */
async function assertWizardFrame(
  page: Page,
  frame: string,
  mask: Locator[],
  regions?: { key: string; locators: Record<string, Locator> }
): Promise<void> {
  const source = readFileSync(
    new URL(`./references/paf-202-create-wizard/${frame}.png`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    wizardReferences.frames[frame]!.sha256
  );
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => document.fonts.ready);
  if (regions)
    await assertFrameRegions({
      page,
      frame: regions.key,
      reference: source,
      regions: wizardReferences.frameRegions[regions.key]!,
      locators: regions.locators,
      mask
    });
  await expect(page).toHaveScreenshot(`${frame}-light.png`, {
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: 0, width: 390, height: 844 },
    maxDiffPixelRatio: wizardReferences.toleranceEvidence[frame]!.maxDiffPixelRatio,
    mask
  });
}

/** Top bar → progress → step label order, 20px gutter on the content (not on main), 14px rhythm,
 * four 6px progress segments (green up to the current step, surface-2 after it) and the 17px bold
 * title, exactly as the frames draw them. */
async function assertWizardChrome(
  page: Page,
  label: string,
  stepIndex: number,
  stepName: string
): Promise<void> {
  await expect(page.locator('main > header h1')).toBeVisible();
  await expect(page.locator('main ol[aria-hidden="true"]')).toBeAttached();
  const green = await tokenColor(page, '--color-green');
  const track = await tokenColor(page, '--color-surface-2');
  const gutter = await tokenValue(page, '--space-20');
  const rhythm = await tokenValue(page, '--space-14');
  const reading = await page.evaluate(() => {
    const main = document.querySelector('main');
    const header = main?.querySelector(':scope > header');
    const heading = header?.querySelector('h1');
    const back = header?.firstElementChild;
    const progress = main?.querySelector('ol[aria-hidden="true"]');
    const content = progress?.parentElement;
    const stepLabel = progress?.nextElementSibling;
    if (!main || !header || !heading || !back || !progress || !content || !stepLabel) return null;
    const heads = getComputedStyle(heading);
    const contentStyle = getComputedStyle(content);
    const mainStyle = getComputedStyle(main);
    const backBox = back.getBoundingClientRect();
    return {
      mainPadding: [mainStyle.paddingLeft, mainStyle.paddingRight],
      headerTags: Array.from(header.children, (node) => node.tagName.toLowerCase()),
      headerHeight: header.getBoundingClientRect().height,
      backSize: [backBox.width, backBox.height],
      headingFont: [heads.fontFamily, heads.fontSize, heads.fontWeight, heads.color],
      contentPadding: [contentStyle.paddingLeft, contentStyle.paddingRight],
      contentGap: contentStyle.rowGap,
      segments: Array.from(progress.children, (node) => ({
        height: node.getBoundingClientRect().height,
        background: getComputedStyle(node).backgroundColor,
        state: node.getAttribute('data-step-state')
      })),
      stepLabel: stepLabel.textContent,
      order: [header, content].map((node) => node.getBoundingClientRect().top)
    };
  });
  expect(reading, `${label}: wizard chrome must render`).not.toBeNull();
  expect(reading!.mainPadding, `${label}: main carries no gutter (content owns it)`).toEqual([
    '0px',
    '0px'
  ]);
  expect(reading!.headerTags, `${label}: top bar order back → title`).toEqual([
    stepIndex > 0 ? 'button' : 'a',
    'h1'
  ]);
  expect(reading!.headerHeight, `${label}: top bar height`).toBeGreaterThanOrEqual(56);
  expect(reading!.backSize, `${label}: back control 48×48`).toEqual([48, 48]);
  expect(reading!.headingFont[0]!.startsWith('Figtree'), `${label}: h1 heading face`).toBe(true);
  expect(reading!.headingFont.slice(1, 3), `${label}: h1 17px bold (frame top bar title)`).toEqual([
    '17px',
    '700'
  ]);
  expect(normColor(reading!.headingFont[3]!), `${label}: h1 on --color-text`).toBe(
    await tokenColor(page, '--color-text')
  );
  expect(reading!.contentPadding, `${label}: content gutter is --space-20`).toEqual([
    gutter,
    gutter
  ]);
  expect(reading!.contentGap, `${label}: content rhythm is --space-14`).toBe(rhythm);
  expect(reading!.order[0]!, `${label}: top bar sits above the content`).toBeLessThan(
    reading!.order[1]!
  );
  expect(reading!.segments.length, `${label}: four progress segments`).toBe(4);
  for (const [index, segment] of reading!.segments.entries()) {
    expect(segment.height, `${label}: segment ${index} is 6px`).toBe(6);
    expect(
      segment.background,
      `${label}: segment ${index} fill (green up to and including the current step)`
    ).toBe(index <= stepIndex ? green : track);
    expect(segment.state).toBe(
      index < stepIndex ? 'done' : index === stepIndex ? 'current' : 'todo'
    );
  }
  expect(reading!.stepLabel, `${label}: step label`).toBe(
    `${en.matchCreate.stepOf.replace('{{current}}', String(stepIndex + 1)).replace('{{total}}', '4')} · ${stepName}`
  );
}

/** Sticky action bar (frames "Sticky actions"): the last block of the wizard, pinned to the bottom of
 * the viewport on surface with a hairline top border, secondary 112 min width + flexible 52px
 * primary; scrolling to the end leaves the last content block fully clear of the bar. */
async function assertWizardActions(
  page: Page,
  label: string,
  secondaryName: string,
  primaryName: string
): Promise<void> {
  const secondary = page.getByRole('button', { name: secondaryName, exact: true });
  const primary = page.getByRole('button', { name: primaryName, exact: true });
  await assertPrimaryActionTokens(page, primary, label, '--color-on-green');
  const bar = primary.locator('xpath=..');
  const surface = await tokenColor(page, '--color-surface');
  const hairline = await tokenColor(page, '--color-hairline');
  const gutter = await tokenValue(page, '--space-20');
  const probe = await bar.evaluate((node) => {
    const style = getComputedStyle(node);
    const kids = Array.from(node.children, (child) => child.getBoundingClientRect());
    const content = node.previousElementSibling;
    return {
      position: style.position,
      bottom: style.bottom,
      background: style.backgroundColor,
      borderTop: [style.borderTopWidth, style.borderTopColor],
      padding: [style.paddingLeft, style.paddingRight],
      kids: kids.map((box) => ({ width: box.width, height: box.height })),
      lastChild: node.parentElement?.lastElementChild === node,
      contentBottom: content ? content.getBoundingClientRect().bottom : null,
      barTop: node.getBoundingClientRect().top,
      barBottom: node.getBoundingClientRect().bottom,
      viewport: window.innerHeight
    };
  });
  expect(probe.position, `${label}: action bar is sticky`).toBe('sticky');
  expect(probe.bottom, `${label}: action bar pins to the bottom`).toBe('0px');
  expect(probe.lastChild, `${label}: action bar closes the wizard`).toBe(true);
  expect(normColor(probe.background), `${label}: action bar on --color-surface`).toBe(surface);
  expect(probe.borderTop[0], `${label}: hairline top border`).toBe('1px');
  expect(normColor(probe.borderTop[1]!), `${label}: hairline colour`).toBe(hairline);
  expect(probe.padding, `${label}: action bar gutter`).toEqual([gutter, gutter]);
  expect(probe.kids.length, `${label}: exactly secondary + primary`).toBe(2);
  expect(probe.kids[0]!.height, `${label}: secondary 52px`).toBe(52);
  expect(probe.kids[0]!.width, `${label}: secondary ≥112px`).toBeGreaterThanOrEqual(112);
  expect(probe.kids[1]!.height, `${label}: primary 52px`).toBe(52);
  expect(probe.kids[1]!.width, `${label}: primary takes the remaining width`).toBeGreaterThan(
    probe.kids[0]!.width
  );
  const secondaryBox = await secondary.boundingBox();
  const primaryBox = await primary.boundingBox();
  expect(secondaryBox!.x, `${label}: secondary precedes primary`).toBeLessThan(primaryBox!.x);
  // At the top of the page the bar rests on the viewport bottom, and after scrolling to the end the
  // last content block is fully clear of it.
  await page.evaluate(() => window.scrollTo(0, 0));
  const resting = await bar.evaluate((node) => node.getBoundingClientRect().bottom);
  expect(
    Math.abs(resting - probe.viewport),
    `${label}: bar rests on the viewport bottom`
  ).toBeLessThanOrEqual(1);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const cleared = await bar.evaluate((node) => {
    const content = node.previousElementSibling;
    const last = content?.lastElementChild;
    return last ? node.getBoundingClientRect().top - last.getBoundingClientRect().bottom : null;
  });
  expect(cleared, `${label}: last content block clears the sticky bar`).not.toBeNull();
  expect(cleared!, `${label}: scroll clearance`).toBeGreaterThanOrEqual(-0.5);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Reference measurement: cards are pure-white #ffffff surfaces sitting directly on
 * the page background #f4f6f1 with NO border pixel between them (the x=18 column
 * transitions straight from background to white in every list/detail/create frame —
 * re-verified by pixel probe) and a ~12px corner radius (the corner profile reaches
 * the full-left edge ~12 rows below the card top). The F26–F30 fix round closed the
 * radius delta: cards render at --radius-12 exactly, and the runtime is borderless
 * like the reference (StyleX drops the un-splittable border shorthand — see finding
 * F31). The borderless assertion is the reference truth: any future border would
 * fail here. */
async function assertCardGrouping(page: Page, label: string): Promise<void> {
  const surface = await tokenColor(page, '--color-surface');
  const radius = await tokenValue(page, '--radius-18');
  const padding = await tokenValue(page, '--space-16');
  const cards = page.locator('main article');
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const style = await cards.nth(index).evaluate((node) => {
      const computed = getComputedStyle(node);
      // Frame order: [photo] → time/price row → venue heading → chips row → participation lines.
      const kids = Array.from(node.children).filter((child) => child.tagName !== 'IMG');
      return {
        backgroundColor: computed.backgroundColor,
        borderStyle: computed.borderTopStyle,
        radius: computed.borderTopLeftRadius,
        padding: computed.paddingTop,
        tags: kids.slice(0, 4).map((child) => child.tagName),
        topHasTime: kids[0]?.querySelector('time') !== null,
        tops: kids.slice(0, 4).map((child) => child.getBoundingClientRect().top),
        priceOnTimeRow: (() => {
          const time = kids[0]?.querySelector('time')?.getBoundingClientRect();
          const price =
            kids[0]?.children.length === 2
              ? kids[0].lastElementChild?.getBoundingClientRect()
              : undefined;
          return time && price ? { timeLeft: time.left, priceLeft: price.left } : null;
        })()
      };
    });
    expect(style.backgroundColor, `${label}: card ${index} surface`).toBe(surface);
    expect(style.borderStyle, `${label}: card ${index} is borderless like the frame`).toBe('none');
    expect(style.radius, `${label}: card ${index} radius must be --radius-18`).toBe(radius);
    expect(style.padding, `${label}: card ${index} padding must be --space-16`).toBe(padding);
    expect(style.topHasTime, `${label}: card ${index} opens with the time row`).toBe(true);
    expect(style.tags[0], `${label}: card ${index} starts with the time/price row`).toBe('DIV');
    expect(style.tags[1], `${label}: card ${index} venue heading follows`).toMatch(/^H[23]$/);
    expect(style.tags[2], `${label}: card ${index} chips follow the venue`).toBe('DIV');
    expect(
      style.tops[0]! < style.tops[1]! &&
        style.tops[1]! < style.tops[2]! &&
        style.tops[2]! < style.tops[3]!,
      `${label}: card ${index} blocks must descend time/price → venue → chips → participation (got ${style.tops.join(', ')})`
    ).toBe(true);
    if (style.priceOnTimeRow)
      expect(
        style.priceOnTimeRow.priceLeft,
        `${label}: card ${index} price sits to the right of the time`
      ).toBeGreaterThan(style.priceOnTimeRow.timeLeft);
  }
}

/** Clubhouse list chrome (frames ENn8Q, kYI9H, uePpj, w25dY): 20px gutter (centered 640px column on
 * wide viewports), 28px extrabold title, a 44px --color-surface "New" action beside it, the 12px
 * rhythm between header, segments and list, and (Available/My) one day heading per group. */
async function assertListChrome(
  page: Page,
  label: string,
  options: { grouped?: boolean } = {}
): Promise<void> {
  const gutter = Number.parseFloat(await tokenValue(page, '--space-20'));
  const chrome = await page.evaluate(() => {
    const main = document.querySelector('main')!;
    const h1 = main.querySelector('h1')!;
    const action = main.querySelector('header > a')!;
    const h1Style = getComputedStyle(h1);
    const actionStyle = getComputedStyle(action);
    return {
      innerWidth: window.innerWidth,
      mainLeft: main.getBoundingClientRect().left,
      mainWidth: main.getBoundingClientRect().width,
      paddingLeft: getComputedStyle(main).paddingLeft,
      font: h1Style.fontFamily,
      size: h1Style.fontSize,
      weight: h1Style.fontWeight,
      color: h1Style.color,
      actionBackground: actionStyle.backgroundColor,
      actionColor: actionStyle.color,
      actionHeight: action.getBoundingClientRect().height,
      actionHref: action.getAttribute('href'),
      actionRight: action.getBoundingClientRect().right,
      mainRight: main.getBoundingClientRect().right,
      dayHeadings: Array.from(main.querySelectorAll('h2[id^="matches-day-"]')).map(
        (node) => node.textContent
      ),
      groupedArticles: main.querySelectorAll('section[aria-labelledby^="matches-day-"] article')
        .length,
      articles: main.querySelectorAll('article').length,
      venueLevels: Array.from(main.querySelectorAll('article h2, article h3')).map(
        (node) => node.tagName
      )
    };
  });
  expect(chrome.paddingLeft, `${label}: main gutter must be --space-20`).toBe(
    await tokenValue(page, '--space-20')
  );
  expect(chrome.mainWidth, `${label}: column is at most 640px`).toBeLessThanOrEqual(640);
  expect(chrome.mainLeft + chrome.mainWidth / 2, `${label}: column stays centered`).toBeCloseTo(
    chrome.innerWidth / 2,
    0
  );
  // The global language/theme chips float top-right, so the header reserves their width.
  const reserve =
    2 * Number.parseFloat(await tokenValue(page, '--space-40')) +
    3 * Number.parseFloat(await tokenValue(page, '--space-8'));
  expect(
    chrome.mainRight - chrome.actionRight,
    `${label}: New action stays clear of the global chips`
  ).toBeGreaterThanOrEqual(gutter + reserve - 0.5);
  expect(chrome.font.startsWith('Figtree'), `${label}: h1 uses Figtree`).toBe(true);
  expect(chrome.size, `${label}: h1 is --font-size-28 (frame 30px, nearest token)`).toBe('28px');
  expect(chrome.weight, `${label}: h1 is extrabold`).toBe('800');
  expect(chrome.color, `${label}: h1 renders on --color-text`).toBe(
    await tokenColor(page, '--color-text')
  );
  expect(chrome.actionHref, `${label}: New action creates a match`).toBe('/matches/create');
  expect(chrome.actionBackground, `${label}: New action is the surface button`).toBe(
    await tokenColor(page, '--color-surface')
  );
  expect(chrome.actionColor, `${label}: New action copy`).toBe(
    await tokenColor(page, '--color-text')
  );
  expect(chrome.actionHeight, `${label}: New action is the 44px frame button`).toBeCloseTo(44, 0);
  await assertRhythm(page, label, 'main', '--space-12');
  if (options.grouped) {
    expect(chrome.dayHeadings.length, `${label}: at least one day heading`).toBeGreaterThan(0);
    expect(chrome.groupedArticles, `${label}: every card sits under a day heading`).toBe(
      chrome.articles
    );
    expect(new Set(chrome.venueLevels), `${label}: grouped venue headings are h3`).toEqual(
      new Set(['H3'])
    );
  } else {
    expect(chrome.dayHeadings, `${label}: Past is flat, no day headings`).toEqual([]);
    expect(new Set(chrome.venueLevels), `${label}: flat venue headings are h2`).toEqual(
      chrome.articles > 0 ? new Set(['H2']) : new Set()
    );
  }
}

type MatchesReferences = {
  frames: Record<string, { sha256: string }>;
  frameRegions: Record<string, Record<string, FrameRegionRecord>>;
  toleranceEvidence: Record<string, { maxDiffPixelRatio: number }>;
};
const matchesReferences: MatchesReferences = JSON.parse(
  readFileSync(new URL('./references/paf-202-matches/manifest.json', import.meta.url), 'utf8')
);

/** Fixture instants move with the clock, so times and day rows are masked in baselines. */
function dynamicMask(page: Page): Locator[] {
  return [
    page.locator('main time'),
    page.locator('main section[aria-labelledby^="matches-day-"] > div:first-child')
  ];
}

/** Live regions compared with the same region of the Pencil export (design layer). The card is
 * the first article, or the empty-state section when the list has none. */
function frameRegionLocators(page: Page, frame: string): Record<string, Locator> {
  const card = frame === 'kYI9H' ? page.locator('main > section') : page.locator('main article');
  return {
    title: page.locator('main h1'),
    newAction: page.locator('main a[href="/matches/create"]'),
    tabs: page.locator('main nav'),
    bottomNav: page.locator('nav[data-app-nav]'),
    card,
    cardEdge: card
  };
}

/** Two layers per Clubhouse frame. The Pencil export is hash-pinned and compared region by region
 * with the live page (design layer, manifest.frameRegions: gated regions carry measured budgets,
 * finding regions record real divergences and are never masked). The Chromium snapshot below is the
 * browser regression layer: fixture dates, times and history rows differ from the sample data, so
 * those are masked and the exact structural probes carry the layout assertions. */
async function assertMatchesFrame(page: Page, frame: string, mask: Locator[]): Promise<void> {
  const source = readFileSync(
    new URL(`./references/paf-202-matches/${frame}.png`, import.meta.url)
  );
  expect(createHash('sha256').update(source).digest('hex')).toBe(
    matchesReferences.frames[frame]!.sha256
  );
  await page.evaluate(() => document.fonts.ready);
  await assertFrameRegions({
    page,
    frame,
    reference: source,
    regions: matchesReferences.frameRegions[frame]!,
    locators: frameRegionLocators(page, frame),
    mask
  });
  // Fixture instants move with the clock, so the masked <time> box width (and the zone label beside
  // it) varied with the hour of the run. Pin the text after the region/structure probes ran.
  await page.locator('main time').evaluateAll((times) => {
    for (const time of times) time.textContent = '00:00 AM';
  });
  await expect(page).toHaveScreenshot(`${frame}-light.png`, {
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: 0, width: 390, height: 844 },
    maxDiffPixelRatio: matchesReferences.toleranceEvidence[frame]!.maxDiffPixelRatio,
    mask
  });
}

/** Reference measurement: every frame aligns all content blocks to one shared
 * horizontal axis inset exactly 18px per side at 390px (11/11 frames measured,
 * re-verified by pixel probe: leftmost content x=18, rightmost x=371=390-1-18).
 * F26 is fixed: all three surfaces (list, detail, create) pad main with the
 * --space-18 token exactly, and every main child sits on that shared axis. The
 * child inset is asserted as padding + measured border per side, so a future
 * border on the detail surface could not silently shift the axis. */
async function assertGutterAxis(
  page: Page,
  label: string,
  insetToken: '--space-18' | '--space-20',
  container: 'main' | 'main > div' = 'main'
): Promise<void> {
  const expectedInset = await tokenValue(page, insetToken);
  const metrics = await page.evaluate((selector) => {
    const main = document.querySelector(selector);
    if (!main) return null;
    const innerWidth = window.innerWidth;
    const mainStyle = getComputedStyle(main);
    return {
      innerWidth,
      paddingLeft: mainStyle.paddingLeft,
      paddingRight: mainStyle.paddingRight,
      borderLeft: mainStyle.borderLeftWidth,
      borderRight: mainStyle.borderRightWidth,
      // The sticky action bar bleeds past the gutter by design; assertActionBar owns its geometry.
      blocks: Array.from(main.children)
        .filter((node) => !node.hasAttribute('data-match-action-bar'))
        .map((node) => {
          const box = node.getBoundingClientRect();
          return { left: box.left, right: innerWidth - box.right };
        })
    };
  }, container);
  expect(metrics, `${label}: main must be present`).not.toBeNull();
  expect(
    metrics!.paddingLeft,
    `${label}: main gutter must equal ${insetToken} exactly (reference 18px shared axis, F26 fixed)`
  ).toBe(expectedInset);
  expect(metrics!.paddingRight, `${label}: main gutter must be symmetric`).toBe(expectedInset);
  const inset =
    Number.parseFloat(expectedInset) + Math.max(Number.parseFloat(metrics!.borderLeft), 0);
  const insetRight =
    Number.parseFloat(expectedInset) + Math.max(Number.parseFloat(metrics!.borderRight), 0);
  for (const [index, block] of metrics!.blocks.entries()) {
    expect(block.left, `${label}: block ${index} must start on the shared left axis`).toBeCloseTo(
      inset,
      0
    );
    expect(block.right, `${label}: block ${index} must end on the shared right axis`).toBeCloseTo(
      insetRight,
      0
    );
  }
}

/** Reference measurement: sibling cards on the listings sit 8px apart
 * (available-populated card extents 243..369 / 378..504), detail section cards 7–8px
 * (eYIgj 376..367-adjacent, JLqMT), and create-flow section cards 10px (wHaAb extents
 * 114..336 / 347..631 / 642..766). F27 is fixed: the list and detail grids pin the
 * --space-8 token and the create grids the --space-10 token exactly — the pre-fix
 * --space-4/--space-5 rhythms fail this gate.
 *
 * Rendered-geometry gate (F18 completion): the declared token alone cannot prove the
 * rendered rhythm — a margin-driven spacing (UA margins on bare children, or margins
 * swapped in for the gap) leaves `rowGap` untouched while the real boxes drift apart,
 * and the screenshot budget would absorb it. So this gate measures the RENDERED
 * geometry with getBoundingClientRect(): (a) no measured child carries a vertical
 * margin — the token gap is the only spacing mechanism on the rhythm axis; (b) the
 * real vertical distance between every pair of consecutive siblings equals the token
 * exactly (±0.05px, well under LayoutUnit resolution but far outside any margin
 * contribution); (c) the container's content box wraps the children exactly — the
 * first child sits on the content top edge and the last on the content bottom edge,
 * so no hidden container padding contributes to the grouping boundaries. Together
 * with the retained rowGap token assertion, any margin-based re-implementation fails
 * here independent of the screenshot budgets. */
async function assertRhythm(
  page: Page,
  label: string,
  selector: string,
  token: '--space-8' | '--space-10' | '--space-12' | '--space-14'
): Promise<void> {
  const expected = await tokenValue(page, token);
  const expectedPx = Number.parseFloat(expected);
  const measured = await page.evaluate((target) => {
    const container = document.querySelector(target);
    if (!container) return null;
    const containerStyle = getComputedStyle(container);
    const containerBox = container.getBoundingClientRect();
    // The sticky action bar is spaced by auto/negative margins and owned by assertActionBar.
    const hasBar = container.querySelector(':scope > [data-match-action-bar]') !== null;
    const children = Array.from(container.children)
      .filter((node): node is Element => node instanceof Element)
      .filter((node) => !node.hasAttribute('data-match-action-bar'))
      .filter((node) => {
        const display = getComputedStyle(node).display;
        return display !== 'none' && display !== 'contents';
      })
      .map((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          top: box.top,
          bottom: box.bottom,
          marginTop: Number.parseFloat(style.marginTop),
          marginBottom: Number.parseFloat(style.marginBottom)
        };
      });
    return {
      rowGap: containerStyle.rowGap,
      borderTop: Number.parseFloat(containerStyle.borderTopWidth),
      borderBottom: Number.parseFloat(containerStyle.borderBottomWidth),
      paddingTop: Number.parseFloat(containerStyle.paddingTop),
      paddingBottom: Number.parseFloat(containerStyle.paddingBottom),
      containerTop: containerBox.top,
      containerBottom: containerBox.bottom,
      hasBar,
      children
    };
  }, selector);
  expect(measured, `${label}: ${selector} rhythm container must exist`).not.toBeNull();
  const problems: string[] = [];
  const require = (condition: boolean, message: string): void => {
    if (!condition) problems.push(message);
  };
  require(measured!.rowGap ===
    expected, `${label}: ${selector} rhythm must equal ${token} exactly (reference 8px list/detail, 10px create — F27 fixed)`);
  for (const [index, child] of measured!.children.entries()) {
    require(child.marginTop ===
      0, `${label}: ${selector} child ${index} (${child.tag}) must carry no margin-top — the ${token} gap is the only spacing mechanism (rendered-geometry gate)`);
    require(child.marginBottom ===
      0, `${label}: ${selector} child ${index} (${child.tag}) must carry no margin-bottom — the ${token} gap is the only spacing mechanism (rendered-geometry gate)`);
  }
  if (measured!.children.length > 0) {
    const contentTop = measured!.containerTop + measured!.borderTop + measured!.paddingTop;
    const contentBottom =
      measured!.containerBottom - measured!.borderBottom - measured!.paddingBottom;
    require(numberClose(
      measured!.children[0]!.top,
      contentTop
    ), `${label}: first ${selector} child must sit on the container content top edge (rendered grouping boundary; got ${measured!.children[0]!.top} vs ${contentTop})`);
    const last = measured!.children[measured!.children.length - 1]!;
    if (!measured!.hasBar)
      require(numberClose(
        last.bottom,
        contentBottom
      ), `${label}: last ${selector} child (${last.tag}) must sit on the container content bottom edge (rendered grouping boundary; got ${last.bottom} vs ${contentBottom})`);
  }
  for (let index = 1; index < measured!.children.length; index += 1) {
    const previous = measured!.children[index - 1]!;
    const current = measured!.children[index]!;
    require(numberClose(
      current.top - previous.bottom,
      expectedPx
    ), `${label}: rendered distance between ${selector} siblings ${index - 1}→${index} (${previous.tag}→${current.tag}) must equal the ${token} gap exactly, not gap+margin (rendered-geometry gate; got ${current.top - previous.bottom} vs ${expectedPx})`);
  }
  if (problems.length === 0) return;
  expect(
    problems,
    `${label}: rendered rhythm geometry must match the pinned token system with zero margin contribution`
  ).toEqual([]);
}

/** Sub-LayoutUnit resolution tolerance: distances must equal the token exactly; only
 * float accumulation noise (≪0.05px) is tolerated. Any real margin shows up in the
 * first decimal and fails. */
function numberClose(measured: number, expected: number): boolean {
  return Math.abs(measured - expected) < 0.05;
}

async function assertTabSet(
  page: Page,
  copy: Copy,
  active: 'available' | 'my' | 'past'
): Promise<void> {
  const nav = page.getByRole('navigation', { name: copy.matches.navigationLabel });
  const tabs = nav.getByRole('link');
  await expect(tabs).toHaveCount(3);
  const labels = ['available', 'my', 'past'] as const;
  // aria-current="page" must appear on the active segment ONLY within the page content.
  await expect(
    page.locator('main [aria-current="page"]'),
    'exactly one segment carries aria-current="page" inside main (the app shell nav marks Matches itself)'
  ).toHaveCount(1);
  // Frames ENn8Q/uePpj/w25dY: a 56px --color-surface-2 track (4px inset) holds three 48px
  // segments; the active one is the only --color-surface pill with --color-text copy, inactive
  // labels are --color-muted on the bare track; every label is bold.
  const track = await tokenColor(page, '--color-surface-2');
  const pill = await tokenColor(page, '--color-surface');
  const text = await tokenColor(page, '--color-text');
  const muted = await tokenColor(page, '--color-muted');
  const trackTreatment = await nav.evaluate((node) => {
    const computed = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      background: computed.backgroundColor,
      height: box.height,
      padding: computed.paddingTop,
      radius: computed.borderTopLeftRadius
    };
  });
  expect(trackTreatment.background, 'segment track must be --color-surface-2').toBe(track);
  expect(trackTreatment.height, 'segment track must be the 56px frame row').toBeCloseTo(56, 0);
  expect(trackTreatment.padding, 'segment track inset must be --space-4').toBe(
    await tokenValue(page, '--space-4')
  );
  expect(trackTreatment.radius, 'segment track radius must be --radius-14').toBe(
    await tokenValue(page, '--radius-14')
  );
  for (const [index, tab] of labels.entries()) {
    await expect(tabs.nth(index)).toHaveAccessibleName(copy.matches.tabs[tab]);
    const treatment = await tabs.nth(index).evaluate((node) => {
      const computed = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        ariaCurrent: node.getAttribute('aria-current'),
        background: computed.backgroundColor,
        color: computed.color,
        weight: computed.fontWeight,
        height: box.height,
        radius: computed.borderTopLeftRadius
      };
    });
    expect(treatment.height, `segment ${tab} must be the 48px frame segment`).toBeCloseTo(48, 0);
    expect(treatment.weight, `segment ${tab} label must be bold`).toBe('700');
    expect(treatment.radius, `segment ${tab} radius must be --radius-11`).toBe(
      await tokenValue(page, '--radius-11')
    );
    if (tab === active) {
      await expect(tabs.nth(index)).toHaveAttribute('aria-current', 'page');
      expect(treatment.background, 'active segment must carry the --color-surface pill').toBe(pill);
      expect(treatment.color, 'active segment copy must be --color-text').toBe(text);
    } else {
      expect(
        treatment.ariaCurrent,
        `inactive segment ${tab} must not carry aria-current`
      ).toBeNull();
      expect(treatment.background, `inactive segment ${tab} must stay unpilled`).toBe(
        'rgba(0, 0, 0, 0)'
      );
      expect(treatment.color, `inactive segment ${tab} copy must be --color-muted`).toBe(muted);
    }
  }
}

async function assertFocusRing(page: Page, label: string): Promise<void> {
  const ring = await page.evaluate((selector) => {
    const active = document.activeElement;
    if (!(active instanceof Element)) return null;
    const style = getComputedStyle(active);
    return {
      matches: active.matches(selector),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
      outlineColor: style.outlineColor
    };
  }, ':focus-visible');
  expect(ring, `${label}: keyboard focus must land on a focusable element`).not.toBeNull();
  expect(ring!.matches, `${label}: active element must be focus-visible`).toBe(true);
  expect(ring!.outlineStyle, `${label}: visible focus ring style`).toBe('solid');
  // Clubhouse focus ring: --focus-width (3px) solid --color-focus.
  expect(ring!.outlineWidth, `${label}: focus ring must be the Clubhouse --focus-width token`).toBe(
    Number.parseFloat(await tokenValue(page, '--focus-width'))
  );
  await test.info().attach(`${label} — measured focus ring`, {
    body: `${ring!.outlineWidth}px ${ring!.outlineStyle} ${ring!.outlineColor} (Clubhouse --focus-width ring)`
  });
}

/** Keyboard reachability: Tab from the document start must reach the matches tab set with
 * a visible focus ring; focus is released afterwards so screenshots stay neutral. */
async function assertTabsKeyboardReachable(page: Page, copy: Copy): Promise<void> {
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur()
  );
  let reached = false;
  for (let presses = 0; presses < 5 && !reached; presses += 1) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(
      (label) => document.activeElement?.closest('nav')?.getAttribute('aria-label') === label,
      copy.matches.navigationLabel
    );
  }
  expect(reached, 'the matches tab set must be keyboard-reachable').toBe(true);
  await assertFocusRing(page, 'matches tabs');
  await page.evaluate(
    () => document.activeElement instanceof HTMLElement && document.activeElement.blur()
  );
}

/** The counts line must carry the exact localized participation facts. */
async function assertLocalizedCountText(
  scope: Locator,
  copy: Copy,
  locale: 'en' | 'pt-BR' | 'es',
  accepted: number
): Promise<void> {
  const plural = (key: 'playing' | 'reserve' | 'groups' | 'moreNeeded', count: number): string => {
    const form = new Intl.PluralRules(locale).select(count);
    return `${count} ${copy.matches.counts[`${key}_${form}`] ?? copy.matches.counts[`${key}_other`]}`;
  };
  const expected = [
    plural('playing', Math.floor(accepted / 4) * 4),
    plural('reserve', accepted % 4),
    plural('groups', Math.floor(accepted / 4)),
    plural('moreNeeded', 4 - (accepted % 4))
  ].join(' · ');
  await expect(scope.getByText(expected, { exact: true })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Fixtures: deterministic actors, one public community, five staged events.
// Display names, venue names, prices, instants and the community name are fixed
// so every rendered string is deterministic; start-instant text is additionally
// masked in screenshots because the underlying instants move with the clock.
// ---------------------------------------------------------------------------

const family: {
  host?: Actor;
  member?: Actor;
  invitee?: Actor;
  guest?: Actor;
  communityId?: string;
  competitiveId?: string;
  reserveId?: string;
  friendlyId?: string;
  invitedId?: string;
  elapsedId?: string;
  contexts: BrowserContext[];
} = { contexts: [] };

const VENUES = {
  competitive: 'Padelclubgemeinschaftszentrum',
  reserve: 'Arena Duarte',
  friendly: 'Corte Luminosa',
  invited: 'Society Privada',
  elapsed: 'Sala Cronos'
};

type StoredFixtures = {
  hostEmail: string;
  memberEmail: string;
  inviteeEmail: string;
  guestEmail: string;
  communityId: string;
  competitiveId: string;
  reserveId: string;
  friendlyId: string;
  invitedId: string;
  elapsedId: string;
};

// Serial mode restarts the worker after a failure; the fixture identity (fixed display
// names, one shared community, five events) is persisted so the remaining tests restore
// the same fixtures instead of duplicating them in a fresh worker. The local database is
// pruned by e2e/global-setup.ts on every run, so restore always verifies event rows and
// recreates whatever the prune removed.
function storedFixturesPath(): URL {
  return new URL('../test-results/matches-visual-fixtures.json', import.meta.url);
}

function readStoredFixtures(): StoredFixtures | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(storedFixturesPath(), 'utf8'));
    if (
      !isRecord(raw) ||
      typeof raw.hostEmail !== 'string' ||
      typeof raw.memberEmail !== 'string' ||
      typeof raw.inviteeEmail !== 'string' ||
      typeof raw.guestEmail !== 'string' ||
      typeof raw.communityId !== 'string' ||
      typeof raw.competitiveId !== 'string' ||
      typeof raw.reserveId !== 'string' ||
      typeof raw.friendlyId !== 'string' ||
      typeof raw.invitedId !== 'string' ||
      typeof raw.elapsedId !== 'string'
    )
      return null;
    return {
      hostEmail: raw.hostEmail,
      memberEmail: raw.memberEmail,
      inviteeEmail: raw.inviteeEmail,
      guestEmail: raw.guestEmail,
      communityId: raw.communityId,
      competitiveId: raw.competitiveId,
      reserveId: raw.reserveId,
      friendlyId: raw.friendlyId,
      invitedId: raw.invitedId,
      elapsedId: raw.elapsedId
    };
  } catch {
    return null;
  }
}

function writeStoredFixtures(): void {
  writeFileSync(
    storedFixturesPath(),
    JSON.stringify(
      {
        hostEmail: family.host!.email,
        memberEmail: family.member!.email,
        inviteeEmail: family.invitee!.email,
        guestEmail: family.guest!.email,
        communityId: family.communityId!,
        competitiveId: family.competitiveId!,
        reserveId: family.reserveId!,
        friendlyId: family.friendlyId!,
        invitedId: family.invitedId!,
        elapsedId: family.elapsedId!
      },
      null,
      1
    )
  );
}

async function signInWithPassword(email: string, displayName: string): Promise<Actor> {
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await client.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.user) throw session.error ?? new Error('no user');
  const claims = await client.auth.getClaims();
  const id = claims.data?.claims?.sub;
  if (typeof id !== 'string') throw new Error(`No subject claim for ${displayName}`);
  return { id, email, displayName, client };
}

async function eventExists(actor: Actor, eventId: string): Promise<boolean> {
  const row = await actor.client.from('match_events').select('id').eq('id', eventId).maybeSingle();
  return !row.error && row.data !== null;
}

async function publishCompetitiveFixture(
  host: Actor,
  communityId: string,
  eventId: string
): Promise<void> {
  await publishFixture(
    host,
    eventId,
    publishInput(communityId, {
      date: ymd(2),
      startTime: '10:00',
      eventType: 'competitive',
      visibility: 'community_open',
      teamMode: 'POST_MATCH_TEAMS',
      venueName: VENUES.competitive,
      mapsUrl: 'https://maps.google.com/maps/place/padelclub',
      photoPath: await stagePhoto(host, communityId, eventId),
      price: '7.5'
    })
  );
}

async function publishReserveFixture(
  host: Actor,
  communityId: string,
  eventId: string
): Promise<void> {
  await publishFixture(
    host,
    eventId,
    publishInput(communityId, {
      date: ymd(2),
      startTime: '15:00',
      eventType: 'friendly',
      visibility: 'community_open',
      teamMode: 'POST_MATCH_TEAMS',
      venueName: VENUES.reserve,
      mapsUrl: 'https://maps.google.com/maps/place/arena-duarte',
      photoPath: await stagePhoto(host, communityId, eventId)
    })
  );
}

async function ensureReserveRegistration(member: Actor, reserveId: string): Promise<void> {
  // Second accepted registration (trusted fixture insert): the host keeps FIFO #1, the
  // member lands in the reserve segment (2 accepted → 0 playing / 2 reserve) and must
  // see the personal RESERVE badge. The anchors CHECK requires the accepted row to
  // carry order/status/source, and the event's next accepted ordinal must advance
  // past the fixture's order so PAF-5.2 allocations cannot collide with it.
  const existing = await member.client
    .from('match_event_registrations')
    .select('user_id')
    .eq('match_event_id', reserveId)
    .eq('user_id', member.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  await fixtureSql(
    `insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) ` +
      `values ('${reserveId}','${member.id}', now() + interval '2 seconds', 2, 'reserve', 'member'); ` +
      `insert into public.match_event_registration_attempts ` +
      `(registration_id,match_event_id,user_id,outcome,registration_source,requested_at,decided_at,accepted_at,accepted_order,required_generation,confirmed_generation) ` +
      `select id,match_event_id,user_id,lifecycle,registration_source,accepted_at,accepted_at,accepted_at,accepted_order,0,0 ` +
      `from public.match_event_registrations where match_event_id='${reserveId}' and current_attempt_id is null; ` +
      `update public.match_event_registrations r set current_attempt_id=a.id from public.match_event_registration_attempts a ` +
      `where a.registration_id=r.id and r.match_event_id='${reserveId}' and r.current_attempt_id is null; ` +
      `update public.match_event_registration_state set next_accepted_ordinal = 3 where match_event_id = '${reserveId}';`
  );
}

async function publishFriendlyFixture(
  host: Actor,
  communityId: string,
  eventId: string
): Promise<void> {
  await publishFixture(
    host,
    eventId,
    publishInput(communityId, {
      date: ymd(3),
      startTime: '19:30',
      eventType: 'friendly',
      visibility: 'community_open',
      teamMode: 'PREDEFINED_TEAMS',
      venueName: VENUES.friendly,
      mapsUrl: 'https://maps.google.com/maps/place/corte-luminosa',
      photoPath: await stagePhoto(host, communityId, eventId),
      price: '12',
      maximum: 16
    })
  );
}

async function publishInvitedFixture(
  host: Actor,
  communityId: string,
  eventId: string,
  invitee: Actor
): Promise<void> {
  await publishFixture(
    host,
    eventId,
    publishInput(communityId, {
      date: ymd(4),
      startTime: '11:00',
      eventType: 'competitive',
      visibility: 'invite_only',
      teamMode: 'PREDEFINED_TEAMS',
      venueName: VENUES.invited,
      mapsUrl: 'https://maps.google.com/maps/place/society-privada',
      photoPath: await stagePhoto(host, communityId, eventId),
      price: '9.9'
    }),
    [invitee.id]
  );
}

async function ensureElapsedFixture(
  host: Actor,
  communityId: string,
  eventId: string
): Promise<void> {
  const elapsedPhoto = await stagePhoto(host, communityId, eventId);
  await fixtureSql(
    `alter table public.match_events disable trigger match_event_creator_registration; ` +
      `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,price_minor,currency) ` +
      `values ('${eventId}','${communityId}','${host.id}', now() - interval '26 hours','UTC','friendly','community_open','PREDEFINED_TEAMS','${VENUES.elapsed}','https://maps.google.com/maps/place/sala-cronos','${elapsedPhoto}', now() - interval '27 hours', 1000,'EUR'); ` +
      `alter table public.match_events enable trigger match_event_creator_registration;`
  );
}

async function ensureListFixtures(): Promise<void> {
  if (family.host && family.member && family.invitee && family.guest) return;
  const stored = readStoredFixtures();
  if (stored) {
    try {
      family.host = await signInWithPassword(stored.hostEmail, 'Marina Alves');
      family.member = await signInWithPassword(stored.memberEmail, 'Rafael Nunes');
      family.invitee = await signInWithPassword(stored.inviteeEmail, 'Beatriz Costa');
      family.guest = await signInWithPassword(stored.guestEmail, 'Pedro Alvarenga');
      family.communityId = stored.communityId;
      await pinCommunityUtc(family.communityId);
      family.competitiveId = stored.competitiveId;
      family.reserveId = stored.reserveId;
      family.friendlyId = stored.friendlyId;
      family.invitedId = stored.invitedId;
      family.elapsedId = stored.elapsedId;
      const host = family.host;
      const community = await host.client
        .from('communities')
        .select('id')
        .eq('id', family.communityId)
        .maybeSingle();
      if (community.error || !community.data) throw new Error('stored community is missing');
      if (!(await eventExists(host, family.competitiveId)))
        await publishCompetitiveFixture(host, family.communityId, family.competitiveId);
      if (!(await eventExists(host, family.reserveId)))
        await publishReserveFixture(host, family.communityId, family.reserveId);
      await ensureReserveRegistration(family.member, family.reserveId);
      if (!(await eventExists(host, family.friendlyId)))
        await publishFriendlyFixture(host, family.communityId, family.friendlyId);
      if (!(await eventExists(host, family.invitedId)))
        await publishInvitedFixture(host, family.communityId, family.invitedId, family.invitee);
      if (!(await eventExists(host, family.elapsedId)))
        await ensureElapsedFixture(host, family.communityId, family.elapsedId);
      return;
    } catch {
      // Stale or unusable state (for example an actor deleted between runs): rebuild
      // everything from scratch below.
      family.host = undefined;
      family.member = undefined;
      family.invitee = undefined;
      family.guest = undefined;
    }
  }

  family.host = await createActor('Marina Alves');
  family.member = await createActor('Rafael Nunes');
  family.invitee = await createActor('Beatriz Costa');
  family.guest = await createActor('Pedro Alvarenga');
  family.communityId = await createPublicCommunity(family.host);
  await joinAsActiveMember(family.communityId, family.member);
  await joinAsActiveMember(family.communityId, family.invitee);
  const host = family.host;
  const communityId = family.communityId;

  // The two earliest events own the above-the-fold region of Available, in starts_at
  // order, so the viewport capture stays deterministic even when parallel suites own
  // later-dated rows.
  family.competitiveId = crypto.randomUUID();
  await publishCompetitiveFixture(host, communityId, family.competitiveId);

  family.reserveId = crypto.randomUUID();
  await publishReserveFixture(host, communityId, family.reserveId);
  await ensureReserveRegistration(family.member, family.reserveId);

  family.friendlyId = crypto.randomUUID();
  await publishFriendlyFixture(host, communityId, family.friendlyId);

  family.invitedId = crypto.randomUUID();
  await publishInvitedFixture(host, communityId, family.invitedId, family.invitee);

  family.elapsedId = crypto.randomUUID();
  await ensureElapsedFixture(host, communityId, family.elapsedId);
  writeStoredFixtures();
}

async function createFillerEvents(): Promise<void> {
  // Push the Available listing past its limit-20 page so the Load-more affordance (and
  // its loading/offline states) is reachable through real pagination.
  const host = family.host!;
  const communityId = family.communityId!;
  const existing = await host.client
    .from('match_events')
    .select('venue_name')
    .like('venue_name', 'Corte Reserva %');
  if (existing.error) throw existing.error;
  if (existing.data.length >= 18) return;
  // Each filler stages its own draft key (community/event/uploader/object with the event
  // segment equal to the event id, as the publication binding requires) while the draft
  // UUID is still unpublished.
  const inserts: string[] = [];
  for (let index = existing.data.length; index < 18; index += 1) {
    const id = crypto.randomUUID();
    const photoPath = await stagePhoto(host, communityId, id);
    const minutes = 10 * 1440 + index * 37;
    inserts.push(
      `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)` +
        ` values ('${id}','${communityId}','${host.id}', now() + interval '${minutes} minutes','UTC','friendly','community_open','POST_MATCH_TEAMS','Corte Reserva ${index + 1}','https://maps.google.com/maps/place/reserva-${index + 1}','${photoPath}', now() + interval '${minutes - 60} minutes');`
    );
  }
  await fixtureSql(
    `alter table public.match_events disable trigger match_event_creator_registration; ` +
      inserts.join(' ') +
      ` alter table public.match_events enable trigger match_event_creator_registration;`
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

test.describe.serial('PAF-4 match event visual and structural QA', () => {
  test.beforeAll(() => {
    test.setTimeout(240_000);
  });

  test('create wizard — Details, Players and Team mode match the approved frames', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    const host = await createActor('Marina Alves');
    await createPublicCommunity(host);
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, host);

    await page.goto('/matches/create');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: en.matchCreate.title })).toBeVisible();

    // Top bar → progress → step label order, four progress segments (frame wHaAb).
    await assertWizardChrome(page, 'create details 390', 0, en.matchCreate.steps.details);

    // Exactly the two scoped types as the frame segmented control (Friendly first, selected);
    // no Ranked/League state while Friendly.
    const typeGroup = page.getByRole('radiogroup', { name: en.matchCreate.fields.type });
    await expect(typeGroup.getByRole('radio')).toHaveText([
      en.matches.type.friendly,
      en.matches.type.competitive
    ]);
    await expect(typeGroup.getByRole('radio', { name: en.matches.type.friendly })).toBeChecked();
    await expect(page.getByText(/ranked|league/i)).toHaveCount(0);

    // Field order: community → date → start time → price → currency → saved venue → venue name →
    // Maps → court notes → duration → notes → booked → payment note → cutoff, then the photo
    // upload (visibility, maximum registrations and level range moved to the Players step). The
    // sequence of rendered label captions is asserted exactly.
    const expectedLabelOrder = [
      en.matchCreate.fields.community,
      en.matchCreate.fields.date,
      en.matchCreate.fields.startTime,
      en.matchCreate.fields.price,
      en.matchCreate.fields.currency,
      en.matchCreate.fields.savedVenue,
      en.matchCreate.fields.venueName,
      en.matchCreate.fields.mapsUrl,
      en.matchCreate.fields.courtNotes,
      en.matchCreate.fields.duration,
      en.matchCreate.fields.notes,
      en.matchCreate.fields.courtBooked,
      en.matchCreate.fields.paymentNote,
      en.matchCreate.fields.cutoff,
      en.matchCreate.fields.photo
    ];
    const renderedLabelOrder = await page
      .locator('main label')
      .evaluateAll((labels) =>
        labels
          .map((label) =>
            (
              Array.from(label.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)
                ?.textContent ?? ''
            ).trim()
          )
          .filter((caption) => caption.length > 0)
      );
    expect(renderedLabelOrder, 'create Details field order').toEqual(expectedLabelOrder);
    const photoBox = await page.getByLabel(en.matchCreate.fields.photo).boundingBox();
    const cutoffBox = await page.getByLabel(en.matchCreate.fields.cutoff).boundingBox();
    expect(photoBox!.y, 'photo upload must close the Details step').toBeGreaterThan(cutoffBox!.y);
    await expect(
      page.getByText(`${en.matchCreate.fields.timezone}: UTC`, { exact: false })
    ).toBeVisible();

    // The community select carries the fixture community (first select in the form).
    const communityName = await page
      .locator('main label select')
      .first()
      .evaluate((select) =>
        select instanceof HTMLSelectElement ? (select.selectedOptions[0]?.textContent ?? '') : ''
      );
    expect(communityName).toBe('Vale Padel Society');

    await assertWizardActions(
      page,
      'create details 390',
      en.matchCreate.cancel,
      en.matchCreate.next
    );
    await assertNoHorizontalOverflow(page, 'create details 390');
    // The suggested days are weekend dates relative to today, so the chips are masked in the
    // Chromium snapshot; the Pencil-region layer below still records their raw geometry.
    const suggestedDays = page.getByRole('radiogroup', {
      name: en.matchCreate.helpers.suggestedDays
    });
    await assertWizardFrame(page, 'wHaAb', [suggestedDays], {
      key: 'wHaAb:details',
      locators: {
        dateChips: suggestedDays,
        timePrice: page
          .locator('main label')
          .filter({ has: page.locator('input[type="time"]') })
          .locator('xpath=..')
      }
    });
    await assertCheckboxLabelTargets(page, en, 'create details 390');
    await assertPrimaryHitTargets(page, 'create details 390');

    const darkContext = await newContext(browser, { theme: 'dark' });
    const darkPage = await darkContext.newPage();
    await signIn(darkPage, host);
    await darkPage.goto('/matches/create');
    await ready(darkPage);
    expect(await darkPage.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await assertWizardChrome(darkPage, 'create details dark', 0, en.matchCreate.steps.details);
    await assertNoHorizontalOverflow(darkPage, 'create details dark');
    await darkContext.close();

    // Players step: member search with no preselected chips (no fake participants).
    await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await assertWizardChrome(page, 'create players 390', 1, en.matchCreate.steps.players);
    // Wizard navigation moves focus into the form for keyboard users: the first Format radio (no
    // maximum yet, so none is checked).
    await expect(
      page
        .getByRole('radiogroup', { name: en.matchCreate.players.format })
        .getByRole('radio')
        .first()
    ).toBeFocused();
    // The frame draws the first Format preset selected; select it so the region compares that state.
    await page
      .getByRole('radio', {
        name: en.matchCreate.players.formatGroups_one
          .replace('{{count}}', '1')
          .replace('{{places}}', '4')
      })
      .click();
    await expect(page.getByLabel(en.matchCreate.invitees.search)).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(0);
    // Suggested level range comes from the creator rating (3.2 → 2.7–4.7) as the checked chip
    // with its minimum/maximum inputs filled; Registration offers the two real visibilities.
    await expect(page.getByRole('radio', { name: '2.7–4.7' })).toBeChecked();
    await expect(page.getByLabel(en.matchCreate.fields.minLevel)).toHaveValue('2.7');
    await expect(page.getByLabel(en.matchCreate.fields.maxLevel)).toHaveValue('4.7');
    await expect(
      page.getByRole('radiogroup', { name: en.matchCreate.players.registration }).getByRole('radio')
    ).toHaveText([
      en.matchCreate.players.registrationOptions.community_open,
      en.matchCreate.players.registrationOptions.invite_only
    ]);
    await assertWizardActions(
      page,
      'create players 390',
      en.matchCreate.previous,
      en.matchCreate.next
    );
    await assertNoHorizontalOverflow(page, 'create players 390');
    await assertWizardFrame(page, 'vAxZh', [], {
      key: 'vAxZh',
      locators: {
        format: page.getByRole('radiogroup', { name: en.matchCreate.players.format }),
        registration: page.getByRole('radiogroup', { name: en.matchCreate.players.registration }),
        levelChips: page.getByRole('radiogroup', { name: en.matchCreate.players.levelRange })
      }
    });
    await assertPrimaryHitTargets(page, 'create players 390');

    // Team-mode step: exactly the two scoped assignment modes, POST_MATCH_TEAMS default.
    await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await assertWizardChrome(page, 'create team mode 390', 2, en.matchCreate.steps.teams);
    // D6: only the two team-mode radios exist (frame order: after play, then predefined) — no
    // predefined-team pair pickers, no selects, no text inputs.
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).toBeChecked();
    await expect(radios.nth(1)).not.toBeChecked();
    await expect(page.locator('main').getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('main').getByRole('textbox')).toHaveCount(0);
    expect(
      await page
        .getByRole('radio')
        .evaluateAll((nodes) => nodes.map((radio) => radio.closest('label')?.textContent))
    ).toEqual([en.matches.teamMode.POST_MATCH_TEAMS, en.matches.teamMode.PREDEFINED_TEAMS]);
    // D9: the wizard suppresses the bottom navigation and owns its sticky actions; F27: it owns the
    // top chrome too, so the global language/theme chips step aside instead of overlapping progress.
    await expect(page.locator('[data-app-nav]')).toHaveCount(0);
    await expect(page.locator('main[data-route-chrome="navigation"]')).toHaveCount(1);
    await assertChipsStepAside(page, 'create wizard');
    await page.setViewportSize({ width: 390, height: 844 });
    const radioLabels = await page.getByRole('radio').evaluateAll((nodes) =>
      nodes.map((radio) => {
        const label = radio.closest('label');
        return label ? label.getBoundingClientRect().height : 0;
      })
    );
    expect(
      radioLabels.every((height) => height >= 48),
      `segmented team-mode labels must be at least 48px tall (got ${radioLabels.join(', ')})`
    ).toBe(true);
    await assertWizardActions(
      page,
      'create team mode 390',
      en.matchCreate.previous,
      en.matchCreate.next
    );
    await assertNoHorizontalOverflow(page, 'create team mode 390');
    await assertWizardFrame(page, 'b5RR4', []);
    await assertPrimaryHitTargets(page, 'create team mode 390');
  });

  // F25 completion: the full touch-label geometry matrix with RECORDED numbers. The
  // Details test above gates the 390/light/en capture; this test measures BOTH labels'
  // rendered label-element geometry (getBoundingClientRect width AND height ≥44) across
  // mobile AND desktop viewports × light AND dark themes × en/pt-BR/es, proves the label
  // edge (not the input) toggles its checkbox with the implicit label↔input association
  // intact, and proves at 320px that the whole page and translated labels fit without
  // horizontal overflow — including an actual wrap exercise.
  // No screenshots, no budgets: pure rendered measurements, printed and attached.
  test('create details — touch-label geometry matrix across viewports, themes and locales', async ({
    browser
  }) => {
    test.setTimeout(600_000);
    const host = await createActor('Marina Alves');
    await createPublicCommunity(host);
    const rows: string[] = [];
    const recordRow = (row: string): void => {
      rows.push(row);
      console.log(row);
    };

    const openCreateDetails = async (options: {
      viewport: Viewport;
      theme: 'light' | 'dark';
      locale: 'en' | 'pt-BR' | 'es';
    }): Promise<{ page: Page; close: () => Promise<void> }> => {
      const copy = copyFor(options.locale);
      const context = await newContext(browser, {
        viewport: options.viewport,
        locale: options.locale,
        theme: options.theme
      });
      const page = await context.newPage();
      await signIn(page, host, copy);
      await page.goto('/matches/create');
      await ready(page);
      await expect(
        page.getByRole('heading', { level: 1, name: copy.matchCreate.title })
      ).toBeVisible();
      await assertNoHorizontalOverflow(
        page,
        `create details ${options.viewport.width} ${options.theme} ${options.locale}`
      );
      if (options.viewport.width === 320) {
        const file = page.getByLabel(copy.matchCreate.fields.photo);
        await expect(file).toBeVisible();
        const box = await file.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(320);
        expect(box!.height).toBeGreaterThanOrEqual(44);
        const widths = await page.evaluate(() => ({
          viewport: window.innerWidth,
          document: document.documentElement.scrollWidth,
          body: document.body.scrollWidth
        }));
        recordRow(
          `[overflow] 320 ${options.theme} ${options.locale}: viewport=${widths.viewport}px document=${widths.document}px body=${widths.body}px file=${box!.width.toFixed(2)}px`
        );
      }
      return { page, close: () => context.close() };
    };

    const describeReading = (reading: TouchLabelReading): string =>
      `${reading.width.toFixed(2)} × ${reading.height.toFixed(2)}px (text ${reading.textLines} line(s), text width ${reading.textWidth.toFixed(2)}px, text overhang right ${reading.textOverhangRight.toFixed(2)}px, associated ${reading.associated})`;

    const assertReading = (
      reading: TouchLabelReading,
      label: string,
      key: TouchLabelKey,
      copy: Copy
    ): void => {
      expect(reading.associated, `${label}: ${key} label↔input association`).toBe(true);
      expect(
        reading.width,
        `${label}: ${key} ("${copy.matchCreate.fields[key]}") label rendered width (got ${reading.width}px)`
      ).toBeGreaterThanOrEqual(44);
      expect(
        reading.height,
        `${label}: ${key} ("${copy.matchCreate.fields[key]}") label rendered height (got ${reading.height}px)`
      ).toBeGreaterThanOrEqual(44);
      expect(
        reading.textOverhangRight,
        `${label}: ${key} ("${copy.matchCreate.fields[key]}") translated text must not overflow the label horizontally`
      ).toBeLessThanOrEqual(0.5);
      expect(
        reading.textOverhangBottom,
        `${label}: ${key} ("${copy.matchCreate.fields[key]}") translated text must not overflow the label vertically`
      ).toBeLessThanOrEqual(0.5);
    };

    for (const [viewportName, viewport] of [
      ['mobile-390', { width: 390, height: 844 }],
      ['desktop-1280', { width: 1280, height: 800 }]
    ] as const)
      for (const theme of ['light', 'dark'] as const)
        for (const locale of ['en', 'pt-BR', 'es'] as const) {
          const label = `touch-label ${viewportName} ${theme} ${locale}`;
          const { page, close } = await openCreateDetails({
            viewport,
            theme,
            locale
          });
          const copy = copyFor(locale);
          for (const key of TOUCH_LABEL_KEYS) {
            const target = touchLabel(page, copy, key);
            await expect(target).toHaveCount(1);
            const reading = await target.evaluate(measureTouchLabel);
            recordRow(
              `[touch-label] ${label} ${key} "${copy.matchCreate.fields[key]}": ${describeReading(reading)}`
            );
            assertReading(reading, label, key, copy);
            await assertTouchLabelActivation(page, copy, key, label);
          }
          await close();
        }
    // 320px: translations must lay out with zero horizontal overflow (page and label box)
    // while the ≥44×44 geometry assertion still holds, and the wrap path must actually
    // wrap: constraining the label forces the translated text onto multiple rendered
    // lines and the measured box stays ≥44px tall — then restores untouched.
    for (const theme of ['light', 'dark'] as const)
      for (const locale of ['en', 'pt-BR', 'es'] as const) {
        const label = `touch-label 320 ${theme} ${locale}`;
        const copy = copyFor(locale);
        const { page, close } = await openCreateDetails({
          viewport: { width: 320, height: 844 },
          theme,
          locale
        });
        for (const key of TOUCH_LABEL_KEYS) {
          const target = touchLabel(page, copy, key);
          await expect(target).toHaveCount(1);
          const reading = await target.evaluate(measureTouchLabel);
          recordRow(
            `[touch-label] ${label} ${key} "${copy.matchCreate.fields[key]}": ${describeReading(reading)}`
          );
          assertReading(reading, label, key, copy);
          await target.evaluate((node) => {
            node.style.maxWidth = '120px';
          });
          const wrapped = await target.evaluate(measureTouchLabel);
          recordRow(
            `[touch-label] ${label} ${key} "${copy.matchCreate.fields[key]}" constrained to 120px: ${wrapped.width.toFixed(2)} × ${wrapped.height.toFixed(2)}px (text ${wrapped.textLines} line(s), text overhang right ${wrapped.textOverhangRight.toFixed(2)}px)`
          );
          expect(
            wrapped.textLines,
            `${label}: ${key} constrained label must actually wrap its translated text onto multiple rendered lines`
          ).toBeGreaterThanOrEqual(2);
          expect(
            wrapped.width,
            `${label}: ${key} wrapped label rendered width (got ${wrapped.width}px)`
          ).toBeGreaterThanOrEqual(44);
          expect(
            wrapped.height,
            `${label}: ${key} wrapped label rendered height (got ${wrapped.height}px)`
          ).toBeGreaterThanOrEqual(44);
          expect(
            wrapped.textOverhangRight,
            `${label}: ${key} wrapped text must not overflow the label horizontally`
          ).toBeLessThanOrEqual(0.5);
          await target.evaluate((node) => {
            node.style.maxWidth = '';
          });
          const restored = await target.evaluate(measureTouchLabel);
          expect(
            Math.abs(restored.width - reading.width),
            `${label}: ${key} label must restore its unconstrained rendered width`
          ).toBeLessThanOrEqual(0.5);
        }
        await assertNoHorizontalOverflow(page, label);
        await close();
      }

    const { page, close } = await openCreateDetails({
      viewport: { width: 320, height: 844 },
      theme: 'light',
      locale: 'en'
    });
    const file = page.getByLabel(en.matchCreate.fields.photo);
    await file.setInputFiles({
      name: 'venue-photo-selected-filename-long-enough-to-exercise-intrinsic-sizing.png',
      mimeType: 'image/png',
      buffer: matchPhoto()
    });
    await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
      timeout: 15_000
    });
    await assertNoHorizontalOverflow(page, 'create details 320 en long filename upload complete');
    const uploadedBox = await file.boundingBox();
    expect(uploadedBox).not.toBeNull();
    expect(uploadedBox!.x + uploadedBox!.width).toBeLessThanOrEqual(320);
    expect(uploadedBox!.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: en.matchCreate.photo.remove }).click();
    await file.setInputFiles({
      name: 'invalid.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('bad')
    });
    await expect(page.getByRole('alert')).toContainText(en.matchCreate.photo.unavailable);
    await assertNoHorizontalOverflow(page, 'create details 320 en upload error/helper');
    await close();

    await test.info().attach('touch-label geometry matrix measurements', {
      body: rows.join('\n'),
      contentType: 'text/plain'
    });
  });

  test('create wizard — Review states the publication summary over the staged photo', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    const host = await createActor('Marina Alves');
    await createPublicCommunity(host);
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, host);
    await page.goto('/matches/create');
    await waitForHydratedPage(page);
    await page.getByLabel(en.matchCreate.fields.date).fill(ymd(3));
    await page.getByLabel(en.matchCreate.fields.startTime).fill('19:30');
    await page.getByLabel(en.matchCreate.fields.venueName).fill(VENUES.friendly);
    await page
      .getByLabel(en.matchCreate.fields.mapsUrl)
      .fill('https://maps.google.com/maps/place/corte-luminosa');
    await page.getByLabel(en.matchCreate.fields.price).fill('12');
    await page
      .getByLabel(en.matchCreate.fields.photo)
      .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: matchPhoto() });
    await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
      timeout: 15_000
    });
    await page.getByRole('button', { name: en.matchCreate.next }).click();
    await page.getByLabel(en.matchCreate.fields.maximumRegistrations).fill('16');
    for (let step = 0; step < 2; step += 1)
      await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await expect(page.getByRole('heading', { name: en.matchCreate.readyTitle })).toBeVisible();
    await assertWizardChrome(page, 'create review 390', 3, en.matchCreate.steps.review);

    // Review rows (frame RDV2r): muted key left, bold value right, in frame order. The cutoff instant
    // is clock-derived (masked in the capture); cost, invite count and publication are asserted.
    const review = await page
      .locator('main dl > div')
      .evaluateAll((rows) =>
        rows.map((row) => [
          row.querySelector('dt')?.textContent,
          row.querySelector('dd')?.textContent
        ])
      );
    expect(review.map(([key]) => key)).toEqual([
      en.matchCreate.reviewRows.when,
      en.matchCreate.fields.cutoff,
      en.matchCreate.reviewRows.where,
      en.matchCreate.fields.type,
      en.matchCreate.fields.visibility,
      en.matchCreate.reviewRows.level,
      en.matchCreate.fields.price,
      en.matchCreate.reviewRows.teams,
      en.matchCreate.fields.maximumRegistrations,
      en.matchCreate.invitees.selected
    ]);
    expect(review[1]![1]).toContain('· UTC');
    expect(review.find(([key]) => key === en.matchCreate.fields.price)![1]).toContain('€12.00');
    expect(review.at(-1)![1]).toBe('0');
    await expect(page.getByText(en.matchCreate.informationalOnly)).toBeVisible();
    const publish = page.getByRole('button', { name: en.matchCreate.publish });
    await expect(publish).toBeVisible();
    await expect(publish).toBeEnabled();
    await assertWizardActions(
      page,
      'create review 390',
      en.matchCreate.previous,
      en.matchCreate.publish
    );
    await assertNoHorizontalOverflow(page, 'create review 390');
    await assertPrimaryHitTargets(page, 'create review 390');
    await assertWizardFrame(page, 'RDV2r', [page.locator('main dl dd'), page.locator('main img')]);
  });

  test('Available — populated listing stays inside the approved visual envelope', async ({
    browser
  }) => {
    test.setTimeout(360_000);
    await ensureListFixtures();

    const run = async (options: {
      viewport?: Viewport;
      locale?: 'en' | 'pt-BR' | 'es';
      theme?: 'light' | 'dark';
      label: string;
    }) => {
      const copy = copyFor(options.locale ?? 'en');
      const context = await newContext(browser, options);
      const page = await context.newPage();
      await signIn(page, family.member!, copy);
      await page.goto('/matches');
      await ready(page);

      await expect(page.getByRole('heading', { level: 1, name: copy.matches.title })).toBeVisible();
      await assertTabSet(page, copy, 'available');
      const cards = page.locator('main article');
      const competitive = cards.filter({ hasText: VENUES.competitive });
      const reserve = cards.filter({ hasText: VENUES.reserve });
      // The two earliest fixtures own the above-the-fold region, in starts_at order.
      await expect(competitive).toHaveCount(1);
      await expect(reserve).toHaveCount(1);
      await expect(
        competitive.getByRole('link', { name: VENUES.competitive, exact: true })
      ).toBeVisible();
      await expect(reserve.getByRole('link', { name: VENUES.reserve, exact: true })).toBeVisible();
      // Creator, counts and price lines are real projected facts; the reserve card
      // carries the personal badge while no badge is fabricated on the other card.
      await expect(
        competitive.getByText(copy.matches.type.competitive, { exact: true })
      ).toBeVisible();
      await expect(competitive.getByText('Marina Alves', { exact: false })).toBeVisible();
      await assertLocalizedCountText(reserve, copy, options.locale ?? 'en', 2);
      await expect(reserve.getByRole('strong')).toHaveText(copy.matches.badges.reserve);
      await expect(competitive.getByRole('strong')).toHaveCount(0);
      if ((options.locale ?? 'en') === 'en')
        await expect(
          competitive.getByText(`${copy.matches.card.pricePerPlayer}: €7.50`)
        ).toBeVisible();

      await assertTabsKeyboardReachable(page, copy);
      await assertListChrome(page, `available ${options.label}`, { grouped: true });
      await assertCardGrouping(page, `available ${options.label}`);
      if (options.label === 'populated') await assertMatchesFrame(page, 'ENn8Q', dynamicMask(page));
      await assertPhotoAspectTreatment(page, `available ${options.label}`);
      await assertNoHorizontalOverflow(page, `available ${options.label}`);
      await assertPrimaryHitTargets(page, `available ${options.label}`);
      if (options.label === 'populated') await assertChipsOnUnmarkedRoute(page, 'available list');
      await context.close();
    };

    await run({ label: 'populated' });
    await run({ viewport: { width: 320, height: 844 }, label: 'populated 320' });
    await run({
      viewport: { width: 1280, height: 800 },
      label: 'populated desktop'
    });
    await run({ locale: 'pt-BR', label: 'populated pt-BR' });
    await run({ locale: 'es', label: 'populated es' });
    await run({ theme: 'dark', label: 'populated dark' });
  });

  test('Available — empty state replays the recorded truthful empty listing', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    const viewer = await createActor('Nora Vaz');
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    const recordedRaw: unknown = JSON.parse(
      readFileSync(
        new URL('./references/paf-4/recorded-empty-available.response.json', import.meta.url),
        'utf8'
      )
    );
    if (
      !isRecord(recordedRaw) ||
      typeof recordedRaw.status !== 'number' ||
      typeof recordedRaw.contentType !== 'string' ||
      typeof recordedRaw.body !== 'string'
    )
      throw new Error('Invalid recorded empty-available response fixture');
    const recorded = {
      status: recordedRaw.status,
      contentType: recordedRaw.contentType,
      body: recordedRaw.body
    };
    // The Available entry is a global listing: once any public event exists anywhere it
    // cannot be truthfully emptied inside a combined suite run. The empty state is shown
    // by replaying the byte-exact server response recorded from a pruned local database
    // (sha256 pinned in the manifest) at the network boundary — the rendering path is the
    // real application code.
    await page.route('**/_serverFn/**', async (route) => {
      const payload = new URL(route.request().url()).searchParams.get('payload') ?? '';
      if (payload.includes('"entry"') && payload.includes('"available"'))
        await route.fulfill({
          status: recorded.status,
          contentType: recorded.contentType,
          headers: { 'x-tss-serialized': 'true', 'cache-control': 'private, no-store' },
          body: recorded.body
        });
      else await route.continue();
    });
    await signIn(page, viewer);
    await page.goto('/matches/my');
    await waitForHydratedPage(page);
    await page.getByRole('link', { name: en.matches.tabs.available }).click();
    await ready(page);
    await expect(page.getByText(en.matches.empty.available)).toBeVisible();
    await assertTabSet(page, en, 'available');
    await assertTabsKeyboardReachable(page, en);
    await expect(page.locator('main article')).toHaveCount(0);
    await assertListChrome(page, 'available empty');
    const emptyCard = page
      .locator('main > section')
      .filter({ hasText: en.matches.empty.available });
    await expect(emptyCard.getByText(en.matches.emptyHint.available)).toBeVisible();
    await expect(emptyCard.getByRole('link')).toHaveCount(1);
    await assertPrimaryActionTokens(
      page,
      emptyCard.getByRole('link'),
      'available empty state create action',
      '--color-on-green'
    );
    // D6: the frame draws filter chips; list_match_events has no filter arguments, so none render.
    await expect(page.locator('main [aria-pressed], main [role="checkbox"]')).toHaveCount(0);
    await assertMatchesFrame(page, 'kYI9H', dynamicMask(page));
    await assertNoHorizontalOverflow(page, 'available empty');
    await assertPrimaryHitTargets(page, 'available empty');
  });

  test('My Matches — RESERVE badge and truthful FIFO counts', async ({ browser }) => {
    test.setTimeout(180_000);
    await ensureListFixtures();
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.member!);
    await page.goto('/matches/my');
    await ready(page);
    await assertTabSet(page, en, 'my');
    const cards = page.locator('main article');
    await expect(cards).toHaveCount(1);
    const card = cards.filter({ hasText: VENUES.reserve });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole('strong')).toHaveText(en.matches.badges.reserve);
    await assertLocalizedCountText(card, en, 'en', 2);
    await expect(card.getByRole('link', { name: VENUES.reserve, exact: true })).toBeVisible();
    await assertListChrome(page, 'my matches reserve', { grouped: true });
    await assertCardGrouping(page, 'my matches reserve');
    await assertMatchesFrame(page, 'uePpj', dynamicMask(page));
    await assertPhotoAspectTreatment(page, 'my matches reserve');
    await assertNoHorizontalOverflow(page, 'my matches reserve');
    await assertPrimaryHitTargets(page, 'my matches reserve');
  });

  test('My Matches — INVITED badge, invitation detail and no fabricated registration', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    await ensureListFixtures();
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.invitee!);
    await page.goto('/matches/my');
    await ready(page);
    await assertTabSet(page, en, 'my');
    const card = page.locator('main article').filter({ hasText: VENUES.invited });
    await expect(card).toHaveCount(1);
    await expect(page.locator('main article')).toHaveCount(1);
    await expect(card.getByRole('strong')).toHaveText(en.matches.badges.invited);
    await assertListChrome(page, 'my matches invited', { grouped: true });
    await assertCardGrouping(page, 'my matches invited');
    await assertNoHorizontalOverflow(page, 'my matches invited');
    await assertPrimaryHitTargets(page, 'my matches invited');

    // Invitation detail now exposes real invitation response actions (T06).
    await card.getByRole('link', { name: VENUES.invited, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${family.invitedId}$`));
    await ready(page);
    await expect(
      page.getByRole('heading', { level: 1, name: en.matches.detail.barTitle, exact: true })
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: VENUES.invited, exact: true })
        .getByText(en.matches.detail.visibility.invite_only, { exact: true })
    ).toBeVisible();
    await expect(page.getByText(en.matches.detail.invitationInfo)).toBeVisible();
    const inviteeRegistration = await family
      .invitee!.client.from('match_event_registrations')
      .select('user_id')
      .eq('match_event_id', family.invitedId!)
      .eq('user_id', family.invitee!.id)
      .maybeSingle();
    expect(inviteeRegistration.error).toBeNull();
    expect(inviteeRegistration.data).toBeNull();
    for (const name of [
      en.matches.detail.share,
      en.matches.invitations.accept,
      en.matches.invitations.decline
    ]) {
      await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
    }
    await expect(page.getByRole('button')).toHaveCount(3);
    await assertHeadingTypography(page, 'invite detail');
    await assertGutterAxis(page, 'invite detail', '--space-20', 'main > div');
    // Clubhouse detail (eYIgj/fo8Zn): 14px rhythm between the content column's blocks.
    await assertRhythm(page, 'invite detail', 'main > div', '--space-14');
    await assertHeaderShare(page, 'invite detail share');
    await assertNoHorizontalOverflow(page, 'invite detail');
    await assertPrimaryHitTargets(page, 'invite detail');
  });

  test('Past — elapsed event shows scheduled history, Past stays empty for unassociated viewers', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    await ensureListFixtures();
    const hostContext = await newContext(browser);
    const guestContext = await newContext(browser);
    family.contexts.push(hostContext, guestContext);
    const page = await hostContext.newPage();
    await signIn(page, family.host!);
    await page.goto('/matches/past');
    await ready(page);
    await assertTabSet(page, en, 'past');
    const card = page.locator('main article').filter({ hasText: VENUES.elapsed });
    await expect(card).toHaveCount(1);
    // The creator badge is never rendered as a personal badge and no result story exists.
    await expect(card.getByRole('strong')).toHaveCount(0);
    await expect(card.getByText(en.matches.detail.pastScheduled)).toBeVisible();
    await expect(card.getByText(en.matches.detail.outcomeUnavailable)).toBeVisible();
    const cardText = await card.innerText();
    expect(cardText).not.toMatch(/\d+\s[-–—]\s\d/);
    expect(cardText).not.toMatch(/confirmed|disputed|cancel|forfeit/i);
    // The elapsed fixture bypasses the creator-registration trigger, so the projected
    // accepted count is truthfully 0.
    await assertLocalizedCountText(card, en, 'en', 0);
    await assertListChrome(page, 'past elapsed');
    await assertMatchesFrame(page, 'w25dY', [
      ...dynamicMask(page),
      page.locator('main section[aria-labelledby="statistics-history-title"]')
    ]);
    await assertCardGrouping(page, 'past elapsed');
    await assertNoHorizontalOverflow(page, 'past elapsed');
    await assertPrimaryHitTargets(page, 'past elapsed');

    const guestPage = await guestContext.newPage();
    await signIn(guestPage, family.guest!);
    await guestPage.goto('/matches/past');
    await ready(guestPage);
    await expect(guestPage.getByText(en.matches.empty.past)).toBeVisible();
    await expect(guestPage.locator('main article')).toHaveCount(0);
    await assertTabSet(guestPage, en, 'past');
    await assertListChrome(guestPage, 'past empty');
    await assertNoHorizontalOverflow(guestPage, 'past empty');
    await assertPrimaryHitTargets(guestPage, 'past empty');
  });

  test('Detail — friendly creator view and public guest view match the approved frames', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureListFixtures();
    const hostContext = await newContext(browser);
    const guestContext = await newContext(browser);
    family.contexts.push(hostContext, guestContext);
    const page = await hostContext.newPage();
    await signIn(page, family.host!);

    await page.goto(`/matches/${family.friendlyId}`);
    await ready(page);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: en.matches.detail.barTitle,
        exact: true
      })
    ).toBeVisible();
    await expect(
      page
        .getByRole('region', { name: VENUES.friendly, exact: true })
        .getByText(en.matches.detail.visibility.community_open, { exact: true })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: en.matches.back })).toBeVisible();
    await expect(page.getByText(en.matches.detail.creatorAccepted)).toBeVisible();
    // Hero metrics (frame eYIgj): price is a metric tile from the real event price.
    await expect(page.getByText('€12.00', { exact: true })).toBeVisible();
    await expect(page.getByText('Timezone: UTC')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 2, name: en.matches.detail.participation })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: en.matches.detail.participants })
    ).toBeVisible();
    await expect(
      page.getByText(`1 · ${en.matches.detail.accepted}`, { exact: false })
    ).toBeVisible();
    await assertLocalizedCountText(page.locator('main'), en, 'en', 1);
    const mapsLink = page.getByRole('link', {
      name: en.matches.detail.viewCourtLocationFor.replace('{{venue}}', VENUES.friendly)
    });
    await expect(mapsLink).toBeVisible();
    await expect(mapsLink).toHaveAttribute('rel', /noopener noreferrer/);
    const share = page.getByRole('button', { name: en.matches.detail.share });
    await expect(share).toBeVisible();
    await expect(page.getByLabel(en.matches.detail.shareUrl)).toHaveValue(
      new RegExp(`/matches/${family.friendlyId}$`)
    );
    await assertHeadingTypography(page, 'friendly detail 390');
    await assertGutterAxis(page, 'friendly detail 390', '--space-20', 'main > div');
    // Clubhouse detail (eYIgj, nNzWb): 14px rhythm between hero, stats, roster/registration and
    // lower-priority cards.
    await assertRhythm(page, 'friendly detail 390', 'main > div', '--space-14');
    await assertHeaderShare(page, 'friendly detail share');
    await assertHeroOrder(page, 'friendly detail hero');
    await assertPhotoAspectTreatment(page, 'friendly detail', true);
    await assertNoHorizontalOverflow(page, 'friendly detail 390');
    await assertPrimaryHitTargets(page, 'friendly detail 390');

    const darkContext = await newContext(browser, { theme: 'dark' });
    const darkPage = await darkContext.newPage();
    await signIn(darkPage, family.host!);
    await darkPage.goto(`/matches/${family.friendlyId}`);
    await ready(darkPage);
    await assertHeadingTypography(darkPage, 'friendly detail dark');
    await assertGutterAxis(darkPage, 'friendly detail dark', '--space-20', 'main > div');
    await assertNoHorizontalOverflow(darkPage, 'friendly detail dark');
    await darkContext.close();

    // Public guest view of the same event: truthful future-approval information, no join.
    const guestPage = await guestContext.newPage();
    await signIn(guestPage, family.guest!);
    await guestPage.goto(`/matches/${family.friendlyId}`);
    await ready(guestPage);
    await expect(
      guestPage.getByRole('heading', {
        level: 1,
        name: en.matches.detail.barTitle,
        exact: true
      })
    ).toBeVisible();
    await expect(
      guestPage
        .getByRole('region', { name: VENUES.friendly, exact: true })
        .getByText(en.matches.detail.visibility.community_open, { exact: true })
    ).toBeVisible();
    await expect(
      guestPage.getByText(en.matches.detail.guestApprovalRequired).first()
    ).toBeVisible();
    await expect(guestPage.getByText(en.matches.visibility.community_open)).toBeVisible();
    // PAF-5 intentional change: the public guest now gets the real request CTA
    // next to the share action (previously T04 rendered informational context
    // only, and this screen had exactly one button). The registration panel's
    // request state adds the REQUEST TO JOIN primary; share stays.
    const guestButtons = guestPage.getByRole('button');
    await expect(guestButtons).toHaveCount(2);
    await expect(
      guestPage.getByRole('button', { name: en.matchRegistration.join.requestButton })
    ).toBeVisible();
    await expect(guestPage.getByRole('button', { name: en.matches.detail.share })).toBeVisible();
    for (const link of await guestPage.getByRole('link').all())
      expect((await link.textContent()) ?? '').not.toMatch(/book|pay|purchase|join|register/i);
    await assertHeadingTypography(guestPage, 'guest detail');
    await assertGutterAxis(guestPage, 'guest detail', '--space-20', 'main > div');
    // JLqMT composition for an authorized non-member (D3): same card rhythm, request action only.
    await assertRhythm(guestPage, 'guest detail', 'main > div', '--space-14');
    await assertHeaderShare(guestPage, 'guest detail share');
    await assertActionBar(
      guestPage,
      'guest detail request',
      guestPage.getByRole('button', { name: en.matchRegistration.join.requestButton })
    );
    await assertHeroOrder(guestPage, 'guest detail hero');
    await assertPrimaryActionTokens(
      guestPage,
      guestPage.getByRole('button', { name: en.matchRegistration.join.requestButton }),
      'guest detail request',
      '--color-on-green'
    );
    await assertPhotoAspectTreatment(guestPage, 'guest detail', true);
    await assertNoHorizontalOverflow(guestPage, 'guest detail');
    await assertPrimaryHitTargets(guestPage, 'guest detail');
  });

  test('Unknown events resolve to the localized unavailable state', async ({ browser }) => {
    test.setTimeout(120_000);
    const viewer = await createActor('Una Falcao');
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, viewer);
    await page.goto(`/matches/${crypto.randomUUID()}`);
    await ready(page);
    await expect(page.getByText(en.matches.unavailable)).toBeVisible();
    await expect(page.getByRole('link', { name: en.matches.back })).toBeVisible();
    expect((await page.locator('main').innerText()).toLowerCase()).not.toContain('maps');
    await assertGutterAxis(page, 'unavailable', '--space-18');
    await assertNoHorizontalOverflow(page, 'unavailable');
    await assertPrimaryHitTargets(page, 'unavailable');
  });

  test('Pagination loading and offline states render through the real store', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureListFixtures();
    await createFillerEvents();
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    let offline = false;
    await page.route('**/_serverFn/**', async (route) => {
      const payload = new URL(route.request().url()).searchParams.get('payload') ?? '';
      if (!payload.includes('"cursor"')) return route.continue();
      // Hold the cursor request long enough to freeze the real loading state, then either
      // release it or fail it once the context goes offline.
      await new Promise((resolve) => setTimeout(resolve, offline ? 0 : 4000));
      if (offline) await route.abort('internetdisconnected');
      else await route.continue();
    });
    await signIn(page, family.member!);
    await page.goto('/matches');
    await ready(page);
    const loadMore = page.getByRole('button', {
      name: new RegExp(`^(${en.matches.loadMore}|${en.matches.loading})$`)
    });
    await expect(loadMore).toBeVisible();
    await loadMore.scrollIntoViewIfNeeded();
    await loadMore.click();
    await expect(loadMore).toHaveText(en.matches.loading);
    await expect(loadMore).toBeDisabled();
    await assertListChrome(page, 'loading', { grouped: true });
    await assertNoHorizontalOverflow(page, 'loading');

    // Going offline while the request is in flight must surface the offline output and
    // keep mutations blocked (no queued publication path exists).
    offline = true;
    await context.setOffline(true);
    await expect(page.getByText(en.matches.offline)).toBeVisible({ timeout: 15_000 });
    await expect(loadMore).toBeDisabled();
    await assertListChrome(page, 'offline', { grouped: true });
    await assertNoHorizontalOverflow(page, 'offline');
  });

  test('Listing loader failures surface the error state with a retry action', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    await ensureListFixtures();
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.member!);
    await page.goto('/matches/my');
    await waitForHydratedPage(page);
    await page.route('**/_serverFn/**', async (route) => {
      const payload = new URL(route.request().url()).searchParams.get('payload') ?? '';
      if (payload.includes('"entry"') && payload.includes('"available"'))
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: '{"error":"outage"}'
        });
      else await route.continue();
    });
    await page.getByRole('link', { name: en.matches.tabs.available }).click();
    await ready(page);
    await expect(page.getByText(en.matches.error)).toBeVisible();
    await expect(page.getByRole('button', { name: en.matches.retry })).toBeVisible();
    await expect(page.locator('main [role="alert"]')).toBeVisible();
    await assertListChrome(page, 'error');
    await assertNoHorizontalOverflow(page, 'error');
    await assertPrimaryHitTargets(page, 'error');
  });

  test.afterAll(async () => {
    await Promise.all(family.contexts.splice(0).map((context) => context.close()));
  });
});
