import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { day, leagueFixtures } from './leagues-fixtures';
import { copies, en, fill, sql } from './matches-management-fixtures';

// PAF-173: a former community member reads, read-only, the League they actually played in.
// Real routes, sessions and RPCs (leave_community, close_league, result review); trusted SQL is
// used for setup and time anchors only. Assertions use the en locale strings and structure
// (roles, hrefs, focus, geometry), never screenshots.
const former = en.leagues.former;
const h = en.leagues.history;
const history = en.statistics.history;

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let leagueId: string;
let proposalB: string;
const LEAGUE_NAME = 'Former Participant League';
// Deliberately short: stresses the 44px minimum width of the match-history League link.
const OPEN_NAME = 'Q3';
let openLeagueId: string;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  f = await leagueFixtures(browser, { memberCount: 5, communityName: 'Former Club' });
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(180_000);
});

// Quartet: creator + member 0 (team A) vs members 1 + 2 (team B). Member 2 leaves the community;
// member 0 stays; member 3 never played.
const players = () => [f.creator, f.members[0]!, f.members[1]!, f.members[2]!];
const FORMER = () => f.members[2]!;
const MEMBER = () => f.members[0]!;
const teams = () => ({
  team_a: [players()[0]!.id, players()[1]!.id],
  team_b: [players()[2]!.id, players()[3]!.id]
});

async function playedRankedEvent(name: string, league = leagueId) {
  const eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId: league,
    date: day(1),
    venue: `Former E2E ${name}`
  });
  for (const player of players().slice(1))
    await f.rpc(player, 'submit_match_registration', { p_match_event_id: eventId });
  await f.cutoff(eventId);
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
    alter table public.match_events disable trigger match_event_league_binding;
    update public.match_events set starts_at=now()-interval '3 hours',
      registration_cutoff_at=now()-interval '4 hours' where id='${eventId}';
    alter table public.match_events enable trigger match_event_league_binding;
    alter table public.match_events enable trigger match_event_immutable;
  end $$;`);
  return eventId;
}

async function submitGroup(eventId: string, sets: [number, number][], minutesAgo: number) {
  const played = new Date(Math.floor((Date.now() - minutesAgo * 60_000) / 1000) * 1000);
  const iso = played.toISOString().replace('.000Z', 'Z');
  await f.rpc(f.creator, 'submit_match_event_result', {
    p_match_event_id: eventId,
    p_group_number: 1,
    p_teams: teams(),
    p_sets: sets.map(([a, b], index) => ({
      position: index + 1,
      team_a_games: a,
      team_b_games: b,
      completed: true
    })),
    p_played_local: {
      local: iso.slice(0, 19).replace('T', ' '),
      offset_seconds: 0,
      instant: iso
    },
    p_court_label: 'Court 1',
    p_request_id: crypto.randomUUID()
  });
  const [row] = await sql(
    `select id::text from public.match_event_result_proposals where match_event_id='${eventId}' and group_number=1`
  );
  return String(row?.id);
}

async function approve(proposal: string) {
  await f.rpc(players()[2]!, 'review_match_event_result', {
    p_proposal_id: proposal,
    p_expected_version: 1,
    p_decision: 'approve',
    p_request_id: crypto.randomUUID()
  });
}

const detailPath = () => `/community/${f.community}/leagues/${leagueId}`;
const openDetailPath = () => `/community/${f.community}/leagues/${openLeagueId}`;
async function visit(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}
const leagueLink = (page: Page) =>
  page.getByRole('link', { name: fill(history.leagueLink, { name: LEAGUE_NAME }) });
const openLeagueLink = (page: Page) =>
  page.getByRole('link', { name: fill(history.leagueLink, { name: OPEN_NAME }) });

function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    // Denial journeys legitimately log failed resource loads.
    if (message.type() === 'error' && !/status of 4\d\d/.test(message.text()))
      errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

test('seed: private community, closed League with two published versions, former player left', async () => {
  leagueId = await f.createLeague(f.creator, {
    name: LEAGUE_NAME,
    endMode: 'manual',
    start: day(0),
    minimum: 1
  });
  await sql(`do $$ begin
    update public.leagues set start_at=now()-interval '10 days' where id='${leagueId}';
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from=now()-interval '10 days', activated_at=now()-interval '10 days'
      where community_id='${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  const [league] = await sql(
    `select version, status::text as status from public.leagues where id='${leagueId}'`
  );
  if (league?.status !== 'active')
    await f.rpc(f.creator, 'activate_league', {
      p_league_id: leagueId,
      p_expected_version: league?.version
    });

  const win = await playedRankedEvent('win');
  await approve(
    await submitGroup(
      win,
      [
        [6, 4],
        [6, 3]
      ],
      90
    )
  );
  const draw = await playedRankedEvent('draw');
  proposalB = await submitGroup(
    draw,
    [
      [6, 4],
      [4, 6]
    ],
    45
  );
  const [current] = await sql(`select version from public.leagues where id='${leagueId}'`);
  await f.rpc(f.creator, 'close_league', {
    p_league_id: leagueId,
    p_expected_version: current?.version
  });
  // Late first confirmation publishes final version 2; version 1 stays inspectable.
  await approve(proposalB);
  const [counted] = await sql(
    `select count(*)::int as versions from public.league_standings_snapshots where league_id='${leagueId}'`
  );
  expect(counted?.versions).toBe(2);

  // An open (Active) League the former player also played: live standings with an earned row.
  // Its start is a fixed past instant so the rendered period never drifts between runs.
  openLeagueId = await f.createLeague(f.creator, {
    name: OPEN_NAME,
    endMode: 'manual',
    start: day(0),
    minimum: 1
  });
  await sql(`update public.leagues set start_at='2026-10-01T00:00:00Z' where id='${openLeagueId}'`);
  const [open] = await sql(
    `select version, status::text as status from public.leagues where id='${openLeagueId}'`
  );
  if (open?.status !== 'active')
    await f.rpc(f.creator, 'activate_league', {
      p_league_id: openLeagueId,
      p_expected_version: open?.version
    });
  await approve(
    await submitGroup(
      await playedRankedEvent('open', openLeagueId),
      [
        [6, 4],
        [6, 3]
      ],
      30
    )
  );
  const [live] = await sql(
    `select count(*)::int as n from public.league_player_counters where league_id='${openLeagueId}' and user_id='${FORMER().id}' and matches > 0`
  );
  expect(live?.n).toBe(1);

  await sql(`update public.communities set visibility='private' where id='${f.community}'`);
  await f.rpc(FORMER(), 'leave_community', { p_community_id: f.community });
  const [stillMember] = await sql(
    `select count(*)::int as n from public.community_members
       where community_id='${f.community}' and user_id='${FORMER().id}' and valid_until is null and status='active'`
  );
  expect(stillMember?.n).toBe(0);
});

test('former participant: history League link opens the read-only League, back returns to history', async () => {
  const page = await f.page(FORMER());
  const errors = watchErrors(page);
  await visit(page, '/matches/past');
  const link = leagueLink(page).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', detailPath());
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${detailPath()}$`));
  await waitForHydratedPage(page);

  await expect(page.getByRole('heading', { level: 1, name: LEAGUE_NAME })).toBeVisible();
  await expect(page.getByRole('heading', { name: former.title })).toBeVisible();
  await expect(page.getByText(former.body)).toBeVisible();
  // Read-only: no management actions, no community-level links.
  await expect(page.getByRole('button', { name: en.leagues.detail.close })).toHaveCount(0);
  await expect(page.getByRole('link', { name: en.statistics.community.open })).toHaveCount(0);
  await expect(page.getByRole('link', { name: h.previousLeagues })).toHaveCount(0);
  await expect(page.getByRole('link', { name: en.leagues.back })).toHaveCount(0);

  const back = page.getByRole('link', { name: former.back });
  await expect(back).toHaveAttribute('href', '/matches/past');
  await back.click();
  await expect(page).toHaveURL(/\/matches\/past$/);
  await waitForHydratedPage(page);
  await expect(leagueLink(page).first()).toBeVisible();
  expect(errors, 'browser console and hydration errors').toEqual([]);
});

test('former participant: open League opens from history with live standings, their earned row and the notice', async () => {
  const page = await f.page(FORMER());
  const errors = watchErrors(page);
  await visit(page, '/matches/past');
  const link = openLeagueLink(page).first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', openDetailPath());
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${openDetailPath()}$`));
  await waitForHydratedPage(page);

  await expect(page.getByRole('heading', { level: 1, name: OPEN_NAME })).toBeVisible();
  await expect(page.getByTestId('former-participant-notice')).toBeVisible();
  await expect(page.getByRole('heading', { name: former.title })).toBeVisible();
  await expect(page.getByText(former.body)).toBeVisible();
  // Live standings of the open League, with the viewer's own earned row (a played loss).
  await expect(page.getByText(en.leagues.standings.live, { exact: true }).first()).toBeVisible();
  const own = page.locator('tr:visible').filter({ hasText: FORMER().name }).first();
  await expect(own).toBeVisible();
  await expect(own.getByText(en.leagues.standings.you, { exact: true })).toBeVisible();
  await expect(
    page.locator('tr:visible').filter({ hasText: f.creator.name }).first()
  ).toBeVisible();
  // Read-only: no management actions.
  await expect(page.getByRole('button', { name: en.leagues.detail.close })).toHaveCount(0);

  const back = page.getByRole('link', { name: former.back });
  await expect(back).toHaveAttribute('href', '/matches/past');
  await back.click();
  await expect(page).toHaveURL(/\/matches\/past$/);
  await waitForHydratedPage(page);
  await expect(openLeagueLink(page).first()).toBeVisible();
  expect(errors, 'browser console and hydration errors').toEqual([]);
});

test('former participant: deep link, reload and version switching work without membership', async () => {
  const page = await f.page(FORMER());
  await visit(page, detailPath());
  await expect(page.getByRole('heading', { name: former.title })).toBeVisible();
  const select = page.getByRole('combobox', { name: h.selectVersion });
  await expect(select).toHaveValue('2');
  await expect(page.getByText(h.lateFirstConfirmation)).toBeVisible();

  await select.focus();
  await select.selectOption('1');
  await expect(page).toHaveURL(/version=1/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('1');
  await expect(page.getByText(h.olderVersion)).toBeVisible();
  await expect(page.getByRole('heading', { name: former.title })).toBeVisible();

  // A reload of the versioned URL keeps working; the back target stays match history.
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('1');
  await expect(page.getByRole('link', { name: former.back })).toHaveAttribute(
    'href',
    '/matches/past'
  );

  await page.getByRole('combobox', { name: h.selectVersion }).selectOption('2');
  await waitForHydratedPage(page);
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('2');
});

test('former participant of a private community reaches the League but not community surfaces', async () => {
  const page = await f.page(FORMER());
  await visit(page, detailPath());
  await expect(page.getByRole('heading', { name: former.title })).toBeVisible();

  const [community] = await sql(
    `select visibility::text as v from public.communities where id='${f.community}'`
  );
  expect(community?.v).toBe('private');

  // The community League list stays denied through the existing League error contract.
  await visit(page, `/community/${f.community}/leagues`);
  await expect(page.getByRole('heading', { name: en.leagues.deniedTitle })).toBeVisible();
  await expect(page.getByText(LEAGUE_NAME)).toHaveCount(0);

  // Community administration members stay inaccessible: the League name never leaks there.
  await visit(page, `/community/${f.community}/admin/members`);
  await expect(page.getByText(LEAGUE_NAME)).toHaveCount(0);
  await expect(page.getByText(players()[0]!.name)).toHaveCount(0);
});

test('former participant: layout fits the narrow viewport, keyboard reaches link and back, targets >= 44px', async () => {
  const page = await f.page(FORMER(), 'en', 320, 'light', 700);
  await visit(page, '/matches/past');
  const link = leagueLink(page).first();
  await link.scrollIntoViewIfNeeded();
  // Both hit-area dimensions, for a long League name and for a very short one (min-width stress).
  const linkBox = await link.boundingBox();
  expect(linkBox!.height).toBeGreaterThanOrEqual(44);
  expect(linkBox!.width).toBeGreaterThanOrEqual(44);
  const shortLink = openLeagueLink(page).first();
  await shortLink.scrollIntoViewIfNeeded();
  await expect(shortLink).toHaveText(fill(history.league, { name: OPEN_NAME }));
  const shortBox = await shortLink.boundingBox();
  expect(shortBox!.height).toBeGreaterThanOrEqual(44);
  expect(shortBox!.width).toBeGreaterThanOrEqual(44);
  const overflow = () =>
    page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
  expect(await overflow()).toBeLessThanOrEqual(0);

  // Keyboard activation of the History League link.
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`${detailPath()}$`));
  await waitForHydratedPage(page);

  const notice = page.getByRole('heading', { name: former.title });
  await expect(notice).toBeVisible();
  const card = notice.locator('xpath=ancestor::div[1]');
  const box = await card.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(320 + 1);
  expect(await overflow()).toBeLessThanOrEqual(0);

  const back = page.getByRole('link', { name: former.back });
  const backBox = await back.boundingBox();
  expect(backBox!.width).toBeGreaterThanOrEqual(44);
  expect(backBox!.height).toBeGreaterThanOrEqual(44);
  await back.focus();
  await expect(back).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/matches\/past$/);
});

test('active member regression: League detail has no notice and keeps the community back target', async () => {
  const page = await f.page(MEMBER());
  await visit(page, detailPath());
  await expect(page.getByRole('heading', { level: 1, name: LEAGUE_NAME })).toBeVisible();
  await expect(page.getByRole('heading', { name: former.title })).toHaveCount(0);
  await expect(page.getByText(former.body)).toHaveCount(0);
  await expect(page.getByRole('link', { name: former.back })).toHaveCount(0);
  const back = page.getByRole('link', { name: en.leagues.back });
  await expect(back).toHaveAttribute('href', `/community/${f.community}/leagues`);
  await expect(page.getByRole('link', { name: en.statistics.community.open })).toBeVisible();
  await expect(page.getByRole('link', { name: h.previousLeagues })).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/community/${f.community}/leagues$`));
});

const noticeCard = (page: Page) => page.getByTestId('former-participant-notice');
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
/** The computed colour a CSS value resolves to, so assertions compare tokens, not literals. */
const resolved = (page: Page, property: 'background-color' | 'color', value: string) =>
  page.evaluate(
    ([name, css]) => {
      const probe = document.createElement('div');
      probe.style.setProperty(name!, css!);
      document.body.append(probe);
      const computed = getComputedStyle(probe).getPropertyValue(name!);
      probe.remove();
      return computed;
    },
    [property, value]
  );

// Design intent (Pencil frame YYMpT, "State variants - former participant League access"): a
// distinct notice (green-soft surface, eye icon, compact horizontal layout, muted body copy),
// asserted through tokens, roles and geometry so it survives restyling within the intent.
test('former participant: notice has the approved treatment (token surface, icon beside copy, muted body)', async () => {
  const page = await f.page(FORMER(), 'en', 390, 'light', 844);
  await visit(page, openDetailPath());
  const notice = noticeCard(page);
  await expect(notice).toBeVisible();
  const title = notice.getByRole('heading', { name: former.title });
  const icon = page.getByTestId('former-participant-icon');
  const body = notice.getByText(former.body);
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('aria-hidden', 'true');

  const colors = await notice.evaluate((element) => ({
    surface: getComputedStyle(element).backgroundColor,
    page: getComputedStyle(document.body).backgroundColor
  }));
  expect(colors.surface).toBe(await resolved(page, 'background-color', 'var(--color-green-soft)'));
  expect(colors.surface).not.toBe(colors.page);
  expect(await body.evaluate((element) => getComputedStyle(element).color)).toBe(
    await resolved(page, 'color', 'var(--color-muted)')
  );
  expect(await title.evaluate((element) => getComputedStyle(element).color)).not.toBe(
    await body.evaluate((element) => getComputedStyle(element).color)
  );

  // Compact horizontal layout: the icon sits left of the copy, inside the notice, same row.
  const [card, iconBox, titleBox] = await Promise.all([
    notice.boundingBox(),
    icon.boundingBox(),
    title.boundingBox()
  ]);
  expect(iconBox!.x + iconBox!.width).toBeLessThanOrEqual(titleBox!.x + 1);
  expect(iconBox!.x).toBeGreaterThanOrEqual(card!.x);
  expect(iconBox!.y).toBeGreaterThanOrEqual(card!.y);
  expect(iconBox!.y + iconBox!.height).toBeLessThanOrEqual(card!.y + card!.height);
  expect(titleBox!.y).toBeLessThan(iconBox!.y + iconBox!.height);
});

// Longer translated copy at the narrowest supported width: no overflow, notice fully reachable.
for (const locale of ['pt-BR', 'es'] as const) {
  test(`former participant: ${locale} copy fits the 320px viewport and stays operable`, async () => {
    const copy = copies[locale].leagues.former;
    const page = await f.page(FORMER(), locale, 320, 'light', 700);
    await visit(page, openDetailPath());
    const notice = noticeCard(page);
    await expect(notice.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(notice.getByText(copy.body)).toBeVisible();
    await notice.scrollIntoViewIfNeeded();
    await expect(notice).toBeInViewport({ ratio: 1 });
    const card = await notice.boundingBox();
    expect(card!.x).toBeGreaterThanOrEqual(0);
    expect(card!.x + card!.width).toBeLessThanOrEqual(320 + 1);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

    const back = page.getByRole('link', { name: copy.back });
    await back.scrollIntoViewIfNeeded();
    const backBox = await back.boundingBox();
    expect(backBox!.width).toBeGreaterThanOrEqual(44);
    expect(backBox!.height).toBeGreaterThanOrEqual(44);
    expect(backBox!.x).toBeGreaterThanOrEqual(0);
    expect(backBox!.x + backBox!.width).toBeLessThanOrEqual(320 + 1);
    await back.focus();
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/matches\/past$/);
  });
}

// Former-state visual regression. Tagged @visual: excluded from the fast lane (VISUAL_GREP), part of
// the full pnpm test:e2e gate. Baselines live in leagues-former-participant.spec.ts-snapshots.
//
// Tolerance evidence (PAF-173, AGENTS.md visual-gate rules):
//  - Structure is carried by the strict token/geometry/role probes above; they are never relaxed and
//    the pixel budgets are not a structural gate.
//  - Budgets are ceilings that only absorb font-rasterization drift inside the one pinned Chromium
//    config (raster flags fixed in playwright.config.ts): the focused notice crops are text-light
//    (0.01), the full League detail adds the standings table and header chrome (0.02), the same
//    ceilings the Home and notification visual specs use for their pinned-renderer baselines.
//  - Cross-renderer (Pencil vs Chromium) pixel equality is out of scope per AGENTS.md; the notice
//    treatment is gated against the Pencil intent by the token probes, not by a Pencil raster.
//  - Never widen a budget to mask a defect; re-bless only after a reviewed design change.
const FORMER_VISUAL_BUDGETS = {
  'former-notice-en-390.png': 0.01,
  'former-notice-pt-BR-320.png': 0.01,
  'former-league-detail-en-390.png': 0.02
} as const;

test.describe('former participant visual regression', { tag: '@visual' }, () => {
  const shot = {
    animations: 'disabled',
    caret: 'hide',
    threshold: 0.1
  } as const;

  test('former notice crop, en 390px', async () => {
    const page = await f.page(FORMER(), 'en', 390, 'light', 844);
    await visit(page, openDetailPath());
    const name = 'former-notice-en-390.png';
    await expect(noticeCard(page)).toBeVisible();
    await expect(noticeCard(page)).toHaveScreenshot(name, {
      ...shot,
      maxDiffPixelRatio: FORMER_VISUAL_BUDGETS[name]
    });
  });

  test('former notice crop, pt-BR 320px (longest copy)', async () => {
    const page = await f.page(FORMER(), 'pt-BR', 320, 'light', 700);
    await visit(page, openDetailPath());
    const name = 'former-notice-pt-BR-320.png';
    await expect(noticeCard(page)).toBeVisible();
    await expect(noticeCard(page)).toHaveScreenshot(name, {
      ...shot,
      maxDiffPixelRatio: FORMER_VISUAL_BUDGETS[name]
    });
  });

  test('former participant League detail, en 390px', async () => {
    const page = await f.page(FORMER(), 'en', 390, 'light', 844);
    await visit(page, openDetailPath());
    const name = 'former-league-detail-en-390.png';
    await expect(noticeCard(page)).toBeVisible();
    await expect(
      page.locator('tr:visible').filter({ hasText: FORMER().name }).first()
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page).toHaveScreenshot(name, {
      ...shot,
      maxDiffPixelRatio: FORMER_VISUAL_BUDGETS[name]
    });
  });
});
