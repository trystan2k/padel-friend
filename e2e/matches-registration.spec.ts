import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
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

// PAF-5.6 functional E2E (PAF-83): real registration/FIFO journeys against the fresh
// preview with real local Supabase actors — direct join, out-of-range and guest requests
// with creator approve/reject, private denial, two-quartet progression with changed-player
// alerts, pending-duplicate and full-capacity conflicts, FIFO durability and a DB-time
// cutoff journey driven by a trusted fixture plus the internal local processor.
// Visual/screenshot coverage is a separate workstream (matches-registration-visual.spec.ts)
// and intentionally absent here. Cleanup follows the house pattern: every actor signs up
// through the @test.local domain, so the global-setup prune owns these rows; browser
// contexts are closed below.

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  matches: {
    unavailable: string;
    detail: {
      title: string;
      accepted: string;
      participation: string;
      guestApprovalRequired: string;
      outOfRangeApprovalRequired: string;
    };
    teamMode: { PREDEFINED_TEAMS: string; POST_MATCH_TEAMS: string };
  };
  matchCreate: {
    title: string;
    next: string;
    review: string;
    publish: string;
    steps: { players: string; teams: string };
    fields: {
      date: string;
      startTime: string;
      visibility: string;
      venueName: string;
      mapsUrl: string;
      price: string;
      maximumRegistrations: string;
      photo: string;
    };
    photo: { remove: string };
  };
  matchRegistration: {
    join: {
      sectionTitle: string;
      button: string;
      capacity_other: string;
      levelRange: string;
      requestButton: string;
    };
    full: { badge: string; detail: string; button: string };
    closed: {
      badge: string;
      rosterCount: string;
      button: string;
    };
    request: {
      pendingBadge: string;
      approvedPlayingBadge: string;
      approvedReserveBadge: string;
      joinedPlayingBadge: string;
      joinedReserveBadge: string;
      createdPlayingBadge: string;
      createdPlayingCopy: string;
      declinedBadge: string;
      declinedCopy: string;
      requestAgain: string;
      expiredBadge: string;
      expiredCopy: string;
    };
    roster: {
      groupTitle: string;
      reserveTitle: string;
      notPlayingTitle: string;
      you: string;
      count_one: string;
      count_other: string;
      position: string;
    };
    badges: { playing: string; reserveNotPlaying: string; guest: string };
    queue: {
      title: string;
      empty: string;
      typeGuest: string;
      typeOutOfRange: string;
      approveLabel: string;
      declineLabel: string;
    };
    feedback: {
      accepted: string;
      pending: string;
      approved: string;
      rejected: string;
      full: string;
    };
    aria: { roster: string };
  };
  notifications: {
    kinds: Record<string, string>;
    match: {
      openEvent: string;
      registrationPlayingTitle: string;
      registrationPromotedBody: string;
      registrationExpiredBody: string;
      registrationNotPlayingBody: string;
    };
  };
};

const en: Copy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);

const password = 'Password123!';
const config = localConfig();

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  serviceWorkers: 'block'
});

type Actor = { id: string; email: string; displayName: string; client: SupabaseClient };
type RpcError = { code?: string | null; message?: string | null } | null;
type SqlRow = Record<string, unknown>;

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
    throw new Error('Registration E2E requires loopback Supabase');
  return { url, key };
}

function rand(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** i18n interpolation for en templates, e.g. `fill(template, { group: 2 })`. */
function fill(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)),
    template
  );
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

async function createActor(label: string, level = 3.2): Promise<Actor> {
  const bootstrap = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `match-reg-${crypto.randomUUID()}@test.local`;
  const signup = await bootstrap.auth.signUp({ email, password });
  if (signup.error || !signup.data.session || !signup.data.user)
    throw new Error(`Could not create local E2E actor: ${signup.error?.message ?? 'no session'}`);
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const displayName = `${label} ${crypto.randomUUID().slice(0, 8)}`;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: displayName,
    p_preferred_side: 'EITHER',
    p_initial_level: level
  });
  if (onboarded.error) throw onboarded.error;
  return { id: signup.data.user.id, email, displayName, client };
}

async function newContext(browser: Browser): Promise<BrowserContext> {
  return browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    serviceWorkers: 'block'
  });
}

async function signIn(page: Page, actor: Actor): Promise<void> {
  await page.context().addCookies([{ name: 'locale', value: 'en', url: 'http://127.0.0.1:4173' }]);
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

async function createCommunityViaRpc(
  admin: Actor,
  name: string,
  visibility: 'public' | 'private'
): Promise<string> {
  const created = await admin.client.rpc('create_community', {
    p_name: name,
    p_visibility: visibility,
    p_join_policy: 'instant'
  });
  if (created.error || typeof created.data !== 'string')
    throw created.error ?? new Error('Community fixture failed');
  // Journeys resolve event instants in the UTC zone; pin the effective admin defaults
  // so no community inherits a localized default that would shift every scheduled start.
  await fixtureSql(
    `update public.communities set settings = coalesce(settings,'{}'::jsonb) || ` +
      `'{"timezone":"UTC","admin_defaults":{"timezone":"UTC","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb ` +
      `where id = '${created.data}';`
  );
  return created.data;
}

async function joinCommunityAsActiveMember(communityId: string, member: Actor): Promise<void> {
  const joined = await member.client.rpc('join_public_community', { p_community_id: communityId });
  if (joined.error) throw joined.error;
  const membership = await member.client
    .from('community_members')
    .select('status')
    .eq('community_id', communityId)
    .eq('user_id', member.id)
    .is('valid_until', null)
    .maybeSingle();
  if (membership.error || !membership.data)
    throw membership.error ?? new Error('Membership fixture failed');
  if (membership.data.status !== 'active')
    throw new Error(`Membership is ${membership.data.status}, not active`);
}

async function notificationRows(
  actor: Actor,
  kind: string,
  eventId: string
): Promise<{ id: string }[]> {
  const rows = await actor.client
    .from('notifications')
    .select('id')
    .eq('kind', kind)
    .eq('target_id', eventId);
  if (rows.error) throw rows.error;
  return rows.data ?? [];
}

async function publishedEventRow(
  creator: Actor,
  venue: string
): Promise<{ id: string; community_id: string }> {
  const row = await creator.client
    .from('match_events')
    .select('id,community_id')
    .eq('venue_name', venue)
    .maybeSingle();
  if (row.error || !row.data) throw row.error ?? new Error('Published event row is missing');
  return row.data;
}

async function detailData(actor: Actor, eventId: string): Promise<Record<string, unknown>> {
  const result = await actor.client.rpc('get_match_event', { p_event_id: eventId });
  if (result.error) throw result.error;
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error(`Detail for ${eventId} did not resolve to an object`);
  return data;
}

/** Real authenticated submit through the shipped RPC (the call the UI server function makes). */
async function submitRegistration(
  actor: Actor,
  eventId: string
): Promise<{ data: unknown; error: RpcError }> {
  return actor.client.rpc('submit_match_registration', { p_match_event_id: eventId });
}

/** Real authenticated creator decision through the shipped RPC (attempt-bound). */
async function decideRegistration(
  actor: Actor,
  eventId: string,
  userId: string,
  decision: 'approve' | 'reject'
): Promise<{ data: unknown; error: RpcError }> {
  const attempt = await fixtureRows(
    `select a.id::text as id from public.match_event_registration_attempts a ` +
      `where a.match_event_id = '${eventId}' and a.user_id = '${userId}' ` +
      `order by a.requested_at desc, a.id desc limit 1;`
  );
  const attemptId = attempt[0]?.['id'];
  if (typeof attemptId !== 'string')
    throw new Error(`no registration attempt for ${userId} on ${eventId}`);
  return actor.client.rpc('decide_match_registration', {
    p_match_event_id: eventId,
    p_attempt_id: attemptId,
    p_decision: decision
  });
}

// ---------------------------------------------------------------------------
// Trusted local SQL harness. Fixture writes run as one atomic DO block and
// bypass only the triggers the sibling suites bypass; reads are owner-only
// projections the browser roles can never reach.
// ---------------------------------------------------------------------------

function runSupabaseQuery(
  sql: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
      { cwd: process.cwd() }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function fixtureSql(sql: string): Promise<void> {
  const result = await runSupabaseQuery(`do $$ begin ${sql} end $$;`);
  if (result.code !== 0)
    throw new Error(
      `Trusted fixture SQL failed (${result.code}): ${result.stdout}\n${result.stderr}`
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRowArray(value: unknown): value is SqlRow[] {
  return Array.isArray(value) && value.every((row) => isRecord(row));
}

async function fixtureRows(sql: string): Promise<SqlRow[]> {
  const result = await runSupabaseQuery(sql);
  if (result.code !== 0)
    throw new Error(`Local SQL failed (${result.code}): ${result.stdout}\n${result.stderr}`);
  const parsed: unknown = JSON.parse(result.stdout);
  if (isRecord(parsed) && isRowArray(parsed.rows)) return parsed.rows;
  const start = result.stdout.indexOf('[');
  const end = result.stdout.lastIndexOf(']');
  if (start < 0 || end <= start)
    throw new Error(`Local SQL returned no JSON rows: ${result.stdout.slice(0, 400)}`);
  const sliced: unknown = JSON.parse(result.stdout.slice(start, end + 1));
  if (isRowArray(sliced)) return sliced;
  throw new Error(`Local SQL returned invalid rows: ${result.stdout}`);
}

/** The creator-only queue RPC returns one summary row; its `requests` array is the queue. */
function queueRequestsOf(result: { data: unknown }): unknown[] {
  const row = Array.isArray(result.data) ? result.data[0] : undefined;
  return isRecord(row) && Array.isArray(row['requests']) ? row['requests'] : [];
}

async function registrationRowFor(eventId: string, userId: string): Promise<SqlRow | undefined> {
  const rows = await fixtureRows(
    `select r.lifecycle::text as lifecycle, r.participation_status::text as participation, ` +
      `r.accepted_order::text as accepted_order, r.accepted_at::text as accepted_at, ` +
      `r.approved_at::text as approved_at, r.requested_at::text as requested_at ` +
      `from public.match_event_registrations r ` +
      `where r.match_event_id = '${eventId}' and r.user_id = '${userId}';`
  );
  return rows[0];
}

async function registrationStateRow(eventId: string): Promise<SqlRow> {
  const rows = await fixtureRows(
    `select s.next_accepted_ordinal::text as next_ordinal, s.transition_revision::text as revision, ` +
      `(s.cutoff_processed_at is not null) as cutoff_processed ` +
      `from public.match_event_registration_state s where s.match_event_id = '${eventId}';`
  );
  if (rows.length !== 1) throw new Error(`Registration state row missing for ${eventId}`);
  return rows[0]!;
}

/** Invokes the internal local cutoff processor and returns its jsonb payload. */
async function processorPayload(eventId: string): Promise<Record<string, unknown>> {
  const rows = await fixtureRows(
    `select public.process_match_event_registration_cutoff('${eventId}');`
  );
  const payload = rows[0]?.[Object.keys(rows[0] ?? {})[0] ?? ''];
  if (!isRecord(payload)) throw new Error('Cutoff processor returned no payload');
  return payload;
}

async function communityMembershipCount(communityId: string, userId: string): Promise<number> {
  const rows = await fixtureRows(
    `select count(*)::int as n from public.community_members ` +
      `where community_id = '${communityId}' and user_id = '${userId}';`
  );
  return Number(rows[0]!['n']);
}

async function orderedAcceptedRows(eventId: string): Promise<SqlRow[]> {
  return fixtureRows(
    `select r.user_id::text as user_id, r.accepted_order::text as accepted_order, ` +
      `r.participation_status::text as participation, r.lifecycle::text as lifecycle ` +
      `from public.match_event_registrations r ` +
      `where r.match_event_id = '${eventId}' order by r.accepted_order;`
  );
}

// ---------------------------------------------------------------------------
// Shared wizard helper — identical to the sibling suites; the create route is
// reached by its real protected URL /matches/create.
// ---------------------------------------------------------------------------

async function openCreateWizard(page: Page): Promise<void> {
  await page.goto('/matches/create');
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: en.matchCreate.title })).toBeVisible();
}

async function publishMatchViaUi(
  page: Page,
  options: {
    venue: string;
    date?: string;
    startTime?: string;
    teamMode?: 'PREDEFINED_TEAMS' | 'POST_MATCH_TEAMS';
    price?: string;
    maximum?: string;
  }
): Promise<void> {
  await openCreateWizard(page);
  await page.getByLabel(en.matchCreate.fields.date).fill(options.date ?? ymd(3));
  await page.getByLabel(en.matchCreate.fields.startTime).fill(options.startTime ?? '19:30');
  await page.getByLabel(en.matchCreate.fields.visibility).selectOption('community_open');
  await page.getByLabel(en.matchCreate.fields.venueName).fill(options.venue);
  await page
    .getByLabel(en.matchCreate.fields.mapsUrl)
    .fill(`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(options.venue)}`);
  if (options.price) await page.getByLabel(en.matchCreate.fields.price).fill(options.price);
  if (options.maximum)
    await page.getByLabel(en.matchCreate.fields.maximumRegistrations).fill(options.maximum);
  await page
    .getByLabel(en.matchCreate.fields.photo)
    .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: matchPhoto() });
  await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
    timeout: 15_000
  });
  await page.getByRole('button', { name: en.matchCreate.next }).click();
  await expect(page.getByText(en.matchCreate.steps.players, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: en.matchCreate.next }).click();
  await expect(page.getByText(en.matchCreate.steps.teams, { exact: true })).toBeVisible();
  await page
    .getByRole('radio', { name: en.matches.teamMode[options.teamMode ?? 'POST_MATCH_TEAMS'] })
    .check();
  await page.getByRole('button', { name: en.matchCreate.next }).click();
  await expect(page.getByRole('heading', { name: en.matchCreate.review })).toBeVisible();
  await page.getByRole('button', { name: en.matchCreate.publish }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await waitForHydratedPage(page);
}

// ---------------------------------------------------------------------------
// Registration-surface locators. The roster is the caller's named region, the
// queue is creator-only, and the participation strip carries the counts.
// ---------------------------------------------------------------------------

function rosterSection(page: Page): Locator {
  return page.getByRole('region', { name: en.matchRegistration.aria.roster });
}

function requestQueueSection(page: Page): Locator {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: en.matchRegistration.queue.title })
  });
}

function participationSection(page: Page): Locator {
  return page.locator('section').filter({
    has: page.getByRole('heading', { name: en.matches.detail.participation })
  });
}

// ---------------------------------------------------------------------------
// Shared family. Serial blocks share actors; every actor is a real local
// Supabase account with its own authenticated client and, where needed, its
// own signed-in browser page.
// ---------------------------------------------------------------------------

const family: {
  contexts: BrowserContext[];
  // Event A — community open with requests.
  creator?: Actor;
  member?: Actor;
  member2?: Actor;
  member3?: Actor;
  outApproved?: Actor;
  outRejected?: Actor;
  guest?: Actor;
  privateAdmin?: Actor;
  stranger?: Actor;
  communityId?: string;
  eventId?: string;
  venue?: string;
  creatorPage?: Page;
  memberPage?: Page;
  outApprovedPage?: Page;
  outRejectedPage?: Page;
  guestPage?: Page;
  strangerPage?: Page;
  // Event B/C — quartets and capacity.
  host2?: Actor;
  quartet?: Actor[];
  dupRequester?: Actor;
  community2Id?: string;
  eventBId?: string;
  venueB?: string;
  host2Page?: Page;
  quartetPage?: Page;
  // Event D — cutoff journey.
  lateMember?: Actor;
  eventDId?: string;
  lateMemberPage?: Page;
} = { contexts: [] };

async function newActorPage(browser: Browser, actor: Actor): Promise<Page> {
  const context = await newContext(browser);
  family.contexts.push(context);
  const page = await context.newPage();
  await signIn(page, actor);
  return page;
}

// Idempotent fixture builders for the later serial blocks. Playwright may give
// each serial group its own worker process, so every block rebuilds its own
// actors; these builders exist so the single describe below can create the
// heavier quartet/cutoff families lazily, right where they are first needed.

async function ensureQuartetFixtures(browser: Browser): Promise<void> {
  if (family.eventBId) return;
  test.setTimeout(480_000);
  family.host2 = await createActor('Quartet Host');
  family.quartet = [
    await createActor('Quartet One'),
    await createActor('Quartet Two'),
    await createActor('Quartet Three'),
    await createActor('Quartet Four'),
    await createActor('Quartet Five'),
    await createActor('Quartet Six'),
    await createActor('Quartet Seven'),
    await createActor('Quartet Eight')
  ];
  family.dupRequester = await createActor('Duplicate Outsider', 6.5);
  family.community2Id = await createCommunityViaRpc(
    family.host2,
    `Quartet circle ${rand()}`,
    'public'
  );
  for (const actor of [...family.quartet, family.dupRequester])
    await joinCommunityAsActiveMember(family.community2Id, actor);

  family.host2Page = await newActorPage(browser, family.host2);
  family.venueB = `Quartet Arena ${rand()}`;
  // Unlimited event: it must remain open after 8 and 9 accepted players.
  await publishMatchViaUi(family.host2Page, {
    venue: family.venueB,
    date: ymd(4),
    startTime: '11:00',
    teamMode: 'POST_MATCH_TEAMS'
  });
  const row = await publishedEventRow(family.host2, family.venueB);
  family.eventBId = row.id;
  family.quartetPage = await newActorPage(browser, family.quartet[3]!);
}

async function ensureCutoffFixtures(browser: Browser): Promise<void> {
  if (family.eventDId) return;
  test.setTimeout(300_000);
  family.lateMember = await createActor('Late Reserve');
  await joinCommunityAsActiveMember(family.communityId!, family.lateMember);
  const venue = `Cutoff Arena ${rand()}`;
  await publishMatchViaUi(family.creatorPage!, {
    venue,
    date: ymd(3),
    startTime: '20:00',
    teamMode: 'POST_MATCH_TEAMS'
  });
  const row = await publishedEventRow(family.creator!, venue);
  family.eventDId = row.id;
  family.lateMemberPage = await newActorPage(browser, family.lateMember);
}

test.afterAll(async () => {
  await Promise.all(family.contexts.map((context) => context.close()));
});

// ---------------------------------------------------------------------------
// Block 1 — Event A: direct join, request/approve, request/reject with
// re-entry, guest approval without membership, private-community denial.
// ---------------------------------------------------------------------------

test.describe.serial('registration, FIFO and cutoff journeys', () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(420_000);
    family.creator = await createActor('Reg Creator');
    family.member = await createActor('Join Member');
    family.member2 = await createActor('Second Member');
    family.member3 = await createActor('Third Member');
    // Level 6.5 sits outside the creator's suggested 2.7–4.7 range.
    family.outApproved = await createActor('Approved Outsider', 6.5);
    family.outRejected = await createActor('Rejected Outsider', 6.5);
    family.guest = await createActor('Public Guest');
    family.privateAdmin = await createActor('Private Admin');
    family.stranger = await createActor('Private Stranger');

    family.communityId = await createCommunityViaRpc(
      family.creator,
      `Registration circle ${rand()}`,
      'public'
    );
    for (const actor of [
      family.member,
      family.member2,
      family.member3,
      family.outApproved,
      family.outRejected
    ])
      await joinCommunityAsActiveMember(family.communityId, actor);

    family.creatorPage = await newActorPage(browser, family.creator);
    family.venue = `Registration Arena ${rand()}`;
    await publishMatchViaUi(family.creatorPage, {
      venue: family.venue,
      date: ymd(3),
      startTime: '19:30',
      teamMode: 'PREDEFINED_TEAMS',
      price: '12',
      maximum: '16'
    });
    const row = await publishedEventRow(family.creator, family.venue);
    family.eventId = row.id;

    family.memberPage = await newActorPage(browser, family.member);
    family.outApprovedPage = await newActorPage(browser, family.outApproved);
    family.outRejectedPage = await newActorPage(browser, family.outRejected);
    family.guestPage = await newActorPage(browser, family.guest);
    family.strangerPage = await newActorPage(browser, family.stranger);
  });

  // AC1/AC3: the in-range member joins through the real CTA, lands in the FIFO
  // ledger with the authoritative placement, and the fourth acceptance promotes
  // the whole quartet with changed-player alerts and working deep links.
  test('in-range member joins directly through the CTA and the quartet completes around them', async () => {
    test.setTimeout(240_000);
    const page = family.memberPage!;
    const eventId = family.eventId!;
    const member = family.member!;

    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${family.venue}` })
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: en.matchRegistration.join.sectionTitle })
    ).toBeVisible();
    // Capacity and level range are the truthful pre-join facts (creator accepted first).
    await expect(
      page.getByText(fill(en.matchRegistration.join.capacity_other, { remaining: 15, maximum: 16 }))
    ).toBeVisible();
    await expect(
      page.getByText(fill(en.matchRegistration.join.levelRange, { min: 2.7, max: 4.7, level: 3.2 }))
    ).toBeVisible();

    await page.getByRole('button', { name: en.matchRegistration.join.button }).click();
    await expect(page.getByText(en.matchRegistration.feedback.accepted)).toBeVisible();
    // Direct join (F27): a member accepted instantly through the CTA carries the
    // JOINED badge — organizer approval wording is reserved for real decisions.
    // Second accepted of two: reserve queue placement #2 until a quartet completes.
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedReserveBadge, { position: 2 }))
    ).toBeVisible();
    await expect(page.getByRole('button', { name: en.matchRegistration.join.button })).toHaveCount(
      0
    );
    await expect(
      participationSection(page).getByText(`2 · ${en.matches.detail.accepted}`)
    ).toBeVisible();

    // Two more in-range members join; the fourth acceptance promotes all four.
    for (const actor of [family.member2!, family.member3!]) {
      const joined = await submitRegistration(actor, eventId);
      expect(joined.error, `${actor.displayName} direct join`).toBeNull();
    }

    await page.reload();
    await waitForHydratedPage(page);
    // The member's own placement comes from the direct join (F27): JOINED wording.
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 1 }))
    ).toBeVisible();
    const roster = rosterSection(page);
    await expect(
      roster.getByRole('heading', {
        name: fill(en.matchRegistration.roster.groupTitle, { group: 1 })
      })
    ).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.roster.count_other.replace('{{count}}', '4'))
    ).toHaveCount(1);
    await expect(roster.getByText(en.matchRegistration.roster.you, { exact: true })).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.badges.playing, { exact: true }).first()
    ).toBeVisible();
    await expect(
      participationSection(page).getByText(`4 · ${en.matches.detail.accepted}`)
    ).toBeVisible();
    await expect(
      participationSection(page).getByText(/4 playing · 0 reserve · 1 group/)
    ).toBeVisible();

    const detail = await detailData(member, eventId);
    expect(detail).toMatchObject({
      accepted_count: 4,
      playing_count: 4,
      reserve_count: 0,
      group_count: 1,
      caller_badge: 'playing'
    });

    // Changed-player alerts: early joiners were promoted, the last joiner was
    // accepted straight into the completed quartet, and everyone got the
    // quartet-complete alert exactly once.
    const promoted = await notificationRows(member, 'match_registration_promoted', eventId);
    expect(promoted).toHaveLength(1);
    expect(
      await notificationRows(member, 'match_registration_quartet_complete', eventId)
    ).toHaveLength(1);
    expect(
      await notificationRows(family.creator!, 'match_registration_promoted', eventId)
    ).toHaveLength(1);
    expect(
      await notificationRows(family.member3!, 'match_registration_playing', eventId)
    ).toHaveLength(1);

    // Deep link: the promotion alert resolves to the match with the live placement.
    await page.goto(`/notifications/${promoted[0]!.id}`);
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: en.notifications.kinds.match_registration_promoted
      })
    ).toBeVisible();
    await expect(
      page.getByText(fill(en.notifications.match.registrationPromotedBody, { group: 1 }))
    ).toBeVisible();
    await page.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 1 }))
    ).toBeVisible();
  });

  // AC1/AC2: out-of-range member requests, the creator approves from the queue,
  // and the approval time (not request time) sets the FIFO placement.
  test('out-of-range member requests, creator approves, placement starts at approval', async () => {
    test.setTimeout(240_000);
    const page = family.outApprovedPage!;
    const creatorPage = family.creatorPage!;
    const eventId = family.eventId!;
    const requester = family.outApproved!;

    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    await expect(
      page.getByText(en.matches.detail.outOfRangeApprovalRequired).first()
    ).toBeVisible();
    await page.getByRole('button', { name: en.matchRegistration.join.requestButton }).click();
    await expect(page.getByText(en.matchRegistration.feedback.pending)).toBeVisible();
    await expect(
      page.getByText(en.matchRegistration.request.pendingBadge, { exact: true })
    ).toBeVisible();

    expect(
      await notificationRows(family.creator!, 'match_registration_requested', eventId)
    ).toHaveLength(1);

    await creatorPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(creatorPage);
    // F27: the creator's own slot is neither an approval nor a direct join —
    // CREATOR badge with the timestampless copy (order 1, Group 1).
    await expect(
      creatorPage.getByText(fill(en.matchRegistration.request.createdPlayingBadge, { group: 1 }))
    ).toBeVisible();
    await expect(
      creatorPage.getByText(en.matchRegistration.request.createdPlayingCopy)
    ).toBeVisible();
    const card = requestQueueSection(creatorPage)
      .locator('li')
      .filter({ hasText: requester.displayName });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText(en.matchRegistration.queue.typeOutOfRange, { exact: true })
    ).toBeVisible();
    await card
      .getByRole('button', {
        name: fill(en.matchRegistration.queue.approveLabel, { name: requester.displayName })
      })
      .click();
    await expect(creatorPage.getByText(en.matchRegistration.feedback.approved)).toBeVisible();
    await expect(creatorPage.getByText(en.matchRegistration.queue.empty)).toBeVisible();

    // FIFO: approval behind the four earlier acceptances lands the requester in
    // the reserve queue at position #1 — request time reserved nothing.
    // Genuine approval journey (F27): the creator decision wrote approved_at, so
    // the APPROVED wording is the honest expectation here.
    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      page.getByText(fill(en.matchRegistration.request.approvedReserveBadge, { position: 1 }))
    ).toBeVisible();
    const roster = rosterSection(page);
    await expect(
      roster.getByRole('heading', { name: en.matchRegistration.roster.reserveTitle })
    ).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.roster.count_one.replace('{{count}}', '1'))
    ).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.roster.position.replace('{{position}}', '1'))
    ).toBeVisible();

    expect(await notificationRows(requester, 'match_registration_approved', eventId)).toHaveLength(
      1
    );
    expect(await notificationRows(requester, 'match_registration_reserve', eventId)).toHaveLength(
      1
    );
    const detail = await detailData(requester, eventId);
    expect(detail).toMatchObject({ accepted_count: 5, playing_count: 4, reserve_count: 1 });
  });

  // AC1: the reject path ends in a declined state with a working re-request
  // affordance while registration is open (re-entry policy).
  test('creator rejects a request and the requester may ask again while registration is open', async () => {
    test.setTimeout(240_000);
    const page = family.outRejectedPage!;
    const creatorPage = family.creatorPage!;
    const eventId = family.eventId!;
    const requester = family.outRejected!;

    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    await page.getByRole('button', { name: en.matchRegistration.join.requestButton }).click();
    await expect(page.getByText(en.matchRegistration.feedback.pending)).toBeVisible();

    await creatorPage.reload();
    await waitForHydratedPage(creatorPage);
    const card = requestQueueSection(creatorPage)
      .locator('li')
      .filter({ hasText: requester.displayName });
    await expect(card).toHaveCount(1);
    await card
      .getByRole('button', {
        name: fill(en.matchRegistration.queue.declineLabel, { name: requester.displayName })
      })
      .click();
    await expect(creatorPage.getByText(en.matchRegistration.feedback.rejected)).toBeVisible();
    await expect(creatorPage.getByText(en.matchRegistration.queue.empty)).toBeVisible();

    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      page.getByText(en.matchRegistration.request.declinedBadge, { exact: true })
    ).toBeVisible();
    await expect(page.getByText(en.matchRegistration.request.declinedCopy)).toBeVisible();
    expect(await notificationRows(requester, 'match_registration_rejected', eventId)).toHaveLength(
      1
    );
    const rejectedRow = await registrationRowFor(eventId, requester.id);
    expect(rejectedRow!['lifecycle']).toBe('rejected');
    expect(rejectedRow!['accepted_order']).toBeNull();

    // Re-entry: a fresh attempt reuses the canonical identity while open.
    await page.getByRole('button', { name: en.matchRegistration.request.requestAgain }).click();
    await expect(page.getByText(en.matchRegistration.feedback.pending)).toBeVisible();
    await expect(
      page.getByText(en.matchRegistration.request.pendingBadge, { exact: true })
    ).toBeVisible();
    const retried = await registrationRowFor(eventId, requester.id);
    expect(retried!['lifecycle']).toBe('pending');

    // F21: decisions are bound to the immutable ATTEMPT id. A stale decision
    // naming the FIRST (rejected) attempt is refused with
    // MATCH_REGISTRATION_ALREADY_RESOLVED and must not resolve the fresh
    // re-application the creator never reviewed — the row stays pending and the
    // attempts ledger is untouched.
    const attempts = await fixtureRows(
      `select a.id::text as id, a.outcome::text as outcome from public.match_event_registration_attempts a ` +
        `where a.match_event_id = '${eventId}' and a.user_id = '${requester.id}' ` +
        `order by a.requested_at asc, a.id asc;`
    );
    expect(attempts.map((row) => row['outcome'])).toEqual(['rejected', 'pending']);
    const staleAttemptId = attempts[0]!['id'];
    if (typeof staleAttemptId !== 'string') throw new Error('first attempt id missing');
    const stale = await family.creator!.client.rpc('decide_match_registration', {
      p_match_event_id: eventId,
      p_attempt_id: staleAttemptId,
      p_decision: 'approve'
    });
    expect(stale.error).not.toBeNull();
    expect(stale.error!.message ?? '').toContain('MATCH_REGISTRATION_ALREADY_RESOLVED');
    const staleRow = await registrationRowFor(eventId, requester.id);
    expect(staleRow!['lifecycle']).toBe('pending');
    expect(staleRow!['accepted_order']).toBeNull();
    const attemptsAfterStale = await fixtureRows(
      `select a.outcome::text as outcome from public.match_event_registration_attempts a ` +
        `where a.match_event_id = '${eventId}' and a.user_id = '${requester.id}' ` +
        `order by a.requested_at asc, a.id asc;`
    );
    expect(attemptsAfterStale.map((row) => row['outcome'])).toEqual(['rejected', 'pending']);

    // The creator sees the fresh attempt and declines it again; the ledger keeps
    // exactly one resolved row for this identity and each attempt alerted once.
    await creatorPage.reload();
    await waitForHydratedPage(creatorPage);
    const retriedCard = requestQueueSection(creatorPage)
      .locator('li')
      .filter({ hasText: requester.displayName });
    await expect(retriedCard).toHaveCount(1);
    await retriedCard
      .getByRole('button', {
        name: fill(en.matchRegistration.queue.declineLabel, { name: requester.displayName })
      })
      .click();
    await expect(creatorPage.getByText(en.matchRegistration.queue.empty)).toBeVisible();
    expect(await notificationRows(requester, 'match_registration_rejected', eventId)).toHaveLength(
      2
    );
  });

  // AC2: a public-community guest is approved and marked as a guest, and the
  // approval never touches community_members; an approve replay keeps the
  // original anchors and emits no second alert.
  test('public-community guest is approved, stays a non-member, and approve replays keep original anchors', async () => {
    test.setTimeout(240_000);
    const page = family.guestPage!;
    const creatorPage = family.creatorPage!;
    const eventId = family.eventId!;
    const guest = family.guest!;
    const creator = family.creator!;

    expect(await communityMembershipCount(family.communityId!, guest.id)).toBe(0);

    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    await expect(page.getByText(en.matches.detail.guestApprovalRequired).first()).toBeVisible();
    await page.getByRole('button', { name: en.matchRegistration.join.requestButton }).click();
    await expect(page.getByText(en.matchRegistration.feedback.pending)).toBeVisible();

    await creatorPage.reload();
    await waitForHydratedPage(creatorPage);
    const card = requestQueueSection(creatorPage)
      .locator('li')
      .filter({ hasText: guest.displayName });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByText(en.matchRegistration.queue.typeGuest, { exact: true })
    ).toBeVisible();
    await card
      .getByRole('button', {
        name: fill(en.matchRegistration.queue.approveLabel, { name: guest.displayName })
      })
      .click();
    await expect(creatorPage.getByText(en.matchRegistration.feedback.approved)).toBeVisible();

    // The guest is marked as a guest everywhere and still holds no membership row.
    // Genuine approval journey (F27): the queue decision wrote approved_at, so
    // the APPROVED wording is asserted here — the approval state must stay covered.
    expect(await communityMembershipCount(family.communityId!, guest.id)).toBe(0);
    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      page.getByText(fill(en.matchRegistration.request.approvedReserveBadge, { position: 2 }))
    ).toBeVisible();
    const roster = rosterSection(page);
    await expect(
      roster.getByText(en.matchRegistration.badges.guest, { exact: true }).first()
    ).toBeVisible();

    expect(await notificationRows(guest, 'match_registration_approved', eventId)).toHaveLength(1);

    // Retry contract: approving the accepted request replays with the ORIGINAL
    // anchors and emits no second alert, and no ordinal/revision moves.
    const before = await registrationRowFor(eventId, guest.id);
    const stateBefore = await registrationStateRow(eventId);
    const replay = await decideRegistration(creator, eventId, guest.id, 'approve');
    expect(replay.error).toBeNull();
    expect(replay.data).toMatchObject({
      lifecycle: 'accepted',
      replayed: true,
      accepted_order: 6
    });
    const after = await registrationRowFor(eventId, guest.id);
    expect(after!['accepted_at']).toBe(before!['accepted_at']);
    expect(after!['approved_at']).toBe(before!['approved_at']);
    expect(after!['accepted_order']).toBe(before!['accepted_order']);
    const stateAfter = await registrationStateRow(eventId);
    expect(stateAfter['next_ordinal']).toBe(stateBefore['next_ordinal']);
    expect(stateAfter['revision']).toBe(stateBefore['revision']);
    expect(await notificationRows(guest, 'match_registration_approved', eventId)).toHaveLength(1);
  });

  // AC1: a private-community nonmember is denied with no request row and no UI
  // affordance that implies success.
  test('private-community nonmember is denied everywhere with no request row', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    const admin = family.privateAdmin!;
    const stranger = family.stranger!;
    const strangerPage = family.strangerPage!;

    const privateCommunityId = await createCommunityViaRpc(
      admin,
      `Private registration circle ${rand()}`,
      'private'
    );
    void privateCommunityId;
    const adminPage = await newActorPage(browser, admin);
    const venue = `Hidden Registration Court ${rand()}`;
    await publishMatchViaUi(adminPage, { venue });
    const row = await publishedEventRow(admin, venue);
    const eventId = row.id;

    // The stranger cannot read the event, so the detail resolves to the graceful
    // unavailable state: no join/request CTA anywhere, nothing that implies success.
    await strangerPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(strangerPage);
    await expect(strangerPage.getByText(en.matches.unavailable)).toBeVisible();
    await expect(strangerPage.getByRole('button')).toHaveCount(0);

    // No request row exists for the stranger, and the creator's queue read is empty.
    const strangerRow = await registrationRowFor(eventId, stranger.id);
    expect(strangerRow).toBeUndefined();
    const queue = await admin.client.rpc('list_match_event_registration_requests', {
      p_match_event_id: eventId
    });
    expect(queue.error).toBeNull();
    expect(queueRequestsOf(queue)).toEqual([]);
    // Positive control: the private community's own admin still sees the event.
    await adminPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(adminPage);
    await expect(
      adminPage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();
  });

  // ---------------------------------------------------------------------------
  // Event B/C: two-quartet progression with changed-player alerts, ninth-player
  // Reserve, FIFO durability, pending duplicate and full capacity.
  // ---------------------------------------------------------------------------

  // AC3: drive to 8 accepted players; the browser-made eighth acceptance
  // completes Group 2 atomically and the changed players receive the right alerts.
  test('two-quartet progression: the eighth acceptance completes Group 2 with promotion alerts', async ({
    browser
  }) => {
    test.setTimeout(300_000);
    await ensureQuartetFixtures(browser);
    const page = family.quartetPage!;
    const eventId = family.eventBId!;
    const quartet = family.quartet!;
    const q1 = quartet[0]!;
    const q2 = quartet[1]!;
    const q3 = quartet[2]!;
    const q4 = quartet[3]!;
    const q5 = quartet[4]!;
    const q6 = quartet[5]!;
    const q7 = quartet[6]!;
    const host = family.host2!;

    // First quartet completes via the third member join.
    for (const actor of [q1, q2, q3]) {
      const joined = await submitRegistration(actor, eventId);
      expect(joined.error, `${actor.displayName} direct join`).toBeNull();
    }
    expect(await detailData(host, eventId)).toMatchObject({
      accepted_count: 4,
      playing_count: 4,
      reserve_count: 0,
      group_count: 1
    });
    expect(
      await notificationRows(host, 'match_registration_quartet_complete', eventId)
    ).toHaveLength(1);
    expect(await notificationRows(q3, 'match_registration_playing', eventId)).toHaveLength(1);

    // Seventh acceptance leaves four playing and three in the reserve queue.
    for (const actor of [q5, q6, q7]) {
      const joined = await submitRegistration(actor, eventId);
      expect(joined.error, `${actor.displayName} direct join`).toBeNull();
    }
    expect(await detailData(host, eventId)).toMatchObject({
      accepted_count: 7,
      playing_count: 4,
      reserve_count: 3,
      group_count: 1
    });
    expect(await notificationRows(q5, 'match_registration_reserve', eventId)).toHaveLength(1);

    // The eighth acceptance happens through the real CTA in the browser.
    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    await page.getByRole('button', { name: en.matchRegistration.join.button }).click();
    await expect(page.getByText(en.matchRegistration.feedback.accepted)).toBeVisible();
    // Direct join (F27): the eighth acceptance is an instant CTA join — JOINED.
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 2 }))
    ).toBeVisible();

    await expect(
      participationSection(page).getByText(/8 playing · 0 reserve · 2 groups/)
    ).toBeVisible();
    const roster = rosterSection(page);
    for (const group of [1, 2]) {
      await expect(
        roster.getByRole('heading', {
          name: fill(en.matchRegistration.roster.groupTitle, { group })
        })
      ).toBeVisible();
    }
    await expect(
      roster.getByText(en.matchRegistration.roster.count_other.replace('{{count}}', '4'))
    ).toHaveCount(2);
    await expect(roster.getByText(en.matchRegistration.roster.you, { exact: true })).toBeVisible();

    expect(await detailData(host, eventId)).toMatchObject({
      accepted_count: 8,
      playing_count: 8,
      reserve_count: 0,
      group_count: 2
    });

    // Changed-player alerts for the second quartet exactly: the fresh joiner got
    // playing + quartet-complete; the three promoted reserves got promoted.
    expect(await notificationRows(q4, 'match_registration_playing', eventId)).toHaveLength(1);
    expect(await notificationRows(q4, 'match_registration_quartet_complete', eventId)).toHaveLength(
      1
    );
    expect(await notificationRows(q4, 'match_registration_promoted', eventId)).toHaveLength(0);
    for (const actor of [q5, q6, q7]) {
      expect(await notificationRows(actor, 'match_registration_promoted', eventId)).toHaveLength(1);
      expect(
        await notificationRows(actor, 'match_registration_quartet_complete', eventId)
      ).toHaveLength(1);
    }
    // The already-complete Group 1 is never re-notified.
    expect(await notificationRows(q1, 'match_registration_promoted', eventId)).toHaveLength(1);
    expect(await notificationRows(q1, 'match_registration_quartet_complete', eventId)).toHaveLength(
      1
    );

    // Deep link: the playing alert resolves to the match with the live placement.
    const playingAlert = await notificationRows(q4, 'match_registration_playing', eventId);
    await page.goto(`/notifications/${playingAlert[0]!.id}`);
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: fill(en.notifications.match.registrationPlayingTitle, { group: 2 })
      })
    ).toBeVisible();
    await page.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 2 }))
    ).toBeVisible();
  });

  // AC3: the ninth accepted player is Reserve, visibly and durably.
  test('the ninth accepted player is Reserve in the roster and counts', async () => {
    test.setTimeout(180_000);
    const page = family.quartetPage!;
    const eventId = family.eventBId!;
    const host = family.host2!;
    const q8 = family.quartet![7]!;

    const joined = await submitRegistration(q8, eventId);
    expect(joined.error, 'ninth direct join').toBeNull();

    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      participationSection(page).getByText(/8 playing · 1 reserve · 2 groups/)
    ).toBeVisible();
    const roster = rosterSection(page);
    await expect(
      roster.getByRole('heading', { name: en.matchRegistration.roster.reserveTitle })
    ).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.roster.count_one.replace('{{count}}', '1'))
    ).toBeVisible();
    await expect(
      roster.getByText(en.matchRegistration.roster.position.replace('{{position}}', '1'))
    ).toBeVisible();
    // The quartet page still shows q4's own direct-join placement (F27: JOINED).
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 2 }))
    ).toBeVisible();

    expect(await detailData(host, eventId)).toMatchObject({
      accepted_count: 9,
      playing_count: 8,
      reserve_count: 1,
      group_count: 2,
      registration_open: true
    });
    expect(await notificationRows(q8, 'match_registration_reserve', eventId)).toHaveLength(1);
  });

  // AC2/AC4: the accepted FIFO order is immutable across refresh and duplicate
  // join attempts.
  test('original FIFO order is preserved after refresh and a duplicate join attempt', async () => {
    test.setTimeout(180_000);
    const page = family.quartetPage!;
    const eventId = family.eventBId!;
    const q1 = family.quartet![0]!;

    const before = await orderedAcceptedRows(eventId);
    expect(before).toHaveLength(9); // host + eight accepted, one row per identity

    const duplicate = await submitRegistration(q1, eventId);
    expect(duplicate.error).not.toBeNull();
    expect(duplicate.error!.message ?? '').toContain('MATCH_REGISTRATION_DUPLICATE');

    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      participationSection(page).getByText(/8 playing · 1 reserve · 2 groups/)
    ).toBeVisible();

    const after = await orderedAcceptedRows(eventId);
    expect(after).toEqual(before);
  });

  // AC4: identity uniqueness — a second request while pending is rejected and
  // the original request row (including its queue time) is untouched.
  test('a pending request cannot be duplicated', async () => {
    test.setTimeout(180_000);
    const eventId = family.eventBId!;
    const requester = family.dupRequester!;
    const host = family.host2!;

    const first = await submitRegistration(requester, eventId);
    expect(first.error).toBeNull();
    const row = await registrationRowFor(eventId, requester.id);
    expect(row!['lifecycle']).toBe('pending');

    const duplicate = await submitRegistration(requester, eventId);
    expect(duplicate.error).not.toBeNull();
    expect(duplicate.error!.message ?? '').toContain('MATCH_REGISTRATION_PENDING_DUPLICATE');

    const after = await registrationRowFor(eventId, requester.id);
    expect(after!['requested_at']).toBe(row!['requested_at']);

    // Cleanup: resolve the leftover pending row so the block ends consistent.
    const decision = await decideRegistration(host, eventId, requester.id, 'reject');
    expect(decision.error).toBeNull();
  });

  // AC4: full capacity blocks new joins and new approvals with explicit
  // feedback — never a silent outcome.
  test('full capacity: explicit feedback on the member surface and on the approval conflict', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    await ensureQuartetFixtures(browser);
    const host = family.host2!;
    const hostPage = family.host2Page!;
    const q4 = family.quartet![3]!;
    const guest = family.guest!;

    // A capped event: creator + one member fill it.
    const venue = `Capacity Arena ${rand()}`;
    await publishMatchViaUi(hostPage, {
      venue,
      date: ymd(5),
      startTime: '10:00',
      maximum: '2'
    });
    const row = await publishedEventRow(host, venue);
    const cappedEventId = row.id;

    const joined = await submitRegistration(q4, cappedEventId);
    expect(joined.error, 'second of two direct join').toBeNull();

    // A guest request still enters pending while the event is full (contract).
    const request = await submitRegistration(guest, cappedEventId);
    expect(request.error).toBeNull();
    const pendingRow = await registrationRowFor(cappedEventId, guest.id);
    expect(pendingRow!['lifecycle']).toBe('pending');
    expect(pendingRow!['accepted_order']).toBeNull();
    expect(pendingRow!['accepted_at']).toBeNull();

    // A member without a registration row sees the explicit MATCH FULL surface.
    const fullViewer = family.dupRequester!;
    const fullViewerPage = await newActorPage(browser, fullViewer);
    await fullViewerPage.goto(`/matches/${cappedEventId}`);
    await waitForHydratedPage(fullViewerPage);
    // Badge and disabled CTA share the copy; the badge span comes first in the panel.
    await expect(
      fullViewerPage.getByText(en.matchRegistration.full.badge, { exact: true }).first()
    ).toBeVisible();
    await expect(
      fullViewerPage.getByText(fill(en.matchRegistration.full.detail, { accepted: 2, maximum: 2 }))
    ).toBeVisible();
    await expect(
      fullViewerPage.getByRole('button', { name: en.matchRegistration.full.button })
    ).toBeDisabled();

    // Approving into a full event returns the explicit full feedback and the
    // request stays pending.
    const stateBefore = await registrationStateRow(cappedEventId);
    await hostPage.goto(`/matches/${cappedEventId}`);
    await waitForHydratedPage(hostPage);
    const card = requestQueueSection(hostPage).locator('li').filter({ hasText: guest.displayName });
    await expect(card).toHaveCount(1);
    await card
      .getByRole('button', {
        name: fill(en.matchRegistration.queue.approveLabel, { name: guest.displayName })
      })
      .click();
    await expect(hostPage.getByText(en.matchRegistration.feedback.full)).toBeVisible();
    await expect(card).toHaveCount(1);

    const pendingAfter = await registrationRowFor(cappedEventId, guest.id);
    expect(pendingAfter!['lifecycle']).toBe('pending');
    expect(pendingAfter!['accepted_order']).toBeNull();
    const stateAfter = await registrationStateRow(cappedEventId);
    expect(stateAfter['next_ordinal']).toBe(stateBefore['next_ordinal']);
    expect(stateAfter['revision']).toBe(stateBefore['revision']);
  });

  // ---------------------------------------------------------------------------
  // Event D: cutoff journey with DB-time fixtures. The event becomes genuinely
  // due through a trusted fixture (the only mutation is the cutoff instant,
  // transaction-scoped around the immutable trigger), then the internal local
  // processor is invoked through the trusted harness — the same function the
  // unattended scheduler calls. No page.clock, no test-only RPC and no
  // production clock override.
  // ---------------------------------------------------------------------------

  test('before cutoff: quartet playing, fifth player Reserve, request pending', async ({
    browser
  }) => {
    test.setTimeout(180_000);
    await ensureCutoffFixtures(browser);
    const eventId = family.eventDId!;
    const creator = family.creator!;
    const lateMember = family.lateMember!;
    const outRejected = family.outRejected!;
    const page = family.lateMemberPage!;

    for (const actor of [family.member!, family.member2!, family.member3!]) {
      const joined = await submitRegistration(actor, eventId);
      expect(joined.error, `${actor.displayName} direct join`).toBeNull();
    }
    const lateJoin = await submitRegistration(lateMember, eventId);
    expect(lateJoin.error, 'fifth direct join').toBeNull();
    const request = await submitRegistration(outRejected, eventId);
    expect(request.error, 'out-of-range request').toBeNull();

    await page.goto(`/matches/${eventId}`);
    await waitForHydratedPage(page);
    // Direct join (F27): the fifth acceptance is an instant join — JOINED · RESERVE.
    await expect(
      page.getByText(fill(en.matchRegistration.request.joinedReserveBadge, { position: 1 }))
    ).toBeVisible();

    const detail = await detailData(creator, eventId);
    expect(detail).toMatchObject({
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 1,
      registration_open: true
    });
    expect(await notificationRows(lateMember, 'match_registration_reserve', eventId)).toHaveLength(
      1
    );
  });

  test('due cutoff expires the request, demotes the leftover Reserve and keeps the quartet with durable alerts', async () => {
    test.setTimeout(300_000);
    const eventId = family.eventDId!;
    const creator = family.creator!;
    const lateMember = family.lateMember!;
    const requester = family.outRejected!;
    const lateMemberPage = family.lateMemberPage!;
    const memberPage = family.memberPage!;
    const requesterPage = family.outRejectedPage!;

    // Baseline: the complete quartet's alerts before the cutoff transition.
    const member2Before = await Promise.all([
      notificationRows(family.member2!, 'match_registration_playing', eventId),
      notificationRows(family.member2!, 'match_registration_quartet_complete', eventId)
    ]);

    // DB-time fixture: make the event genuinely due. Transaction-scoped bypass of
    // the immutable trigger around exactly one column update.
    await fixtureSql(
      `alter table public.match_events disable trigger match_event_immutable; ` +
        `update public.match_events set registration_cutoff_at = pg_catalog.now() - interval '5 minutes' ` +
        `where id = '${eventId}'; ` +
        `alter table public.match_events enable trigger match_event_immutable;`
    );

    // The internal per-event processor, called locally through the trusted
    // harness (the same function the unattended scheduler invokes).
    const processedPayload = await processorPayload(eventId);
    expect(processedPayload['processed']).toBe(true);
    expect(processedPayload['expired_count']).toBe(1);

    // Exactly-once: a second execution writes nothing further.
    const replayedPayload = await processorPayload(eventId);
    expect(replayedPayload['processed']).toBe(false);
    expect(replayedPayload['reason']).toBe('already_processed');

    // Ledger facts: the pending request expired without anchors, the leftover
    // Reserve became Reserve Not Playing, and the complete quartet stayed intact
    // in its original order.
    const expiredRow = await registrationRowFor(eventId, requester.id);
    expect(expiredRow!['lifecycle']).toBe('expired');
    expect(expiredRow!['accepted_order']).toBeNull();
    expect(expiredRow!['accepted_at']).toBeNull();
    const reserveRow = await registrationRowFor(eventId, lateMember.id);
    expect(reserveRow!['participation']).toBe('reserve_not_playing');
    const rosterRows = await orderedAcceptedRows(eventId);
    // The expired row carries no participation anchor at all (CHECK-enforced);
    // it sorts last by accepted_order.
    expect(rosterRows.map((entry) => entry['participation'])).toEqual([
      'playing',
      'playing',
      'playing',
      'playing',
      'reserve_not_playing',
      null
    ]);
    expect(rosterRows[5]!['lifecycle']).toBe('expired');
    expect((await registrationStateRow(eventId))['cutoff_processed']).toBe(true);

    // The complete quartet's members received NO new alerts from the cutoff.
    const member2After = await Promise.all([
      notificationRows(family.member2!, 'match_registration_playing', eventId),
      notificationRows(family.member2!, 'match_registration_quartet_complete', eventId)
    ]);
    expect(member2After).toEqual(member2Before);

    // Leftover Reserve: durable not-playing alert with a working deep link, and
    // the roster section shows RESERVE NOT PLAYING.
    const notPlayingAlerts = await notificationRows(
      lateMember,
      'match_registration_not_playing',
      eventId
    );
    expect(notPlayingAlerts).toHaveLength(1);
    await lateMemberPage.reload();
    await waitForHydratedPage(lateMemberPage);
    await expect(
      lateMemberPage
        .getByText(en.matchRegistration.badges.reserveNotPlaying, { exact: true })
        .first()
    ).toBeVisible();
    const lateRoster = rosterSection(lateMemberPage);
    await expect(
      lateRoster.getByRole('heading', { name: en.matchRegistration.roster.notPlayingTitle })
    ).toBeVisible();
    await lateMemberPage.goto(`/notifications/${notPlayingAlerts[0]!.id}`);
    await waitForHydratedPage(lateMemberPage);
    await expect(
      lateMemberPage.getByRole('heading', {
        level: 1,
        name: en.notifications.kinds.match_registration_not_playing
      })
    ).toBeVisible();
    await expect(
      lateMemberPage.getByText(en.notifications.match.registrationNotPlayingBody)
    ).toBeVisible();
    await lateMemberPage.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(lateMemberPage).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      lateMemberPage
        .getByText(en.matchRegistration.badges.reserveNotPlaying, { exact: true })
        .first()
    ).toBeVisible();

    // Complete quartet stays playable on the match surface (the members joined
    // directly, so their own placement reads JOINED — F27).
    await memberPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(memberPage);
    await expect(
      memberPage.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 1 }))
    ).toBeVisible();
    await expect(
      rosterSection(memberPage).getByRole('heading', {
        name: fill(en.matchRegistration.roster.groupTitle, { group: 1 })
      })
    ).toBeVisible();

    // Expired requester: durable expiry alert with a working deep link and the
    // truthful expired state on the match surface.
    const expiredAlerts = await notificationRows(requester, 'match_registration_expired', eventId);
    expect(expiredAlerts).toHaveLength(1);
    await requesterPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(requesterPage);
    await expect(
      requesterPage.getByText(en.matchRegistration.request.expiredBadge, { exact: true })
    ).toBeVisible();
    await expect(requesterPage.getByText(en.matchRegistration.request.expiredCopy)).toBeVisible();
    await requesterPage.goto(`/notifications/${expiredAlerts[0]!.id}`);
    await waitForHydratedPage(requesterPage);
    await expect(
      requesterPage.getByRole('heading', {
        level: 1,
        name: en.notifications.kinds.match_registration_expired
      })
    ).toBeVisible();
    await expect(
      requesterPage.getByText(en.notifications.match.registrationExpiredBody)
    ).toBeVisible();
    await requesterPage.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(requesterPage).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      requesterPage.getByText(en.matchRegistration.request.expiredBadge, { exact: true })
    ).toBeVisible();

    // A viewer without a registration row sees the explicit closed state with the
    // truthful split of playing vs reserve-not-playing.
    const guestPage = family.guestPage!;
    await guestPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(guestPage);
    // Badge and disabled CTA share the copy; the badge span comes first in the panel.
    await expect(
      guestPage.getByText(en.matchRegistration.closed.badge, { exact: true }).first()
    ).toBeVisible();
    await expect(
      guestPage.getByText(
        fill(en.matchRegistration.closed.rosterCount, { playing: 4, reserveNotPlaying: 1 })
      )
    ).toBeVisible();
    await expect(
      guestPage.getByRole('button', { name: en.matchRegistration.closed.button })
    ).toBeDisabled();

    const detail = await detailData(creator, eventId);
    expect(detail).toMatchObject({
      registration_open: false,
      accepted_count: 5,
      playing_count: 4,
      reserve_count: 0,
      reserve_not_playing_count: 1
    });
  });
});
