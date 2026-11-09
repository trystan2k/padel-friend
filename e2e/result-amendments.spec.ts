import { expect, test } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { acquireRatingSuite, releaseRatingSuite } from './rating-suite-lock';
import { sql } from './matches-management-fixtures';
import { amendmentFixtures, copies, repairNow } from './result-amendments-fixtures';

type Fixtures = Awaited<ReturnType<typeof amendmentFixtures>>;
let f: Fixtures;
const c = copies.en.matches.corrections;
const r = copies.en.matches.results;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_500_000);
  await acquireRatingSuite();
  f = await amendmentFixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await f?.cleanup();
});
// Declared after the cleanup hook so the suite lock is released last.
test.afterAll(releaseRatingSuite);
test.beforeEach(() => test.setTimeout(180_000));

test('participant requests correction with keyboard, validates reason, reviews candidate and sees pending publication', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const group = await f.confirmed();
  const page = await f.page(f.creator);
  await f.open(page, group.eventId);
  const trigger = page.getByRole('button', { name: c.request.open, exact: true });
  const target = await trigger.boundingBox();
  expect(target?.height).toBeGreaterThanOrEqual(44);
  expect(target?.width).toBeGreaterThanOrEqual(44);
  await testInfo.attach('amendment-request-mobile-light', {
    body: await page.screenshot({
      path: testInfo.outputPath('correction-surface.png'),
      fullPage: true
    }),
    contentType: 'image/png'
  });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: c.request.title, exact: true });
  const reason = dialog.getByRole('textbox');
  await expect(reason).toBeFocused();
  await dialog.getByRole('button', { name: c.request.submit, exact: true }).click();
  await expect(reason).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('alert')).toHaveText(c.dialog.text.required);
  const errorId = await reason.getAttribute('aria-describedby');
  expect(errorId).toBeTruthy();
  await expect(page.locator(`[id="${errorId}"]`)).toHaveText(c.dialog.text.required);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.press('Enter');
  await reason.fill('Score recorded backwards');
  await dialog.getByRole('button', { name: c.request.submit, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('[data-amendment-lifecycle=requested]')).toBeVisible();
  const amendment = (await f.amendments(group.eventId))[0]!;
  await f.candidate(group, amendment.amendment_id);
  const reviewer = await f.page(f.members[1]!);
  await f.open(reviewer, group.eventId);
  const card = reviewer.locator('[data-amendment-lifecycle=proposal_pending]');
  await expect(card).toContainText('2–6');
  await testInfo.attach('corrected-team-review-mobile-light', {
    body: await reviewer.screenshot({
      path: testInfo.outputPath('corrected-team-review.png'),
      fullPage: true
    }),
    contentType: 'image/png'
  });
  await card.getByRole('button', { name: r.review.approve, exact: true }).click();
  await expect(
    reviewer.locator('[data-amendment-lifecycle=approved_pending_repair]')
  ).toHaveAttribute('data-pending-application', 'true');
  await expect(reviewer.locator('[data-repair-status=queued]')).toContainText(
    c.repair.publication.pending
  );
  // Prior official fact stays current until a committed worker publication.
  expect((await f.proposal(group.eventId)).confirmation?.confirmation_id).toBe(group.baseId);
  await reviewer.reload();
  await waitForHydratedPage(reviewer);
  await expect(reviewer.locator('[data-repair-publication=pending]')).toBeVisible();
});

test('unrelated player has no request entry and cannot issue request or admin decision directly', async () => {
  const group = await f.confirmed();
  const page = await f.page(f.members[6]!);
  await f.open(page, group.eventId);
  await expect(page.getByRole('button', { name: c.request.open, exact: true })).toHaveCount(0);
  const denied = await f.members[6]!.client.rpc('request_result_amendment', {
    p_proposal_id: group.original.proposal_id,
    p_expected_confirmation_id: group.baseId,
    p_reason: 'Not entitled',
    p_command_id: crypto.randomUUID()
  });
  expect(denied.error).not.toBeNull();
  const amendmentId = await f.requested(group);
  const version = await f.candidate(group, amendmentId);
  const decision = await f.members[1]!.client.rpc('resolve_result_dispute', {
    p_proposal_id: group.original.proposal_id,
    p_expected_base_confirmation_id: group.baseId,
    p_expected_candidate_version: version,
    p_decision: 'void',
    p_justification: 'Not an admin',
    p_command_id: crypto.randomUUID()
  });
  expect(decision.error).not.toBeNull();
  expect((await f.proposal(group.eventId)).confirmation?.confirmation_id).toBe(group.baseId);
});

test('stale candidate approval reports conflict and refreshes to current candidate', async () => {
  const group = await f.confirmed();
  const amendmentId = await f.requested(group);
  const version = await f.candidate(group, amendmentId);
  const page = await f.page(f.members[1]!);
  await f.open(page, group.eventId);
  await expect(page.locator('[data-amendment-lifecycle=proposal_pending]')).toBeVisible();
  await f.candidate(group, amendmentId, version);
  await page
    .locator('[data-amendment-lifecycle=proposal_pending]')
    .getByRole('button', { name: r.review.approve, exact: true })
    .click();
  await expect(page.getByText(c.conflicts.candidateVersionConflict, { exact: true })).toBeVisible();
  const latest = (await f.amendments(group.eventId))[0]!;
  expect(latest.candidate?.version).toBe(version + 1);
  expect(latest.pending_application).toBe(false);
});

const ratingEvents = (eventId: string) =>
  sql(
    `select count(*)::int as n from public.player_rating_events where match_event_id='${eventId}'`
  );

test('Friendly correction publishes with no rating events and the Incomplete original gains them once corrected', async () => {
  const friendly = await f.confirmed('friendly');
  const friendlyJob = await f.accepted(friendly);
  expect(await repairNow(friendlyJob.jobId)).toBe('succeeded');
  expect(await ratingEvents(friendly.eventId)).toEqual([{ n: 0 }]);
  expect((await f.proposal(friendly.eventId)).classification).toBe('team_b');

  const incomplete = await f.confirmed('competitive', true);
  expect(await ratingEvents(incomplete.eventId)).toEqual([{ n: 0 }]);
  const incompleteJob = await f.accepted(incomplete);
  expect(await repairNow(incompleteJob.jobId)).toBe('succeeded');
  expect(await ratingEvents(incomplete.eventId)).toEqual([{ n: 4 }]);
  expect((await f.proposal(incomplete.eventId)).classification).toBe('team_b');
});

for (const decision of ['replace', 'void'] as const) {
  test(`admin explicitly resolves disputed correction: ${decision}`, async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    await f.grantAdmin();
    const group = await f.confirmed();
    const amendmentId = await f.requested(group);
    const version = await f.candidate(group, amendmentId);
    await f.rpc(f.members[1]!, 'review_result_amendment', {
      p_amendment_id: amendmentId,
      p_expected_base_confirmation_id: group.baseId,
      p_expected_candidate_version: version,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_command_id: crypto.randomUUID()
    });
    const page = await f.page(f.creator, 'en', 390, 'dark');
    await f.open(page, group.eventId);
    const card = page.locator('[data-amendment-lifecycle=disputed]');
    await card.getByRole('button', { name: c.resolve.open, exact: true }).click();
    const dialog = page.getByRole('dialog', { name: c.resolve.title, exact: true });
    await dialog.getByRole('radio', { name: c.resolve.options[decision], exact: false }).check();
    await dialog.getByRole('textbox').fill('Reviewed original score sheet with both teams');
    await testInfo.attach(`dispute-${decision}-mobile-dark`, {
      body: await page.screenshot({
        path: testInfo.outputPath('correction-surface.png'),
        fullPage: true
      }),
      contentType: 'image/png'
    });
    await dialog.getByRole('button', { name: c.resolve.submit, exact: true }).click();
    await expect(dialog).toBeHidden();
    const pending = page.locator('[data-amendment-lifecycle=approved_pending_repair]');
    await expect(pending).toContainText(c.adminOverride);
    const amendment = (await f.amendments(group.eventId))[0]!;
    expect(amendment.resolution?.decision).toBe(decision);
    expect(amendment.pending_application).toBe(true);
    if (!amendment.repair_job_id) throw new Error('No queued repair');
    const claim = await f.claimRepair(amendment.repair_job_id);
    if (claim.status === 'claimed') {
      const [result] = await sql(
        `select public.execute_result_repair('${amendment.repair_job_id}','${claim.token}')->>'outcome' as outcome`
      );
      expect(result?.['outcome']).toBe('succeeded');
    } else expect(claim.status).toBe('succeeded');
    await page.reload();
    await waitForHydratedPage(page);
    await expect(page.locator('[data-amendment-lifecycle=applied]')).toHaveAttribute(
      'data-pending-application',
      'false'
    );
    const official = await f.rpc(f.creator, 'get_match_event_official_results', {
      p_match_event_id: group.eventId
    });
    expect(Array.isArray(official) ? official.length : -1).toBe(decision === 'void' ? 0 : 1);
  });
}

for (const locale of ['en', 'pt-BR', 'es'] as const) {
  test(`correction surfaces preserve server locale through hydration: ${locale}`, async () => {
    const group = await f.confirmed('friendly', true);
    const page = await f.page(f.creator, locale, 390, 'dark');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error' && /hydrat/i.test(message.text())) errors.push(message.text());
    });
    const serverResponse = await page.request.get(`/matches/${group.eventId}`);
    const serverHtml = await serverResponse.text();
    expect(serverHtml).toContain(`lang="${locale}"`);
    expect(serverHtml).toContain(copies[locale].matches.corrections.title);
    await f.open(page, group.eventId);
    const copy = copies[locale].matches.corrections;
    await expect(page.getByRole('heading', { name: copy.title, exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.getByRole('button', { name: copy.request.open, exact: true }).click();
    await expect(page.getByRole('dialog', { name: copy.request.title, exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}
