import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, leagueFixtures } from './leagues-fixtures';
import {
  assertDesignSystemStyles,
  assertInInitialViewport,
  assertNoOverflow,
  primaryRankingTargets,
  assertTouchHeights,
  docBox,
  measureStandingsFrame,
  standingsStyleChecks
} from './league-standings-visual';
import { en, fill, sql } from './matches-management-fixtures';

// PAF-12 U4: a Ranked League from creation to archive. Real routes and RPCs; trusted SQL is used
// for setup and time anchors only (League/event/membership history in the past) and, afterwards,
// to prove the UI shows exactly what the stored records say.
const s = en.leagues.standings;
const h = en.leagues.history;
const c = en.leagues.counters;

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let leagueId: string;
let proposalB: string;
const venue = (name: string) => `Standings E2E ${name}`;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await leagueFixtures(browser, { memberCount: 5, communityName: 'Standings Club' });
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(180_000);
});

const players = () => [f.creator, f.members[0]!, f.members[1]!, f.members[2]!];
const teams = () => ({
  team_a: [players()[0]!.id, players()[1]!.id],
  team_b: [players()[2]!.id, players()[3]!.id]
});

/** A Ranked event of the League with a full quartet, moved into the League's past. */
async function playedRankedEvent(name: string) {
  const eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId,
    date: day(1),
    venue: venue(name)
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

/** Approval by a member of the team opposite the submitter: the group confirms. */
async function approve(proposal: string) {
  await f.rpc(players()[2]!, 'review_match_event_result', {
    p_proposal_id: proposal,
    p_expected_version: 1,
    p_decision: 'approve',
    p_request_id: crypto.randomUUID()
  });
}

const region = (page: Page) => page.getByRole('region', { name: s.tableLabel });
const row = (page: Page, name: string) =>
  region(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name }) });

/** The secondary full-statistics view lives in a native disclosure; open it once per page. */
async function openAllStats(page: Page) {
  if (!(await region(page).isVisible())) await page.getByText(s.allStats, { exact: true }).click();
  await expect(region(page)).toBeVisible();
}

/**
 * Exact compact-table column probe: the five primary columns in order (place, player, W–L–D, set
 * difference, award), left to right without overlap, every header and the first row aligned on
 * the same columns (the frame's avatar / GP sub-lines are an intentional, documented adaptation).
 */
async function assertCompactColumns(table: Locator, labels: string[], label: string) {
  const headers = table.getByRole('columnheader');
  await expect(headers).toHaveText(labels);
  const boxes = await Promise.all((await headers.all()).map((header) => docBox(header)));
  for (let index = 1; index < boxes.length; index++)
    expect
      .soft(boxes[index]!.x, `${label} column ${index} starts at/after column ${index - 1} ends`)
      .toBeGreaterThanOrEqual(boxes[index - 1]!.right - 1);
  const first = table.getByRole('row').nth(1);
  const cellBoxes = await Promise.all(
    [
      first.getByRole('cell').nth(0),
      first.getByRole('rowheader'),
      first.getByRole('cell').nth(1),
      first.getByRole('cell').nth(2),
      first.getByRole('cell').nth(3)
    ].map((cell) => docBox(cell))
  );
  cellBoxes.forEach((cell, index) => {
    expect
      .soft(cell.x, `${label} row cell ${index} aligns with its header`)
      .toBeCloseTo(boxes[index]!.x, 0);
    expect.soft(cell.width, `${label} row cell ${index} width`).toBeCloseTo(boxes[index]!.width, 0);
  });
}

/** Own-summary card probe: place, set difference, matches in one row, left to right, inside the page. */
async function assertSummaryCard(page: Page, label: string) {
  const summary = page.locator('dl').filter({ has: page.getByText(s.yourPlace, { exact: true }) });
  await expect(summary).toHaveCount(1);
  const labels = [s.yourPlace, c.setDifferential, c.matches];
  const stats = await Promise.all(
    labels.map((text) => docBox(summary.locator('dt', { hasText: text }).locator('..')))
  );
  const card = await docBox(summary);
  for (const [index, stat] of stats.entries()) {
    expect
      .soft(stat.x, `${label} summary stat ${index} inside card`)
      .toBeGreaterThanOrEqual(card.x - 1);
    expect
      .soft(stat.right, `${label} summary stat ${index} inside card`)
      .toBeLessThanOrEqual(card.right + 1);
    expect
      .soft(Math.abs(stat.y - stats[0]!.y), `${label} summary stats share one row`)
      .toBeLessThanOrEqual(1);
    if (index > 0)
      expect
        .soft(stat.x, `${label} summary stat order`)
        .toBeGreaterThanOrEqual(stats[index - 1]!.right - 1);
  }
  expect.soft(card.x, `${label} summary card left`).toBeGreaterThanOrEqual(0);
  expect.soft(card.right, `${label} summary card right`).toBeLessThanOrEqual(390);
  return card;
}

/** Primary ranking row of the compact table: place, record, set difference, award. */
const primaryRow = (page: Page, name: string, title = s.title) =>
  page
    .getByRole('table', { name: title, exact: true })
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name }) });

/** Every statistic cell of a row, in table order (place, then the counters, then the award). */
async function cells(page: Page, name: string) {
  await openAllStats(page);
  const texts = await row(page, name).getByRole('cell').allTextContents();
  // The place cell also carries a visually hidden shared-place announcement.
  return texts.map((text, index) =>
    index === 0 ? (text.match(/^\d+/)?.[0] ?? text) : text.trim()
  );
}

async function storedCounters() {
  return sql(
    `select user_id::text, matches, wins, draws, losses, sets_won, sets_lost
       from public.league_player_counters where league_id='${leagueId}' order by user_id`
  );
}

/** Activates through the real command at the League's stored version (the anchors bump it). */
async function activate(id: string) {
  const [league] = await sql(`select version, status::text from public.leagues where id='${id}'`);
  if (league?.status === 'active') return;
  await f.rpc(f.creator, 'activate_league', {
    p_league_id: id,
    p_expected_version: league?.version
  });
}

async function openLeague(page: Page, search = '') {
  await page.goto(`/community/${f.community}/leagues/${leagueId}${search}`);
  await waitForHydratedPage(page);
}

test('Win group confirmed in a Manual League shows exact live counters and shared places', async () => {
  leagueId = await f.createLeague(f.creator, {
    name: 'Standings League',
    endMode: 'manual',
    start: day(0),
    minimum: 2
  });
  // Time anchors: the League began ten days ago and every member was already active then.
  await sql(`do $$ begin
    update public.leagues set start_at=now()-interval '10 days' where id='${leagueId}';
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from=now()-interval '10 days', activated_at=now()-interval '10 days'
      where community_id='${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  await activate(leagueId);

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
  // The unconfirmed Draw group waits for its approval until after the League closes.
  const draw = await playedRankedEvent('draw');
  proposalB = await submitGroup(
    draw,
    [
      [6, 4],
      [4, 6]
    ],
    45
  );

  const page = await f.page(f.creator);
  await openLeague(page);
  await expect(page.getByRole('heading', { name: s.title, exact: true })).toBeVisible();
  await expect(page.getByText(s.live, { exact: true })).toBeVisible();

  const [a, b] = [players()[0]!.name, players()[2]!.name];
  // Primary view, visible without opening anything: place, W–L–D, set difference, award.
  await expect(primaryRow(page, a).getByRole('cell').first()).toHaveText(/^1/);
  await expect(primaryRow(page, a)).toContainText('1–0–0');
  await expect(primaryRow(page, a)).toContainText('+2');
  await expect(primaryRow(page, b)).toContainText('0–1–0');
  await expect(primaryRow(page, b)).toContainText('-2');
  // Place, Matches, Wins, Draws, Losses, Sets won, Sets lost, Set difference, award.
  expect(await cells(page, a)).toEqual([
    '1',
    '1',
    '1',
    '0',
    '0',
    '2',
    '0',
    '+2',
    en.leagues.award.remaining_one
  ]);
  expect(await cells(page, b)).toEqual([
    '5',
    '1',
    '0',
    '0',
    '1',
    '0',
    '2',
    '-2',
    en.leagues.award.remaining_one
  ]);
  // Winners share place 1; the two zero-record members share 3; losers share 5 (competition
  // ranking skips places after a tie). Shared places are announced for assistive tech.
  await expect(
    row(page, players()[1]!.name).getByText(fill(s.sharedPosition, { position: 1 }))
  ).toBeAttached();
  await expect(
    row(page, players()[3]!.name).getByText(fill(s.sharedPosition, { position: 5 }))
  ).toBeAttached();

  // Own summary and callout (creator won).
  await expect(page.getByText(s.yourPlace, { exact: true })).toBeVisible();
  await expect(page.getByText(en.leagues.award.callout.remaining_one)).toBeVisible();

  // The screen is exactly what the stored, materialized counters say.
  const stored = await storedCounters();
  expect(stored).toHaveLength(4);
  for (const record of stored) {
    const actor = players().find((player) => player.id === record.user_id)!;
    expect(await cells(page, actor.name)).toEqual(
      expect.arrayContaining([
        String(record.matches),
        String(record.wins),
        String(record.losses),
        String(record.sets_won),
        String(record.sets_lost)
      ])
    );
  }
  await expect(region(page).getByRole('columnheader', { name: c.setDifferential })).toBeVisible();
});

/**
 * d6ANDN close confirmation. The Pencil frame is a full-screen route; production adapts it to a
 * Base UI modal over the League page (Cancel first so the safe action holds initial focus), so no
 * full-frame screenshot budget exists: exact structural probes gate the dialog instead.
 */
async function closeDialogVisual(page: Page) {
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await docBox(dialog);
  expect.soft(box.x, 'd6ANDN dialog left edge').toBeGreaterThanOrEqual(0);
  expect.soft(box.right, 'd6ANDN dialog right edge').toBeLessThanOrEqual(390);
  expect.soft(box.y, 'd6ANDN dialog top').toBeGreaterThanOrEqual(0);
  expect.soft(box.bottom, 'd6ANDN dialog bottom').toBeLessThanOrEqual(844);
  const confirm = dialog.getByRole('button', { name: en.leagues.detail.closeConfirm.confirm });
  const cancel = dialog.getByRole('button', { name: en.leagues.detail.closeConfirm.cancel });
  // Reference: warning copy, then two stacked full-row 44px actions (End, Cancel).
  const [body, confirmBox, cancelBox] = await Promise.all([
    docBox(dialog.getByText(en.leagues.detail.closeConfirm.body)),
    docBox(confirm),
    docBox(cancel)
  ]);
  for (const control of [confirmBox, cancelBox]) {
    expect.soft(control.y, 'd6ANDN action follows the warning').toBeGreaterThan(body.y);
    expect.soft(control.height, 'd6ANDN action height').toBeGreaterThanOrEqual(44);
    expect.soft(control.x, 'd6ANDN action inside dialog').toBeGreaterThanOrEqual(box.x - 1);
    expect.soft(control.right, 'd6ANDN action inside dialog').toBeLessThanOrEqual(box.right + 1);
    expect
      .soft(control.width, 'd6ANDN action is a full-row control')
      .toBeGreaterThan(box.width / 2);
  }
  const [upper, lower] = [confirmBox, cancelBox].sort((x, y) => x.y - y.y);
  expect
    .soft(upper!.bottom, 'd6ANDN actions are stacked, not overlapping')
    .toBeLessThanOrEqual(lower!.y);
  // Accepted composition: Cancel first (holds initial focus), End second; identical column and width.
  expect.soft(cancelBox.y, 'd6ANDN Cancel precedes End').toBeLessThan(confirmBox.y);
  expect
    .soft(Math.abs(cancelBox.x - confirmBox.x), 'd6ANDN actions share a left edge')
    .toBeLessThanOrEqual(1);
  expect
    .soft(Math.abs(cancelBox.width - confirmBox.width), 'd6ANDN actions share a width')
    .toBeLessThanOrEqual(1);
  expect.soft(confirmBox.y, 'd6ANDN actions keep a gap').toBeGreaterThanOrEqual(cancelBox.bottom);
  expect
    .soft(Math.abs(box.x + box.width / 2 - 195), 'd6ANDN dialog is centered')
    .toBeLessThanOrEqual(1);
  await assertNoOverflow(page, 'd6ANDN');
  // d6ANDN is structural-only (modal adaptation); its card and type still resolve to the tokens.
  await assertDesignSystemStyles(
    page,
    'light',
    [
      {
        name: 'close dialog card',
        locator: dialog,
        tokens: {
          'background-color': 'var(--color-surface)',
          color: 'var(--color-text)',
          'border-top-left-radius': 'var(--radius-14)',
          'padding-top': 'var(--space-14)',
          'row-gap': 'var(--space-8)'
        },
        palette: { 'background-color': 'surface', color: 'text' },
        literals: { 'border-top-left-radius': '14px', 'padding-top': '14px' }
      },
      {
        name: 'close dialog title',
        locator: dialog.getByRole('heading'),
        tokens: {
          'font-family': 'var(--font-family-heading)',
          'font-size': 'var(--font-size-16)',
          'font-weight': 'var(--font-weight-bold)'
        },
        literals: { 'font-size': '16px', 'font-weight': '700' }
      }
    ],
    'd6ANDN masked content'
  );
}

test('ywfn7 active standings: Pencil frame budget and structure', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  const page = await f.page(f.creator, 'en', 390, 'dark', 844);
  await openLeague(page);
  await expect(page.getByText(s.live, { exact: true })).toBeVisible();
  await expect(page.getByText(s.yourPlace, { exact: true })).toBeVisible();
  // F5: the primary ranking is visible in the initial viewport (no scrolling happened yet).
  await assertInInitialViewport(
    page,
    primaryRankingTargets(page.getByRole('table', { name: s.title, exact: true })),
    'ywfn7 initial viewport'
  );
  await measureStandingsFrame(page, 'ywfn7', info);

  // Section order of the approved composition: standings heading + status, own summary, table, award callout.
  const title = page.getByRole('heading', { name: s.title, exact: true });
  const table = page.getByRole('table', { name: s.title, exact: true });
  const own = page.getByText(s.yourPlace, { exact: true });
  const callout = page.getByText(en.leagues.award.callout.remaining_one);
  const order = [
    await docBox(title),
    await docBox(page.getByText(s.live, { exact: true })),
    await docBox(own),
    await docBox(table),
    await docBox(callout)
  ];
  for (let index = 1; index < order.length; index++)
    expect(order[index]!.y, `ywfn7 section ${index} follows ${index - 1}`).toBeGreaterThanOrEqual(
      order[index - 1]!.y - 1
    );

  // Primary table: five columns inside the 390px viewport, no sideways page scroll, 44px controls.
  await expect(table.getByRole('columnheader')).toHaveCount(5);
  const tableBox = await docBox(table);
  expect.soft(tableBox.x, 'ywfn7 table left edge').toBeGreaterThanOrEqual(0);
  expect.soft(tableBox.right, 'ywfn7 table right edge').toBeLessThanOrEqual(390);
  for (const cell of await table.getByRole('row').first().getByRole('columnheader').all()) {
    const box = await cell.boundingBox();
    expect
      .soft(box!.x + box!.width, 'ywfn7 primary column inside viewport')
      .toBeLessThanOrEqual(390);
  }
  // The viewer's own row is the highlighted one (aria-current) and sits inside the table box.
  const current = table.locator('[aria-current]');
  await expect(current).toHaveCount(1);
  const currentBox = await docBox(current);
  expect
    .soft(currentBox.right, 'ywfn7 viewer row inside table')
    .toBeLessThanOrEqual(tableBox.right + 1);
  const summaryCard = await assertSummaryCard(page, 'ywfn7');
  expect
    .soft(summaryCard.bottom, 'ywfn7 summary card precedes the table')
    .toBeLessThanOrEqual(tableBox.y + 1);
  await assertCompactColumns(
    table,
    [s.position, s.player, s.record, c.setDifferential, s.award],
    'ywfn7'
  );
  await assertNoOverflow(page, 'ywfn7');
  await assertTouchHeights(page.locator('main'), 'ywfn7');
  // Masked content (the screenshot compare masks it: Pencil mock copy differs) is certified by the
  // geometry probes above plus these design-token/style assertions, in the dark theme of ywfn7.
  await assertDesignSystemStyles(
    page,
    'dark',
    [
      ...standingsStyleChecks(page, { yourPlace: s.yourPlace, matches: c.matches, title: s.title }),
      {
        name: 'standings heading',
        locator: title,
        tokens: {
          'font-family': 'var(--font-family-heading)',
          'font-size': 'var(--font-size-14)',
          'font-weight': 'var(--font-weight-bold)'
        },
        palette: { color: 'text' },
        literals: { 'font-weight': '700' }
      },
      {
        name: 'award callout',
        locator: callout,
        tokens: {
          'background-color': 'var(--color-green-soft)',
          color: 'var(--color-green)',
          'border-top-left-radius': 'var(--radius-14)',
          'padding-top': 'var(--space-12)',
          'padding-left': 'var(--space-12)',
          'font-size': 'var(--font-size-12)',
          'font-weight': 'var(--font-weight-medium)'
        },
        palette: { 'background-color': 'green-soft', color: 'green' },
        literals: { 'border-top-left-radius': '14px', 'font-size': '12px', 'font-weight': '500' }
      }
    ],
    'ywfn7 masked content'
  );
});

test('only the owner or an Admin closes; closing shows the archived final table', async () => {
  const denied = await f.members[3]!.client.rpc('close_league', {
    p_league_id: leagueId,
    p_expected_version: 2
  });
  expect(denied.error).not.toBeNull();

  const member = await f.page(f.members[3]!);
  await openLeague(member);
  await expect(member.getByRole('button', { name: en.leagues.detail.close })).toHaveCount(0);

  const page = await f.page(f.creator);
  await openLeague(page);
  const trigger = page.getByRole('main').getByRole('button', { name: en.leagues.detail.close });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText(en.leagues.detail.closeConfirm.body);
  // Cancel by keyboard returns focus to the trigger and changes nothing.
  await dialog.getByRole('button', { name: en.leagues.detail.closeConfirm.cancel }).click();
  await expect(trigger).toBeFocused();
  expect(await sql(`select status::text from public.leagues where id='${leagueId}'`)).toEqual([
    { status: 'active' }
  ]);

  await trigger.click();
  await closeDialogVisual(page);
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: en.leagues.detail.closeConfirm.confirm })
    .click();
  await expect(page.getByText(s.final, { exact: true })).toBeVisible();
  await expect(page.getByText(en.leagues.detail.closedDone)).toBeVisible();
  await expect(page.getByRole('button', { name: en.leagues.detail.close })).toHaveCount(0);

  // The archived table is the stored version 1, not today's counters under a final label.
  const [snapshot] = await sql(
    `select standings_version, cause::text, jsonb_array_length(entries) as entries
       from public.league_standings_snapshots where league_id='${leagueId}'`
  );
  expect(snapshot).toMatchObject({ standings_version: 1, cause: 'closed', entries: 4 });
  const select = page.getByRole('combobox', { name: h.selectVersion });
  await expect(select).toHaveValue('1');
  expect(await cells(page, players()[0]!.name)).toEqual([
    '1',
    '1',
    '1',
    '0',
    '0',
    '2',
    '0',
    '+2',
    en.leagues.award.finalIneligible
  ]);
  await expect(page.getByText(h.cause.closed)).toBeVisible();
  // Owner audit trail lists the close.
  await expect(page.getByRole('heading', { name: h.auditTitle })).toBeVisible();
  await expect(
    page.getByRole('listitem').filter({ hasText: en.leagues.history.audit.closed })
  ).toBeVisible();
});

/** xbIxj historical final: composition budget and structure (truthful late-first-confirmation copy). */
async function historyVisual(page: Page, info: TestInfo) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await measureStandingsFrame(page, 'xbIxj', info);
  const notice = page.getByText(h.lateFirstConfirmation);
  const table = page.getByRole('table', { name: s.title, exact: true });
  const select = page.getByRole('combobox', { name: h.selectVersion });
  const [noticeBox, tableBox, selectBox] = await Promise.all([
    docBox(notice),
    docBox(table),
    docBox(select)
  ]);
  // Production order (reported deviation from the frame, where the notice sits above the list):
  // final table first, then the version history that carries the notice and the version select.
  expect
    .soft(noticeBox.y, 'xbIxj history notice follows the final table')
    .toBeGreaterThan(tableBox.bottom);
  expect
    .soft(selectBox.y, 'xbIxj version select follows the final table')
    .toBeGreaterThan(tableBox.bottom);
  expect.soft(selectBox.height, 'xbIxj version select height').toBeGreaterThanOrEqual(44);
  // Exact block order: own summary, final table, version select, then the late-first-confirmation notice.
  const summaryCard = await assertSummaryCard(page, 'xbIxj');
  expect
    .soft(summaryCard.bottom, 'xbIxj summary card precedes the final table')
    .toBeLessThanOrEqual(tableBox.y + 1);
  expect
    .soft(noticeBox.y, 'xbIxj notice follows the version select')
    .toBeGreaterThan(selectBox.bottom);
  await assertCompactColumns(
    table,
    [s.position, s.player, s.record, c.setDifferential, s.award],
    'xbIxj'
  );
  for (const box of [noticeBox, tableBox, selectBox]) {
    expect.soft(box.x, 'xbIxj block left edge').toBeGreaterThanOrEqual(0);
    expect.soft(box.right, 'xbIxj block right edge').toBeLessThanOrEqual(390);
  }
  await assertNoOverflow(page, 'xbIxj');
  // Masked content: geometry probes above plus design-token/style assertions in the light theme.
  await assertDesignSystemStyles(
    page,
    'light',
    [
      ...standingsStyleChecks(page, { yourPlace: s.yourPlace, matches: c.matches, title: s.title }),
      {
        name: 'version select',
        locator: select,
        tokens: {
          'background-color': 'var(--color-surface)',
          color: 'var(--color-text)',
          'border-top-color': 'var(--color-line)',
          'border-top-left-radius': 'var(--radius-12)',
          'font-family': 'var(--font-family-body)',
          'font-size': 'var(--font-size-14)',
          'padding-left': 'var(--space-12)'
        },
        palette: { 'background-color': 'surface', color: 'text', 'border-top-color': 'line' },
        literals: { 'border-top-left-radius': '12px', 'font-size': '14px' }
      },
      {
        name: 'late-first-confirmation notice',
        locator: notice,
        tokens: {
          'font-size': 'var(--font-size-12)',
          'font-weight': 'var(--font-weight-semibold)'
        },
        palette: { color: 'text' },
        literals: { 'font-size': '12px', 'font-weight': '600' }
      },
      {
        name: 'history notice card',
        locator: notice.locator('xpath=ancestor::div[1]'),
        tokens: {
          'background-color': 'var(--color-surface)',
          color: 'var(--color-text)',
          'border-top-left-radius': 'var(--radius-14)',
          'padding-top': 'var(--space-10)',
          'row-gap': 'var(--space-6)'
        },
        palette: { 'background-color': 'surface' },
        literals: { 'border-top-left-radius': '14px', 'padding-top': '10px', 'row-gap': '6px' }
      }
    ],
    'xbIxj masked content'
  );
}

test('a first result confirmed after the close adds a new final; the old one stays inspectable', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  await approve(proposalB);
  const [counted] = await sql(
    `select count(*)::int as versions from public.league_standings_snapshots where league_id='${leagueId}'`
  );
  expect(counted?.versions).toBe(2);

  const page = await f.page(f.creator);
  await openLeague(page);
  const select = page.getByRole('combobox', { name: h.selectVersion });
  await expect(select).toHaveValue('2');
  await expect(page.getByText(h.lateFirstConfirmation)).toBeVisible();
  await expect(page.getByText(/was confirmed for the first time/)).toBeVisible();
  await historyVisual(page, info);
  // Version 2 includes the Draw: two matches each, award minimum reached.
  expect(await cells(page, players()[0]!.name)).toEqual([
    '1',
    '2',
    '1',
    '1',
    '0',
    '3',
    '1',
    '+2',
    en.leagues.award.finalEligible
  ]);
  await expect(
    page.getByRole('listitem').filter({ hasText: en.leagues.history.audit.standings_revised })
  ).toBeVisible();

  // Keyboard-only version selection keeps v1 selected and points at the newer one.
  await select.focus();
  await select.selectOption('1');
  await expect(page).toHaveURL(/version=1/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('1');
  expect(await cells(page, players()[0]!.name)).toEqual([
    '1',
    '1',
    '1',
    '0',
    '0',
    '2',
    '0',
    '+2',
    en.leagues.award.finalIneligible
  ]);
  await expect(page.getByText(h.olderVersion)).toBeVisible();
  await expect(page.getByText(h.revisionAvailable)).toBeVisible();

  await page.getByRole('button', { name: h.viewLatest }).click();
  await expect(page).not.toHaveURL(/version=/);
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('2');

  // An unknown version is a safe, translated error with a way back.
  await openLeague(page, '?version=99');
  await expect(page.getByRole('alert')).toContainText(
    en.leagues.errors.LEAGUE_STANDINGS_VERSION_NOT_FOUND
  );
  await expect(page.getByRole('button', { name: h.viewLatest })).toBeVisible();

  // Members without management rights see the archive but no audit trail or close action.
  const member = await f.page(f.members[3]!);
  await openLeague(member);
  await expect(member.getByText(s.final, { exact: true })).toBeVisible();
  await expect(member.getByRole('heading', { name: h.auditTitle })).toHaveCount(0);
  await expect(member.getByRole('link', { name: h.previousLeagues })).toBeVisible();
});

test('the archived League stays reachable from the list once a successor is active', async () => {
  const successor = await f.createLeague(f.creator, {
    name: 'Successor League',
    endMode: 'manual',
    start: day(0)
  });
  await activate(successor);
  const page = await f.page(f.creator);
  await page.goto(`/community/${f.community}/leagues`);
  await waitForHydratedPage(page);
  await page.getByRole('link', { name: /Standings League/ }).click();
  await expect(page.getByText(s.final, { exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: h.selectVersion })).toHaveValue('2');
});

test('final standings reflow at 320px in pt-BR dark mode with 44px targets and a reachable table', async () => {
  const pt = copies['pt-BR'].leagues;
  const page = await f.page(f.creator, 'pt-BR', 320, 'dark');
  await openLeague(page);
  await expect(page.getByRole('heading', { name: pt.standings.title, exact: true })).toBeVisible();

  // Primary ranking info (place, player, W–L–D, set difference, award) sits inside the 320px
  // viewport: the page never scrolls sideways and no primary column is cut off.
  const primary = page.getByRole('table', { name: pt.standings.title, exact: true });
  await expect(primary.getByRole('columnheader')).toHaveCount(5);
  const own = primaryRow(page, f.creator.name, pt.standings.title);
  await expect(own).toContainText('1–0–1');
  // Vertically too: header and first ranking row lie inside the first 320px-wide screen (before any scroll).
  await assertInInitialViewport(
    page,
    primaryRankingTargets(primary),
    'pt-BR 320px initial viewport'
  );
  for (const cell of await own.getByRole('cell').all()) {
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);

  // Every statistic stays reachable in the secondary view: a named, focusable scroll region.
  await page.getByText(pt.standings.allStats, { exact: true }).click();
  const overflow = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    region: (() => {
      const node = document.querySelector('section[aria-label][tabindex="0"]');
      return node ? node.scrollWidth - node.clientWidth : -1;
    })()
  }));
  expect(overflow.page).toBeLessThanOrEqual(0);
  expect(overflow.region).toBeGreaterThan(0);
  const tableRegion = page.getByRole('region', { name: pt.standings.tableLabel });
  await tableRegion.focus();
  await expect(tableRegion).toBeFocused();

  // Interactive targets stay at least 44px tall, translated text included.
  for (const target of [
    page.getByText(pt.standings.allStats, { exact: true }),
    page.getByRole('combobox', { name: pt.history.selectVersion }),
    page.getByRole('link', { name: pt.history.previousLeagues })
  ]) {
    const box = await target.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.getByText(pt.history.lateFirstConfirmation)).toBeVisible();
});

test('premature, repeated, stale and unauthorized closes are rejected and leave the published finals untouched', async () => {
  const finals = () =>
    sql(`select standings_version, cause::text, md5(entries::text) as entries
           from public.league_standings_snapshots where league_id='${leagueId}' order by standings_version`);
  const leagueRow = async (id: string) => {
    const [league] = await sql(
      `select version, status::text as status from public.leagues where id='${id}'`
    );
    return { version: Number(league?.['version']), status: String(league?.['status']) };
  };
  const closeAs = (who: typeof f.creator, id: string, version: number) =>
    who.client.rpc('close_league', { p_league_id: id, p_expected_version: version });

  const published = await finals();
  expect(published).toHaveLength(2);
  const archived = await leagueRow(leagueId);
  expect(archived.status).toBe('closed');

  // Closing a closed League is an idempotent replay of the same close (nothing is republished);
  // a stale version still conflicts and a plain member is forbidden.
  const replayed = await closeAs(f.creator, leagueId, archived.version);
  expect(replayed.error).toBeNull();
  expect(replayed.data).toMatchObject({ id: leagueId, status: 'closed' });
  expect((await closeAs(f.creator, leagueId, archived.version + 7)).error?.message).toBe(
    'LEAGUE_VERSION_CONFLICT'
  );
  expect((await closeAs(f.members[3]!, leagueId, archived.version)).error).not.toBeNull();

  // Premature: an Upcoming League has nothing to close yet.
  const premature = await f.createLeague(f.creator, {
    name: 'Premature League',
    endMode: 'manual',
    start: day(20)
  });
  const upcoming = await leagueRow(premature);
  expect(upcoming.status).toBe('upcoming');
  expect((await closeAs(f.creator, premature, upcoming.version)).error?.message).toBe(
    'LEAGUE_INVALID_STATE'
  );

  // The active successor: a plain member is forbidden and a stale version conflicts.
  const [successorId] = (
    await sql(
      `select id::text from public.leagues where community_id='${f.community}' and name='Successor League'`
    )
  ).map((found) => String(found['id']));
  const active = await leagueRow(successorId!);
  expect(active.status).toBe('active');
  expect((await closeAs(f.members[3]!, successorId!, active.version)).error?.message).toBe(
    'LEAGUE_FORBIDDEN'
  );
  expect((await closeAs(f.creator, successorId!, active.version + 7)).error?.message).toBe(
    'LEAGUE_VERSION_CONFLICT'
  );

  // Every rejection left the League states and the published finals exactly as they were.
  expect(await leagueRow(successorId!)).toEqual(active);
  expect(await leagueRow(premature)).toEqual(upcoming);
  expect(await leagueRow(leagueId)).toEqual(archived);
  expect(await finals()).toEqual(published);
  expect(await storedCounters()).toHaveLength(4);
});
