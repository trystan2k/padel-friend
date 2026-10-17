import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page
} from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

// PAF-76 visual/structural QA for Match Events. Companion to e2e/matches.spec.ts (functional
// journeys live there and must stay untouched). Every screen below pairs exact structural
// probes with a screenshot gate; reference-backed baselines are Pencil MCP exports of the
// approved frames (see e2e/references/paf-4/manifest.json), self-baselines are first-honest
// captures for states and viewports the design source has no full-screen frame for. Run
// through `pnpm test:e2e` only — never a bare `playwright test`.

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  matches: {
    title: string;
    navigationLabel: string;
    back: string;
    tabs: { available: string; my: string; past: string };
    visibility: { community_open: string; invite_only: string };
    type: { competitive: string; friendly: string };
    unavailable: string;
    offline: string;
    loading: string;
    error: string;
    retry: string;
    loadMore: string;
    empty: { available: string; past: string };
    badges: { invited: string; reserve: string };
    counts: Record<string, string>;
    card: { pricePerPlayer: string; openMaps: string };
    detail: {
      title: string;
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
    };
  };
  matchCreate: {
    title: string;
    next: string;
    review: string;
    publish: string;
    informationalOnly: string;
    steps: { details: string; players: string; teams: string };
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
      levelRestriction: string;
      courtBooked: string;
    };
    helpers: { defaultCutoff: string };
    invitees: { search: string; selected: string };
    photo: { remove: string };
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
// Pinned provenance for every Pencil-derived reference and baseline. The
// manifest records node IDs, crop derivations and sha256 digests; both the
// reference set and the reference-derived baselines are re-verified at runtime
// (and after each comparison, so --update-snapshots cannot silently replace a
// reviewed baseline with a live capture).
// ---------------------------------------------------------------------------

type VisualManifest = {
  sourceDesign: { path: string; sha256: string };
  approvedReferences: Record<string, { frameId: string; sha256: string; derivation: string }>;
  screenshotBaselines: Record<string, { sha256: string; derivedFrom: string }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVisualManifest(value: unknown): value is VisualManifest {
  if (!isRecord(value) || !isRecord(value.sourceDesign) || !isRecord(value.approvedReferences))
    return false;
  if (!isRecord(value.screenshotBaselines)) return false;
  return Object.values(value.approvedReferences).every(
    (reference) => isRecord(reference) && typeof reference.sha256 === 'string'
  );
}

const visualManifest: VisualManifest = (() => {
  const raw: unknown = JSON.parse(
    readFileSync(new URL('./references/paf-4/manifest.json', import.meta.url), 'utf8')
  );
  if (!isVisualManifest(raw)) throw new Error('Invalid PAF-4 visual provenance manifest');
  return raw;
})();

function digestFile(path: URL): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertManifestProvenance(): void {
  const design = new URL('../docs/design/padel-friend.pen', import.meta.url);
  expect(digestFile(design), 'padel-friend.pen must be the reviewed source design').toBe(
    visualManifest.sourceDesign.sha256
  );
  for (const [reference, approved] of Object.entries(visualManifest.approvedReferences)) {
    expect(
      digestFile(new URL(`./references/paf-4/${reference}`, import.meta.url)),
      `${reference} must match its reviewed Pencil export digest`
    ).toBe(approved.sha256);
  }
  for (const [baseline, derived] of Object.entries(visualManifest.screenshotBaselines)) {
    expect(
      digestFile(new URL(`./matches-visual.spec.ts-snapshots/${baseline}`, import.meta.url)),
      `${baseline} must match its reviewed derivation digest`
    ).toBe(derived.sha256);
  }
}

function assertBaselineUnchanged(baseline: string): void {
  const derived = visualManifest.screenshotBaselines[baseline];
  if (!derived) return;
  expect(
    digestFile(new URL(`./matches-visual.spec.ts-snapshots/${baseline}`, import.meta.url)),
    `${baseline} must still match its reviewed derivation after the comparison`
  ).toBe(derived.sha256);
}

// Per-screen screenshot budgets, recalibrated against the corrected implementation
// after the primary-action copy correction (--color-bg, the reference-measured #f4f6f1
// CTA copy) and the detail participation/participants section restructure
// (VISUAL_CALIBRATE=1 run, recorded in the manifest). Each reference-backed budget is
// the measured honest app-vs-Pencil comparison plus a margin that only absorbs
// cross-renderer font-rasterization residuals (PAF-1 measured ~0.75–1.3pp absolute on
// text-dense screens): +2pp for screens measuring <20%, +1.5pp for screens measuring
// ≥20%. The detail budgets TIGHTENED this round (0.295→0.225, 0.415→0.385, 0.415→0.375)
// because the corrected detail structure measures closer to the frames. Self-baselined
// viewports/locales/states keep a 2pp envelope around their first honest capture of the
// corrected implementation.
// No budget hides a structural defect: every geometric attribute of the retained scope
// is gated exactly by the structural probes, which now also gate RENDERED geometry —
// sibling-to-sibling distances equal the pinned token exactly, rhythm children carry
// zero vertical margin, and each rhythm container's content box wraps its children
// (grouping boundaries).
const VISUAL_BUDGETS: Record<string, number> = {
  'create-details.png': 0.15,
  'create-players.png': 0.16,
  'create-team-mode.png': 0.16,
  'create-review.png': 0.305,
  'available-populated.png': 0.325,
  'available-empty.png': 0.14,
  'my-matches-invited.png': 0.315,
  'my-matches-reserve.png': 0.315,
  'past-elapsed.png': 0.315,
  'detail-public-guest.png': 0.375,
  'detail-friendly-creator.png': 0.385,
  'detail-invitee.png': 0.225,
  'create-details-dark.png': 0.02,
  'available-populated-320.png': 0.02,
  'available-populated-desktop.png': 0.02,
  'available-populated-pt-BR.png': 0.02,
  'available-populated-es.png': 0.02,
  'available-populated-dark.png': 0.02,
  'detail-friendly-creator-dark.png': 0.02,
  'past-empty.png': 0.02,
  'state-unavailable.png': 0.02,
  'state-error.png': 0.02,
  'state-loading.png': 0.02,
  'state-offline.png': 0.02
};

const MASK_COLOR = '#FF00FF';

// Calibration mode (VISUAL_CALIBRATE=1): first-honest-comparison measurements are
// recorded and reported instead of failing the run, so all reference-backed screens can
// be measured in a single pass before their budgets are pinned. Regular runs never set
// this and every comparison is a hard gate. Structural-gate violations follow the same
// rule in reverse: hard failures in regular runs, RECORDED (into the calibration
// artifact and the report) in calibration runs so one serial pass still measures every
// screen — a recorded violation must be fixed and re-measured before its budget is
// trusted, which is why the manifest names any open violation next to its budget.
const calibration: Record<string, string> = {};
const structuralViolations: string[] = [];
const calibrating = process.env.VISUAL_CALIBRATE === '1';

function writeCalibrationArtifact(): void {
  writeFileSync(
    new URL('../test-results/matches-visual-calibration.json', import.meta.url),
    JSON.stringify({ measurements: calibration, structuralViolations }, null, 1)
  );
}

function baselinePath(baseline: string): string {
  return new URL(`./matches-visual.spec.ts-snapshots/${baseline}`, import.meta.url).pathname;
}

async function compare(page: Page, baseline: string, masks: Locator[] = []): Promise<void> {
  if (calibrating && !existsSync(baselinePath(baseline))) {
    // First honest capture for a self-baselined screen: write it directly so the
    // calibration run is not failed by Playwright's missing-snapshot bookkeeping. The
    // capture applies the same dynamic-area masks as the comparisons — an unmasked
    // first capture would make every later masked comparison fail on the masked areas.
    await page.screenshot({
      path: baselinePath(baseline),
      animations: 'disabled',
      caret: 'hide',
      ...(masks.length > 0 ? { mask: masks, maskColor: MASK_COLOR } : {})
    });
    return;
  }
  try {
    await expect(page).toHaveScreenshot(baseline, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      // Calibration measures every screen's raw ratio (budget 0 forces the failure path
      // that records it); regular runs enforce the pinned budget as a hard gate.
      maxDiffPixelRatio: calibrating ? 0 : VISUAL_BUDGETS[baseline],
      ...(masks.length > 0 ? { mask: masks, maskColor: MASK_COLOR } : {})
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const measured = /ratio ([\d.]+) of all image pixels/.exec(message);
    if (calibrating) {
      if (measured?.[1]) {
        calibration[baseline] = measured[1];
        writeCalibrationArtifact();
      }
      return;
    }
    throw cause;
  }
  assertBaselineUnchanged(baseline);
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
  const variables = new Map(
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
  const url = process.env.VITE_SUPABASE_URL ?? variables.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    variables.get('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    '';
  if (!url || !key || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('Matches visual E2E requires loopback Supabase');
  return { url, key };
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
async function fixtureSql(sql: string): Promise<void> {
  const child = spawn(
    'pnpm',
    [
      'exec',
      'supabase',
      'db',
      'query',
      '--local',
      '--output-format',
      'json',
      `do $$ begin ${sql} end $$;`
    ],
    { cwd: process.cwd() }
  );
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
    await Promise.all([
      document.fonts.load('400 12px Inter'),
      document.fonts.load('500 12px Inter'),
      document.fonts.load('600 12px Inter'),
      document.fonts.load('700 12px Inter'),
      document.fonts.load('400 12px Manrope'),
      document.fonts.load('600 12px Manrope'),
      document.fonts.load('700 24px Manrope')
    ]);
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        if (!image.complete) await image.decode().catch(() => undefined);
      })
    );
  });
  const fonts = await page.evaluate(() => ({
    inter: document.fonts.check('400 12px Inter') && document.fonts.check('600 12px Inter'),
    manrope: document.fonts.check('700 24px Manrope')
  }));
  expect(fonts, 'Inter and Manrope must be available before screenshot').toEqual({
    inter: true,
    manrope: true
  });
}

/** Dynamic-area masks: venue photo renderings and the rendered start-instant text lines
 * (card datetime line, detail datetime line, review cutoff instant). Nothing else is ever
 * masked — no field, no card, no whole section. */
function dynamicMasks(page: Page, kind: 'list' | 'detail' | 'review'): Locator[] {
  const images = page.locator('main img');
  if (kind === 'list') return [images, page.locator('main article > p:first-of-type')];
  if (kind === 'detail') return [images, page.locator('main > p:first-of-type')];
  return [images, page.locator('main section > p:first-of-type')];
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

/** Photo aspect treatment: 16/9 cover cropping, matching the design's venue imagery. */
async function assertPhotoAspectTreatment(page: Page, label: string): Promise<void> {
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
    expect(treatment!.aspectRatio, `${label}: photo ${index} aspect`).toBe('16 / 9');
    expect(treatment!.objectFit, `${label}: photo ${index} fit`).toBe('cover');
    expect(
      Math.abs(treatment!.height - (treatment!.width * 9) / 16),
      `${label}: photo ${index} rendered box must follow 16/9`
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

/** Reference measurement: the h1 cap band is 19–20px tall in every frame
 * (available-populated y=25..44, create-details y=25..44, detail-friendly-creator
 * y=25..49 with descender), which among the token type scale only a 24px bold
 * Manrope heading produces. Pre-fix the h1 rendered in the body face at the UA
 * default size, failing every assertion here. */
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
    style.fontFamily.startsWith('Manrope'),
    `${label}: h1 must use the Manrope heading face`
  ).toBe(true);
  expect(style.fontSize, `${label}: h1 must be --font-size-24 (reference cap band 19–20px)`).toBe(
    '24px'
  );
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
  copyToken: '--color-on-hero' | '--color-bg' = '--color-bg'
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

/** Reference measurement (F30, wHaAb/vAxZh/b5RR4 y=777..820): the wizard's continue
 * action is the full-content-width --color-green 44px primary on EVERY step. F30 is
 * fixed, so on top of the primary tokens this gate pins the full-width geometry: the
 * action must span its container's content box exactly (±1px), failing any future
 * regression to a shrunk secondary-style button. */
async function assertFullWidthPrimaryAction(
  page: Page,
  action: Locator,
  label: string,
  copyToken: '--color-on-hero' | '--color-bg' = '--color-on-hero'
): Promise<void> {
  await assertPrimaryActionTokens(page, action, label, copyToken);
  const widths = await action.evaluate((node) => {
    const parent = node.parentElement;
    if (!parent) return null;
    const parentStyle = getComputedStyle(parent);
    return {
      action: node.getBoundingClientRect().width,
      parentContent:
        parent.clientWidth -
        Number.parseFloat(parentStyle.paddingLeft) -
        Number.parseFloat(parentStyle.paddingRight)
    };
  });
  expect(widths, `${label}: primary action must have a measurable container`).not.toBeNull();
  expect(
    Math.abs(widths!.action - widths!.parentContent),
    `${label}: primary action must span the full content width (reference full-width continue action, F30 fixed)`
  ).toBeLessThanOrEqual(1);
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
  const cards = page.locator('main article');
  const count = await cards.count();
  for (let index = 0; index < count; index += 1) {
    const style = await cards.nth(index).evaluate((node) => {
      const computed = getComputedStyle(node);
      return {
        backgroundColor: computed.backgroundColor,
        borderWidth: computed.borderTopWidth,
        borderStyle: computed.borderTopStyle,
        radius: computed.borderTopLeftRadius
      };
    });
    expect(
      style.backgroundColor,
      `${label}: card ${index} must render on the --color-surface grouping surface`
    ).toBe(surface);
    expect(
      style.borderStyle === 'none' || Number.parseFloat(style.borderWidth) === 0,
      `${label}: card ${index} must be borderless like the reference cards`
    ).toBe(true);
    expect(
      Number.parseFloat(style.radius),
      `${label}: card ${index} corner radius must be --radius-12 exactly (reference ~12px corner profile)`
    ).toBe(12);
  }
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
  insetToken: '--space-18'
): Promise<void> {
  const expectedInset = await tokenValue(page, insetToken);
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const innerWidth = window.innerWidth;
    const mainStyle = getComputedStyle(main);
    return {
      innerWidth,
      paddingLeft: mainStyle.paddingLeft,
      paddingRight: mainStyle.paddingRight,
      borderLeft: mainStyle.borderLeftWidth,
      borderRight: mainStyle.borderRightWidth,
      blocks: Array.from(main.children, (node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: innerWidth - box.right };
      })
    };
  });
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
  token: '--space-8' | '--space-10'
): Promise<void> {
  const expected = await tokenValue(page, token);
  const expectedPx = Number.parseFloat(expected);
  const measured = await page.evaluate((target) => {
    const container = document.querySelector(target);
    if (!container) return null;
    const containerStyle = getComputedStyle(container);
    const containerBox = container.getBoundingClientRect();
    const children = Array.from(container.children)
      .filter((node): node is Element => node instanceof Element)
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
  if (calibrating) {
    // Measurement pass: record and keep measuring (see the calibration note above).
    structuralViolations.push(...problems);
    writeCalibrationArtifact();
    return;
  }
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
  // F18: aria-current="page" must appear on the active tab ONLY — asserted
  // document-wide, not merely "attached somewhere".
  await expect(
    page.locator('[aria-current="page"]'),
    'exactly one element carries aria-current="page" document-wide'
  ).toHaveCount(1);
  // Reference ENn8Q y=83..126 (pixel-verified): the tab row is a 44px full-content-width
  // track filled #e9efe8 (--color-surface-2) and the active tab is the only white
  // #ffffff pill on it; inactive labels sit directly on the track. F28 is fixed: the
  // implementation renders exactly that treatment, so both colors are pinned to their
  // tokens exactly (token-relative so the dark-theme run gates its own palette).
  const track = await tokenColor(page, '--color-surface-2');
  const pill = await tokenColor(page, '--color-surface');
  const trackTreatment = await page
    .getByRole('navigation', { name: copy.matches.navigationLabel })
    .evaluate((node) => {
      const computed = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return { background: computed.backgroundColor, height: box.height };
    });
  expect(
    trackTreatment.background,
    'tab track must be filled with --color-surface-2 (reference #e9efe8, F28 fixed)'
  ).toBe(track);
  expect(trackTreatment.height, 'tab track must be the 44px reference row').toBeGreaterThanOrEqual(
    44
  );
  for (const [index, tab] of labels.entries()) {
    await expect(tabs.nth(index)).toHaveAccessibleName(copy.matches.tabs[tab]);
    const treatment = await tabs.nth(index).evaluate((node) => {
      const computed = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        ariaCurrent: node.getAttribute('aria-current'),
        background: computed.backgroundColor,
        weight: computed.fontWeight,
        minHeight: computed.minHeight,
        height: box.height
      };
    });
    expect(
      Math.max(Number.parseFloat(treatment.minHeight), treatment.height),
      `tab ${tab} must meet the 44px target (reference tab row is 44px tall)`
    ).toBeGreaterThanOrEqual(44);
    if (tab === active) {
      await expect(tabs.nth(index)).toHaveAttribute('aria-current', 'page');
      // Reference ENn8Q: the active tab is the only white pill and the only semibold
      // label in the row (F28 fixed — white --color-surface pill on the surface-2 track).
      expect(treatment.background, 'active tab must carry the white --color-surface pill').toBe(
        pill
      );
      expect(treatment.weight, 'active tab label must be semibold').toBe('600');
    } else {
      expect(treatment.ariaCurrent, `non-active tab ${tab} must not carry aria-current`).toBeNull();
      expect(treatment.background, `non-active tab ${tab} must stay unpilled`).toBe(
        'rgba(0, 0, 0, 0)'
      );
      expect(treatment.weight, `non-active tab ${tab} must stay regular weight`).toBe('400');
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
  // The corrected token ring is --border-width-lg (2px), matching the design states
  // board (n6zFq) 2px visible ring. Pinned exactly so a silent downgrade back to the
  // 1px --border-width-md ring cannot pass.
  expect(
    ring!.outlineWidth,
    `${label}: focus ring must be the design-required 2px (--border-width-lg)`
  ).toBe(2);
  await test.info().attach(`${label} — measured focus ring`, {
    body: `${ring!.outlineWidth}px ${ring!.outlineStyle} ${ring!.outlineColor} (design states board: 2px visible ring)`
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
  // see the personal RESERVE badge.
  const existing = await member.client
    .from('match_event_registrations')
    .select('user_id')
    .eq('match_event_id', reserveId)
    .eq('user_id', member.id)
    .maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return;
  await fixtureSql(
    `insert into public.match_event_registrations(match_event_id,user_id,accepted_at) ` +
      `values ('${reserveId}','${member.id}', now() + interval '2 seconds');`
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
    assertManifestProvenance();
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

    // Header order: title → subtitle → current step label.
    const headerChildren = await page
      .locator('main > header')
      .evaluate((header) => Array.from(header.children, (node) => node.tagName.toLowerCase()));
    expect(headerChildren).toEqual(['h1', 'p', 'p']);
    await expect(page.locator('main > header > p').nth(1)).toHaveText(en.matchCreate.steps.details);

    // Exactly the two scoped enums; no Ranked/League state anywhere.
    const enumOptions = (label: string): Promise<string[]> =>
      page
        .getByLabel(label)
        .evaluate((select) =>
          select instanceof HTMLSelectElement ? Array.from(select.options, (o) => o.value) : []
        );
    expect(await enumOptions(en.matchCreate.fields.type)).toEqual(['competitive', 'friendly']);
    expect(await enumOptions(en.matchCreate.fields.visibility)).toEqual([
      'community_open',
      'invite_only'
    ]);
    await expect(page.getByText(/ranked|league/i)).toHaveCount(0);

    // Field order: community → date → start time → type → visibility → saved venue →
    // venue name → Maps → court notes → duration → notes → level restriction → min/max
    // level → booked → price → currency → payment note → maximum → cutoff, then the
    // photo upload. The sequence of rendered label captions is asserted exactly.
    const expectedLabelOrder = [
      en.matchCreate.fields.community,
      en.matchCreate.fields.date,
      en.matchCreate.fields.startTime,
      en.matchCreate.fields.type,
      en.matchCreate.fields.visibility,
      en.matchCreate.fields.savedVenue,
      en.matchCreate.fields.venueName,
      en.matchCreate.fields.mapsUrl,
      en.matchCreate.fields.courtNotes,
      en.matchCreate.fields.duration,
      en.matchCreate.fields.notes,
      en.matchCreate.fields.levelRestriction,
      en.matchCreate.fields.minLevel,
      en.matchCreate.fields.maxLevel,
      en.matchCreate.fields.courtBooked,
      en.matchCreate.fields.price,
      en.matchCreate.fields.currency,
      en.matchCreate.fields.paymentNote,
      en.matchCreate.fields.maximumRegistrations,
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

    // Suggested level range comes from the creator rating (3.2 → 2.7–4.7); the community
    // select carries the fixture community (first select in the form).
    await expect(page.getByLabel(en.matchCreate.fields.minLevel)).toHaveValue('2.7');
    await expect(page.getByLabel(en.matchCreate.fields.maxLevel)).toHaveValue('4.7');
    const communityName = await page
      .locator('main label select')
      .first()
      .evaluate((select) =>
        select instanceof HTMLSelectElement ? (select.selectedOptions[0]?.textContent ?? '') : ''
      );
    expect(communityName).toBe('Vale Padel Society');

    await assertHeadingTypography(page, 'create details 390');
    await assertGutterAxis(page, 'create details 390', '--space-18');
    await assertRhythm(page, 'create details 390', 'main > div', '--space-10');
    // F30 fixed: the continue action is the full-width green 44px primary on every step.
    await assertFullWidthPrimaryAction(
      page,
      page.getByRole('button', { name: en.matchCreate.next }),
      'create details continue',
      '--color-bg'
    );
    await assertNoHorizontalOverflow(page, 'create details 390');
    await assertPrimaryHitTargets(page, 'create details 390');
    await compare(page, 'create-details.png');

    const darkContext = await newContext(browser, { theme: 'dark' });
    const darkPage = await darkContext.newPage();
    await signIn(darkPage, host);
    await darkPage.goto('/matches/create');
    await ready(darkPage);
    expect(await darkPage.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
    await assertHeadingTypography(darkPage, 'create details dark');
    await assertGutterAxis(darkPage, 'create details dark', '--space-18');
    await assertNoHorizontalOverflow(darkPage, 'create details dark');
    await compare(darkPage, 'create-details-dark.png');
    await darkContext.close();

    // Players step: member search with no preselected chips (no fake participants).
    await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await expect(page.locator('main > header > p').nth(1)).toHaveText(en.matchCreate.steps.players);
    await expect(page.getByLabel(en.matchCreate.invitees.search)).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(0);
    await assertHeadingTypography(page, 'create players 390');
    await assertGutterAxis(page, 'create players 390', '--space-18');
    await assertRhythm(page, 'create players 390', 'main > div', '--space-10');
    await assertFullWidthPrimaryAction(
      page,
      page.getByRole('button', { name: en.matchCreate.next }),
      'create players continue',
      '--color-bg'
    );
    await assertNoHorizontalOverflow(page, 'create players 390');
    await assertPrimaryHitTargets(page, 'create players 390');
    // Wizard navigation moves focus into the form for keyboard users.
    expect(
      await page.evaluate(
        () =>
          document.activeElement instanceof HTMLElement &&
          document.activeElement.tagName === 'INPUT'
      )
    ).toBe(true);
    await compare(page, 'create-players.png');

    // Team-mode step: exactly the two scoped assignment modes, POST_MATCH_TEAMS default.
    await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await expect(page.locator('main > header > p').nth(1)).toHaveText(en.matchCreate.steps.teams);
    const radios = page.getByRole('radio');
    await expect(radios).toHaveCount(2);
    await expect(radios.nth(0)).not.toBeChecked();
    await expect(radios.nth(1)).toBeChecked();
    const radioLabels = await page.getByRole('radio').evaluateAll((nodes) =>
      nodes.map((radio) => {
        const label = radio.closest('label');
        return label ? label.getBoundingClientRect().height : 0;
      })
    );
    await test.info().attach('team-mode radio label heights (known deviation)', {
      body: radioLabels.map((height) => `label height ${height}px`).join('\n')
    });
    await assertHeadingTypography(page, 'create team mode 390');
    await assertGutterAxis(page, 'create team mode 390', '--space-18');
    await assertRhythm(page, 'create team mode 390', 'main > div', '--space-10');
    await assertFullWidthPrimaryAction(
      page,
      page.getByRole('button', { name: en.matchCreate.next }),
      'create team mode continue',
      '--color-bg'
    );
    await assertNoHorizontalOverflow(page, 'create team mode 390');
    await assertPrimaryHitTargets(page, 'create team mode 390');
    await compare(page, 'create-team-mode.png');
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
    await page.getByLabel(en.matchCreate.fields.maximumRegistrations).fill('16');
    await page
      .getByLabel(en.matchCreate.fields.photo)
      .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: matchPhoto() });
    await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
      timeout: 15_000
    });
    for (let step = 0; step < 3; step += 1)
      await page.getByRole('button', { name: en.matchCreate.next }).click();
    await ready(page);
    await expect(page.getByRole('heading', { name: en.matchCreate.review })).toBeVisible();

    // Required review facts: the cutoff instant (clock-derived, masked in the capture),
    // the informational cost, the invite count and an enabled publication action.
    await expect(page.locator('main section > p').first()).toContainText('· UTC');
    await expect(page.getByText(en.matchCreate.informationalOnly)).toBeVisible();
    await expect(page.getByText('€12.00', { exact: false })).toBeVisible();
    await expect(
      page.getByText(`${en.matchCreate.invitees.selected}: 0`, { exact: false })
    ).toBeVisible();
    const publish = page.getByRole('button', { name: en.matchCreate.publish });
    await expect(publish).toBeVisible();
    await expect(publish).toBeEnabled();
    await assertHeadingTypography(page, 'create review 390');
    await assertGutterAxis(page, 'create review 390', '--space-18');
    await assertRhythm(page, 'create review 390', 'main > div', '--space-10');
    await assertFullWidthPrimaryAction(
      page,
      page.getByRole('button', { name: en.matchCreate.publish }),
      'create review publish',
      '--color-bg'
    );
    await assertNoHorizontalOverflow(page, 'create review 390');
    await assertPrimaryHitTargets(page, 'create review 390');
    await compare(page, 'create-review.png', dynamicMasks(page, 'review'));
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
      baseline: string;
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
        competitive.getByText(`${copy.matches.type.competitive} · Marina Alves`, { exact: false })
      ).toBeVisible();
      await assertLocalizedCountText(reserve, copy, options.locale ?? 'en', 2);
      await expect(reserve.getByRole('strong')).toHaveText(copy.matches.badges.reserve);
      await expect(competitive.getByRole('strong')).toHaveCount(0);
      if ((options.locale ?? 'en') === 'en')
        await expect(
          competitive.getByText(`${copy.matches.card.pricePerPlayer}: €7.50`)
        ).toBeVisible();

      await assertTabsKeyboardReachable(page, copy);
      await assertHeadingTypography(page, `available ${options.baseline}`);
      await assertGutterAxis(page, `available ${options.baseline}`, '--space-18');
      await assertRhythm(
        page,
        `available ${options.baseline}`,
        'main > section[aria-label]',
        '--space-8'
      );
      await assertCardGrouping(page, `available ${options.baseline}`);
      await assertPrimaryActionTokens(
        page,
        page.locator('main > header > a').first(),
        `available ${options.baseline} create action`
      );
      await assertPhotoAspectTreatment(page, `available ${options.baseline}`);
      await assertNoHorizontalOverflow(page, `available ${options.baseline}`);
      await assertPrimaryHitTargets(page, `available ${options.baseline}`);
      await compare(page, options.baseline, dynamicMasks(page, 'list'));
      await context.close();
    };

    await run({ baseline: 'available-populated.png' });
    await run({ viewport: { width: 320, height: 844 }, baseline: 'available-populated-320.png' });
    await run({
      viewport: { width: 1280, height: 800 },
      baseline: 'available-populated-desktop.png'
    });
    await run({ locale: 'pt-BR', baseline: 'available-populated-pt-BR.png' });
    await run({ locale: 'es', baseline: 'available-populated-es.png' });
    await run({ theme: 'dark', baseline: 'available-populated-dark.png' });
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
    await assertHeadingTypography(page, 'available empty');
    await assertGutterAxis(page, 'available empty', '--space-18');
    await assertPrimaryActionTokens(
      page,
      page.locator('main > header > a').first(),
      'available empty header create action'
    );
    await assertPrimaryActionTokens(
      page,
      page.locator('main > section').filter({ hasText: en.matches.empty.available }).locator('a'),
      'available empty state create action'
    );
    await assertNoHorizontalOverflow(page, 'available empty');
    await assertPrimaryHitTargets(page, 'available empty');
    await compare(page, 'available-empty.png');
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
    await assertHeadingTypography(page, 'my matches reserve');
    await assertGutterAxis(page, 'my matches reserve', '--space-18');
    await assertRhythm(page, 'my matches reserve', 'main > section[aria-label]', '--space-8');
    await assertCardGrouping(page, 'my matches reserve');
    await assertPrimaryActionTokens(
      page,
      page.locator('main > header > a').first(),
      'my matches reserve create action'
    );
    await assertPhotoAspectTreatment(page, 'my matches reserve');
    await assertNoHorizontalOverflow(page, 'my matches reserve');
    await assertPrimaryHitTargets(page, 'my matches reserve');
    await compare(page, 'my-matches-reserve.png', dynamicMasks(page, 'list'));
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
    await assertHeadingTypography(page, 'my matches invited');
    await assertGutterAxis(page, 'my matches invited', '--space-18');
    await assertRhythm(page, 'my matches invited', 'main > section[aria-label]', '--space-8');
    await assertCardGrouping(page, 'my matches invited');
    await assertNoHorizontalOverflow(page, 'my matches invited');
    await assertPrimaryHitTargets(page, 'my matches invited');
    await compare(page, 'my-matches-invited.png', dynamicMasks(page, 'list'));

    // Invitation detail: invitation context without any inert accept/decline action (T05).
    await card.getByRole('link', { name: VENUES.invited, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${family.invitedId}$`));
    await ready(page);
    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${VENUES.invited}` })
    ).toBeVisible();
    await expect(page.getByText(en.matches.detail.invitationInfo)).toBeVisible();
    const buttons = page.getByRole('button');
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveAccessibleName(en.matches.detail.share);
    await assertHeadingTypography(page, 'invite detail');
    await assertGutterAxis(page, 'invite detail', '--space-18');
    await assertRhythm(page, 'invite detail', 'main', '--space-8');
    // The grouped white section surfaces are the reference-measured "detail section
    // cards" (eYIgj/JLqMT): gate their rendered spacing and box wrap directly.
    await assertRhythm(page, 'invite detail', 'main > div', '--space-8');
    await assertPrimaryActionTokens(
      page,
      page.getByRole('button', { name: en.matches.detail.share }),
      'invite detail share'
    );
    await assertNoHorizontalOverflow(page, 'invite detail');
    await assertPrimaryHitTargets(page, 'invite detail');
    await compare(page, 'detail-invitee.png', dynamicMasks(page, 'detail'));
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
    await assertHeadingTypography(page, 'past elapsed');
    await assertGutterAxis(page, 'past elapsed', '--space-18');
    await assertRhythm(page, 'past elapsed', 'main > section[aria-label]', '--space-8');
    await assertCardGrouping(page, 'past elapsed');
    await assertNoHorizontalOverflow(page, 'past elapsed');
    await assertPrimaryHitTargets(page, 'past elapsed');
    await compare(page, 'past-elapsed.png', dynamicMasks(page, 'list'));

    const guestPage = await guestContext.newPage();
    await signIn(guestPage, family.guest!);
    await guestPage.goto('/matches/past');
    await ready(guestPage);
    await expect(guestPage.getByText(en.matches.empty.past)).toBeVisible();
    await expect(guestPage.locator('main article')).toHaveCount(0);
    await assertTabSet(guestPage, en, 'past');
    await assertHeadingTypography(guestPage, 'past empty');
    await assertGutterAxis(guestPage, 'past empty', '--space-18');
    await assertNoHorizontalOverflow(guestPage, 'past empty');
    await assertPrimaryHitTargets(guestPage, 'past empty');
    await compare(guestPage, 'past-empty.png');
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
        name: `${en.matches.detail.title}: ${VENUES.friendly}`
      })
    ).toBeVisible();
    await expect(page.getByRole('link', { name: en.matches.back })).toBeVisible();
    await expect(page.getByText(en.matches.detail.creatorAccepted)).toBeVisible();
    await expect(page.getByText(`${en.matches.card.pricePerPlayer}: €12.00`)).toBeVisible();
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
      name: en.matches.card.openMaps.replace('{{venue}}', VENUES.friendly)
    });
    await expect(mapsLink).toBeVisible();
    await expect(mapsLink).toHaveAttribute('rel', /noopener noreferrer/);
    const share = page.getByRole('button', { name: en.matches.detail.share });
    await expect(share).toBeVisible();
    await expect(page.getByLabel(en.matches.detail.shareUrl)).toHaveValue(
      new RegExp(`/matches/${family.friendlyId}$`)
    );
    await assertHeadingTypography(page, 'friendly detail 390');
    await assertGutterAxis(page, 'friendly detail 390', '--space-18');
    await assertRhythm(page, 'friendly detail 390', 'main', '--space-8');
    // The grouped white section surfaces are the reference-measured "detail section
    // cards" (eYIgj): gate their rendered spacing and box wrap directly.
    await assertRhythm(page, 'friendly detail 390', 'main > div', '--space-8');
    await assertPrimaryActionTokens(
      page,
      page.getByRole('button', { name: en.matches.detail.share }),
      'friendly detail share'
    );
    await assertPhotoAspectTreatment(page, 'friendly detail');
    await assertNoHorizontalOverflow(page, 'friendly detail 390');
    await assertPrimaryHitTargets(page, 'friendly detail 390');
    await compare(page, 'detail-friendly-creator.png', dynamicMasks(page, 'detail'));

    const darkContext = await newContext(browser, { theme: 'dark' });
    const darkPage = await darkContext.newPage();
    await signIn(darkPage, family.host!);
    await darkPage.goto(`/matches/${family.friendlyId}`);
    await ready(darkPage);
    await assertHeadingTypography(darkPage, 'friendly detail dark');
    await assertGutterAxis(darkPage, 'friendly detail dark', '--space-18');
    await assertNoHorizontalOverflow(darkPage, 'friendly detail dark');
    await compare(darkPage, 'detail-friendly-creator-dark.png', dynamicMasks(darkPage, 'detail'));
    await darkContext.close();

    // Public guest view of the same event: truthful future-approval information, no join.
    const guestPage = await guestContext.newPage();
    await signIn(guestPage, family.guest!);
    await guestPage.goto(`/matches/${family.friendlyId}`);
    await ready(guestPage);
    await expect(
      guestPage.getByRole('heading', {
        level: 1,
        name: `${en.matches.detail.title}: ${VENUES.friendly}`
      })
    ).toBeVisible();
    await expect(guestPage.getByText(en.matches.detail.guestApprovalRequired)).toBeVisible();
    await expect(guestPage.getByText(en.matches.visibility.community_open)).toBeVisible();
    const guestButtons = guestPage.getByRole('button');
    await expect(guestButtons).toHaveCount(1);
    await expect(guestButtons).toHaveAccessibleName(en.matches.detail.share);
    for (const link of await guestPage.getByRole('link').all())
      expect((await link.textContent()) ?? '').not.toMatch(/book|pay|purchase|join|register/i);
    await assertHeadingTypography(guestPage, 'guest detail');
    await assertGutterAxis(guestPage, 'guest detail', '--space-18');
    await assertRhythm(guestPage, 'guest detail', 'main', '--space-8');
    // The grouped white section surfaces are the reference-measured "detail section
    // cards" (JLqMT): gate their rendered spacing and box wrap directly.
    await assertRhythm(guestPage, 'guest detail', 'main > div', '--space-8');
    await assertPrimaryActionTokens(
      guestPage,
      guestPage.getByRole('button', { name: en.matches.detail.share }),
      'guest detail share'
    );
    await assertPhotoAspectTreatment(guestPage, 'guest detail');
    await assertNoHorizontalOverflow(guestPage, 'guest detail');
    await assertPrimaryHitTargets(guestPage, 'guest detail');
    await compare(guestPage, 'detail-public-guest.png', dynamicMasks(guestPage, 'detail'));
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
    await compare(page, 'state-unavailable.png');
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
    await assertGutterAxis(page, 'loading', '--space-18');
    await assertNoHorizontalOverflow(page, 'loading');
    await compare(page, 'state-loading.png');

    // Going offline while the request is in flight must surface the offline output and
    // keep mutations blocked (no queued publication path exists).
    offline = true;
    await context.setOffline(true);
    await expect(page.getByText(en.matches.offline)).toBeVisible({ timeout: 15_000 });
    await expect(loadMore).toBeDisabled();
    await assertGutterAxis(page, 'offline', '--space-18');
    await assertNoHorizontalOverflow(page, 'offline');
    await compare(page, 'state-offline.png');
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
    await assertGutterAxis(page, 'error', '--space-18');
    await assertNoHorizontalOverflow(page, 'error');
    await assertPrimaryHitTargets(page, 'error');
    await compare(page, 'state-error.png');
  });

  test.afterAll(async () => {
    await test.info().attach('visual calibration measurements', {
      body: JSON.stringify({ measurements: calibration, structuralViolations }, null, 1)
    });
    await Promise.all(family.contexts.splice(0).map((context) => context.close()));
  });
});
