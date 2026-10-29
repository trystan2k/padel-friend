import { expect, test } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  copies,
  correctTeams,
  enterScore,
  fill,
  officialSnapshot,
  openRecord,
  resultFixtures,
  review,
  sql
} from './matches-results-fixtures';

let f: Awaited<ReturnType<typeof resultFixtures>>;
const r = copies.en.matches.results;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await resultFixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(120_000));

test('assign two groups and submit only one pending result', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  const id = await f.completedEvent();
  const before = await officialSnapshot(f.community);
  expect(before.filter((row) => row.kind === 'profiles')).toHaveLength(11);
  expect(before.filter((row) => row.kind === 'ratings')).toHaveLength(11);
  const notificationsBefore = await sql(`select id,kind,category,event_key,
      recipient_user_id::text as recipient_id
    from public.notifications where target_id='${id}' order by id`);
  const rosterQuery = `select id,user_id,accepted_order,participation_status from public.match_event_registrations where match_event_id='${id}' order by accepted_order,id`;
  const rosterBefore = await sql(rosterQuery);
  expect(rosterBefore).toHaveLength(8);
  const page = await f.page(f.creator);
  await f.open(page, id);
  await page.getByRole('link', { name: r.title, exact: true }).click();
  await waitForHydratedPage(page);
  await page.getByRole('combobox', { name: r.groupLabel, exact: true }).selectOption('2');
  const groupTwo = await correctTeams(page);
  await expect(page.getByRole('button', { name: r.confirmTeams, exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: r.groupLabel, exact: true }).selectOption('1');
  const teams = await correctTeams(page);
  expect(
    new Set([...teams.team_a, ...teams.team_b, ...groupTwo.team_a, ...groupTwo.team_b]).size
  ).toBe(8);
  await enterScore(page);
  await expect(page.getByText(r.outcome.draw, { exact: true })).toBeVisible();
  await review(page);
  await info.attach('manual-draw-review', {
    body: await page.screenshot({
      path: info.outputPath('manual-draw-review.png'),
      fullPage: true
    }),
    contentType: 'image/png'
  });
  const stale = await f.page(f.creator);
  await openRecord(stale, id);
  await enterScore(stale);
  await review(stale);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.pending, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: r.pending })).toContainText(
    fill(r.versionLabel, { version: 1 })
  );
  await expect(page.getByText(fill(r.autoConfirmIn, { hours: 48 }), { exact: true })).toBeVisible();
  await stale.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(stale.getByText(r.errors.activeProposal, { exact: true })).toBeVisible();
  await expect(stale.getByRole('button', { name: r.reload, exact: true })).toBeVisible();
  await expect(stale.locator('form')).toContainText(fill(r.versionLabel, { version: 1 }));
  await expect(stale.getByRole('button', { name: r.submit, exact: true })).toHaveCount(0);
  const proposals = await f.rpc(f.creator, 'get_match_event_result_proposals', {
    p_match_event_id: id
  });
  expect(proposals).toEqual([
    expect.objectContaining({
      group_number: 1,
      version: 1,
      status: 'pending',
      teams: {
        team_a: teams.team_a.map((user_id) => expect.objectContaining({ user_id })),
        team_b: teams.team_b.map((user_id) => expect.objectContaining({ user_id }))
      },
      classification: 'draw',
      submitted_by_name: 'Management Host',
      court_label: 'Court 2',
      played_at_local: '2026-10-23 18:30:00',
      played_at_offset_seconds: 0,
      sets: [
        { position: 1, team_a_games: 6, team_b_games: 4, completed: true },
        { position: 2, team_a_games: 4, team_b_games: 6, completed: true },
        { position: 3, team_a_games: 2, team_b_games: 1, completed: false }
      ]
    })
  ]);
  if (!Array.isArray(proposals)) throw new Error('Expected proposals array');
  const facts: Record<string, unknown> = proposals[0];
  expect(
    await sql(`select p.group_number::int as group_number, p.active_version::int as active_version, count(v.*)::int as versions
    from public.match_event_result_proposals p join public.match_event_result_proposal_versions v on v.proposal_id=p.id
    where p.match_event_id='${id}' group by p.group_number,p.active_version`)
  ).toEqual([{ group_number: 1, active_version: 1, versions: 1 }]);
  expect(
    Date.parse(String(facts.review_deadline_at)) - Date.parse(String(facts.submitted_at))
  ).toBe(48 * 3_600_000);
  expect(Date.parse(String(facts.played_at_utc))).toBe(Date.parse('2026-10-23T18:30:00Z'));
  await expect(page.getByRole('region', { name: r.pending })).toContainText(
    fill(r.autoConfirmDeadline, {
      deadline: new Intl.DateTimeFormat('en-GB', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'UTC'
      }).format(new Date(String(facts.review_deadline_at)))
    })
  );
  expect(await officialSnapshot(f.community)).toEqual(before);
  expect(await sql(rosterQuery)).toEqual(rosterBefore);
  const notificationsAfter = await sql(`select id,kind,category,event_key,
      recipient_user_id::text as recipient_id
    from public.notifications where target_id='${id}' order by id`);
  const priorNotificationIds = new Set(
    notificationsBefore.map((notification) => notification['id'])
  );
  expect(
    notificationsAfter
      .filter((notification) => priorNotificationIds.has(notification['id']))
      .map(({ id: notificationId, kind, category, event_key, recipient_id }) => ({
        id: notificationId,
        kind,
        category,
        event_key,
        recipient_id
      }))
  ).toEqual(notificationsBefore);
  const newNotifications = notificationsAfter.filter(
    (notification) => !priorNotificationIds.has(notification['id'])
  );
  const expectedResultRecipients = [
    ...new Set([...teams.team_a, ...teams.team_b, f.creator.id])
  ].sort();
  expect(
    newNotifications
      .map(({ kind, category, event_key, recipient_id }) => ({
        kind,
        category,
        event_key,
        recipient_id
      }))
      .sort((left, right) => String(left.recipient_id).localeCompare(String(right.recipient_id)))
  ).toEqual(
    expectedResultRecipients.map((recipient_id) => ({
      kind: recipient_id === f.creator.id ? 'result_added' : 'result_review_needed',
      category: 'results',
      event_key: `result.submitted:${String(facts.proposal_id)}:v1`,
      recipient_id
    }))
  );
  await f.open(page, id);
  await expect(page.getByText(r.pendingDescription, { exact: true })).toBeVisible();
  await info.attach('manual-pending-match-detail', {
    body: await page.screenshot({
      path: info.outputPath('manual-pending-match-detail.png'),
      fullPage: true
    }),
    contentType: 'image/png'
  });
  // No League/standings feature exists: assert schema boundary rather than invent a surface.
  expect(
    await sql(
      `select table_name from information_schema.tables where table_schema='public' and table_name ~ '(standing|league|statistic)'`
    )
  ).toEqual([]);
  await info.attach('observed-proposal-facts', {
    body: JSON.stringify(
      {
        id,
        teams,
        groupTwo,
        proposal: facts,
        officialRowsUnchanged: before.length,
        notificationsUnchanged: true
      },
      null,
      2
    ),
    contentType: 'application/json'
  });
  console.info(
    'PAF-7 observed walkthrough:',
    JSON.stringify({ id, teams, groupTwo, proposal: facts, officialRowsUnchanged: before.length })
  );
});

test('admin recovers submission when creator unavailable', async () => {
  const id = await f.completedEvent();
  const admin = f.members[8]!;
  await sql(
    `update public.community_members set role='admin' where community_id='${f.community}' and user_id='${admin.id}'`
  );
  const page = await f.page(admin);
  await f.open(page, id);
  await page.getByRole('link', { name: r.title, exact: true }).click();
  await waitForHydratedPage(page);
  await correctTeams(page);
  await enterScore(page, [
    [6, 4, true],
    [6, 3, true]
  ]);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.pending, { exact: true })).toBeVisible();
  expect(
    await sql(
      `select submitted_by::text from public.match_event_result_proposals where match_event_id='${id}'`
    )
  ).toEqual([{ submitted_by: admin.id }]);
});

test('invalid score identifies set and team inline', async () => {
  const id = await f.completedEvent();
  const page = await f.page(f.creator);
  await openRecord(page, id);
  await enterScore(page, [[6, 5, true]]);
  await expect(page.getByRole('button', { name: r.submit, exact: true })).toBeDisabled();
  const error = page.locator('#set-error-1');
  await expect(error).toContainText(
    fill(r.invalidCompletedSet, { number: 1, team: r.teams.team_b, score: '6–5' })
  );
  await expect(page.locator('#score-0-team_b')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#score-0-team_b')).toHaveAttribute('aria-describedby', 'set-error-1');
  expect(
    await f.rpc(f.creator, 'get_match_event_result_proposals', { p_match_event_id: id })
  ).toEqual([]);
});

test('friendly preview shows no rating effect', async () => {
  const id = await f.completedEvent('friendly');
  const before = await officialSnapshot(f.community);
  const page = await f.page(f.creator);
  await openRecord(page, id);
  await enterScore(page, [
    [6, 4, true],
    [4, 6, true],
    [7, 5, true]
  ]);
  await expect(page.getByText(r.ratingEffectNone, { exact: true })).toBeVisible();
  await expect(page.getByText(r.ratingEffect, { exact: true })).toHaveCount(0);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.pending, { exact: true })).toBeVisible();
  expect(await officialSnapshot(f.community)).toEqual(before);
});
