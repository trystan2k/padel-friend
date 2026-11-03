import { expect, test, type Locator, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { en, fill } from './matches-management-fixtures';
import {
  A_ALL_TOTALS,
  SEED_GROUPS,
  linesFor,
  statisticsWorld,
  totalsOf,
  type Filter,
  type PlayerKey,
  type SeedGroup,
  type StatisticsWorld
} from './statistics-fixtures';

// PAF-13 U8 journeys. Real persisted data confirmed through the production finalizer; every
// expected figure comes from the hand-calculated oracle in statistics-fixtures.ts, never from
// the UI under test. Role/name locators, auto-retrying assertions (no sleeps) and a console
// error watcher on every journey.

const t = en.statistics;
let w: StatisticsWorld;
const pages = new Map<PlayerKey, Page>();
const consoleErrors = new WeakMap<Page, string[]>();

test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  w = await statisticsWorld(browser);
});
test.afterAll(async () => {
  test.setTimeout(240_000);
  await w?.cleanup();
});
test.beforeEach(() => test.setTimeout(180_000));

async function pageOf(key: PlayerKey): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const page = await w.f.page(w.actors[key], 'en', 1280, 'light', 900);
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  consoleErrors.set(page, errors);
  pages.set(key, page);
  return page;
}

/** Console / hydration errors fail the journey (denial journeys expect 4xx resource logs). */
function expectNoBrowserErrors(page: Page) {
  const errors = consoleErrors.get(page) ?? [];
  expect(errors, 'browser console and hydration errors').toEqual([]);
  errors.length = 0;
}

async function visit(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}

const stat = (page: Page, label: string): Locator =>
  page
    .locator('dl > div')
    .filter({
      has: page
        .getByRole('term')
        .filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) })
    })
    .first();
async function expectStat(page: Page, label: string, value: string | number) {
  await expect(stat(page, label).locator('strong').first(), label).toHaveText(String(value));
}
const percent = (ratio: number) =>
  new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 1 }).format(ratio);

const playerPath = (key: PlayerKey, search = '') => `/players/${w.idOf(key)}${search}`;
const query = (filter: Filter) => {
  const params = new URLSearchParams();
  if (filter.community)
    params.set('communityId', filter.community === 'main' ? w.f.community : w.cross.communityId);
  if (filter.league) params.set('leagueId', w.leagues[filter.league].id);
  if (filter.type) params.set('type', filter.type);
  if (filter.from) params.set('from', filter.from);
  if (filter.through) params.set('through', filter.through);
  const text = params.toString();
  return text ? `?${text}` : '';
};

async function expectPlayerTotals(page: Page, filter: Filter) {
  const totals = totalsOf(linesFor('A', filter));
  await expectStat(page, 'Matches played', totals.groups);
  await expectStat(page, 'Wins', totals.wins);
  await expectStat(page, 'Losses', totals.losses);
  await expectStat(page, 'Draws', totals.draws);
  await expectStat(page, 'Incomplete results', totals.incomplete);
  await expectStat(page, 'Sets won', totals.setsWon);
  await expectStat(page, 'Sets lost', totals.setsLost);
  await expectStat(page, 'Games won', totals.gamesWon);
  await expectStat(page, 'Games lost', totals.gamesLost);
  const decided = totals.wins + totals.losses + totals.draws;
  if (decided > 0) await expectStat(page, 'Win rate', percent(totals.wins / decided));
}

const groupsOf = (filter: Filter): SeedGroup[] =>
  SEED_GROUPS.filter((group) => {
    if (filter.community && group.community !== filter.community) return false;
    if (filter.league && (group.league !== filter.league || group.classification === 'incomplete'))
      return false;
    if (filter.type && group.type !== filter.type) return false;
    const day = group.at.slice(0, 10);
    return !(filter.from && day < filter.from) && !(filter.through && day > filter.through);
  });

async function expectCommunityTotals(page: Page, filter: Filter) {
  const groups = groupsOf({ ...filter, community: 'main' });
  await expectStat(page, 'Matches played', groups.length);
  await expectStat(page, 'Competitive', groups.filter((g) => g.type === 'competitive').length);
  await expectStat(page, 'Friendly', groups.filter((g) => g.type === 'friendly').length);
  await expectStat(
    page,
    'With a winner',
    groups.filter((g) => g.classification.startsWith('team')).length
  );
  await expectStat(page, 'Draws', groups.filter((g) => g.classification === 'draw').length);
  await expectStat(
    page,
    'Incomplete',
    groups.filter((g) => g.classification === 'incomplete').length
  );
}

/** Opens a chart's data table with the keyboard only and returns header → value rows. */
async function tableByKeyboard(page: Page, chart: string | RegExp) {
  const figure = page.getByRole('figure', { name: chart });
  const trigger = figure.getByRole('button', { name: t.charts.showData });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await expect(figure.getByRole('button', { name: t.charts.hideData })).toBeFocused();
  const table = figure.getByRole('table');
  await expect(table).toBeVisible();
  const rows = table.getByRole('row');
  const count = await rows.count();
  const result: [string, string][] = [];
  for (let index = 1; index < count; index += 1) {
    const row = rows.nth(index);
    result.push([
      (await row.getByRole('rowheader').innerText()).trim(),
      (await row.getByRole('cell').innerText()).trim()
    ]);
  }
  return result;
}

const monthLabel = (period: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${period}-01T00:00:00Z`)
  );
const dayLabel = (date: Date) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date);
const mondayOf = (instant: string) => {
  const date = new Date(`${instant.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date;
};

// --- AC1: history lifecycle labels + group detail ---------------------------------------

test('history shows every lifecycle label separately from match type', async () => {
  const page = await pageOf('A');
  await visit(page, '/matches/past');
  const list = page.getByRole('list', { name: t.history.listLabel });
  await expect(list).toBeVisible();
  const status = (name: string) => list.getByText(name, { exact: true });
  await expect(status(t.history.status.played)).toHaveCount(7);
  await expect(status(t.history.status.incomplete)).toHaveCount(1);
  await expect(status(t.history.status.pending)).toHaveCount(1);
  await expect(status(t.history.status.disputed)).toHaveCount(1);
  await expect(status(t.history.status.canceled)).toHaveCount(1);
  // A plays in both the awaiting-result event and the reserve event (where D is the reserve).
  await expect(status(t.history.status.awaiting_result)).toHaveCount(2);
  await expect(status(t.history.status.reserve_not_playing)).toHaveCount(0);
  // Match type is its own badge; Played may coexist with Friendly or Competitive.
  await expect(list.getByText('Friendly', { exact: true })).toHaveCount(3);
  // Unconfirmed lifecycle entries never show a score or a rating.
  await expect(list.getByText(t.history.statusHelp.pending)).toBeVisible();
  await expect(list.getByText(t.history.statusHelp.disputed)).toBeVisible();
  expectNoBrowserErrors(page);

  const reserve = await pageOf('D');
  await visit(reserve, '/matches/past');
  // D is the fifth registrant, hence the reserve, of the four open five-player events.
  await expect(
    reserve
      .getByRole('list', { name: t.history.listLabel })
      .getByText(t.history.status.reserve_not_playing, { exact: true })
  ).toHaveCount(4);
  expectNoBrowserErrors(reserve);
});

test('group detail shows manual approver vs automatic confirmation, rating effects and audit', async () => {
  const page = await pageOf('A');
  const open = (key: string) =>
    visit(page, `/matches/${w.groupIds[key]!.eventId}/groups/${w.groupIds[key]!.proposalId}`);

  await open('g1'); // MANUAL, Competitive, Closed League
  await expect(
    page.getByText(fill(t.detail.confirmation.manual, { name: w.nameOf('A') }), { exact: true })
  ).toBeVisible();
  await expect(page.getByText(t.detail.confirmation.automatic)).toHaveCount(0);
  await expect(page.getByText(t.detail.rating.state.applied, { exact: true })).toBeVisible();
  await expect(
    page.getByText(fill(t.detail.setsTotal, { a: 2, b: 0 }), { exact: false })
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: t.detail.sections.timeline })).toBeVisible();
  await expect(page.getByText(`Result submitted by ${w.f.creator.name}`)).toBeVisible();

  await open('g2'); // AUTO_48H
  await expect(page.getByText(t.detail.confirmation.automatic, { exact: true })).toBeVisible();
  await expect(page.getByText(`Approved by`)).toHaveCount(0);
  await expect(page.getByText(`Confirmed automatically`).first()).toBeVisible();
  await expect(page.getByText('Games 15–13')).toBeVisible();

  await open('g6'); // Incomplete: games kept, no outcome, no rating
  await expect(page.getByText(t.detail.rating.absent.incomplete).first()).toBeVisible();
  await expect(page.getByText(t.detail.winner.team_a)).toHaveCount(0);
  await expect(page.getByText(t.detail.winner.team_b)).toHaveCount(0);
  expectNoBrowserErrors(page);
});

test('2-1 with an unfinished third set stays a draw and never becomes a win or a set', async () => {
  const page = await pageOf('A');
  await visit(page, `/matches/${w.groupIds['g3']!.eventId}/groups/${w.groupIds['g3']!.proposalId}`);
  await expect(page.getByText(t.detail.winner.draw, { exact: true })).toBeVisible();
  await expect(page.getByText('Sets 1–1 · Games 11–11')).toBeVisible();
  await expect(page.getByText(t.detail.winner.team_a)).toHaveCount(0);
  await expect(page.getByText(t.detail.winner.team_b)).toHaveCount(0);
  await expect(page.getByText(t.detail.rating.absent.friendly).first()).toBeVisible();

  // History row, pair table and head-to-head table agree: Draw, 1–1 sets, 11–11 games.
  await visit(page, '/matches/past');
  const row = page.getByRole('listitem').filter({ hasText: 'Games 11–11' });
  await expect(row).toHaveCount(1);
  await expect(row.getByText(t.history.outcome.draw, { exact: true })).toBeVisible();
  await expect(row.getByText(t.history.outcome.win, { exact: true })).toHaveCount(0);

  await visit(page, `${playerPath('A')}/partners/${w.idOf('B')}`);
  const pairRow = page.getByRole('row').filter({ hasText: '11–11' });
  await expect(pairRow.getByRole('cell').nth(0)).toHaveText(/draw/i);
  await expect(pairRow.getByRole('cell').nth(1)).toHaveText('1–1');
  await visit(page, `${playerPath('A')}/opponents/${w.idOf('C')}`);
  const h2hRow = page.getByRole('row').filter({ hasText: '11–11' });
  await expect(h2hRow.getByRole('cell').nth(0)).toHaveText(/draw/i);
  await expect(h2hRow.getByRole('cell').nth(1)).toHaveText('1–1');
  expectNoBrowserErrors(page);
});

// --- AC2/AC3: navigation chain with preserved scope --------------------------------------

test('dashboard to player, partner pair, opponent head-to-head and group detail keep the scope', async () => {
  const page = await pageOf('A');
  await visit(page, '/dashboard');
  await page.getByRole('link', { name: t.player.myStatistics }).click();
  await expect(page).toHaveURL(new RegExp(`/players/${w.idOf('A')}$`));
  await waitForHydratedPage(page);
  await expectPlayerTotals(page, {});
  expect(totalsOf(linesFor('A')), 'oracle matches the literal hand calculation').toEqual(
    A_ALL_TOTALS
  );

  const scope: Filter = { community: 'main', type: 'competitive' };
  await visit(page, playerPath('A', query(scope)));
  await expectPlayerTotals(page, scope);
  const partnersTable = page.getByRole('table', { name: /Partners/ });
  await partnersTable.getByRole('link', { name: new RegExp(w.nameOf('B')) }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${w.idOf('B')}\\?`));
  await expect(page).toHaveURL(/type=competitive/);
  await expect(page).toHaveURL(new RegExp(`communityId=${w.f.community}`));
  await waitForHydratedPage(page);
  const pair = linesFor('A', scope).filter((line) => line.partner === 'B');
  const pairTotals = totalsOf(pair);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `${w.nameOf('A')} & ${w.nameOf('B')}`
  );
  await expectStat(page, 'Matches together', pairTotals.groups);
  await expectStat(page, 'Wins', pairTotals.wins);
  await expectStat(page, 'Incomplete results', pairTotals.incomplete);

  await page.getByRole('link', { name: t.relationships.backToPlayer }).click();
  await expect(page).toHaveURL(/type=competitive/);
  await waitForHydratedPage(page);
  await expectPlayerTotals(page, scope);

  const opponentsTable = page.getByRole('table', { name: /Opponents/ });
  await opponentsTable.getByRole('link', { name: new RegExp(w.nameOf('C')) }).click();
  await expect(page).toHaveURL(new RegExp(`/opponents/${w.idOf('C')}\\?`));
  await waitForHydratedPage(page);
  const meetings = linesFor('A', scope).filter((line) => line.opponents.includes('C'));
  const h2h = totalsOf(meetings);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    `${w.nameOf('A')} vs ${w.nameOf('C')}`
  );
  await expectStat(page, 'Meetings', h2h.groups);
  await expectStat(page, 'Wins', h2h.wins);
  await expectStat(page, 'Losses', h2h.losses);
  await expectStat(page, 'Games won', h2h.gamesWon);
  await expectStat(page, 'Games lost', h2h.gamesLost);

  await page
    .getByRole('link', { name: /View match played on/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/matches\/[0-9a-f-]+\/groups\/[0-9a-f-]+$/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: t.detail.title })).toBeVisible();
  expectNoBrowserErrors(page);
});

test('one-match partnership shows the raw record but no best-partner claim', async () => {
  const page = await pageOf('A');
  await visit(page, `${playerPath('A')}/partners/${w.idOf('E')}`);
  await expectStat(page, 'Matches together', 1);
  await expectStat(page, 'Wins', 1);
  await expect(
    page.getByText(fill(t.relationships.eligibility.pair.notYet, { observed: 1, required: 5 }))
  ).toBeVisible();
  await visit(page, playerPath('A'));
  const best = stat(page, 'Best partner');
  await expect(best).toContainText('Not available');
  await expect(best).toContainText('Shown after 5 matches');
  // The raw 1–0 record stays visible in the partner list.
  const row = page
    .getByRole('table', { name: /Partners/ })
    .getByRole('row')
    .filter({ hasText: w.nameOf('E') });
  await expect(row).toContainText('1W 0L 0D');
  expectNoBrowserErrors(page);
});

// --- AC4: filters, deep links, reload, back/forward --------------------------------------

test('player filters via deep links match the seeded numbers and survive reload and history', async () => {
  const page = await pageOf('A');
  const matrix: Filter[] = [
    {},
    { community: 'main' },
    { community: 'cross' },
    { community: 'main', type: 'friendly' },
    { community: 'main', type: 'competitive' },
    { community: 'main', league: 'active' },
    { community: 'main', league: 'closed' },
    { community: 'main', from: '2026-09-15', through: '2026-10-05' },
    { type: 'competitive', from: '2026-10-05', through: '2026-10-05' }
  ];
  for (const filter of matrix) {
    await visit(page, playerPath('A', query(filter)));
    await expectPlayerTotals(page, filter);
  }
  const first: Filter = { community: 'main', league: 'active' };
  const second: Filter = { community: 'main', type: 'friendly' };
  await visit(page, playerPath('A', query(first)));
  await page.goto(playerPath('A', query(second)));
  await waitForHydratedPage(page);
  await expectPlayerTotals(page, second);
  await page.reload();
  await waitForHydratedPage(page);
  await expectPlayerTotals(page, second);
  await page.goBack();
  await waitForHydratedPage(page);
  await expect(page).toHaveURL(new RegExp(`leagueId=${w.leagues.active.id}`));
  await expectPlayerTotals(page, first);
  await page.goForward();
  await waitForHydratedPage(page);
  await expect(page).toHaveURL(/type=friendly/);
  await expectPlayerTotals(page, second);
  expectNoBrowserErrors(page);
});

test('community filters apply through the form, write the URL and replay on back/forward', async () => {
  const page = await pageOf('A');
  const base = `/community/${w.f.community}/statistics`;
  await visit(page, base);
  await expectCommunityTotals(page, {});
  const form = page.getByRole('form', { name: t.filters.title });

  await form
    .getByLabel(t.filters.league)
    .selectOption({ label: fill(t.filters.activeLeague, { name: w.leagues.active.name }) });
  await form.getByRole('button', { name: t.filters.apply }).click();
  await expect(page).toHaveURL(new RegExp(`leagueId=${w.leagues.active.id}`));
  await expectCommunityTotals(page, { league: 'active' });
  await expectStat(
    page,
    'Matches in the active ranking',
    groupsOf({ community: 'main', league: 'active' }).length
  );

  await form
    .getByLabel(t.filters.league)
    .selectOption({ label: fill(t.filters.historicalLeague, { name: w.leagues.closed.name }) });
  await form.getByRole('button', { name: t.filters.apply }).click();
  await expect(page).toHaveURL(new RegExp(`leagueId=${w.leagues.closed.id}`));
  await expectCommunityTotals(page, { league: 'closed' });

  await form.getByLabel(t.filters.league).selectOption({ label: t.filters.noLeague });
  await form.getByRole('radio', { name: t.filters.types.competitive }).check();
  await form.getByLabel(t.filters.from).fill('2026-09-15');
  await form.getByLabel(t.filters.through).fill('2026-10-05');
  await form.getByRole('button', { name: t.filters.apply }).click();
  await expect(page).toHaveURL(/type=competitive/);
  await expect(page).toHaveURL(/from=2026-09-15/);
  const dated: Filter = { type: 'competitive', from: '2026-09-15', through: '2026-10-05' };
  await expectCommunityTotals(page, dated);

  await page.goBack();
  await waitForHydratedPage(page);
  await expect(page).toHaveURL(new RegExp(`leagueId=${w.leagues.closed.id}`));
  await expectCommunityTotals(page, { league: 'closed' });
  await page.goForward();
  await waitForHydratedPage(page);
  await expectCommunityTotals(page, dated);
  await page.reload();
  await waitForHydratedPage(page);
  await expectCommunityTotals(page, dated);

  await form.getByRole('button', { name: t.filters.reset }).click();
  await expect(page).not.toHaveURL(/type=/);
  await expectCommunityTotals(page, {});
  expectNoBrowserErrors(page);
});

test('Friendly with a League explains the empty selection instead of coercing the type', async () => {
  const page = await pageOf('A');
  await visit(
    page,
    `/community/${w.f.community}/statistics?leagueId=${w.leagues.active.id}&type=friendly`
  );
  await expect(page.getByText(t.community.notice.friendly_league)).toBeVisible();
  await expectStat(page, 'Matches played', 0);
  await visit(
    page,
    playerPath('A', query({ community: 'main', league: 'active', type: 'friendly' }))
  );
  await expectPlayerTotals(page, { community: 'main', league: 'active', type: 'friendly' });
  expectNoBrowserErrors(page);
});

// --- AC6: chart tables opened by keyboard, values equal the seeded series ----------------

test('chart data tables open by keyboard and list every seeded value', async () => {
  const page = await pageOf('A');
  await visit(page, playerPath('A'));
  const months = new Map<string, number>();
  for (const line of linesFor('A')) {
    const period = line.group.at.slice(0, 7);
    months.set(period, (months.get(period) ?? 0) + 1);
  }
  const expectedMonths = [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, n]) => [monthLabel(period), String(n)]);
  expect(await tableByKeyboard(page, t.player.activity.caption)).toEqual(expectedMonths);
  await expect(
    page.getByRole('figure', { name: t.player.activity.caption }).getByText(/8 matches in total/)
  ).toBeVisible();

  await visit(page, `/community/${w.f.community}/statistics`);
  const main = SEED_GROUPS.filter((group) => group.community === 'main');
  const weekly = new Map<number, number>();
  for (const group of main)
    weekly.set(mondayOf(group.at).getTime(), (weekly.get(mondayOf(group.at).getTime()) ?? 0) + 1);
  const starts = [...weekly.keys()].sort((a, b) => a - b);
  const expectedWeeks: [string, string][] = [];
  for (let at = starts[0]!; at <= starts.at(-1)!; at += 7 * 86_400_000)
    expectedWeeks.push([dayLabel(new Date(at)), String(weekly.get(at) ?? 0)]);
  const weeklyRows = await tableByKeyboard(page, /Matches per week/);
  expect(weeklyRows).toEqual(expectedWeeks);

  const monthly = new Map<string, number>();
  for (const group of main)
    monthly.set(group.at.slice(0, 7), (monthly.get(group.at.slice(0, 7)) ?? 0) + 1);
  const expectedMonthly = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, n]) => [monthLabel(period), String(n)]);
  expect(await tableByKeyboard(page, /Matches per month/)).toEqual(expectedMonthly);
  expectNoBrowserErrors(page);
});

// --- authorization / membership edge cases ------------------------------------------------

test('an outsider cannot read the private community, its aggregates or its group detail', async () => {
  const page = await pageOf('G');
  await visit(page, `/community/${w.cross.communityId}/statistics`);
  await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
  await expect(page.getByText(w.cross.name)).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: new RegExp(t.navigation.community, 'i') })
  ).toHaveCount(0);

  const gx = w.groupIds['gx']!;
  await visit(page, `/matches/${gx.eventId}/groups/${gx.proposalId}`);
  // The route answers with the app's not-found state: no result, no teams, no score.
  await expect(page.getByText('Not Found', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: t.detail.title })).toHaveCount(0);

  // Another player's all-communities aggregate never unions the private community.
  await visit(page, playerPath('A', `?communityId=${w.cross.communityId}`));
  await expect(page.getByText(w.cross.name)).toHaveCount(0);
  await expect(stat(page, 'Matches played')).toHaveCount(0);
});

test('an inactive community member keeps the history of matches they actually played', async () => {
  const page = await pageOf('F');
  await visit(page, playerPath('F'));
  await expectPlayerTotals2(page);
  await visit(page, '/matches/past');
  const list = page.getByRole('list', { name: t.history.listLabel });
  await expect(list.getByText(t.history.status.played, { exact: true })).toHaveCount(1);
  const g7 = w.groupIds['g7']!;
  await visit(page, `/matches/${g7.eventId}/groups/${g7.proposalId}`);
  await expect(page.getByRole('heading', { name: t.detail.title })).toBeVisible();
  await expect(page.getByText('Games 12–3')).toBeVisible();
  expectNoBrowserErrors(page);
});

async function expectPlayerTotals2(page: Page) {
  const totals = totalsOf(linesFor('F'));
  expect(totals.groups).toBe(1);
  await expectStat(page, 'Matches played', 1);
  await expectStat(page, 'Wins', totals.wins);
  await expectStat(page, 'Games won', totals.gamesWon);
}
