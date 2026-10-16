import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

// PAF-76 functional E2E: real journeys for create/discover Match Events against the local
// loopback stack — publish through the UI wizard with a real image, notification delivery,
// visibility matrix, invitations, deep links, idempotent replays and validation rejections.
// Visual/screenshot coverage is a separate workstream and intentionally absent here.

type Copy = {
  auth: { loginEmailLabel: string; loginPasswordLabel: string; loginSubmit: string };
  matches: {
    navigationLabel: string;
    unavailable: string;
    back: string;
    empty: { available: string; past: string };
    badges: { invited: string; resultActionRequired: string };
    card: { photoAlt: string; pricePerPlayer: string; openMaps: string };
    detail: {
      title: string;
      creatorAccepted: string;
      invitationInfo: string;
      share: string;
      shareUrl: string;
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
      type: string;
      venueName: string;
      mapsUrl: string;
      price: string;
      currency: string;
      photo: string;
      maximumRegistrations: string;
      cutoff: string;
    };
    invitees: { search: string };
    photo: { remove: string };
    errors: {
      invalidInput: string;
      invalidMapsUrl: string;
      unsupportedCurrency: string;
      negativePrice: string;
      pastStart: string;
      invalidCutoff: string;
    };
  };
  notifications: {
    kinds: { match_event_published: string; match_event_invitation: string };
    match: { openEvent: string; invitedBy: string; venue: string };
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
    throw new Error('Matches E2E requires loopback Supabase');
  return { url, key };
}

function rand(): string {
  return crypto.randomUUID().slice(0, 8);
}

/** A real, decodable 1x1 PNG (70 bytes) — valid magic bytes and a real browser image. */
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
  const email = `match-${crypto.randomUUID()}@test.local`;
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
  return created.data;
}

async function joinCommunityAsActiveMember(
  admin: Actor,
  communityId: string,
  member: Actor
): Promise<void> {
  // Public instant-join communities are joined through the real join RPC (invitation
  // acceptance is private-only per the join-flow RPC contract).
  void admin;
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

async function matchNotificationRows(
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
): Promise<{
  id: string;
  community_id: string;
  photo_path: string;
  maps_url: string;
  min_level: number | null;
  max_level: number | null;
}> {
  const row = await creator.client
    .from('match_events')
    .select('id,community_id,photo_path,maps_url,min_level,max_level')
    .eq('venue_name', venue)
    .maybeSingle();
  if (row.error || !row.data) throw row.error ?? new Error('Published event row is missing');
  return row.data;
}

function captureResponses(page: Page): () => Promise<string> {
  const payloads: Promise<string>[] = [];
  const collect = (response: import('@playwright/test').Response) => {
    if (['document', 'fetch', 'xhr'].includes(response.request().resourceType()))
      payloads.push(response.text().catch(() => ''));
  };
  page.on('response', collect);
  return async () => {
    page.off('response', collect);
    return (await Promise.all(payloads)).join('\n');
  };
}

/** Trusted local SQL harness (single atomic DO block so concurrent publications never
 * observe disabled triggers): only the future-start creator trigger is bypassed, exactly
 * like the integration fixture suites do for elapsed events. */
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

// The global Available listing is pruned once per run by e2e/global-setup.ts (integration
// fixture events would otherwise fill the limit-20 page before this suite publishes).

async function detailData(actor: Actor, eventId: string): Promise<Record<string, unknown>> {
  const result = await actor.client.rpc('get_match_event', { p_event_id: eventId });
  if (result.error) throw result.error;
  const data = Array.isArray(result.data) ? result.data[0] : result.data;
  if (typeof data !== 'object' || data === null || Array.isArray(data))
    throw new Error(`Detail for ${eventId} did not resolve to an object`);
  return data;
}

// ---------------------------------------------------------------------------
// Shared wizard helper. The create route currently has no in-app entry link
// (the dashboard only links /matches), so the wizard is reached by its real
// protected URL /matches/create — recorded here, not worked around.
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
    visibility?: 'community_open' | 'invite_only';
    teamMode?: 'PREDEFINED_TEAMS' | 'POST_MATCH_TEAMS';
    price?: string;
    maximum?: string;
    inviteeName?: string;
  }
): Promise<void> {
  await openCreateWizard(page);
  const visibility = options.visibility ?? 'community_open';
  await page.getByLabel(en.matchCreate.fields.date).fill(options.date ?? ymd(3));
  await page.getByLabel(en.matchCreate.fields.startTime).fill(options.startTime ?? '19:30');
  await page.getByLabel(en.matchCreate.fields.visibility).selectOption(visibility);
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
  if (options.inviteeName) {
    await page.getByLabel(en.matchCreate.invitees.search).fill(options.inviteeName);
    await page.getByRole('button', { name: options.inviteeName }).click();
    await expect(page.getByRole('listitem').filter({ hasText: options.inviteeName })).toBeVisible();
  }
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
  if (visibility === 'community_open')
    await expect(page.getByRole('link', { name: options.venue, exact: true })).toBeVisible();
}

test.describe.serial('public community_open lifecycle', () => {
  const family: {
    creator?: Actor;
    member?: Actor;
    excluded?: Actor;
    guest?: Actor;
    communityId?: string;
    eventId?: string;
    photoPath?: string;
    venue?: string;
    mapsUrl?: string;
    date?: string;
    startTime?: string;
    contexts?: BrowserContext[];
    creatorPage?: Page;
    memberPage?: Page;
    excludedPage?: Page;
    guestPage?: Page;
  } = {};

  test.beforeAll(async ({ browser }) => {
    family.creator = await createActor('Match Creator');
    family.member = await createActor('Open Member');
    // Level 6.5 sits outside the creator's suggested 2.7–4.7 range.
    family.excluded = await createActor('Range Outsider', 6.5);
    family.guest = await createActor('Public Guest');
    family.communityId = await createCommunityViaRpc(
      family.creator,
      `Open circle ${rand()}`,
      'public'
    );
    await joinCommunityAsActiveMember(family.creator, family.communityId, family.member);
    await joinCommunityAsActiveMember(family.creator, family.communityId, family.excluded);

    family.contexts = [];
    family.creatorPage = await (await newContext(browser)).newPage();
    family.contexts.push(family.creatorPage.context());
    await signIn(family.creatorPage, family.creator);

    family.venue = `Elite Padel Club ${rand()}`;
    family.mapsUrl = 'https://www.google.com/maps/place/?q=place_id:ElitePadel';
    family.date = ymd(3);
    family.startTime = '19:30';
    await publishMatchViaUi(family.creatorPage, {
      venue: family.venue,
      date: family.date,
      startTime: family.startTime,
      teamMode: 'PREDEFINED_TEAMS',
      price: '12',
      maximum: '16'
    });
    const row = await publishedEventRow(family.creator, family.venue);
    family.eventId = row.id;
    family.photoPath = row.photo_path;
    family.mapsUrl = row.maps_url;

    family.memberPage = await (await newContext(browser)).newPage();
    family.excludedPage = await (await newContext(browser)).newPage();
    family.guestPage = await (await newContext(browser)).newPage();
    family.contexts.push(
      family.memberPage.context(),
      family.excludedPage.context(),
      family.guestPage.context()
    );
    await signIn(family.memberPage, family.member);
    await signIn(family.excludedPage, family.excluded);
    await signIn(family.guestPage, family.guest);
  });

  test.afterAll(async () => {
    await Promise.all((family.contexts ?? []).map((context) => context.close()));
  });

  test('publishing accepts the creator first, shows the event and broadcasts exactly once', async () => {
    test.setTimeout(180_000);
    const creator = family.creator!;
    const member = family.member!;
    const eventId = family.eventId!;
    const venue = family.venue!;

    // Creator is the first accepted registration.
    const registrations = await creator.client
      .from('match_event_registrations')
      .select('user_id,accepted_at')
      .eq('match_event_id', eventId);
    expect(registrations.error).toBeNull();
    expect(registrations.data).toHaveLength(1);
    expect(registrations.data![0]!.user_id).toBe(creator.id);

    // The authoritative detail projection reflects the publication inputs.
    const detail = await detailData(creator, eventId);
    expect(detail).toMatchObject({
      event_id: eventId,
      community_id: family.communityId,
      venue_name: venue,
      event_type: 'friendly',
      visibility: 'community_open',
      team_assignment_mode: 'PREDEFINED_TEAMS',
      price_minor: 1200,
      currency: 'EUR',
      timezone: 'UTC',
      restriction_enabled: true,
      min_level: 2.7,
      max_level: 4.7,
      accepted_count: 1,
      playing_count: 0,
      reserve_count: 1,
      more_needed: 3,
      caller_badge: 'creator'
    });

    // Creator detail page: acceptance, cost, timezone, maps and the real image.
    const creatorPage = family.creatorPage!;
    await creatorPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(creatorPage);
    await expect(
      creatorPage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();
    await expect(creatorPage.getByText(en.matches.detail.creatorAccepted)).toBeVisible();
    await expect(creatorPage.getByText(`${en.matches.card.pricePerPlayer}: €12.00`)).toBeVisible();
    await expect(creatorPage.getByText('Timezone: UTC')).toBeVisible();
    const mapsLink = creatorPage.getByRole('link', {
      name: en.matches.card.openMaps.replace('{{venue}}', venue)
    });
    await expect(mapsLink).toHaveAttribute('href', family.mapsUrl!);
    const photo = creatorPage.getByRole('img', { name: en.matches.card.photoAlt });
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((node) => (node instanceof HTMLImageElement ? node.naturalWidth : 0))
      )
      .toBeGreaterThan(0);

    // Exactly one publication notification for the other active member.
    expect(await matchNotificationRows(member, 'match_event_published', eventId)).toHaveLength(1);
    const memberPage = family.memberPage!;
    await memberPage.goto('/notifications');
    await waitForHydratedPage(memberPage);
    const cards = memberPage
      .locator('main li')
      .filter({ hasText: en.notifications.kinds.match_event_published });
    await expect(cards).toHaveCount(1);
    await expect(cards.getByText(venue)).toBeVisible();
    await cards.getByRole('link', { name: en.notifications.match.openEvent }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      memberPage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();

    // The member discovers the event in Available.
    await memberPage.goto('/matches');
    await waitForHydratedPage(memberPage);
    await expect(memberPage.getByRole('link', { name: venue, exact: true })).toBeVisible();
  });

  test('an authenticated nonmember discovers the public event and image but receives no broadcast', async () => {
    const guest = family.guest!;
    const guestPage = family.guestPage!;
    const eventId = family.eventId!;
    const venue = family.venue!;

    expect(await matchNotificationRows(guest, 'match_event_published', eventId)).toEqual([]);
    await guestPage.goto('/matches');
    await waitForHydratedPage(guestPage);
    const card = guestPage.getByRole('link', { name: venue, exact: true });
    await expect(card).toBeVisible();
    await card.click();
    await expect(guestPage).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await expect(
      guestPage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();
    const photo = guestPage.getByRole('img', { name: en.matches.card.photoAlt });
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate((node) => (node instanceof HTMLImageElement ? node.naturalWidth : 0))
      )
      .toBeGreaterThan(0);
    const mapsLink = guestPage.getByRole('link', {
      name: en.matches.card.openMaps.replace('{{venue}}', venue)
    });
    await expect(mapsLink).toHaveAttribute('href', family.mapsUrl!);
    await expect(mapsLink).toHaveAttribute('rel', /noopener noreferrer/);
    expect(await matchNotificationRows(guest, 'match_event_published', eventId)).toEqual([]);
  });

  test('a member excluded by the level range still sees the event with its truthful range', async () => {
    const excluded = family.excluded!;
    const excludedPage = family.excludedPage!;
    const eventId = family.eventId!;
    const venue = family.venue!;

    // Truthful discovery: the event is NOT hidden from the excluded member.
    await excludedPage.goto('/matches');
    await waitForHydratedPage(excludedPage);
    await expect(excludedPage.getByRole('link', { name: venue, exact: true })).toBeVisible();
    // No personal badge is fabricated for the out-of-range viewer.
    await expect(excludedPage.locator('main article strong')).toHaveCount(0);

    // The authorized projection carries the truthful eligibility facts.
    const detail = await detailData(excluded, eventId);
    expect(detail).toMatchObject({
      restriction_enabled: true,
      min_level: 2.7,
      max_level: 4.7,
      caller_badge: null
    });
    await excludedPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(excludedPage);
    await expect(
      excludedPage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();

    // KNOWN GAP (reported, not faked): the localized out-of-range approval note
    // (matches.detail.outOfRangeApprovalRequired) can never render because neither
    // list_match_events nor get_match_event emits `out_of_range`/`requires_approval`.
  });

  test('repeated publication, reload and focus never duplicate events or notifications', async () => {
    const creator = family.creator!;
    const member = family.member!;
    const creatorPage = family.creatorPage!;
    const eventId = family.eventId!;
    const venue = family.venue!;
    const row = await publishedEventRow(creator, venue);

    // Exact canonical replay through the same RPC returns the original publication.
    const replay = await creator.client.rpc('publish_match_event', {
      p_event_id: eventId,
      p_input: {
        community_id: family.communityId,
        date: family.date,
        start_time: family.startTime,
        event_type: 'friendly',
        visibility: 'community_open',
        team_assignment_mode: 'PREDEFINED_TEAMS',
        venue_name: venue,
        maps_url: family.mapsUrl,
        photo_path: family.photoPath,
        saved_venue_id: null,
        court_notes: null,
        duration_minutes: null,
        notes: null,
        court_booked: false,
        restriction_enabled: true,
        min_level: row.min_level,
        max_level: row.max_level,
        price: '12',
        currency: 'EUR',
        payment_note: null,
        maximum_registrations: 16,
        cutoff_at: null
      },
      p_invitee_ids: []
    });
    expect(replay.error).toBeNull();
    expect(replay.data).toBe(eventId);

    const sameVenue = await creator.client
      .from('match_events')
      .select('id')
      .eq('venue_name', venue);
    expect(sameVenue.error).toBeNull();
    expect(sameVenue.data).toHaveLength(1);
    const registrations = await creator.client
      .from('match_event_registrations')
      .select('user_id')
      .eq('match_event_id', eventId);
    expect(registrations.data).toHaveLength(1);
    expect(await matchNotificationRows(member, 'match_event_published', eventId)).toHaveLength(1);

    await creatorPage.goto('/matches');
    await waitForHydratedPage(creatorPage);
    await expect(creatorPage.getByRole('link', { name: venue, exact: true })).toHaveCount(1);
    await creatorPage.reload();
    await waitForHydratedPage(creatorPage);
    await expect(creatorPage.getByRole('link', { name: venue, exact: true })).toHaveCount(1);
    await creatorPage.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(creatorPage.getByRole('link', { name: venue, exact: true })).toHaveCount(1);
  });

  test('matches surfaces expose no booking, payment, Ranked, League or filter controls', async () => {
    const creatorPage = family.creatorPage!;
    const eventId = family.eventId!;

    await creatorPage.goto('/matches');
    await waitForHydratedPage(creatorPage);
    await expect(creatorPage.getByText(/ranked|league/i)).toHaveCount(0);
    const tabs = creatorPage.getByRole('navigation', { name: en.matches.navigationLabel });
    await expect(tabs.getByRole('link')).toHaveCount(3);
    await expect(creatorPage.getByRole('button')).toHaveCount(0);
    // The global shell language/theme selects live outside main; no filter inputs here.
    await expect(creatorPage.locator('main select, main input')).toHaveCount(0);

    await creatorPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(creatorPage);
    await expect(creatorPage.getByText(/ranked|league/i)).toHaveCount(0);
    const buttons = creatorPage.getByRole('button');
    await expect(buttons).toHaveCount(1);
    await expect(buttons).toHaveAccessibleName(en.matches.detail.share);
    const links = creatorPage.getByRole('link');
    await expect(links).toHaveCount(2); // localized Back + the external Maps anchor
    for (const link of await links.all())
      expect((await link.textContent()) ?? '').not.toMatch(/book|pay|purchase|join|register/i);

    // The create wizard offers exactly the two scoped enums and no Ranked/League state.
    await openCreateWizard(creatorPage);
    await expect(creatorPage.getByText(/ranked|league/i)).toHaveCount(0);
    const typeOptions = await creatorPage
      .getByLabel(en.matchCreate.fields.type)
      .evaluate((select) =>
        select instanceof HTMLSelectElement
          ? Array.from(select.options).map((option) => option.value)
          : []
      );
    expect(typeOptions).toEqual(['competitive', 'friendly']);
    const visibilityOptions = await creatorPage
      .getByLabel(en.matchCreate.fields.visibility)
      .evaluate((select) =>
        select instanceof HTMLSelectElement
          ? Array.from(select.options).map((option) => option.value)
          : []
      );
    expect(visibilityOptions).toEqual(['community_open', 'invite_only']);
    await expect(
      creatorPage.getByRole('button', { name: /ranked|league|book|pay|purchase/i })
    ).toHaveCount(0);
    await creatorPage.getByRole('button', { name: en.matchCreate.next }).click();
    await expect(
      creatorPage.getByText(en.matchCreate.steps.players, { exact: true })
    ).toBeVisible();
    await creatorPage.getByRole('button', { name: en.matchCreate.next }).click();
    await expect(creatorPage.getByText(en.matchCreate.steps.teams, { exact: true })).toBeVisible();
    await expect(creatorPage.getByRole('radio')).toHaveCount(2);
  });
});

test('a private community_open event stays invisible to an unsolicited outsider everywhere', async ({
  browser
}) => {
  test.setTimeout(240_000);
  const admin = await createActor('Private Admin');
  const stranger = await createActor('Private Stranger');
  await createCommunityViaRpc(admin, `Private circle ${rand()}`, 'private');

  const adminContext = await newContext(browser);
  const strangerContext = await newContext(browser);
  try {
    const adminPage = await adminContext.newPage();
    const strangerPage = await strangerContext.newPage();
    await signIn(adminPage, admin);
    await signIn(strangerPage, stranger);
    const venue = `Hidden Court ${rand()}`;
    await publishMatchViaUi(adminPage, { venue });
    const row = await publishedEventRow(admin, venue);
    const eventId = row.id;

    // Available is a global listing across all authorized communities (parallel suites
    // publish their own events), so invisibility is asserted as venue absence, never as
    // the shared empty state.
    await strangerPage.goto('/matches');
    await waitForHydratedPage(strangerPage);
    await expect(strangerPage.getByRole('link', { name: venue, exact: true })).toHaveCount(0);

    // Direct database access denies the row.
    const direct = await stranger.client.from('match_events').select('id').eq('id', eventId);
    expect(direct.error).toBeNull();
    expect(direct.data).toEqual([]);

    // Detail resolves to the localized unavailable state without leaking context.
    const stopCapture = captureResponses(strangerPage);
    await strangerPage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(strangerPage);
    await expect(strangerPage.getByText(en.matches.unavailable)).toBeVisible();
    await expect(strangerPage.getByRole('link', { name: en.matches.back })).toBeVisible();
    const observed = `${await strangerPage.locator('main').innerText()}\n${await stopCapture()}`;
    expect(observed).not.toContain(venue);
    expect(observed).not.toContain('maps/place');

    // Storage stays closed for the outsider: no download, no signed URL, no public route.
    const download = await stranger.client.storage
      .from('match-event-photos')
      .download(row.photo_path);
    expect(download.error).toBeTruthy();
    const signed = await stranger.client.storage
      .from('match-event-photos')
      .createSignedUrl(row.photo_path, 60);
    expect(signed.error).toBeTruthy();
    const publicProbe = await fetch(
      `${config.url}/storage/v1/object/public/match-event-photos/${row.photo_path}`
    );
    expect(publicProbe.ok).toBe(false);

    // Positive control: the private community's own admin still sees the event.
    await adminPage.goto('/matches');
    await waitForHydratedPage(adminPage);
    await expect(adminPage.getByRole('link', { name: venue, exact: true })).toBeVisible();
  } finally {
    await Promise.all([adminContext.close(), strangerContext.close()]);
  }
});

test('invite_only stays invisible until an explicit invitation and never auto-registers', async ({
  browser
}) => {
  test.setTimeout(300_000);
  const host = await createActor('Invite Host');
  const member = await createActor('Plain Member');
  const invitee = await createActor('Invited Guest');
  const stranger = await createActor('Invite Stranger');
  const communityId = await createCommunityViaRpc(host, `Invite circle ${rand()}`, 'public');
  await joinCommunityAsActiveMember(host, communityId, member);
  await joinCommunityAsActiveMember(host, communityId, invitee);

  const hostContext = await newContext(browser);
  const memberContext = await newContext(browser);
  const strangerContext = await newContext(browser);
  const inviteeContext = await newContext(browser);
  try {
    const hostPage = await hostContext.newPage();
    await signIn(hostPage, host);
    const venue = `Invitation Court ${rand()}`;
    await publishMatchViaUi(hostPage, {
      venue,
      visibility: 'invite_only',
      inviteeName: invitee.displayName
    });
    const row = await publishedEventRow(host, venue);
    const eventId = row.id;

    // No broadcast anywhere; exactly one invitation for the invitee.
    expect(await matchNotificationRows(invitee, 'match_event_invitation', eventId)).toHaveLength(1);
    expect(await matchNotificationRows(invitee, 'match_event_published', eventId)).toEqual([]);
    expect(await matchNotificationRows(member, 'match_event_published', eventId)).toEqual([]);
    expect(await matchNotificationRows(member, 'match_event_invitation', eventId)).toEqual([]);
    expect(await matchNotificationRows(stranger, 'match_event_published', eventId)).toEqual([]);
    expect(await matchNotificationRows(host, 'match_event_published', eventId)).toEqual([]);

    const memberPage = await memberContext.newPage();
    const strangerPage = await strangerContext.newPage();
    await signIn(memberPage, member);
    await signIn(strangerPage, stranger);

    // Ordinary member and stranger: invisible in the list, direct DB access and deep link.
    for (const [page, actor] of [
      [memberPage, member],
      [strangerPage, stranger]
    ] as const) {
      await page.goto('/matches');
      await waitForHydratedPage(page);
      await expect(page.getByRole('link', { name: venue, exact: true })).toHaveCount(0);
      const denied = await actor.client.rpc('get_match_event', { p_event_id: eventId });
      expect(denied.data ?? null).toBeNull();
      await page.goto(`/matches/${eventId}`);
      await waitForHydratedPage(page);
      await expect(page.getByText(en.matches.unavailable)).toBeVisible();
    }

    // The invited member: INVITED badge, invitation context and notification — no registration.
    const registrationsBefore = await host.client
      .from('match_event_registrations')
      .select('user_id')
      .eq('match_event_id', eventId);
    expect(registrationsBefore.error).toBeNull();
    expect(registrationsBefore.data).toEqual([{ user_id: host.id }]);

    const inviteePage = await inviteeContext.newPage();
    await signIn(inviteePage, invitee);
    await inviteePage.goto('/matches/my');
    await waitForHydratedPage(inviteePage);
    const card = inviteePage.locator('main article').filter({ hasText: venue });
    await expect(card).toHaveCount(1);
    await expect(card.locator('strong')).toHaveText(en.matches.badges.invited);
    await inviteePage.goto(`/matches/${eventId}`);
    await waitForHydratedPage(inviteePage);
    await expect(
      inviteePage.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();
    await expect(inviteePage.getByText(en.matches.detail.invitationInfo)).toBeVisible();

    const invitationRows = await matchNotificationRows(invitee, 'match_event_invitation', eventId);
    await inviteePage.goto('/notifications');
    await waitForHydratedPage(inviteePage);
    const invitationCard = inviteePage
      .locator('main li')
      .filter({ hasText: en.notifications.kinds.match_event_invitation });
    await expect(invitationCard).toHaveCount(1);
    await expect(invitationCard.getByText(venue)).toBeVisible();
    await inviteePage.goto(`/notifications/${invitationRows[0]!.id}`);
    await waitForHydratedPage(inviteePage);
    await expect(
      inviteePage.getByRole('heading', {
        level: 1,
        name: en.notifications.kinds.match_event_invitation
      })
    ).toBeVisible();
    await expect(
      inviteePage.getByText(en.notifications.match.invitedBy.replace('{{name}}', host.displayName))
    ).toBeVisible();
    await expect(inviteePage.getByText(`${en.notifications.match.venue}: ${venue}`)).toBeVisible();

    const registrationsAfter = await host.client
      .from('match_event_registrations')
      .select('user_id')
      .eq('match_event_id', eventId);
    expect(registrationsAfter.data).toEqual([{ user_id: host.id }]);
  } finally {
    await Promise.all([
      hostContext.close(),
      memberContext.close(),
      strangerContext.close(),
      inviteeContext.close()
    ]);
  }
});

test('unknown or malformed events resolve to the graceful unavailable state', async ({
  browser
}) => {
  test.setTimeout(120_000);
  const viewer = await createActor('Missing Viewer');
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, viewer);
    // There is no delete API (events are immutable), so a never-published UUID is the
    // truthful stand-in for a missing/deleted event: identical unavailable resolution.
    for (const target of [crypto.randomUUID(), 'not-a-uuid']) {
      await page.goto(`/matches/${target}`);
      await waitForHydratedPage(page);
      await expect(page.getByText(en.matches.unavailable)).toBeVisible();
      await expect(page.getByRole('link', { name: en.matches.back })).toBeVisible();
    }
    await page.getByRole('link', { name: en.matches.back }).click();
    await expect(page).toHaveURL(/\/matches$/);
  } finally {
    await context.close();
  }
});

test('invalid input cannot publish through the UI or the publication RPC', async ({ browser }) => {
  test.setTimeout(300_000);
  const creator = await createActor('Invalid Host');
  const communityId = await createCommunityViaRpc(creator, `Invalid circle ${rand()}`, 'public');
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, creator);
    const countOwnEvents = async (): Promise<number> => {
      const rows = await creator.client.from('match_events').select('id');
      if (rows.error) throw rows.error;
      return rows.data.length;
    };
    const before = await countOwnEvents();

    const fillValidDraft = async (venue: string, date: string) => {
      await openCreateWizard(page);
      await page.getByLabel(en.matchCreate.fields.date).fill(date);
      await page.getByLabel(en.matchCreate.fields.startTime).fill('19:30');
      await page.getByLabel(en.matchCreate.fields.venueName).fill(venue);
      await page
        .getByLabel(en.matchCreate.fields.mapsUrl)
        .fill('https://maps.google.com/maps/place/valid-venue');
    };
    const uploadPhotoAndReview = async () => {
      await page
        .getByLabel(en.matchCreate.fields.photo)
        .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: matchPhoto() });
      await expect(page.getByRole('button', { name: en.matchCreate.photo.remove })).toBeVisible({
        timeout: 15_000
      });
      for (let step = 0; step < 3; step += 1)
        await page.getByRole('button', { name: en.matchCreate.next }).click();
      await expect(page.getByRole('heading', { name: en.matchCreate.review })).toBeVisible();
    };
    const publishExpectRejected = async (message: string) => {
      await page.getByRole('button', { name: en.matchCreate.publish }).click();
      await expect(page).toHaveURL(/\/matches\/create$/);
      await expect(page.getByText(en.matchCreate.errors.invalidInput)).toBeVisible();
      await expect(page.getByText(message)).toBeVisible();
    };

    // Malformed Maps URL.
    await fillValidDraft(`Broken Maps ${rand()}`, ymd(3));
    await page
      .getByLabel(en.matchCreate.fields.mapsUrl)
      .fill('https://padel.example.com/maps/not-maps');
    await uploadPhotoAndReview();
    await publishExpectRejected(en.matchCreate.errors.invalidMapsUrl);

    // Negative price.
    await fillValidDraft(`Broken Price ${rand()}`, ymd(3));
    await page.getByLabel(en.matchCreate.fields.price).fill('-5');
    await uploadPhotoAndReview();
    await publishExpectRejected(en.matchCreate.errors.negativePrice);

    // Past start.
    await fillValidDraft(`Broken Start ${rand()}`, ymd(-1));
    await uploadPhotoAndReview();
    await publishExpectRejected(en.matchCreate.errors.pastStart);

    // Custom cutoff after the start.
    await fillValidDraft(`Broken Cutoff ${rand()}`, ymd(3));
    await page.getByLabel(en.matchCreate.fields.cutoff).fill(`${ymd(3)}T21:00`);
    await uploadPhotoAndReview();
    await publishExpectRejected(en.matchCreate.errors.invalidCutoff);

    // Missing photo keeps Publish disabled: there is no publication path at all.
    await fillValidDraft(`Broken Photo ${rand()}`, ymd(3));
    await page.getByLabel(en.matchCreate.fields.price).fill('5');
    for (let step = 0; step < 3; step += 1)
      await page.getByRole('button', { name: en.matchCreate.next }).click();
    await expect(page.getByRole('button', { name: en.matchCreate.publish })).toBeDisabled();
    await expect(page).toHaveURL(/\/matches\/create$/);

    expect(await countOwnEvents()).toBe(before);

    // Direct RPC: unsupported currency is impossible through the select, so the
    // protocol-level rejection is proven here alongside the other rules.
    const stagePhoto = async (draftId: string): Promise<string> => {
      const path = `${communityId}/${draftId}/${creator.id}/${crypto.randomUUID()}.png`;
      const upload = await creator.client.storage
        .from('match-event-photos')
        .upload(path, matchPhoto(), { contentType: 'image/png' });
      expect(upload.error).toBeNull();
      return path;
    };
    const attempts = [
      {
        label: 'malformed Maps URL',
        override: { maps_url: 'https://padel.example.com/maps/not-maps' },
        code: '22023'
      },
      { label: 'unsupported currency', override: { currency: 'CHF' }, code: '22023' },
      { label: 'negative price', override: { price: '-5' }, code: '22023' },
      { label: 'past start', override: { date: ymd(-1) }, code: '23514' },
      {
        label: 'cutoff after start',
        override: { cutoff_at: new Date(Date.now() + 4 * 86_400_000).toISOString() },
        code: '22023'
      }
    ];
    for (const attempt of attempts) {
      const draftId = crypto.randomUUID();
      const photoPath = await stagePhoto(draftId);
      const result = await creator.client.rpc('publish_match_event', {
        p_event_id: draftId,
        p_input: {
          community_id: communityId,
          date: ymd(3),
          start_time: '10:00',
          event_type: 'friendly',
          visibility: 'community_open',
          team_assignment_mode: 'POST_MATCH_TEAMS',
          venue_name: `Rpc Reject ${rand()}`,
          maps_url: 'https://maps.google.com/maps/place/rpc-venue',
          photo_path: photoPath,
          saved_venue_id: null,
          court_notes: null,
          duration_minutes: null,
          notes: null,
          court_booked: false,
          restriction_enabled: false,
          min_level: null,
          max_level: null,
          price: null,
          currency: null,
          payment_note: null,
          maximum_registrations: null,
          cutoff_at: null,
          ...attempt.override
        },
        p_invitee_ids: []
      });
      expect(result.error?.code, attempt.label).toBe(attempt.code);
      const stored = await creator.client.from('match_events').select('id').eq('id', draftId);
      expect(stored.data, attempt.label).toEqual([]);
    }
    expect(await countOwnEvents()).toBe(before);
  } finally {
    await context.close();
  }
});

test('an elapsed Past event shows scheduled history without fabricated results', async ({
  browser
}) => {
  test.setTimeout(240_000);
  const creator = await createActor('Elapsed Host');
  const outsider = await createActor('Elapsed Outsider');
  const communityId = await createCommunityViaRpc(creator, `Elapsed circle ${rand()}`, 'public');
  const eventId = crypto.randomUUID();
  const photoPath = `${communityId}/${eventId}/${creator.id}/${crypto.randomUUID()}.png`;
  const upload = await creator.client.storage
    .from('match-event-photos')
    .upload(photoPath, matchPhoto(), { contentType: 'image/png' });
  expect(upload.error).toBeNull();
  const venue = `Elapsed Court ${rand()}`;
  await fixtureSql(
    `alter table public.match_events disable trigger match_event_creator_registration; ` +
      `insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,price_minor,currency,notes) ` +
      `values ('${eventId}','${communityId}','${creator.id}', now() - interval '26 hours','UTC','friendly','community_open','PREDEFINED_TEAMS','${venue}','https://maps.google.com/maps/place/elapsed','${photoPath}', now() - interval '27 hours', 1000,'EUR','Elapsed notes'); ` +
      `alter table public.match_events enable trigger match_event_creator_registration;`
  );

  const context = await newContext(browser);
  const outsiderContext = await newContext(browser);
  try {
    const page = await context.newPage();
    await signIn(page, creator);
    await page.goto('/matches/past');
    await waitForHydratedPage(page);
    const card = page.locator('main article').filter({ hasText: venue });
    await expect(card).toHaveCount(1);
    await expect(card.getByText('€10.00')).toBeVisible();
    await card.getByRole('link', { name: venue, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/matches/${eventId}$`));
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', { level: 1, name: `${en.matches.detail.title}: ${venue}` })
    ).toBeVisible();
    // Scheduled history only: no result badge, no score-like pair, no confirmed/disputed prose.
    const mainText = await page.locator('main').innerText();
    expect(mainText).not.toMatch(/\d+\s[-–—]\s\d/);
    expect(mainText).not.toMatch(/confirmed|disputed|cancel|forfeit/i);
    await expect(page.getByText(en.matches.badges.resultActionRequired)).toHaveCount(0);
    // KNOWN GAP (reported, not faked): matches.detail.pastScheduled/outcomeUnavailable can
    // never render because get_match_event does not emit an `is_past` flag.

    const outsiderPage = await outsiderContext.newPage();
    await signIn(outsiderPage, outsider);
    await outsiderPage.goto('/matches/past');
    await waitForHydratedPage(outsiderPage);
    await expect(outsiderPage.getByRole('link', { name: venue, exact: true })).toHaveCount(0);
  } finally {
    await Promise.all([context.close(), outsiderContext.close()]);
  }
});
