import { expect, test } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { repairNow } from './result-amendments-fixtures';
import {
  chronologyFixtures,
  copies,
  correctedSets,
  fill,
  sql
} from './result-amendments-chronology-fixtures';
import {
  assertContrast,
  assertNoOverflow,
  assertStacked,
  assertTargets,
  box,
  measureFrame
} from './result-corrections-visual';

// October result corrected after a later group, a mid-sequence level adjustment and the League close.
// Real authenticated commands throughout; the only trusted SQL anchors times and reads back evidence.
type Fixtures = Awaited<ReturnType<typeof chronologyFixtures>>;
let f: Fixtures;
const c = copies.en.matches.corrections;
const r = copies.en.matches.results;
const history = copies.en.leagues.history;

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  f = await chronologyFixtures(browser);
  await f.closeLeague();
});
test.afterAll(async () => {
  test.setTimeout(240_000);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(240_000));

const counts = (proposalId: string, eventId: string) =>
  sql(`select
    (select count(*)::int from public.statistics_group_facts where game_group_id='${proposalId}') as facts,
    (select count(*)::int from public.match_event_result_confirmations where match_event_id='${eventId}') as confirmations,
    (select count(*)::int from public.notifications where target_id='${eventId}' and kind='result_repair_applied') as notices,
    (select count(*)::int from public.match_event_audit_log where match_event_id='${eventId}' and action='result_repair_applied') as audits,
    (select count(*)::int from public.league_standings_snapshots where league_id='${f.leagueId}') as snapshots`);

test('October correction after the League close replays later groups, preserves the adjustment and versions the final', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const { creator, m0, m1, m2, m3, m4, m5, m6 } = f.players;
  const playerIds = [creator, m0, m1, m2, m3, m4, m5, m6].map((player) => player.id);
  const before = await f.snapshot();
  expect(before.snapshots).toHaveLength(1);
  expect(before.adjustments).toHaveLength(1);
  const baseFacts = await counts(f.october.proposalId, f.october.eventId);

  // Request, corrected proposal and corrected-team review go through the real pages.
  const page = await f.page(creator);
  await f.open(page, f.october.eventId);
  await page.getByRole('button', { name: c.request.open, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: c.request.title, exact: true });
  await dialog.getByRole('textbox').fill('Score recorded backwards');
  await dialog.getByRole('button', { name: c.request.submit, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-amendment-lifecycle=requested]')).toBeVisible();
  await page.getByRole('link', { name: c.submitCandidate, exact: true }).click();
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: r.confirmTeams, exact: true }).click();
  for (const [index, set] of correctedSets.entries()) {
    const row = page.getByRole('group', {
      name: fill(r.setNumber, { number: index + 1 }),
      exact: true
    });
    await row
      .getByRole('textbox', { name: r.teams.team_a, exact: true })
      .fill(String(set.team_a_games));
    await row
      .getByRole('textbox', { name: r.teams.team_b, exact: true })
      .fill(String(set.team_b_games));
    await row.getByRole('textbox', { name: r.teams.team_b, exact: true }).blur();
  }
  // First press reviews the recap, the second submits the corrected proposal.
  await page.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await expect(page.getByRole('heading', { name: r.matchRecap, exact: true })).toBeVisible();
  await page.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await expect(
    page.getByRole('heading', { name: fill(r.correctionSubmitted, { version: 2 }), exact: true })
  ).toBeVisible();
  await f.open(page, f.october.eventId);
  const card = page.locator('[data-amendment-lifecycle=proposal_pending]');
  await expect(card).toContainText('2–6');
  const amendment = (await f.amendments(f.october.eventId))[0]!;
  expect(amendment.base_confirmation_id).toBe(f.october.confirmationId);

  // The corrected team reviews on the real page; approval queues a repair, it does not apply it.
  const reviewer = await f.page(m1);
  await f.open(reviewer, f.october.eventId);
  await reviewer
    .locator('[data-amendment-lifecycle=proposal_pending]')
    .getByRole('button', { name: r.review.approve, exact: true })
    .click();
  const pending = reviewer.locator('[data-amendment-lifecycle=approved_pending_repair]');
  await expect(pending).toHaveAttribute('data-pending-application', 'true');
  await expect(reviewer.locator('[data-repair-status=queued]')).toContainText(
    c.repair.publication.pending
  );
  const queued = (await f.amendments(f.october.eventId))[0]!;
  const jobId = queued.repair_job_id!;
  expect(jobId).toBeTruthy();
  expect((await f.proposals(f.october.eventId))[0]!.confirmation?.confirmation_id).toBe(
    f.october.confirmationId
  );
  expect((await f.snapshot()).snapshots).toHaveLength(1);
  await pending.locator('summary').click();
  await expect(pending).toContainText(
    fill(c.historyRevisionPending, { base: f.october.confirmationId.slice(0, 8), version: 1 })
  );

  // Publication: one committed repair replays the whole later sequence.
  expect(await repairNow(jobId)).toBe('succeeded');
  const after = await f.snapshot();
  const [original, revised] = after.snapshots;
  expect(after.snapshots).toHaveLength(2);
  // The December-style final stays byte-identical evidence; the new version links and names its cause.
  expect(original).toEqual(before.snapshots[0]);
  expect(revised).toMatchObject({
    version: 2,
    cause: 'result_amendment',
    prior: 1,
    job: jobId,
    amendment: amendment.amendment_id
  });
  // The mid-sequence adjustment is byte-identical: time, boundary, revision, reason and target.
  expect(after.adjustments).toEqual(before.adjustments);
  const changed = (rows: typeof before.ratings) =>
    new Map(rows.map((row) => [row['user_id'], row['mu']]));
  const muBefore = changed(before.ratings);
  const muAfter = changed(after.ratings);
  const moved = playerIds.filter((id) => muBefore.get(id) !== muAfter.get(id));
  for (const player of [creator, m0, m1, m2, m3])
    expect(moved, `${player.name} rating changes through replay`).toContain(player.id);
  expect(muAfter.get(m4.id)).toBe(muBefore.get(m4.id));
  console.info(
    'chronology-replay-evidence',
    JSON.stringify({
      event: f.october.eventId,
      priorConfirmation: f.october.confirmationId,
      amendment: amendment.amendment_id,
      job: jobId,
      snapshots: after.snapshots,
      movedRatings: moved.length,
      ratingsBefore: before.ratings,
      ratingsAfter: after.ratings
    })
  );
  await testInfo.attach('chronology-evidence', {
    body: JSON.stringify({ before, after, jobId, moved }, null, 2),
    contentType: 'application/json'
  });

  // Statistics exactly once per group; later groups are untouched by the October correction.
  const october = await counts(f.october.proposalId, f.october.eventId);
  expect(october[0]).toMatchObject({
    facts: 1,
    confirmations: 2,
    notices: 4,
    audits: 1,
    snapshots: 2
  });
  expect(baseFacts[0]).toMatchObject({
    facts: 1,
    confirmations: 1,
    notices: 0,
    audits: 0,
    snapshots: 1
  });
  expect(
    await sql(
      `select classification from public.statistics_group_facts where game_group_id='${f.october.proposalId}'`
    )
  ).toEqual([{ classification: 'team_b' }]);
  for (const later of [f.second, f.third])
    expect((await counts(later.proposalId, later.eventId))[0]).toMatchObject({
      facts: 1,
      confirmations: 1
    });

  // Retry is idempotent: nothing is duplicated.
  const again = await creator.client.rpc('retry_result_repair', { p_job_id: jobId });
  expect(again.error?.message).toBe('RESULT_REPAIR_ALREADY_APPLIED');
  expect(await counts(f.october.proposalId, f.october.eventId)).toEqual(october);

  // Match page: applied state with the audit chain naming both revisions.
  await f.open(page, f.october.eventId);
  const applied = page.locator('[data-amendment-lifecycle=applied]');
  await expect(applied).toHaveAttribute('data-pending-application', 'false');
  await applied.locator('summary').click();
  await expect(applied).toContainText(amendment.amendment_id.slice(0, 8));
  await expect(applied).toContainText(f.october.confirmationId.slice(0, 8));

  // League: the new final names the correction, the superseded final stays inspectable.
  const league = `/community/${f.community}/leagues/${f.leagueId}`;
  const leaguePage = await f.page(creator, 'en', 390, 'light', 844);
  await leaguePage.goto(league);
  await waitForHydratedPage(leaguePage);
  const banner = leaguePage.locator('[data-standings-correction=result_amendment]');
  await expect(banner).toContainText(history.correctionBanner);
  const viewPrior = leaguePage.getByRole('button', {
    name: fill(history.viewPrior, { version: 1 }),
    exact: true
  });
  assertStacked({ banner: await box(banner), prior: await box(viewPrior) });
  await assertTargets(viewPrior.locator('xpath=..'), 'league history prior version');
  await assertNoOverflow(leaguePage, 'league history');
  await assertContrast(leaguePage.locator('main'), 'league history');
  await banner.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await measureFrame('xbIxj', leaguePage, testInfo);
  await page.goto(league);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: fill(history.viewPrior, { version: 1 }) }).click();
  await expect(page.locator('[data-standings-correction]')).toHaveCount(0);
  await page.goto(`${league}?version=1`);
  await waitForHydratedPage(page);
  await expect(page.locator('[data-standings-correction]')).toHaveCount(0);
});
