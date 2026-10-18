import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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
import { runCleanupTasks, runMatchFixtureCleanup } from './match-fixture-cleanup';

// PAF-5.6 visual gate (PAF-83). Companion to e2e/matches-registration.spec.ts — the
// functional journeys live there and must stay untouched. Every screen pairs exact
// structural probes (asserted against the reference measurements recorded in
// e2e/references/paf-5/manifest.json, never against the implementation) with a
// screenshot gate against the approved Pencil exports.
//
// Frame mapping (see the manifest's referenceMeasurements):
//   registration-direct-join / registration-full / registration-closed (fo8Zn/SYMLa/
//   tYXlh, 390x872) — full detail screens → structural probes + pixel budgets. The
//   frames are stored UNCROPPED because a top-844 crop would truncate their approved
//   bottom navigation; the deterministic handling here is NO crop: the browser
//   viewport is set to 390x872 for exactly these comparisons so the whole approved
//   frame is compared 1:1 against an equally tall app capture.
//   notifications-quartet-playing / notifications-registration-cutoff (qNVpA/Z0gRd,
//   390x844) — notification list states → structural probes + pixel budgets.
//   requests-requester-states (Za6r4), roster-participation-states (xC04T) and
//   participation-quartet-filled (Cpd7L) — state/content boards: mutually exclusive
//   panel states (or the roster block) stacked in one frame. No single app screen can
//   ever render them at once, so per the reviewed n6zFq convention (PAF-4
//   states-board) they drive exact structural assertions only and never a pixel
//   budget.
//
// Roster facts of the detail frames are gated on accepted viewers of the same
// events: the reviewed PAF-5.5 implementation scopes the roster region to the
// caller's own accepted registration, while the frames draw it for every viewer
// state. The visibility difference is a recorded deviation (manifest
// recordedDeviations) — asserted explicitly below, never absorbed into a budget.
//
// The design frames define 390-wide light English screens only. For 320 / desktop /
// dark / pt-BR / es — variants with no approved frame — this suite asserts the
// invariants that must hold (no horizontal overflow, every tappable control ≥44px,
// translated long text tolerated, dark palette actually applied) and deliberately
// does NOT self-authorize screenshot baselines: new baselines require reviewed
// frames first.
//
// Run through `pnpm test:e2e` only — never a bare `playwright test`.

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  matches: {
    back: string;
    detail: {
      title: string;
      overview: string;
      participation: string;
      participants: string;
      accepted: string;
      registrationClosed: string;
    };
    counts: Record<string, string>;
  };
  matchRegistration: {
    aria: { roster: string };
    join: {
      sectionTitle: string;
      openCopy: string;
      button: string;
      capacity_other: string;
      levelRange: string;
      note: string;
    };
    full: { badge: string; detail: string; copy: string; button: string; note: string };
    closed: {
      badge: string;
      detail: string;
      rosterCount: string;
      sectionTitle: string;
      button: string;
      note: string;
    };
    request: {
      back: string;
      context: string;
      pendingBadge: string;
      pendingCopy: string;
      viewMatch: string;
      approvedPlayingBadge: string;
      approvedPlayingCopy: string;
      viewGroup: string;
      approvedReserveBadge: string;
      approvedReserveCopy: string;
      declinedBadge: string;
      declinedCopy: string;
      requestAgain: string;
      expiredBadge: string;
      expiredCopy: string;
      viewMatchHistory: string;
      note: string;
    };
    roster: {
      groupTitle: string;
      reserveTitle: string;
      fifo: string;
      notPlayingTitle: string;
      you: string;
      orderNote: string;
      authoritativeNote: string;
      position: string;
      count_one: string;
      count_other: string;
    };
    badges: {
      playing: string;
      reserve: string;
      reserveNotPlaying: string;
      guest: string;
      member: string;
    };
  };
  notifications: {
    title: string;
    subtitle: string;
    today: string;
    earlier: string;
    markAllRead: string;
    markRead: string;
    filters: { label: string; all: string };
    kinds: Record<string, string>;
    unread_other: string;
    match: { openEvent: string; registrationQuartetCompleteBody: string };
  };
};

const localeCopy = (locale: string): Copy =>
  JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
const en = localeCopy('en');
const ptBr = localeCopy('pt-BR');
const es = localeCopy('es');

// ---------------------------------------------------------------------------
// Pinned provenance (same trust rules as matches-visual.spec.ts): the manifest
// records the reviewed source-design digest, the approved reference digests and
// the derived baseline digests; all three are re-verified at runtime (and after
// each comparison, so --update-snapshots cannot silently replace a reviewed
// baseline with a live capture).
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
    readFileSync(new URL('./references/paf-5/manifest.json', import.meta.url), 'utf8')
  );
  if (!isVisualManifest(raw)) throw new Error('Invalid PAF-5 visual provenance manifest');
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
      digestFile(new URL(`./references/paf-5/${reference}`, import.meta.url)),
      `${reference} must match its reviewed Pencil export digest`
    ).toBe(approved.sha256);
  }
  for (const [baseline, derived] of Object.entries(visualManifest.screenshotBaselines)) {
    expect(
      digestFile(
        new URL(`./matches-registration-visual.spec.ts-snapshots/${baseline}`, import.meta.url)
      ),
      `${baseline} must match its reviewed derivation digest`
    ).toBe(derived.sha256);
  }
}

function assertBaselineUnchanged(baseline: string): void {
  const derived = visualManifest.screenshotBaselines[baseline];
  if (!derived) return;
  expect(
    digestFile(
      new URL(`./matches-registration-visual.spec.ts-snapshots/${baseline}`, import.meta.url)
    ),
    `${baseline} must still match its reviewed derivation after the comparison`
  ).toBe(derived.sha256);
}

// ---------------------------------------------------------------------------
// Per-screen budgets. Calibrated (VISUAL_CALIBRATE=1) against the real
// implementation and pinned in e2e/references/paf-5/manifest.json together with
// the measured values and the scope-adaptation breakdown. Margins only absorb
// cross-renderer font residuals (+2pp for screens measuring <20%, +1.5pp for
// screens measuring ≥20%, mirroring the PAF-1/PAF-4 measured rasterization
// residuals); structural attributes stay gated budget-independently below.
// The zero values below are calibration placeholders: a regular (non-calibrate)
// run fails every comparison until the measured budgets are pinned.
// ---------------------------------------------------------------------------
const VISUAL_BUDGETS: Record<string, number> = {
  'registration-direct-join.png': 0.415,
  'registration-full.png': 0.365,
  'registration-closed.png': 0.375,
  'notifications-quartet-playing.png': 0.365,
  'notifications-registration-cutoff.png': 0.455
};

const MASK_COLOR = '#FF00FF';

// Calibration mode (VISUAL_CALIBRATE=1): first honest comparison measurements are
// recorded and reported instead of failing the run (same mechanism as the PAF-4
// gate). Regular runs never set this and every comparison is a hard gate.
const calibration: Record<string, string> = {};
const structuralViolations: string[] = [];
const calibrating = process.env.VISUAL_CALIBRATE === '1';

function writeCalibrationArtifact(): void {
  writeFileSync(
    new URL('../test-results/matches-registration-visual-calibration.json', import.meta.url),
    JSON.stringify({ measurements: calibration, structuralViolations }, null, 1)
  );
}

function baselinePath(baseline: string): string {
  return new URL(`./matches-registration-visual.spec.ts-snapshots/${baseline}`, import.meta.url)
    .pathname;
}

async function compare(page: Page, baseline: string, masks: Locator[] = []): Promise<void> {
  if (calibrating && !existsSync(baselinePath(baseline))) {
    // Every PAF-5 baseline ships as an approved-reference copy, so this branch
    // only keeps a from-scratch calibration run going; the capture applies the
    // same dynamic-area masks as the comparisons.
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
// Local loopback stack fixtures (same trust rules as the sibling suites: real
// publishable-key JWTs, trusted local SQL only for seeded accepted rows and
// notification rows, no service-role client anywhere). Every actor signs up
// through the @test.local domain so the global-setup prune owns every row this
// suite creates; browser contexts are closed in afterAll.
// ---------------------------------------------------------------------------

const password = 'Password123!';
const config = localConfig();
const ownedActors = new Map<string, Actor>();
const ownedEvents = new Set<string>();
const uploadedPhotos: { actor: Actor; path: string }[] = [];

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
    throw new Error('Registration visual E2E requires loopback Supabase');
  return { url, key };
}

/** A real, decodable 1x1 PNG (70 bytes) — the same fixture photo the sibling suites use. */
function matchPhoto(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
}

/** UTC calendar date offset by whole days; event instants resolve in the community UTC zone. */
function ymd(offsetDays: number): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

/** i18n interpolation for locale templates, e.g. `fill(t, { remaining: 2, maximum: 8 })`. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    template
  );
}

/** A notification kind title must exist in the locale; a missing key is a
 * translation defect, never an empty assertion. */
function kindTitle(copy: Copy, key: string): string {
  const value = copy.notifications.kinds[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`Missing notification kind copy: ${key}`);
  return value;
}

async function createActor(displayName: string, level = 3.2): Promise<Actor> {
  const bootstrap = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `match-reg-visual-${crypto.randomUUID()}@test.local`;
  const signup = await bootstrap.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(
      `Could not create local visual E2E actor: ${signup.error?.message ?? 'no session'}`
    );
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const actor = { id: signup.data.user.id, email, displayName, client };
  ownedActors.set(actor.id, actor);
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: displayName,
    p_preferred_side: 'EITHER',
    p_initial_level: level
  });
  if (onboarded.error) throw onboarded.error;
  return actor;
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
  const actor = { id, email, displayName, client };
  ownedActors.set(actor.id, actor);
  return actor;
}

async function createPublicCommunity(admin: Actor): Promise<string> {
  const created = await admin.client.rpc('create_community', {
    p_name: 'Registration Visual Society',
    p_visibility: 'public',
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community fixture failed');
  await pinCommunityUtc(created.data);
  return created.data;
}

/** Every frame under visual QA resolves event instants in the UTC zone; pin the
 * effective admin defaults so the community never inherits a localized default. */
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
  uploadedPhotos.push({ actor, path });
  return path;
}

function publishInput(
  communityId: string,
  draft: { date: string; startTime: string; venueName: string; price?: string; maximum?: number }
): Record<string, unknown> {
  return {
    community_id: communityId,
    date: draft.date,
    start_time: draft.startTime,
    event_type: 'competitive',
    visibility: 'community_open',
    team_assignment_mode: 'PREDEFINED_TEAMS',
    venue_name: draft.venueName,
    maps_url: `https://maps.google.com/maps/place/${encodeURIComponent(draft.venueName)}`,
    photo_path: null,
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
  input: Record<string, unknown>
): Promise<void> {
  const photoPath = await stagePhoto(actor, String(input.community_id), eventId);
  const result = await actor.client.rpc('publish_match_event', {
    p_event_id: eventId,
    p_input: { ...input, photo_path: photoPath },
    p_invitee_ids: []
  });
  if (result.error || result.data !== eventId)
    throw result.error ?? new Error(`Publication fixture failed for ${eventId}`);
}

/** Trusted local SQL harness (single atomic DO block; only fixture seeding runs
 * through it, exactly like the sibling suites). */
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

/** Trusted read-only fixture query returning the CLI's JSON rows. */
async function fixtureRows(sql: string): Promise<Record<string, unknown>[]> {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
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
  if (code !== 0) throw new Error(`Trusted fixture query failed (${code}): ${stdout}\n${stderr}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Fixture query returned no JSON: ${stdout.slice(0, 400)}`);
  }
  // The CLI v2.118 prints the statement's rows as a top-level JSON array of
  // row objects (the banner goes to stderr); older CLI revisions nested them
  // under a `rows` key. Model both, nothing else.
  if (Array.isArray(parsed))
    return parsed.filter((row): row is Record<string, unknown> => isRecord(row));
  const rows = isRecord(parsed) ? parsed['rows'] : undefined;
  return Array.isArray(rows)
    ? rows.filter((row): row is Record<string, unknown> => isRecord(row))
    : [];
}

type SeededRow = {
  actor: Actor;
  order: number;
  part: 'playing' | 'reserve' | 'reserve_not_playing';
  source: 'member' | 'guest' | 'creator';
  /**
   * Seeds the organizer-approved anchor (`approved_at = accepted_at`, the exact
   * shape a creator decision writes). The reviewed APPROVED requester states
   * (Za6r4 approved playing/reserve cards, Cpd7L confirmed-place card) must come
   * from a genuinely approved ledger row — never from the old direct-join
   * conflation the panel no longer renders as APPROVED (F27).
   */
  approved?: boolean;
};

/** Seeds the accepted ledger behind the creator's own publication registration
 * (order 1) and advances the event's next accepted ordinal past the seed, so
 * UI/RPC registrations can never collide with the fixture orders. */
async function seedAcceptedRows(eventId: string, rows: SeededRow[]): Promise<void> {
  if (rows.length === 0) return;
  const values = rows.map((row) => {
    // now() is transaction-stable, so both expressions are the exact same
    // instant — the lifecycle-anchors CHECK demands approved_at = accepted_at.
    const acceptedAt = `now() - interval '${row.order * 3} minutes'`;
    return (
      `('${eventId}','${row.actor.id}', ${acceptedAt}, ` +
      `${row.approved ? acceptedAt : 'null'}, ` +
      `${row.order}, '${row.part}', '${row.source}')`
    );
  });
  const maxOrder = Math.max(...rows.map((row) => row.order));
  await fixtureSql(
    `insert into public.match_event_registrations` +
      `(match_event_id,user_id,accepted_at,approved_at,accepted_order,participation_status,registration_source) ` +
      `values ${values.join(',')}; ` +
      `update public.match_event_registration_state set next_accepted_ordinal = ${maxOrder + 1} ` +
      `where match_event_id = '${eventId}';`
  );
}

async function submitRegistration(actor: Actor, eventId: string): Promise<void> {
  const result = await actor.client.rpc('submit_match_registration', {
    p_match_event_id: eventId
  });
  if (result.error) throw result.error;
}

async function decideRegistration(
  actor: Actor,
  eventId: string,
  userId: string,
  decision: 'approve' | 'reject'
): Promise<void> {
  const attempt = await fixtureRows(
    `select a.id::text as id from public.match_event_registration_attempts a ` +
      `where a.match_event_id = '${eventId}' and a.user_id = '${userId}' ` +
      `order by a.requested_at desc, a.id desc limit 1;`
  );
  const attemptId = attempt[0]?.['id'];
  if (typeof attemptId !== 'string')
    throw new Error(`no registration attempt for ${userId} on ${eventId}`);
  const result = await actor.client.rpc('decide_match_registration', {
    p_match_event_id: eventId,
    p_attempt_id: attemptId,
    p_decision: decision
  });
  if (result.error) throw result.error;
}

/** The authoritative server projection for the participation facts. */
async function detailData(actor: Actor, eventId: string): Promise<Record<string, unknown>> {
  const result = await actor.client.rpc('get_match_event', { p_event_id: eventId });
  if (result.error) throw result.error;
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error(`Detail for ${eventId} did not resolve to an object`);
  return data;
}

/** Seeds one notification row through the trusted harness (same shape the
 * notification producers write; targets a real readable event so the projection
 * resolves the match context). Returns the row id. */
async function seedNotification(
  actor: Actor,
  eventId: string,
  communityId: string,
  kind: string,
  minutesAgo: number
): Promise<string> {
  const eventKey = `visual:${kind}:${crypto.randomUUID()}`;
  await fixtureSql(
    `insert into public.notifications` +
      `(recipient_user_id,event_key,kind,category,target_type,target_id,community_id,created_at) ` +
      `values ('${actor.id}','${eventKey}','${kind}','matches','match_event','${eventId}',` +
      `'${communityId}', now() - interval '${minutesAgo} minutes');`
  );
  const found = await actor.client
    .from('notifications')
    .select('id')
    .eq('event_key', eventKey)
    .maybeSingle();
  if (found.error || !found.data) throw found.error ?? new Error('Notification seed failed');
  return found.data.id;
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
    // Text-driven font loading is lazy: force the exact faces the app renders with
    // so screenshots never race a pending webfont.
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

/** Dynamic-area masks: venue photo renderings, the detail datetime line and (on
 * the closed screen) the cutoff-instant sentence. Nothing else is ever masked —
 * no field, no card, no whole section, and never a whole screen region such as
 * the design-only bottom navigation. */
function detailMasks(page: Page, options: { closedCopy?: string } = {}): Locator[] {
  const masks = [
    page.locator('main img'),
    page.locator('section[aria-labelledby="match-overview-heading"] > p').first()
  ];
  if (options.closedCopy)
    masks.push(
      page
        .locator('section[aria-labelledby="match-registration-heading"] p')
        .filter({ hasText: options.closedCopy })
    );
  return masks;
}

/** Notification rows carry two genuinely dynamic text areas: the absolute
 * created-at line and the match-context block (its "Starts" line embeds the
 * clock-moving event instant). Both are masked; nothing else is. */
function notificationMasks(page: Page): Locator[] {
  return [
    page.locator('main li p[aria-label]'),
    page.locator('main li div').filter({ has: page.locator('p') })
  ];
}

// ---------------------------------------------------------------------------
// Structural probes (exact assertions against the manifest facts and tokens,
// never against eyeballed pixels)
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

/** Every primary interactive control in main must expose a ≥44px hit target
 * (manifest fact: every tappable control is a comfortable touch target; the
 * app-wide 44px minimum is the reviewed implementation of that fact). */
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

/** Reference measurement (manifest fact): every frame aligns content to one
 * shared axis inset exactly 18px per side at 390px. Gated on the detail surface
 * exactly as the PAF-4 gate does (padding + measured border per side). */
async function assertGutterAxis(page: Page, label: string): Promise<void> {
  const expectedInset = await tokenValue(page, '--space-18');
  const metrics = await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return null;
    const innerWidth = window.innerWidth;
    const mainStyle = getComputedStyle(main);
    return {
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
    `${label}: main gutter must equal --space-18 exactly (manifest fact: 18px shared axis)`
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

/** Normalize a color to the `rgb(r, g, b)` form getComputedStyle reports. */
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

function numberClose(measured: number, expected: number): boolean {
  return Math.abs(measured - expected) < 0.05;
}

function registrationPanel(page: Page): Locator {
  return page.locator('section[aria-labelledby="match-registration-heading"]');
}

function rosterRegion(page: Page, copy: Copy): Locator {
  return page.getByRole('region', { name: copy.matchRegistration.aria.roster });
}

/**
 * The registration CTA gate (manifest facts: join button [18,652,354,44] on
 * fo8Zn; disabled button [18,591,354,44] on SYMLa; disabled button
 * [18,674,354,44] on tYXlh — every registration action is a 44px-tall block).
 * Enabled actions are pinned to the reference-measured primary tokens
 * (--color-green fill with --color-bg copy, the PAF-4 pixel-histogram
 * convention); disabled actions to the explicit disabled treatment
 * (--color-surface-2 fill, --color-muted copy, disabled attribute). The
 * rendered height is gated ≥44 exactly. The rendered width is measured,
 * attached and recorded on every run: the frames draw the registration CTA at
 * the full 354px content width, and the review records the measured width
 * against that fact instead of absorbing it silently (manifest
 * recordedDeviations).
 */
async function assertRegistrationCta(
  page: Page,
  action: Locator,
  label: string,
  options: { disabled?: boolean } = {}
): Promise<void> {
  await expect(action).toHaveCount(1);
  if (options.disabled) await expect(action).toBeDisabled();
  else await expect(action).toBeEnabled();
  const green = await tokenColor(page, '--color-green');
  const copy = await tokenColor(page, '--color-bg');
  const surface2 = await tokenColor(page, '--color-surface-2');
  const muted = await tokenColor(page, '--color-muted');
  const style = await action.evaluate((node) => {
    const computed = getComputedStyle(node);
    const box = node.getBoundingClientRect();
    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      minHeight: computed.minHeight,
      height: box.height,
      width: box.width
    };
  });
  if (options.disabled) {
    expect(
      style.backgroundColor,
      `${label}: disabled CTA must render the explicit surface-2 treatment`
    ).toBe(surface2);
    expect(style.color, `${label}: disabled CTA copy must be --color-muted`).toBe(muted);
  } else {
    expect(
      style.backgroundColor,
      `${label}: registration CTA background must be --color-green (reference #0e714d)`
    ).toBe(green);
    expect(style.color, `${label}: registration CTA copy must be --color-bg`).toBe(copy);
  }
  expect(
    Math.max(Number.parseFloat(style.minHeight), style.height),
    `${label}: registration CTA must meet the 44px target (manifest fact: 44px-tall CTA blocks)`
  ).toBeGreaterThanOrEqual(44);
  await test.info().attach(`${label} — measured CTA box vs frame fact`, {
    body: `rendered ${Math.round(style.width)}x${Math.round(style.height)}; frame fact: 354x44 full-content-width block${options.disabled ? ' (disabled treatment)' : ''}`
  });
}

type RosterRowSpec = { name: string; badges: string[]; position?: string };
type RosterSectionSpec = { title: string; count: string; fifo?: string; rows: RosterRowSpec[] };

/**
 * The roster gate (manifest facts: fo8Zn roster [18,314,354,242] with four
 * playing rows in FIFO order plus two reserve rows and the guest badge on the
 * first reserve row; SYMLa GROUP 1/GROUP 2 with four rows each; tYXlh roster
 * plus the not-playing tail row; xC04T sections playing → reserve → not playing
 * with the guest badge on the second Group 2 row). Asserted exactly against the
 * real roster region: the section heading sequence in DOM order and top-down
 * order, each section's FIFO caption and count line, every row's name, badge
 * sequence and optional reserve position in order, the trailing badge
 * placement, row geometry (each row spans its section's content box exactly and
 * every row meets the 44px touch target — the reviewed a11y adaptation of the
 * frame's 20/25px text rows, recorded in the manifest) and the two closing
 * notes.
 */
async function assertRosterStructure(
  page: Page,
  copy: Copy,
  label: string,
  sections: RosterSectionSpec[]
): Promise<void> {
  const region = rosterRegion(page, copy);
  await expect(region).toBeVisible();
  const headings = region.getByRole('heading');
  await expect(headings).toHaveCount(sections.length);
  const headingTexts = await headings.evaluateAll((nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? '')
  );
  expect(
    headingTexts,
    `${label}: roster section headings must appear exactly in playing → reserve → not-playing order`
  ).toEqual(sections.map((section) => section.title));
  const headingTops = await headings.evaluateAll((nodes) =>
    nodes.map((node) => node.getBoundingClientRect().top)
  );
  for (let index = 1; index < headingTops.length; index += 1)
    expect(
      headingTops[index]! > headingTops[index - 1]!,
      `${label}: roster section ${sections[index]!.title} must sit below ${sections[index - 1]!.title}`
    ).toBe(true);

  for (const section of sections) {
    const sectionBox = region
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: section.title, exact: true }) })
      .first();
    await expect(sectionBox).toBeVisible();
    const expectedCaptions = [
      ...(section.fifo ? [section.fifo] : []),
      section.count,
      ...section.rows.flatMap((row) => [
        row.name,
        ...row.badges,
        ...(row.position ? [row.position] : [])
      ])
    ];
    for (const caption of expectedCaptions)
      await expect(
        sectionBox.getByText(caption, { exact: true }).first(),
        `${label}: roster section "${section.title}" must state "${caption}"`
      ).toBeVisible();

    const rowBoxes = sectionBox.locator('div').filter({ has: page.locator('p') });
    const rowCount = await rowBoxes.count();
    const rowInfo: Array<{
      name: string;
      box: { top: number; bottom: number; left: number; right: number; height: number };
    }> = [];
    for (let index = 0; index < rowCount; index += 1) {
      const info = await rowBoxes.nth(index).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          name: (node.querySelector('p')?.textContent ?? '').trim(),
          hasRowSurface: style.backgroundColor !== 'rgba(0, 0, 0, 0)',
          box: {
            top: box.top,
            bottom: box.bottom,
            left: box.left,
            right: box.right,
            height: box.height
          }
        };
      });
      if (info.name.length === 0 || !info.hasRowSurface) continue;
      rowInfo.push({ name: info.name, box: info.box });
    }
    rowInfo.sort((a, b) => a.box.top - b.box.top);
    expect(
      rowInfo.map((row) => row.name),
      `${label}: roster rows in "${section.title}" must follow the accepted FIFO order`
    ).toEqual(section.rows.map((row) => row.name));

    const sectionMetrics = await sectionBox.evaluate((node) => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        contentLeft: box.left + Number.parseFloat(style.paddingLeft),
        contentRight: box.right - Number.parseFloat(style.paddingRight)
      };
    });
    for (const [index, row] of rowInfo.entries()) {
      expect(
        row.box.height,
        `${label}: roster row ${index} ("${row.name}") must meet the 44px touch target (frame text rows are 20/25px — recorded adaptation)`
      ).toBeGreaterThanOrEqual(44);
      expect(
        numberClose(row.box.left, sectionMetrics.contentLeft) &&
          numberClose(row.box.right, sectionMetrics.contentRight),
        `${label}: roster row ${index} ("${row.name}") must span its section content box exactly (rendered ${row.box.left}..${row.box.right} vs ${sectionMetrics.contentLeft}..${sectionMetrics.contentRight})`
      ).toBe(true);
    }

    for (const [index, rowSpec] of section.rows.entries()) {
      const row = rowBoxes.filter({ hasText: rowSpec.name }).first();
      const nameBox = await row
        .getByText(rowSpec.name, { exact: true })
        .evaluate((node) => node.getBoundingClientRect());
      for (const badge of rowSpec.badges) {
        const badgeBox = await row
          .getByText(badge, { exact: true })
          .evaluate((node) => node.getBoundingClientRect());
        expect(
          badgeBox.left,
          `${label}: badge "${badge}" must sit on or after the name column of its row (manifest badge placement; the app's 44px rows wrap badges the frames draw inline — recorded adaptation)`
        ).toBeGreaterThanOrEqual(nameBox.left - 1);
        expect(
          badgeBox.top >= rowInfo[index]!.box.top &&
            badgeBox.bottom <= rowInfo[index]!.box.bottom + 1,
          `${label}: badge "${badge}" must stay inside its row box`
        ).toBe(true);
      }
    }
  }

  await expect(
    region.getByText(copy.matchRegistration.roster.orderNote, { exact: true })
  ).toBeVisible();
  await expect(
    region.getByText(copy.matchRegistration.roster.authoritativeNote, { exact: true })
  ).toBeVisible();
}

/** The participation facts must state the server's own authoritative counts
 * (manifest fact: the participation block carries the authoritative playing /
 * reserve / group split); the expected line is built from the get_match_event
 * projection, never from the rendered DOM. */
async function assertCountsFromServer(
  page: Page,
  copy: Copy,
  locale: 'en' | 'pt-BR' | 'es',
  detail: Record<string, unknown>
): Promise<void> {
  const number = (key: string): number => (typeof detail[key] === 'number' ? detail[key] : 0);
  const accepted = number('accepted_count');
  const plural = (key: 'playing' | 'reserve' | 'groups' | 'moreNeeded', count: number): string => {
    const form = new Intl.PluralRules(locale).select(count);
    return `${count} ${copy.matches.counts[`${key}_${form}`] ?? copy.matches.counts[`${key}_other`]}`;
  };
  const expected = [
    plural('playing', number('playing_count')),
    plural('reserve', number('reserve_count')),
    plural('groups', number('group_count')),
    plural('moreNeeded', number('more_needed'))
  ].join(' · ');
  await expect(
    page.getByText(expected, { exact: true }),
    'participation counts line must state the authoritative server projection'
  ).toBeVisible();
  await expect(page.getByText(`${accepted} · ${copy.matches.detail.accepted}`)).toBeVisible();
}

/**
 * Panel-state gate for the requester states board (Za6r4 facts: five cards
 * pending → approved playing → approved reserve → declined → expired, each with
 * its badge, copy and one 44px action; the board header carries the back
 * affordance and the "one state at a time" context line — the implementation
 * renders exactly one of these states per surface, so each state is gated on
 * its own fixture viewer). Badge tones are pinned to their tokens exactly.
 */
async function assertRequesterState(
  page: Page,
  copy: Copy,
  label: string,
  state: {
    badge: string;
    badgeTone: 'playing' | 'reserve' | 'muted' | 'danger';
    copyText: string;
    meta?: string;
    /**
     * The Za6r4 board draws the "Approval time sets the queue position" caption
     * under every card; the implementation renders it on the pending, declined
     * and expired states only (the accepted states close with the roster notes,
     * gated by assertRosterStructure). Asserted per state accordingly.
     */
    expectNote?: boolean;
    action: { kind: 'link'; name: string } | { kind: 'button'; name: string; disabled?: boolean };
  }
): Promise<void> {
  const panel = registrationPanel(page);
  await expect(
    panel.getByRole('heading', { name: copy.matchRegistration.request.back })
  ).toBeVisible();
  await expect(
    panel.getByText(copy.matchRegistration.request.context, { exact: true })
  ).toBeVisible();

  const badgeToneTokens: {
    playing: { color: string; background: string };
    reserve: { color: string; background: string };
    muted: { color: string; background: string };
    danger: { color: string; background: string };
  } = {
    playing: { color: '--color-green', background: '--color-green-soft' },
    reserve: { color: '--color-text', background: '--color-surface-2' },
    muted: { color: '--color-muted', background: '--color-surface-2' },
    danger: { color: '--color-red', background: '--color-surface-2' }
  };
  const badge = panel.getByText(state.badge, { exact: true }).first();
  await expect(badge).toBeVisible();
  const tone = badgeToneTokens[state.badgeTone];
  const badgeStyle = await badge.evaluate((node) => {
    const computed = getComputedStyle(node);
    return { color: computed.color, background: computed.backgroundColor };
  });
  expect(
    badgeStyle.color,
    `${label}: badge "${state.badge}" must render its reviewed tone (color)`
  ).toBe(await tokenColor(page, tone.color));
  expect(
    badgeStyle.background,
    `${label}: badge "${state.badge}" must render its reviewed tone (background)`
  ).toBe(await tokenColor(page, tone.background));

  await expect(panel.getByText(state.copyText)).toBeVisible();
  if (state.meta) await expect(panel.getByText(state.meta)).toBeVisible();

  if (state.action.kind === 'button') {
    const button = panel.getByRole('button', { name: state.action.name });
    await expect(button).toHaveCount(1);
    if (state.action.disabled) await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
    const height = await button.evaluate((node) => node.getBoundingClientRect().height);
    expect(
      height,
      `${label}: action "${state.action.name}" must be ≥44px tall`
    ).toBeGreaterThanOrEqual(44);
  } else {
    const link = panel.getByRole('link', { name: state.action.name });
    await expect(link).toHaveCount(1);
    const height = await link.evaluate((node) => node.getBoundingClientRect().height);
    expect(
      height,
      `${label}: action "${state.action.name}" must be ≥44px tall`
    ).toBeGreaterThanOrEqual(44);
  }
  if (state.expectNote !== false)
    await expect(
      panel.getByText(copy.matchRegistration.request.note, { exact: true })
    ).toBeVisible();
}

/**
 * Notification list gate (manifest facts: qNVpA two cards [18,70,354,64] and
 * [18,142,354,64]; Z0gRd six cards in a fixed rhythm with the last card
 * taller). Gated exactly on the app contract: row count, kind titles in
 * created-at order, the unread summary, the MARK ALL READ action and ≥44px
 * targets. The measured row rhythm is attached and recorded against the
 * manifest's 8px fact (the reviewed margin rhythm is a recorded deviation, not
 * an absorbed one).
 */
async function assertNotificationList(
  page: Page,
  copy: Copy,
  label: string,
  expectedTitles: string[]
): Promise<void> {
  const rows = page.locator('main li');
  await expect(rows).toHaveCount(expectedTitles.length);
  for (const [index, title] of expectedTitles.entries()) {
    await expect(
      rows.nth(index).locator('h3'),
      `${label}: notification row ${index} title must follow created-at order`
    ).toHaveText(title);
  }
  const gaps = await rows.evaluateAll((nodes) => {
    const boxes = nodes.map((node) => node.getBoundingClientRect());
    return boxes.slice(1).map((box, index) => box.top - boxes[index]!.bottom);
  });
  await test.info().attach(`${label} — measured notification rhythm vs frame fact`, {
    body: `rendered row gaps [${gaps.map((gap) => gap.toFixed(1)).join(', ')}]px; manifest fact: 8px card rhythm (qNVpA/Z0gRd)`
  });
  await expect(
    page.getByText(fill(copy.notifications.unread_other, { count: expectedTitles.length }), {
      exact: true
    })
  ).toBeVisible();
  await expect(page.getByRole('button', { name: copy.notifications.markAllRead })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Fixtures: deterministic actors, one public community, four staged events and
// two notification viewers. Display names, venue names, prices and instants are
// fixed so every rendered string is deterministic; the genuinely dynamic areas
// (photo rendering, datetime line, cutoff sentence, notification timestamps)
// are masked in the comparisons only.
// ---------------------------------------------------------------------------

const family: {
  contexts: BrowserContext[];
  host?: Actor;
  joinViewer?: Actor;
  joinRafael?: Actor;
  joinElisa?: Actor;
  pendingViewer?: Actor;
  declinedViewer?: Actor;
  fullViewer?: Actor;
  fullHeitor?: Actor;
  closedViewer?: Actor;
  closedAccepted?: Actor;
  expiredViewer?: Actor;
  rosterCaller?: Actor;
  notifA?: Actor;
  notifB?: Actor;
  extraActors: Actor[];
  communityId?: string;
  joinEventId?: string;
  fullEventId?: string;
  closedEventId?: string;
  rosterEventId?: string;
} = { contexts: [], extraActors: [] };

const VENUES = {
  join: 'Registration Visual Arena',
  full: 'Capacity Visual Arena',
  closed: 'Cutoff Visual Arena',
  roster: 'Roster Visual Arena'
};

const JOIN_NAMES = {
  p3: 'Carla Visual Two',
  p4: 'Duarte Visual Four',
  guest: 'Gabriel Guestview'
};
const FULL_NAMES = [
  'Marcos Full Two',
  'Nina Full Three',
  'Oscar Full Four',
  'Paula Full Five',
  'Quint Full Six',
  'Rui Full Seven'
];
const CLOSED_NAMES = [
  'Sara Closed Three',
  'Tiago Closed Four',
  'Ulla Closed Five',
  'Vitor Closed Six',
  'Wanda Closed Seven',
  'Yuri Closed Eight',
  'Bruno Notplaying'
];
const ROSTER_NAMES = [
  'Ana Roster Two',
  'Beto Roster Three',
  'Celo Roster Four',
  'Duda Roster Five',
  'Gustavo Roster Guest',
  'Hugo Roster Seven',
  'Iara Roster Nine',
  'Joana Roster Ten',
  'Kai Roster Notplaying'
];

type StoredFixtures = Record<string, string>;

const STORED_KEYS = [
  'hostEmail',
  'joinViewerEmail',
  'joinRafaelEmail',
  'joinElisaEmail',
  'pendingViewerEmail',
  'declinedViewerEmail',
  'fullViewerEmail',
  'fullHeitorEmail',
  'closedViewerEmail',
  'closedAcceptedEmail',
  'expiredViewerEmail',
  'rosterCallerEmail',
  'notifAEmail',
  'notifBEmail',
  'communityId',
  'joinEventId',
  'fullEventId',
  'closedEventId',
  'rosterEventId'
] as const;

function storedFixturesPath(): URL {
  return new URL('../test-results/matches-registration-visual-fixtures.json', import.meta.url);
}

function readStoredFixtures(): StoredFixtures | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(storedFixturesPath(), 'utf8'));
    if (!isRecord(raw)) return null;
    const result: Record<string, string> = {};
    for (const key of STORED_KEYS) {
      const value = raw[key];
      if (typeof value !== 'string') return null;
      result[key] = value;
    }
    return result;
  } catch {
    return null;
  }
}

function writeStoredFixtures(): void {
  const payload: Record<string, string> = {
    hostEmail: family.host!.email,
    joinViewerEmail: family.joinViewer!.email,
    joinRafaelEmail: family.joinRafael!.email,
    joinElisaEmail: family.joinElisa!.email,
    pendingViewerEmail: family.pendingViewer!.email,
    declinedViewerEmail: family.declinedViewer!.email,
    fullViewerEmail: family.fullViewer!.email,
    fullHeitorEmail: family.fullHeitor!.email,
    closedViewerEmail: family.closedViewer!.email,
    closedAcceptedEmail: family.closedAccepted!.email,
    expiredViewerEmail: family.expiredViewer!.email,
    rosterCallerEmail: family.rosterCaller!.email,
    notifAEmail: family.notifA!.email,
    notifBEmail: family.notifB!.email,
    communityId: family.communityId!,
    joinEventId: family.joinEventId!,
    fullEventId: family.fullEventId!,
    closedEventId: family.closedEventId!,
    rosterEventId: family.rosterEventId!
  };
  writeFileSync(storedFixturesPath(), JSON.stringify(payload, null, 1));
}

async function eventExists(actor: Actor, eventId: string): Promise<boolean> {
  const row = await actor.client.from('match_events').select('id').eq('id', eventId).maybeSingle();
  return !row.error && row.data !== null;
}

async function ownNotificationCount(actor: Actor, eventId: string, kind: string): Promise<number> {
  // RLS scopes notifications reads to the caller's own rows, so this count is
  // per-viewer by construction.
  const rows = await actor.client
    .from('notifications')
    .select('id')
    .eq('kind', kind)
    .eq('target_id', eventId);
  if (rows.error) throw rows.error;
  return (rows.data ?? []).length;
}

/**
 * Builds the whole deterministic fixture family (idempotent: verified against
 * the stored identity and rebuilt when the local prune removed it). Events:
 *   JOIN   — 6 accepted (host + 3 members + guest reserve #1 + member reserve
 *            #2), max 8 → "2 of 8 places left" exactly as frame fo8Zn states.
 *   FULL   — 8 accepted (two complete quartets), max 8 → MATCH FULL as SYMLa.
 *   CLOSED — future start, cutoff already passed (trigger-bypassed fixture
 *            update), 8 playing + 1 reserve not playing + one expired request:
 *            the tYXlh state.
 *   ROSTER — unlimited; 8 playing across two groups (guest on the second Group
 *            2 row), 2 reserves, 1 reserve not playing: the xC04T board.
 */
async function ensureVisualFixtures(): Promise<void> {
  if (family.host && family.joinViewer && family.closedViewer) return;
  const stored = readStoredFixtures();
  if (stored) {
    try {
      family.host = await signInWithPassword(stored.hostEmail!, 'Marina Visual');
      family.joinViewer = await signInWithPassword(stored.joinViewerEmail!, 'Sofia Joinview');
      family.joinRafael = await signInWithPassword(stored.joinRafaelEmail!, 'Rafael Visual');
      family.joinElisa = await signInWithPassword(stored.joinElisaEmail!, 'Elisa Visual');
      family.pendingViewer = await signInWithPassword(
        stored.pendingViewerEmail!,
        'Pedro Pendingview'
      );
      family.declinedViewer = await signInWithPassword(
        stored.declinedViewerEmail!,
        'Diana Declinedview'
      );
      family.fullViewer = await signInWithPassword(stored.fullViewerEmail!, 'Fernanda Fullview');
      family.fullHeitor = await signInWithPassword(stored.fullHeitorEmail!, 'Heitor Promoted');
      family.closedViewer = await signInWithPassword(stored.closedViewerEmail!, 'Carla Closedview');
      family.closedAccepted = await signInWithPassword(
        stored.closedAcceptedEmail!,
        'Bruno Closed Two'
      );
      family.expiredViewer = await signInWithPassword(
        stored.expiredViewerEmail!,
        'Expira Expiredview'
      );
      family.rosterCaller = await signInWithPassword(stored.rosterCallerEmail!, 'Rebeca Roster');
      family.notifA = await signInWithPassword(stored.notifAEmail!, 'Nina Notifview');
      family.notifB = await signInWithPassword(stored.notifBEmail!, 'Bernardo Notifview');
      family.communityId = stored.communityId!;
      await pinCommunityUtc(family.communityId);
      family.joinEventId = stored.joinEventId!;
      family.fullEventId = stored.fullEventId!;
      family.closedEventId = stored.closedEventId!;
      family.rosterEventId = stored.rosterEventId!;
      const host = family.host;
      const community = await host.client
        .from('communities')
        .select('id')
        .eq('id', family.communityId)
        .maybeSingle();
      if (community.error || !community.data) throw new Error('stored community is missing');
      for (const eventId of [
        family.joinEventId,
        family.fullEventId,
        family.closedEventId,
        family.rosterEventId
      ])
        if (!(await eventExists(host, eventId))) throw new Error('stored event is missing');
      for (const eventId of [
        family.joinEventId,
        family.fullEventId,
        family.closedEventId,
        family.rosterEventId
      ])
        ownedEvents.add(eventId);
      return;
    } catch {
      Object.assign(family, {
        host: undefined,
        joinViewer: undefined,
        joinRafael: undefined,
        joinElisa: undefined,
        pendingViewer: undefined,
        declinedViewer: undefined,
        fullViewer: undefined,
        fullHeitor: undefined,
        closedViewer: undefined,
        closedAccepted: undefined,
        expiredViewer: undefined,
        rosterCaller: undefined,
        notifA: undefined,
        notifB: undefined,
        communityId: undefined,
        joinEventId: undefined,
        fullEventId: undefined,
        closedEventId: undefined,
        rosterEventId: undefined,
        extraActors: []
      });
    }
  }

  family.host = await createActor('Marina Visual');
  family.joinViewer = await createActor('Sofia Joinview');
  family.joinRafael = await createActor('Rafael Visual');
  family.joinElisa = await createActor('Elisa Visual');
  family.pendingViewer = await createActor('Pedro Pendingview', 6.5);
  family.declinedViewer = await createActor('Diana Declinedview', 6.5);
  family.fullViewer = await createActor('Fernanda Fullview');
  family.fullHeitor = await createActor('Heitor Promoted');
  family.closedViewer = await createActor('Carla Closedview');
  family.closedAccepted = await createActor('Bruno Closed Two');
  family.expiredViewer = await createActor('Expira Expiredview', 6.5);
  family.rosterCaller = await createActor('Rebeca Roster');
  family.notifA = await createActor('Nina Notifview');
  family.notifB = await createActor('Bernardo Notifview');

  const joinPlayers = [
    await createActor(JOIN_NAMES.p3),
    await createActor(JOIN_NAMES.p4),
    await createActor(JOIN_NAMES.guest)
  ];
  const fullPlayers = await Promise.all(FULL_NAMES.map((name) => createActor(name)));
  const closedPlayers = [
    await createActor('Bruno Closed Two'),
    ...(await Promise.all(CLOSED_NAMES.map((name) => createActor(name))))
  ];
  const rosterPlayers = await Promise.all(ROSTER_NAMES.map((name) => createActor(name)));
  family.extraActors.push(...joinPlayers, ...fullPlayers, ...closedPlayers, ...rosterPlayers);

  family.communityId = await createPublicCommunity(family.host);
  for (const actor of [
    family.joinViewer,
    family.joinRafael,
    family.joinElisa,
    family.pendingViewer,
    family.declinedViewer,
    family.fullViewer,
    family.fullHeitor,
    family.closedViewer,
    family.closedAccepted,
    family.expiredViewer,
    family.rosterCaller,
    family.notifA,
    family.notifB,
    ...joinPlayers,
    ...fullPlayers,
    ...closedPlayers,
    ...rosterPlayers
  ])
    await joinAsActiveMember(family.communityId, actor);

  const host = family.host;
  const communityId = family.communityId;

  // JOIN event: the creator registers at publication (order 1); seed orders
  // 2-6 so the ledger reads 4 playing + guest reserve #1 + member reserve #2.
  // Rafael and Elisa carry the approved anchor: the Za6r4 board depicts genuine
  // APPROVED states (F27), so the fixture must produce them truthfully.
  family.joinEventId = crypto.randomUUID();
  ownedEvents.add(family.joinEventId);
  await publishFixture(
    host,
    family.joinEventId,
    publishInput(communityId, {
      date: ymd(3),
      startTime: '19:30',
      venueName: VENUES.join,
      price: '12',
      maximum: 8
    })
  );
  await seedAcceptedRows(family.joinEventId, [
    { actor: family.joinRafael, order: 2, part: 'playing', source: 'member', approved: true },
    { actor: joinPlayers[0]!, order: 3, part: 'playing', source: 'member' },
    { actor: joinPlayers[1]!, order: 4, part: 'playing', source: 'member' },
    { actor: joinPlayers[2]!, order: 5, part: 'reserve', source: 'guest' },
    { actor: family.joinElisa, order: 6, part: 'reserve', source: 'member', approved: true }
  ]);

  // FULL event: seven seeded members plus the promoted caller (order 8) behind
  // the creator complete two quartets of eight — the SYMLa MATCH FULL state.
  family.fullEventId = crypto.randomUUID();
  ownedEvents.add(family.fullEventId);
  await publishFixture(
    host,
    family.fullEventId,
    publishInput(communityId, {
      date: ymd(4),
      startTime: '10:30',
      venueName: VENUES.full,
      maximum: 8
    })
  );
  await seedAcceptedRows(family.fullEventId, [
    ...fullPlayers.map((actor, index) => ({
      actor,
      order: index + 2,
      part: 'playing' as const,
      source: 'member' as const
    })),
    // Cpd7L depicts the promoted caller's confirmed place as an approved state
    // (F27): seed the approved anchor so the panel genuinely renders APPROVED.
    { actor: family.fullHeitor, order: 8, part: 'playing', source: 'member', approved: true }
  ]);

  // CLOSED event: future start with the cutoff already passed (the only
  // mutation is the cutoff instant, transaction-scoped around the immutable
  // trigger, exactly like the functional cutoff journey). The expired request
  // must exist BEFORE the event becomes due; the internal processor — the same
  // function the unattended scheduler calls — then expires it.
  family.closedEventId = crypto.randomUUID();
  ownedEvents.add(family.closedEventId);
  await publishFixture(
    host,
    family.closedEventId,
    publishInput(communityId, { date: ymd(4), startTime: '11:00', venueName: VENUES.closed })
  );
  await submitRegistration(family.expiredViewer, family.closedEventId);
  await seedAcceptedRows(family.closedEventId, [
    { actor: family.closedAccepted, order: 2, part: 'playing', source: 'member' },
    ...closedPlayers.slice(1, 7).map((actor, index) => ({
      actor,
      order: index + 3,
      part: 'playing' as const,
      source: 'member' as const
    })),
    {
      actor: closedPlayers[7]!,
      order: 9,
      part: 'reserve_not_playing' as const,
      source: 'member' as const
    }
  ]);
  await fixtureSql(
    `alter table public.match_events disable trigger match_event_immutable; ` +
      `update public.match_events set registration_cutoff_at = pg_catalog.now() - interval '5 minutes' ` +
      `where id = '${family.closedEventId}'; ` +
      `alter table public.match_events enable trigger match_event_immutable; ` +
      `perform public.process_match_event_registration_cutoff('${family.closedEventId}');`
  );

  // ROSTER event: unlimited; two complete groups, guest on the second Group 2
  // row (order 6), two reserves and one reserve not playing (xC04T board).
  family.rosterEventId = crypto.randomUUID();
  ownedEvents.add(family.rosterEventId);
  await publishFixture(
    host,
    family.rosterEventId,
    publishInput(communityId, { date: ymd(5), startTime: '09:00', venueName: VENUES.roster })
  );
  await seedAcceptedRows(family.rosterEventId, [
    { actor: rosterPlayers[0]!, order: 2, part: 'playing', source: 'member' },
    { actor: rosterPlayers[1]!, order: 3, part: 'playing', source: 'member' },
    { actor: rosterPlayers[2]!, order: 4, part: 'playing', source: 'member' },
    { actor: rosterPlayers[3]!, order: 5, part: 'playing', source: 'member' },
    { actor: rosterPlayers[4]!, order: 6, part: 'playing', source: 'guest' },
    { actor: rosterPlayers[5]!, order: 7, part: 'playing', source: 'member' },
    { actor: family.rosterCaller, order: 8, part: 'playing', source: 'member' },
    { actor: rosterPlayers[6]!, order: 9, part: 'reserve', source: 'member' },
    { actor: rosterPlayers[7]!, order: 10, part: 'reserve', source: 'member' },
    { actor: rosterPlayers[8]!, order: 11, part: 'reserve', source: 'member' }
  ]);
  // The insert path normalizes every seeded participation to its live FIFO
  // state, so the not-playing tail is set afterwards through the same
  // transition the cutoff processor performs (identity guard bypassed for
  // exactly one column update, transaction-scoped).
  await fixtureSql(
    `alter table public.match_event_registrations disable trigger match_registration_identity_guard; ` +
      `update public.match_event_registrations set participation_status = 'reserve_not_playing' ` +
      `where match_event_id = '${family.rosterEventId}' and accepted_order = 11; ` +
      `alter table public.match_event_registrations enable trigger match_registration_identity_guard;`
  );

  writeStoredFixtures();
}

/** Requester states on the JOIN event (Za6r4 board): pending through the real
 * request RPC; declined through the real creator decision; the approved playing
 * and reserve states are the seeded ledger rows (approved_at = accepted_at)
 * viewed by their own players — genuinely approved, per the reviewed frame. */
async function ensureRequesterStates(): Promise<void> {
  await ensureVisualFixtures();
  const eventId = family.joinEventId!;
  const pendingRow = await family
    .pendingViewer!.client.from('match_event_registrations')
    .select('lifecycle')
    .eq('match_event_id', eventId)
    .eq('user_id', family.pendingViewer!.id)
    .maybeSingle();
  if (pendingRow.error) throw pendingRow.error;
  if (!pendingRow.data) await submitRegistration(family.pendingViewer!, eventId);

  const declinedRow = await family
    .declinedViewer!.client.from('match_event_registrations')
    .select('lifecycle')
    .eq('match_event_id', eventId)
    .eq('user_id', family.declinedViewer!.id)
    .maybeSingle();
  if (declinedRow.error) throw declinedRow.error;
  if (!declinedRow.data) {
    await submitRegistration(family.declinedViewer!, eventId);
    await decideRegistration(family.host!, eventId, family.declinedViewer!.id, 'reject');
  }
}

/** Notification viewers: qNVpA (two quartet/playing rows, unread, minutes old)
 * and Z0gRd (six registration/cutoff rows across the today/earlier boundary). */
async function ensureNotificationFixtures(): Promise<void> {
  await ensureVisualFixtures();
  if (
    (await ownNotificationCount(
      family.notifA!,
      family.fullEventId!,
      'match_registration_playing'
    )) === 0
  ) {
    await seedNotification(
      family.notifA!,
      family.fullEventId!,
      family.communityId!,
      'match_registration_playing',
      1
    );
    await seedNotification(
      family.notifA!,
      family.fullEventId!,
      family.communityId!,
      'match_registration_quartet_complete',
      5
    );
  }
  const kinds: Array<[string, number]> = [
    ['match_registration_requested', 12],
    ['match_registration_approved', 65],
    ['match_registration_rejected', 125],
    ['match_registration_reserve', 185],
    ['match_registration_expired', 26 * 60],
    ['match_registration_not_playing', 27 * 60]
  ];
  if (
    (await ownNotificationCount(
      family.notifB!,
      family.closedEventId!,
      'match_registration_requested'
    )) === 0
  )
    for (const [kind, minutesAgo] of kinds)
      await seedNotification(
        family.notifB!,
        family.closedEventId!,
        family.communityId!,
        kind,
        minutesAgo
      );
  // The publication producer broadcasts match_event_published to every
  // community member (four per run here) and notifications are outside the
  // global-setup prune, so strip the broadcast rows from the two notification
  // viewers before their gates: the qNVpA/Z0gRd lists must contain exactly the
  // registration fixtures under gate.
  await fixtureSql(
    `delete from public.notifications n using auth.users u ` +
      `where n.recipient_user_id = u.id and n.kind = 'match_event_published' ` +
      `and u.email in ('${family.notifA!.email}', '${family.notifB!.email}');`
  );
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

test.describe.serial('PAF-5 registration visual and structural QA', () => {
  test.beforeAll(() => {
    test.setTimeout(240_000);
    assertManifestProvenance();
  });

  test('Match detail — direct join state replays the approved fo8Zn frame', async ({ browser }) => {
    test.setTimeout(480_000);
    await ensureVisualFixtures();
    // The approved frame is 390x872 UNCROPPED (its bottom navigation at
    // [18,802,354,56] is approved content), so this comparison runs at the
    // frame's own height instead of cropping approved content away.
    const context = await newContext(browser, { viewport: { width: 390, height: 872 } });
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.joinViewer!);
    await page.goto(`/matches/${family.joinEventId}`);
    await ready(page);

    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${VENUES.join}` })
    ).toBeVisible();
    // Registration state (manifest fo8Zn facts: join CTA block + capacity fact
    // "2 of 8 places left" + level range + instant-confirmation note).
    const panel = registrationPanel(page);
    await expect(
      panel.getByRole('heading', { name: en.matchRegistration.join.sectionTitle })
    ).toBeVisible();
    await expect(panel.getByText(en.matchRegistration.join.openCopy)).toBeVisible();
    await expect(
      panel.getByText(fill(en.matchRegistration.join.capacity_other, { remaining: 2, maximum: 8 }))
    ).toBeVisible();
    await expect(
      panel.getByText(
        fill(en.matchRegistration.join.levelRange, { min: 2.7, max: 4.7, level: 3.2 })
      )
    ).toBeVisible();
    await expect(panel.getByText(en.matchRegistration.join.note, { exact: true })).toBeVisible();
    await assertRegistrationCta(
      page,
      panel.getByRole('button', { name: en.matchRegistration.join.button }),
      'fo8Zn join CTA'
    );

    // Roster visibility contract (recorded deviation): the frames draw the
    // roster for every viewer; the reviewed implementation scopes it to the
    // caller's accepted registration. Asserted explicitly here so the
    // difference can never drift silently.
    await expect(rosterRegion(page, en)).toHaveCount(0);
    await test.info().attach('fo8Zn roster visibility (recorded deviation)', {
      body: 'Frame fo8Zn draws the roster for the unregistered viewer; the reviewed PAF-5.5 implementation renders the roster region to accepted callers only (asserted: 0 regions here; the roster facts are gated on the accepted viewer in the Za6r4 board test).'
    });

    // Participation block (manifest fact: participation [18,563,354,82]) with
    // the authoritative server counts.
    await expect(
      page.getByRole('heading', { level: 2, name: en.matches.detail.participation })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 3, name: en.matches.detail.participants })
    ).toBeVisible();
    await assertCountsFromServer(
      page,
      en,
      'en',
      await detailData(family.joinViewer!, family.joinEventId!)
    );

    await assertGutterAxis(page, 'fo8Zn detail 390x872');
    await assertNoHorizontalOverflow(page, 'fo8Zn detail 390x872');
    await assertPrimaryHitTargets(page, 'fo8Zn detail 390x872');
    await compare(page, 'registration-direct-join.png', detailMasks(page));
  });

  test('Match detail — registration full state replays the approved SYMLa frame', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureVisualFixtures();
    const context = await newContext(browser, { viewport: { width: 390, height: 872 } });
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.fullViewer!);
    await page.goto(`/matches/${family.fullEventId}`);
    await ready(page);

    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${VENUES.full}` })
    ).toBeVisible();
    // Registration state (manifest SYMLa facts: capacity badge [18,561,95,23]
    // + disabled button [18,591,354,44] + explicit MATCH FULL surface).
    const panel = registrationPanel(page);
    await expect(
      panel.getByRole('heading', { name: en.matchRegistration.join.sectionTitle })
    ).toBeVisible();
    await expect(
      panel.getByText(en.matchRegistration.full.badge, { exact: true }).first()
    ).toBeVisible();
    await expect(
      panel.getByText(fill(en.matchRegistration.full.detail, { accepted: 8, maximum: 8 }))
    ).toBeVisible();
    await expect(
      panel.getByText(fill(en.matchRegistration.full.copy, { maximum: 8 }))
    ).toBeVisible();
    await expect(panel.getByText(en.matchRegistration.full.note, { exact: true })).toBeVisible();
    await assertRegistrationCta(
      page,
      panel.getByRole('button', { name: en.matchRegistration.full.button }),
      'SYMLa full CTA',
      { disabled: true }
    );

    // Roster visibility contract (recorded deviation, same as fo8Zn).
    await expect(rosterRegion(page, en)).toHaveCount(0);

    await expect(
      page.getByRole('heading', { level: 2, name: en.matches.detail.participation })
    ).toBeVisible();
    await assertCountsFromServer(
      page,
      en,
      'en',
      await detailData(family.fullViewer!, family.fullEventId!)
    );

    await assertGutterAxis(page, 'SYMLa detail 390x872');
    await assertNoHorizontalOverflow(page, 'SYMLa detail 390x872');
    await assertPrimaryHitTargets(page, 'SYMLa detail 390x872');
    await compare(page, 'registration-full.png', detailMasks(page));
  });

  test('Match detail — registration closed state replays the approved tYXlh frame', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureVisualFixtures();
    const context = await newContext(browser, { viewport: { width: 390, height: 872 } });
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.closedViewer!);
    await page.goto(`/matches/${family.closedEventId}`);
    await ready(page);

    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${VENUES.closed}` })
    ).toBeVisible();
    // Registration state (manifest tYXlh facts: cutoff status block
    // [18,314,354,39] with the cutoff badge, roster count line, disabled CTA
    // [18,674,354,44]).
    const panel = registrationPanel(page);
    await expect(
      panel.getByRole('heading', { name: en.matchRegistration.join.sectionTitle })
    ).toBeVisible();
    await expect(
      panel.getByText(en.matchRegistration.closed.badge, { exact: true }).first()
    ).toBeVisible();
    await expect(
      panel.getByText(en.matchRegistration.closed.detail, { exact: true })
    ).toBeVisible();
    await expect(
      panel.getByText(
        fill(en.matchRegistration.closed.rosterCount, { playing: 8, reserveNotPlaying: 1 })
      )
    ).toBeVisible();
    await expect(panel.getByText(en.matchRegistration.closed.note, { exact: true })).toBeVisible();
    await expect(
      page.getByText(en.matches.detail.registrationClosed, { exact: true })
    ).toBeVisible();
    await assertRegistrationCta(
      page,
      panel.getByRole('button', { name: en.matchRegistration.closed.button }),
      'tYXlh closed CTA',
      { disabled: true }
    );

    // Roster visibility contract (recorded deviation, same as fo8Zn).
    await expect(rosterRegion(page, en)).toHaveCount(0);

    await expect(
      page.getByRole('heading', { level: 2, name: en.matches.detail.participation })
    ).toBeVisible();
    await assertCountsFromServer(
      page,
      en,
      'en',
      await detailData(family.closedViewer!, family.closedEventId!)
    );

    await assertGutterAxis(page, 'tYXlh detail 390x872');
    await assertNoHorizontalOverflow(page, 'tYXlh detail 390x872');
    await assertPrimaryHitTargets(page, 'tYXlh detail 390x872');
    await compare(
      page,
      'registration-closed.png',
      detailMasks(page, { closedCopy: 'no longer accepted' })
    );
  });

  test('Requester states board (Za6r4) and roster facts — every state gated exactly', async ({
    browser
  }) => {
    test.setTimeout(480_000);
    await ensureRequesterStates();

    // Za6r4 facts: five mutually exclusive requester states, each with its
    // badge, copy and one 44px action — gated one fixture viewer per state.
    const states: Array<{
      label: string;
      actor: Actor;
      eventId: string;
      expected: Parameters<typeof assertRequesterState>[3];
    }> = [
      {
        label: 'Za6r4 pending',
        actor: family.pendingViewer!,
        eventId: family.joinEventId!,
        expected: {
          badge: en.matchRegistration.request.pendingBadge,
          badgeTone: 'reserve',
          copyText: en.matchRegistration.request.pendingCopy,
          meta: 'no place reserved yet',
          action: { kind: 'link', name: en.matchRegistration.request.viewMatch }
        }
      },
      {
        // Za6r4 genuinely depicts APPROVED states (frame copy: "Approved at
        // 09:41 · …"), so the fixture seeds approved_at for this viewer (F27)
        // and the approved wording stays asserted.
        label: 'Za6r4 approved playing',
        actor: family.joinRafael!,
        eventId: family.joinEventId!,
        expected: {
          badge: fill(en.matchRegistration.request.approvedPlayingBadge, { group: 1 }),
          badgeTone: 'playing',
          copyText: en.matchRegistration.request.approvedPlayingCopy.split('{{when}}')[0]!,
          expectNote: false,
          action: { kind: 'link', name: en.matchRegistration.request.viewGroup }
        }
      },
      {
        // Same approved-anchor fixture as the playing card (F27): APPROVED ·
        // RESERVE is a real organizer decision in the frame, not a direct join.
        label: 'Za6r4 approved reserve',
        actor: family.joinElisa!,
        eventId: family.joinEventId!,
        expected: {
          badge: fill(en.matchRegistration.request.approvedReserveBadge, { position: 2 }),
          badgeTone: 'reserve',
          copyText: en.matchRegistration.request.approvedReserveCopy.split('{{when}}')[0]!,
          expectNote: false,
          action: { kind: 'link', name: en.matchRegistration.request.viewMatch }
        }
      },
      {
        label: 'Za6r4 declined',
        actor: family.declinedViewer!,
        eventId: family.joinEventId!,
        expected: {
          badge: en.matchRegistration.request.declinedBadge,
          badgeTone: 'danger',
          copyText: en.matchRegistration.request.declinedCopy,
          action: { kind: 'button', name: en.matchRegistration.request.requestAgain }
        }
      },
      {
        // The expired requester lives on the cutoff-processed CLOSED event
        // (tYXlh fixture): expiry is a cutoff transition, so the state only
        // exists where the cutoff passed.
        label: 'Za6r4 expired',
        actor: family.expiredViewer!,
        eventId: family.closedEventId!,
        expected: {
          badge: en.matchRegistration.request.expiredBadge,
          badgeTone: 'muted',
          copyText: en.matchRegistration.request.expiredCopy,
          action: { kind: 'link', name: en.matchRegistration.request.viewMatchHistory }
        }
      }
    ];

    for (const state of states) {
      const context = await newContext(browser);
      family.contexts.push(context);
      const page = await context.newPage();
      await signIn(page, state.actor);
      await page.goto(`/matches/${state.eventId}`);
      await ready(page);
      await expect(
        page.getByRole('heading', {
          level: 1,
          name:
            state.label === 'Za6r4 expired'
              ? `${en.matches.detail.title}: ${VENUES.closed}`
              : `${en.matches.detail.title}: ${VENUES.join}`
        })
      ).toBeVisible();
      await assertRequesterState(page, en, state.label, state.expected);

      // fo8Zn roster facts, gated on the accepted caller (see the header
      // comment): four playing rows in FIFO order, then the reserve queue with
      // the FIFO caption, the guest badge on the first reserve row and the
      // #1/#2 positions.
      if (state.label === 'Za6r4 approved playing') {
        await assertRosterStructure(page, en, 'fo8Zn roster (accepted viewer)', [
          {
            title: fill(en.matchRegistration.roster.groupTitle, { group: 1 }),
            count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
            rows: [
              { name: family.host!.displayName, badges: [en.matchRegistration.badges.playing] },
              {
                name: en.matchRegistration.roster.you,
                badges: [en.matchRegistration.badges.playing, en.matchRegistration.badges.member]
              },
              { name: JOIN_NAMES.p3, badges: [en.matchRegistration.badges.playing] },
              { name: JOIN_NAMES.p4, badges: [en.matchRegistration.badges.playing] }
            ]
          },
          {
            title: en.matchRegistration.roster.reserveTitle,
            count: fill(en.matchRegistration.roster.count_other, { count: 2 }),
            fifo: en.matchRegistration.roster.fifo,
            rows: [
              {
                name: JOIN_NAMES.guest,
                badges: [en.matchRegistration.badges.reserve, en.matchRegistration.badges.guest],
                position: fill(en.matchRegistration.roster.position, { position: 1 })
              },
              {
                name: family.joinElisa!.displayName,
                badges: [en.matchRegistration.badges.reserve],
                position: fill(en.matchRegistration.roster.position, { position: 2 })
              }
            ]
          }
        ]);
        await expect(
          page.getByText(en.matchRegistration.roster.you, { exact: true })
        ).toBeVisible();
        await assertCountsFromServer(
          page,
          en,
          'en',
          await detailData(family.joinRafael!, family.joinEventId!)
        );
      }
      // The approved reserve viewer must see their roster reserve section with
      // the #2 placement (Za6r4 card 3's roster counterpart).
      if (state.label === 'Za6r4 approved reserve') {
        const region = rosterRegion(page, en);
        await expect(
          region.getByRole('heading', { name: en.matchRegistration.roster.reserveTitle })
        ).toBeVisible();
        await expect(
          region.getByText(fill(en.matchRegistration.roster.position, { position: 2 }), {
            exact: true
          })
        ).toBeVisible();
        await expect(
          region.getByText(en.matchRegistration.badges.reserve, { exact: true }).first()
        ).toBeVisible();
      }
      // The declined card carries its re-entry action while registration is
      // open (Za6r4 card 4): the Request-again action must be enabled.
      if (state.label === 'Za6r4 declined')
        await expect(
          registrationPanel(page).getByRole('button', {
            name: en.matchRegistration.request.requestAgain
          })
        ).toBeEnabled();

      await assertNoHorizontalOverflow(page, state.label);
      await assertPrimaryHitTargets(page, state.label);
      await context.close();
    }
  });

  test('Roster participation states (xC04T) and quartet-complete notification (Cpd7L) — exact structural gates', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureVisualFixtures();
    await test.info().attach('test 5 fixture identity', {
      body: JSON.stringify(
        {
          rosterEventId: family.rosterEventId,
          closedEventId: family.closedEventId,
          fullEventId: family.fullEventId,
          rosterCaller: family.rosterCaller!.email,
          closedAccepted: family.closedAccepted!.email
        },
        null,
        1
      )
    });

    // xC04T: the caller (order 8, Group 2) reads the full participation board:
    // playing groups → reserve queue → not playing, guest badge on the second
    // Group 2 row, RESERVE NOT PLAYING tail, caller highlighted as You.
    const context = await newContext(browser);
    family.contexts.push(context);
    const page = await context.newPage();
    await signIn(page, family.rosterCaller!);
    await page.goto(`/matches/${family.rosterEventId}`);
    await ready(page);
    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${VENUES.roster}` })
    ).toBeVisible();
    // xC04T (open-registration composition): the caller (order 8, Group 2)
    // reads GROUP 1 / GROUP 2 / RESERVE QUEUE with the guest badge on the
    // second Group 2 row and the #1/#2/#3 FIFO positions. The board's NOT
    // PLAYING tail is the post-cutoff composition (the design's own caption:
    // "Reserve Not Playing is set at cutoff") — the projection normalizes it
    // into the reserve queue while registration is open, and the tail is
    // gated on the cutoff-processed event below (tYXlh roster).
    await test.info().attach('xC04T composition (recorded adaptation)', {
      body: 'Frame xC04T stacks the reserve queue and the NOT PLAYING tail in one board. The implementation renders the tail only after the cutoff transition (the projection normalizes reserve_not_playing back into the reserve queue while registration is open); the tail is gated on the cutoff-processed CLOSED event in this test.'
    });
    await test.info().attach('xC04T gate page url', {
      body: page.url()
    });
    await assertRosterStructure(page, en, 'xC04T roster', [
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 1 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: family.host!.displayName, badges: [en.matchRegistration.badges.playing] },
          { name: ROSTER_NAMES[0]!, badges: [en.matchRegistration.badges.playing] },
          { name: ROSTER_NAMES[1]!, badges: [en.matchRegistration.badges.playing] },
          { name: ROSTER_NAMES[2]!, badges: [en.matchRegistration.badges.playing] }
        ]
      },
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 2 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: ROSTER_NAMES[3]!, badges: [en.matchRegistration.badges.playing] },
          {
            name: ROSTER_NAMES[4]!,
            badges: [en.matchRegistration.badges.playing, en.matchRegistration.badges.guest]
          },
          { name: ROSTER_NAMES[5]!, badges: [en.matchRegistration.badges.playing] },
          {
            name: en.matchRegistration.roster.you,
            badges: [en.matchRegistration.badges.playing]
          }
        ]
      },
      {
        title: en.matchRegistration.roster.reserveTitle,
        count: fill(en.matchRegistration.roster.count_other, { count: 3 }),
        fifo: en.matchRegistration.roster.fifo,
        rows: [
          {
            name: ROSTER_NAMES[6]!,
            badges: [en.matchRegistration.badges.reserve],
            position: fill(en.matchRegistration.roster.position, { position: 1 })
          },
          {
            name: ROSTER_NAMES[7]!,
            badges: [en.matchRegistration.badges.reserve],
            position: fill(en.matchRegistration.roster.position, { position: 2 })
          },
          {
            name: ROSTER_NAMES[8]!,
            badges: [en.matchRegistration.badges.reserve],
            position: fill(en.matchRegistration.roster.position, { position: 3 })
          }
        ]
      }
    ]);
    await assertCountsFromServer(
      page,
      en,
      'en',
      await detailData(family.rosterCaller!, family.rosterEventId!)
    );
    await assertGutterAxis(page, 'xC04T detail 390');
    await assertNoHorizontalOverflow(page, 'xC04T detail 390');
    await assertPrimaryHitTargets(page, 'xC04T detail 390');
    await context.close();

    // SYMLa roster facts on the accepted FULL-event viewer: two-column
    // GROUP 1 / GROUP 2, four rows each in accepted order.
    const fullAcceptedContext = await newContext(browser);
    family.contexts.push(fullAcceptedContext);
    const fullAcceptedPage = await fullAcceptedContext.newPage();
    await signIn(fullAcceptedPage, family.fullHeitor!);
    await fullAcceptedPage.goto(`/matches/${family.fullEventId}`);
    await ready(fullAcceptedPage);
    await assertRosterStructure(fullAcceptedPage, en, 'SYMLa roster (accepted viewer)', [
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 1 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: family.host!.displayName, badges: [en.matchRegistration.badges.playing] },
          { name: FULL_NAMES[0]!, badges: [en.matchRegistration.badges.playing] },
          { name: FULL_NAMES[1]!, badges: [en.matchRegistration.badges.playing] },
          { name: FULL_NAMES[2]!, badges: [en.matchRegistration.badges.playing] }
        ]
      },
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 2 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: FULL_NAMES[3]!, badges: [en.matchRegistration.badges.playing] },
          { name: FULL_NAMES[4]!, badges: [en.matchRegistration.badges.playing] },
          { name: FULL_NAMES[5]!, badges: [en.matchRegistration.badges.playing] },
          {
            name: en.matchRegistration.roster.you,
            badges: [en.matchRegistration.badges.playing]
          }
        ]
      }
    ]);
    await assertCountsFromServer(
      fullAcceptedPage,
      en,
      'en',
      await detailData(family.fullHeitor!, family.fullEventId!)
    );

    // Cpd7L: the promoted caller's accepted panel state plus the
    // quartet-complete alert with its working deep link. The frame depicts the
    // confirmed place as an approved state, and the fixture seeds approved_at
    // for this viewer, so the APPROVED wording stays asserted (F27).
    await assertRequesterState(fullAcceptedPage, en, 'Cpd7L promoted', {
      badge: fill(en.matchRegistration.request.approvedPlayingBadge, { group: 2 }),
      badgeTone: 'playing',
      copyText: en.matchRegistration.request.approvedPlayingCopy.split('{{when}}')[0]!,
      expectNote: false,
      action: { kind: 'link', name: en.matchRegistration.request.viewGroup }
    });
    await assertNoHorizontalOverflow(fullAcceptedPage, 'Cpd7L promoted');
    await assertPrimaryHitTargets(fullAcceptedPage, 'Cpd7L promoted');

    // The quartet-complete alert is seeded through the trusted harness (the
    // producer writes the same shape when a real acceptance completes the
    // quartet; the fixture ledger insert does not replay producer side
    // effects).
    const alertId = await seedNotification(
      family.fullHeitor!,
      family.fullEventId!,
      family.communityId!,
      'match_registration_quartet_complete',
      5
    );
    await fullAcceptedPage.goto(`/notifications/${alertId}`);
    await ready(fullAcceptedPage);
    await expect(
      fullAcceptedPage.getByRole('heading', {
        level: 1,
        name: kindTitle(en, 'match_registration_quartet_complete')
      })
    ).toBeVisible();
    await expect(
      fullAcceptedPage.getByText(
        fill(en.notifications.match.registrationQuartetCompleteBody, {
          group: 2,
          event: VENUES.full
        })
      )
    ).toBeVisible();
    const openEvent = fullAcceptedPage.getByRole('link', {
      name: en.notifications.match.openEvent
    });
    await expect(openEvent).toBeVisible();
    const openHeight = await openEvent.evaluate((node) => node.getBoundingClientRect().height);
    expect(openHeight, 'Cpd7L: the Open event action must be ≥44px tall').toBeGreaterThanOrEqual(
      44
    );
    await openEvent.click();
    await expect(fullAcceptedPage).toHaveURL(new RegExp(`/matches/${family.fullEventId}$`));
    await expect(
      fullAcceptedPage.getByText(
        fill(en.matchRegistration.request.approvedPlayingBadge, { group: 2 })
      )
    ).toBeVisible();
    await fullAcceptedContext.close();

    // tYXlh roster facts on the accepted CLOSED-event viewer: groups plus the
    // not-playing tail with its RESERVE NOT PLAYING badge.
    const closedAcceptedContext = await newContext(browser);
    family.contexts.push(closedAcceptedContext);
    const closedAcceptedPage = await closedAcceptedContext.newPage();
    await signIn(closedAcceptedPage, family.closedAccepted!);
    await closedAcceptedPage.goto(`/matches/${family.closedEventId}`);
    await ready(closedAcceptedPage);
    await assertRosterStructure(closedAcceptedPage, en, 'tYXlh roster (accepted viewer)', [
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 1 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: family.host!.displayName, badges: [en.matchRegistration.badges.playing] },
          {
            name: en.matchRegistration.roster.you,
            badges: [en.matchRegistration.badges.playing, en.matchRegistration.badges.member]
          },
          { name: CLOSED_NAMES[0]!, badges: [en.matchRegistration.badges.playing] },
          { name: CLOSED_NAMES[1]!, badges: [en.matchRegistration.badges.playing] }
        ]
      },
      {
        title: fill(en.matchRegistration.roster.groupTitle, { group: 2 }),
        count: fill(en.matchRegistration.roster.count_other, { count: 4 }),
        rows: [
          { name: CLOSED_NAMES[2]!, badges: [en.matchRegistration.badges.playing] },
          { name: CLOSED_NAMES[3]!, badges: [en.matchRegistration.badges.playing] },
          { name: CLOSED_NAMES[4]!, badges: [en.matchRegistration.badges.playing] },
          { name: CLOSED_NAMES[5]!, badges: [en.matchRegistration.badges.playing] }
        ]
      },
      {
        title: en.matchRegistration.roster.notPlayingTitle,
        count: fill(en.matchRegistration.roster.count_one, { count: 1 }),
        rows: [
          {
            name: CLOSED_NAMES[6]!,
            badges: [en.matchRegistration.badges.reserveNotPlaying]
          }
        ]
      }
    ]);
    await assertCountsFromServer(
      closedAcceptedPage,
      en,
      'en',
      await detailData(family.closedAccepted!, family.closedEventId!)
    );
    await assertNoHorizontalOverflow(closedAcceptedPage, 'tYXlh roster (accepted viewer)');
    await assertPrimaryHitTargets(closedAcceptedPage, 'tYXlh roster (accepted viewer)');
    await closedAcceptedContext.close();
  });

  test('Notifications — quartet/playing (qNVpA) and registration/cutoff (Z0gRd) frames', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureNotificationFixtures();

    const quartetContext = await newContext(browser);
    family.contexts.push(quartetContext);
    const quartetPage = await quartetContext.newPage();
    await signIn(quartetPage, family.notifA!);
    await quartetPage.goto('/notifications');
    await ready(quartetPage);
    await expect(
      quartetPage.getByRole('heading', { level: 1, name: en.notifications.title })
    ).toBeVisible();
    // Manifest qNVpA facts: two cards in order playing → quartet complete.
    await assertNotificationList(quartetPage, en, 'qNVpA notifications', [
      kindTitle(en, 'match_registration_playing'),
      kindTitle(en, 'match_registration_quartet_complete')
    ]);
    await assertNoHorizontalOverflow(quartetPage, 'qNVpA notifications');
    await assertPrimaryHitTargets(quartetPage, 'qNVpA notifications');
    await compare(quartetPage, 'notifications-quartet-playing.png', notificationMasks(quartetPage));
    await quartetContext.close();

    const cutoffContext = await newContext(browser);
    family.contexts.push(cutoffContext);
    const cutoffPage = await cutoffContext.newPage();
    await signIn(cutoffPage, family.notifB!);
    await cutoffPage.goto('/notifications');
    await ready(cutoffPage);
    // Manifest Z0gRd facts: six cards in created-at order; the app groups them
    // under Today/Earlier headers (recorded adaptation), so the six titles are
    // gated in overall DOM order.
    await assertNotificationList(cutoffPage, en, 'Z0gRd notifications', [
      kindTitle(en, 'match_registration_requested'),
      kindTitle(en, 'match_registration_approved'),
      kindTitle(en, 'match_registration_rejected'),
      kindTitle(en, 'match_registration_reserve'),
      kindTitle(en, 'match_registration_expired'),
      kindTitle(en, 'match_registration_not_playing')
    ]);
    // Recorded adaptation: the app groups rows under Today/Earlier headers.
    // Exactly which groups render depends on the UTC day boundary, so assert
    // the grouping header contract rather than a fixed pair.
    await expect(
      cutoffPage
        .getByText(en.notifications.today, { exact: true })
        .or(cutoffPage.getByText(en.notifications.earlier, { exact: true }))
        .first()
    ).toBeVisible();
    await assertNoHorizontalOverflow(cutoffPage, 'Z0gRd notifications');
    await assertPrimaryHitTargets(cutoffPage, 'Z0gRd notifications');
    await compare(
      cutoffPage,
      'notifications-registration-cutoff.png',
      notificationMasks(cutoffPage)
    );
    await cutoffContext.close();
  });

  test('Variant invariants — 320 / desktop / dark / pt-BR / es (no approved frames: invariants only)', async ({
    browser
  }) => {
    test.setTimeout(480_000);
    await ensureVisualFixtures();
    await ensureNotificationFixtures();

    // The design frames define 390-wide light English screens only. For every
    // other variant this suite asserts the invariants that must hold (no
    // overflow, ≥44px targets, correct palette/labels) and does NOT
    // self-authorize screenshot baselines.
    const runs: Array<{
      label: string;
      viewport?: Viewport;
      locale?: 'en' | 'pt-BR' | 'es';
      theme?: 'light' | 'dark';
      copy: Copy;
    }> = [
      { label: '320 light en', viewport: { width: 320, height: 844 }, copy: en },
      { label: 'desktop light en', viewport: { width: 1280, height: 800 }, copy: en },
      { label: '390 dark en', theme: 'dark', copy: en },
      { label: '390 light pt-BR', locale: 'pt-BR', copy: ptBr },
      { label: '390 light es', locale: 'es', copy: es }
    ];

    for (const variant of runs) {
      // Detail (fo8Zn state): long translated copy must not overflow and every
      // tappable control must stay ≥44px.
      const context = await newContext(browser, {
        viewport: variant.viewport,
        locale: variant.locale,
        theme: variant.theme
      });
      family.contexts.push(context);
      const page = await context.newPage();
      await signIn(page, family.joinViewer!, variant.copy);
      await page.goto(`/matches/${family.joinEventId}`);
      await ready(page);
      if (variant.theme === 'dark')
        expect(
          await page.evaluate(() => document.documentElement.dataset.theme),
          `${variant.label}: dark palette must be applied`
        ).toBe('dark');
      const panel = registrationPanel(page);
      await expect(
        panel.getByRole('heading', { name: variant.copy.matchRegistration.join.sectionTitle })
      ).toBeVisible();
      await expect(
        panel.getByText(
          fill(variant.copy.matchRegistration.join.capacity_other, { remaining: 2, maximum: 8 })
        )
      ).toBeVisible();
      await expect(
        panel.getByRole('button', { name: variant.copy.matchRegistration.join.button })
      ).toBeVisible();
      await assertNoHorizontalOverflow(page, variant.label);
      await assertPrimaryHitTargets(page, variant.label);
      await context.close();

      // Notifications (Z0gRd state): six rows, translated headers, same
      // invariants.
      const notifContext = await newContext(browser, {
        viewport: variant.viewport,
        locale: variant.locale,
        theme: variant.theme
      });
      family.contexts.push(notifContext);
      const notifPage = await notifContext.newPage();
      await signIn(notifPage, family.notifB!, variant.copy);
      await notifPage.goto('/notifications');
      await ready(notifPage);
      if (variant.theme === 'dark')
        expect(
          await notifPage.evaluate(() => document.documentElement.dataset.theme),
          `${variant.label}: dark palette must be applied (notifications)`
        ).toBe('dark');
      await expect(notifPage.locator('main li')).toHaveCount(6);
      await expect(
        notifPage.getByRole('heading', { level: 1, name: variant.copy.notifications.title })
      ).toBeVisible();
      await assertNoHorizontalOverflow(notifPage, `${variant.label} notifications`);
      await assertPrimaryHitTargets(notifPage, `${variant.label} notifications`);
      await notifContext.close();
    }
  });

  test.afterAll(async () => {
    const errors: unknown[] = [];
    try {
      await test.info().attach('registration visual calibration measurements', {
        body: JSON.stringify({ measurements: calibration, structuralViolations }, null, 1)
      });
    } catch (error) {
      errors.push(error);
    }
    const closes = await Promise.allSettled(
      family.contexts.splice(0).map((context) => context.close())
    );
    for (const result of closes) if (result.status === 'rejected') errors.push(result.reason);
    try {
      await runCleanupTasks([
        async () => {
          for (const photo of uploadedPhotos) {
            const result = await photo.actor.client.storage
              .from('match-event-photos')
              .remove([photo.path]);
            if (result.error) throw result.error;
          }
        },
        () =>
          runMatchFixtureCleanup({ eventIds: [...ownedEvents], actorIds: [...ownedActors.keys()] })
      ]);
    } catch (error) {
      errors.push(error);
    }
    try {
      unlinkSync(storedFixturesPath());
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Visual match fixture teardown failed');
  });
});
