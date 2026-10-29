import { expect, test, type Page } from '@playwright/test';
import type { ResultProposal } from '../src/features/matches/match-result-model';
import { waitForHydratedPage } from './auth-helpers';
import {
  copies,
  enterScore,
  fill,
  openRecord,
  resultFixtures,
  review,
  sql,
  type Actor
} from './matches-results-fixtures';

type Fixtures = Awaited<ReturnType<typeof resultFixtures>>;
const r = copies.en.matches.results;
let f: Fixtures;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await resultFixtures(browser, { memberCount: 15 });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});

test.beforeEach(() => test.setTimeout(180_000));

async function submitProposal(fixtures: Fixtures, eventId: string, actor: Actor, groupNumber = 1) {
  const page = await fixtures.page(actor);
  await openRecord(page, eventId);
  if (groupNumber > 1)
    await page
      .getByRole('combobox', { name: r.groupLabel, exact: true })
      .selectOption(String(groupNumber));
  await enterScore(page);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.pending, { exact: true })).toBeVisible();
  const proposals = await fixtures.rpc(fixtures.creator, 'get_match_event_result_proposals', {
    p_match_event_id: eventId
  });
  if (!Array.isArray(proposals)) throw new Error('Expected proposal rows after submission');
  expect(
    proposals.find(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        'group_number' in row &&
        row.group_number === groupNumber
    )
  ).toMatchObject({ status: 'pending' });
  return page;
}

async function proposalFor(fixtures: Fixtures, eventId: string, groupNumber = 1) {
  const value = await fixtures.rpc(fixtures.creator, 'get_match_event_result_proposals', {
    p_match_event_id: eventId
  });
  if (!Array.isArray(value)) throw new Error('Expected proposal rows');
  const proposal = value.find(
    (row): row is ResultProposal =>
      typeof row === 'object' &&
      row !== null &&
      'group_number' in row &&
      row.group_number === groupNumber
  );
  if (!proposal) throw new Error(`Missing proposal for group ${groupNumber}`);
  return proposal;
}

async function resultNotificationFor(
  actor: Actor,
  eventId: string,
  kind: string,
  proposalId?: string,
  version?: number
) {
  let query = actor.client
    .from('notifications')
    .select('id,kind,event_key,target_type,target_id,read_at')
    .eq('category', 'results')
    .eq('target_id', eventId)
    .eq('kind', kind)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  if (proposalId && version !== undefined)
    query = query.eq('event_key', `result.submitted:${proposalId}:v${version}`);
  const result = await query.limit(1).maybeSingle();
  if (result.error || !result.data)
    throw result.error ?? new Error(`Missing ${kind} result notification for ${actor.id}`);
  return result.data;
}

function actorFor(userId: string): Actor {
  const actor = [f.creator, ...f.members, f.guest].find((candidate) => candidate.id === userId);
  if (!actor) throw new Error(`No fixture actor for ${userId}`);
  return actor;
}

function teamReviewer(proposal: ResultProposal, submitter: Actor, side: 'team_a' | 'team_b') {
  const player = proposal.teams[side].find((candidate) => candidate.user_id !== submitter.id);
  if (!player) throw new Error(`No eligible player on ${side}`);
  return actorFor(player.user_id);
}

async function reviewFromMatch(
  fixtures: Fixtures,
  eventId: string,
  actor: Actor,
  action: 'approve' | 'reject',
  groupNumber = 1
) {
  const page = await fixtures.page(actor);
  await fixtures.open(page, eventId);
  const card = page.getByRole('article', {
    name: fill(r.group, { number: groupNumber }),
    exact: true
  });
  await expect(card).toBeVisible();
  if (action === 'approve') {
    await card.getByRole('button', { name: r.review.approve, exact: true }).click();
  } else {
    await card.getByRole('button', { name: r.review.reject, exact: true }).click();
  }
  return { page, card };
}

async function rejectWithReason(page: Page, reason = r.reject.reasons.scoreIncorrect) {
  const dialog = page.getByRole('dialog', { name: r.reject.title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(r.reject.autoConfirmNotice, { exact: true })).toBeVisible();
  await dialog.getByRole('radio', { name: reason, exact: true }).check();
  await dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function makeAdmin(fixtures: Fixtures, actor: Actor) {
  await sql(`update public.community_members set role='admin'
    where community_id='${fixtures.community}' and user_id='${actor.id}'`);
}

test('opposing team approval confirms submitted group', async ({ browserName }) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  await submitProposal(f, eventId, f.creator);
  const proposal = await proposalFor(f, eventId);
  const submitterSide = proposal.teams.team_a.some((player) => player.user_id === f.creator.id)
    ? 'team_a'
    : 'team_b';
  const oppositeSide = submitterSide === 'team_a' ? 'team_b' : 'team_a';
  const reviewer = teamReviewer(proposal, f.creator, oppositeSide);
  const { page, card } = await reviewFromMatch(f, eventId, reviewer, 'approve');

  await expect(card).toHaveAttribute('data-result-status', 'confirmed');
  await expect(card.getByText(r.confirmation.manual, { exact: true })).toBeVisible();
  const proposals = await proposalFor(f, eventId);
  expect(proposals.status).toBe('confirmed');
  expect(proposals.received_team_coverage_count).toBe(1);
  expect(
    await sql(`select source from public.match_event_result_confirmations
      where proposal_id='${proposal.proposal_id}'`)
  ).toEqual([{ source: 'MANUAL' }]);
  await expect(page.getByRole('region', { name: r.resolution.title })).toContainText(
    fill(r.resolution.progress, { confirmed: 1, expected: 1 })
  );
});

test('nonplaying admin submitter requires approval from both teams', async ({ browserName }) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  const admin = f.members[9]!;
  await makeAdmin(f, admin);
  await submitProposal(f, eventId, admin);
  const proposal = await proposalFor(f, eventId);
  expect(proposal.teams.team_a.some((player) => player.user_id === admin.id)).toBe(false);
  expect(proposal.teams.team_b.some((player) => player.user_id === admin.id)).toBe(false);
  expect(proposal.required_team_coverage_count).toBe(2);
  expect(proposal.received_team_coverage_count).toBe(0);

  const first = teamReviewer(proposal, admin, 'team_a');
  const firstReview = await reviewFromMatch(f, eventId, first, 'approve');
  await expect(firstReview.card).toHaveAttribute('data-result-status', 'pending');
  await expect(firstReview.card).toContainText(
    fill(r.approvalProgress, { received: 1, required: 2 })
  );
  expect((await proposalFor(f, eventId)).status).toBe('pending');

  const second = teamReviewer(proposal, admin, 'team_b');
  const secondReview = await reviewFromMatch(f, eventId, second, 'approve');
  await expect(secondReview.card).toHaveAttribute('data-result-status', 'confirmed');
  const confirmed = await proposalFor(f, eventId);
  expect(confirmed.status).toBe('confirmed');
  expect(confirmed.received_team_coverage_count).toBe(2);
  expect(
    await sql(`select count(*)::int as count from public.match_event_result_reviews
      where proposal_id='${proposal.proposal_id}' and decision='approve'`)
  ).toEqual([{ count: 2 }]);
});

test('rejection reason dialog disputes result and stops auto-confirmation', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  await submitProposal(f, eventId, f.creator);
  const proposal = await proposalFor(f, eventId);
  const submitterSide = proposal.teams.team_a.some((player) => player.user_id === f.creator.id)
    ? 'team_a'
    : 'team_b';
  const opponentSide = submitterSide === 'team_a' ? 'team_b' : 'team_a';
  const reviewer = teamReviewer(proposal, f.creator, opponentSide);
  expect(reviewer.id).not.toBe(f.creator.id);
  const { page, card } = await reviewFromMatch(f, eventId, reviewer, 'reject');
  const dialog = page.getByRole('dialog', { name: r.reject.title, exact: true });
  await dialog.getByRole('radio', { name: r.reject.reasons.scoreIncorrect, exact: true }).check();
  await dialog.getByLabel(r.reject.noteLabel).fill('Third-set score needs correction.');
  await dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();

  await expect(card).toHaveAttribute('data-result-status', 'disputed');
  await expect(card.getByText(r.disputedImpact, { exact: true })).toBeVisible();
  await expect(card).toContainText('Third-set score needs correction.');
  expect(
    await sql(`select p.status, c.id as confirmation_id, r.reason_code, r.reason_note
      from public.match_event_result_proposals p
      left join public.match_event_result_confirmations c on c.proposal_id=p.id
      left join public.match_event_result_reviews r on r.proposal_id=p.id and r.decision='reject'
      where p.id='${proposal.proposal_id}'`)
  ).toEqual([
    {
      status: 'disputed',
      confirmation_id: null,
      reason_code: 'SCORE_INCORRECT',
      reason_note: 'Third-set score needs correction.'
    }
  ]);
  expect((await proposalFor(f, eventId)).can_correct).toBe(true);
});

test('correction creates v2 without carrying v1 approvals and starts fresh deadline', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  await submitProposal(f, eventId, f.creator);
  const versionOne = await proposalFor(f, eventId);
  const submitterSide = versionOne.teams.team_a.some((player) => player.user_id === f.creator.id)
    ? 'team_a'
    : 'team_b';
  const opponentSide = submitterSide === 'team_a' ? 'team_b' : 'team_a';
  const reviewer = teamReviewer(versionOne, f.creator, opponentSide);
  const { page: reviewerPage } = await reviewFromMatch(f, eventId, reviewer, 'reject');
  await rejectWithReason(reviewerPage);

  const correctionPage = await f.page(f.creator);
  await f.open(correctionPage, eventId);
  const disputed = correctionPage.locator('article[data-result-status="disputed"]');
  await disputed.getByRole('link', { name: r.correctResult, exact: true }).click();
  await waitForHydratedPage(correctionPage);
  await correctionPage.getByRole('button', { name: r.confirmTeams, exact: true }).click();
  for (const [index, [a, b]] of [
    [6, 4],
    [4, 6],
    [3, 2]
  ].entries()) {
    await correctionPage.locator(`#score-${index}-team_a`).fill(String(a));
    await correctionPage.locator(`#score-${index}-team_b`).fill(String(b));
    await correctionPage.locator(`#score-${index}-team_b`).blur();
  }
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await expect(correctionPage.locator('article[data-result-status="pending"]')).toBeVisible();

  const versionTwo = await proposalFor(f, eventId);
  expect(versionTwo.version).toBe(2);
  expect(versionTwo.status).toBe('pending');
  expect(versionTwo.received_team_coverage_count).toBe(0);
  expect(Date.parse(versionTwo.review_deadline_at) - Date.parse(versionTwo.submitted_at)).toBe(
    48 * 60 * 60 * 1000
  );
  expect(
    await sql(`select v.version::int as version, count(r.*)::int as approvals
      from public.match_event_result_proposal_versions v
      left join public.match_event_result_reviews r
        on r.proposal_id=v.proposal_id and r.proposal_version=v.version and r.decision='approve'
      where v.proposal_id='${versionOne.proposal_id}' group by v.version order by v.version`)
  ).toEqual([
    { version: 1, approvals: 0 },
    { version: 2, approvals: 0 }
  ]);
  const active = correctionPage.locator('article[data-result-status="pending"]');
  const timer = active.getByRole('timer');
  await expect(timer).toBeVisible();
  await expect(timer).toHaveAccessibleName(fill(r.autoConfirmIn, { hours: 48 }));
  await expect(active).toContainText(fill(r.versionLabel, { version: 2 }));
});

test('late review returns deadline conflict without review write and refreshes authoritative state', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  await submitProposal(f, eventId, f.creator);
  const proposal = await proposalFor(f, eventId);
  const submitterSide = proposal.teams.team_a.some((player) => player.user_id === f.creator.id)
    ? 'team_a'
    : 'team_b';
  const opponentSide = submitterSide === 'team_a' ? 'team_b' : 'team_a';
  const reviewer = teamReviewer(proposal, f.creator, opponentSide);
  const page = await f.page(reviewer);
  await f.open(page, eventId);
  const card = page.locator('article[data-result-status]').first();
  expect((await proposalFor(f, eventId)).status).toBe('pending');
  expect(reviewer.id).not.toBe(f.creator.id);
  const approve = card.getByRole('button', { name: r.review.approve, exact: true });
  await expect(approve).toBeVisible();
  await f.expireProposal(proposal.proposal_id);

  await expect(approve).toBeVisible();
  await approve.click();
  await expect(card).toHaveAttribute('data-result-status', 'confirmed');
  await expect(card.getByText(r.conflicts.deadlineElapsed, { exact: true })).toBeVisible();
  const result = await sql(`select p.status, c.source, count(r.*)::int as review_count
    from public.match_event_result_proposals p
    join public.match_event_result_confirmations c on c.proposal_id=p.id
    left join public.match_event_result_reviews r on r.proposal_id=p.id
    where p.id='${proposal.proposal_id}' group by p.status,c.source`);
  expect(result).toEqual([{ status: 'confirmed', source: 'AUTO_48H', review_count: 0 }]);
  expect(
    await sql(`select result->>'conflict' as conflict
      from public.match_event_management_commands
      where match_event_id='${eventId}' and actor_id='${reviewer.id}' and action='review_result'`)
  ).toEqual([{ conflict: 'deadline_elapsed' }]);
  await expect(page.getByRole('region', { name: r.resolution.title })).toContainText(
    fill(r.resolution.progress, { confirmed: 1, expected: 1 })
  );
});

test('multi-group detail keeps confirmed, pending, disputed and unsubmitted groups independent', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 16);

  await submitProposal(f, eventId, f.creator, 1);
  const confirmedProposal = await proposalFor(f, eventId, 1);
  const submitterSide = confirmedProposal.teams.team_a.some(
    (player) => player.user_id === f.creator.id
  )
    ? 'team_a'
    : 'team_b';
  const opponentSide = submitterSide === 'team_a' ? 'team_b' : 'team_a';
  const approvingActor = teamReviewer(confirmedProposal, f.creator, opponentSide);
  const { card: confirmedCard } = await reviewFromMatch(f, eventId, approvingActor, 'approve');
  await expect(confirmedCard).toHaveAttribute('data-result-status', 'confirmed');

  await submitProposal(f, eventId, f.creator, 2);
  await submitProposal(f, eventId, f.creator, 3);
  const disputedProposal = await proposalFor(f, eventId, 3);
  const rejector = teamReviewer(
    disputedProposal,
    f.creator,
    disputedProposal.teams.team_a.some((player) => player.user_id === f.creator.id)
      ? 'team_b'
      : 'team_a'
  );
  const { page: rejectPage } = await reviewFromMatch(f, eventId, rejector, 'reject', 3);
  await rejectWithReason(rejectPage);

  const detail = await f.page(f.creator);
  await f.open(detail, eventId);
  const summary = detail.getByRole('region', { name: r.resolution.title });
  await expect(summary).toContainText(r.resolution.partiallyResolved);
  await expect(summary).toContainText(fill(r.resolution.progress, { confirmed: 1, expected: 4 }));
  await expect(detail.locator('article[data-result-status="confirmed"]')).toHaveCount(1);
  await expect(detail.locator('article[data-result-status="pending"]')).toHaveCount(1);
  await expect(detail.locator('article[data-result-status="disputed"]')).toHaveCount(1);
  const missing = detail.locator('article').filter({
    has: detail.getByRole('heading', { name: fill(r.group, { number: 4 }), exact: true })
  });
  await expect(missing).toContainText(r.awaitingResult);
  await expect(missing.getByRole('link', { name: r.title, exact: true })).toBeVisible();
  expect(
    await sql(`select group_number::int as group_number,status from public.match_event_result_proposals
      where match_event_id='${eventId}' order by group_number`)
  ).toEqual([
    { group_number: 1, status: 'confirmed' },
    { group_number: 2, status: 'pending' },
    { group_number: 3, status: 'disputed' }
  ]);

  const disputeNotice = await resultNotificationFor(rejector, eventId, 'result_disputed');
  expect(disputeNotice.target_type).toBe('result_available');
  expect(disputeNotice.event_key).toBe(`result.disputed:${disputedProposal.proposal_id}:v1`);
  const notificationPage = await f.page(rejector, 'es', 1280, 'dark', 800);
  await notificationPage.goto('/notifications');
  await waitForHydratedPage(notificationPage);
  const disputedHref = `/matches/${eventId}?result_group=3&result_proposal=${disputedProposal.proposal_id}&result_version=1#result-group-3`;
  const resultNotice = notificationPage
    .locator('main li')
    .filter({
      has: notificationPage.locator(`a[href="${disputedHref}"]`)
    })
    .filter({
      has: notificationPage.getByRole('heading', {
        name: copies.es.notifications.kinds.result_disputed,
        exact: true
      })
    });
  await expect(resultNotice).toHaveCount(1);
  await expect(resultNotice).toContainText(
    fill(copies.es.notifications.result.group, { number: 3 })
  );
  await resultNotice
    .getByRole('link', { name: copies.es.notifications.result.openResult, exact: true })
    .click();
  await expect(notificationPage).toHaveURL(
    new RegExp(`/matches/${eventId}\\?result_group=3&result_proposal=`)
  );
  await expect(notificationPage).toHaveURL(/result_version=1#result-group-3$/);
  const linkedSummary = notificationPage.getByRole('region', {
    name: copies.es.matches.results.resolution.title,
    exact: true
  });
  await expect(linkedSummary).toContainText(copies.es.matches.results.resolution.partiallyResolved);
  await expect(notificationPage.locator('article[data-result-status="confirmed"]')).toHaveCount(1);
  await expect(notificationPage.locator('article[data-result-status="pending"]')).toHaveCount(1);
  await expect(notificationPage.locator('article[data-result-status="disputed"]')).toHaveCount(1);
  await expect(notificationPage.locator('#result-group-4')).toContainText(
    copies.es.matches.results.awaitingResult
  );
  await notificationPage.context().close();
});

test('result alerts lead through review, correction, fresh deadline and scheduled confirmation', async () => {
  test.setTimeout(240_000);
  const eventId = await f.completedEvent('competitive', 4);
  const nonplayingAdmin = f.members[9]!;
  await makeAdmin(f, nonplayingAdmin);
  const submitPage = await submitProposal(f, eventId, nonplayingAdmin);
  await submitPage.context().close();

  const versionOne = await proposalFor(f, eventId);
  const reviewerA = teamReviewer(versionOne, nonplayingAdmin, 'team_a');
  const reviewerB = teamReviewer(versionOne, nonplayingAdmin, 'team_b');
  const initialNotice = await resultNotificationFor(
    reviewerA,
    eventId,
    'result_review_needed',
    versionOne.proposal_id,
    1
  );
  expect(initialNotice).toMatchObject({
    target_type: 'result_available',
    target_id: eventId,
    event_key: `result.submitted:${versionOne.proposal_id}:v1`
  });

  const pt = copies['pt-BR'];
  const reviewerPage = await f.page(reviewerA, 'pt-BR', 320, 'light');
  await reviewerPage.goto('/notifications');
  await waitForHydratedPage(reviewerPage);
  const activeV1Href = `/matches/${eventId}?result_group=1&result_proposal=${versionOne.proposal_id}&result_version=1#result-group-1`;
  const reviewerNotice = reviewerPage.locator('main li').filter({
    has: reviewerPage.locator(`a[href="${activeV1Href}"]`)
  });
  await expect(reviewerNotice).toHaveCount(1);
  await expect(reviewerNotice).toContainText(fill(pt.notifications.result.group, { number: 1 }));
  await reviewerNotice
    .getByRole('link', { name: pt.notifications.result.openResult, exact: true })
    .click();
  await expect(reviewerPage).toHaveURL(
    new RegExp(`/matches/${eventId}\\?result_group=1&result_proposal=${versionOne.proposal_id}`)
  );
  await expect(reviewerPage).toHaveURL(/result_version=1#result-group-1$/);
  await waitForHydratedPage(reviewerPage);
  const firstCard = reviewerPage.locator('article[data-result-status="pending"]');
  await expect(
    firstCard.getByRole('button', { name: pt.matches.results.review.approve })
  ).toBeVisible();
  await firstCard.getByRole('button', { name: pt.matches.results.review.approve }).click();
  await expect(firstCard).toHaveAttribute('data-result-status', 'pending');
  await expect(firstCard).toContainText(
    fill(pt.matches.results.approvalProgress, { received: 1, required: 2 })
  );
  await reviewerPage.context().close();
  expect((await proposalFor(f, eventId)).received_team_coverage_count).toBe(1);

  const rejectionPage = await f.page(reviewerB, 'en', 390, 'dark');
  await rejectionPage.goto('/notifications');
  await waitForHydratedPage(rejectionPage);
  const secondNotice = rejectionPage.locator('main li').filter({
    has: rejectionPage.locator(`a[href="${activeV1Href}"]`)
  });
  await expect(secondNotice).toHaveCount(1);
  await secondNotice
    .getByRole('link', { name: copies.en.notifications.result.openResult, exact: true })
    .click();
  await expect(rejectionPage).toHaveURL(/result_version=1#result-group-1$/);
  await waitForHydratedPage(rejectionPage);
  const rejectionCard = rejectionPage.locator('article[data-result-status="pending"]');
  await rejectionCard.getByRole('button', { name: r.review.reject, exact: true }).click();
  await rejectWithReason(rejectionPage);
  await expect(rejectionPage.locator('article[data-result-status="disputed"]')).toBeVisible();
  await rejectionPage.context().close();

  const disputedNotice = await resultNotificationFor(reviewerB, eventId, 'result_disputed');
  expect(disputedNotice.event_key).toBe(`result.disputed:${versionOne.proposal_id}:v1`);
  const disputedAlerts = await sql(`select recipient_user_id::text as recipient_id,kind
    from public.notifications where category='results' and target_id='${eventId}'
      and event_key='result.disputed:${versionOne.proposal_id}:v1'`);
  const expectedDisputeRecipients = [
    ...new Set([
      ...versionOne.teams.team_a.map((player) => player.user_id),
      ...versionOne.teams.team_b.map((player) => player.user_id),
      f.creator.id
    ])
  ].sort();
  expect(disputedAlerts).toHaveLength(expectedDisputeRecipients.length);
  expect(disputedAlerts.map((row) => String(row['recipient_id'])).sort()).toEqual(
    expectedDisputeRecipients
  );
  expect(disputedAlerts.every((row) => row['kind'] === 'result_disputed')).toBe(true);

  const correctionPage = await f.page(nonplayingAdmin);
  await f.open(correctionPage, eventId);
  const disputedCard = correctionPage.locator('article[data-result-status="disputed"]');
  await disputedCard.getByRole('link', { name: r.correctResult, exact: true }).click();
  await waitForHydratedPage(correctionPage);
  await correctionPage.getByRole('button', { name: r.confirmTeams, exact: true }).click();
  for (const [index, [teamA, teamB]] of [
    [6, 4],
    [4, 6],
    [3, 2]
  ].entries()) {
    await correctionPage.locator(`#score-${index}-team_a`).fill(String(teamA));
    await correctionPage.locator(`#score-${index}-team_b`).fill(String(teamB));
    await correctionPage.locator(`#score-${index}-team_b`).blur();
  }
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await expect(correctionPage.locator('article[data-result-status="pending"]')).toBeVisible();
  await correctionPage.context().close();

  const versionTwo = await proposalFor(f, eventId);
  expect(versionTwo.proposal_id).toBe(versionOne.proposal_id);
  expect(versionTwo.version).toBe(2);
  expect(versionTwo.status).toBe('pending');
  expect(versionTwo.received_team_coverage_count).toBe(0);
  expect(Date.parse(versionTwo.review_deadline_at) - Date.parse(versionTwo.submitted_at)).toBe(
    48 * 60 * 60 * 1000
  );
  const correctedNotice = await resultNotificationFor(
    reviewerA,
    eventId,
    'result_review_needed',
    versionOne.proposal_id,
    2
  );
  expect(correctedNotice.event_key).toBe(`result.submitted:${versionOne.proposal_id}:v2`);

  const usedReviewerIds = new Set([reviewerA.id, reviewerB.id]);
  const staleWitnessId = [...versionOne.teams.team_a, ...versionOne.teams.team_b].find(
    (player) => !usedReviewerIds.has(player.user_id)
  )?.user_id;
  if (!staleWitnessId) throw new Error('No result notification witness actor');
  const staleWitness = actorFor(staleWitnessId);
  const staleNotice = await resultNotificationFor(
    staleWitness,
    eventId,
    'result_review_needed',
    versionOne.proposal_id,
    1
  );
  const spanish = copies.es;
  const stalePage = await f.page(staleWitness, 'es', 1280, 'dark', 800);
  await stalePage.goto('/notifications');
  await waitForHydratedPage(stalePage);
  const staleCard = stalePage.locator('main li').filter({
    has: stalePage.getByRole('heading', {
      name: spanish.notifications.kinds.result_review_needed,
      exact: true
    }),
    hasText: fill(spanish.notifications.result.historicalVersion, { version: 1 })
  });
  await expect(staleCard).toHaveCount(1);
  const staleLink = staleCard.getByRole('link', {
    name: spanish.notifications.result.reviewCurrent,
    exact: true
  });
  await expect(staleLink).toHaveAttribute(
    'href',
    `/matches/${eventId}?result_group=1&result_proposal=${versionOne.proposal_id}&result_version=1#result-group-1`
  );
  const staleRead = await staleWitness.client
    .from('notifications')
    .select('read_at')
    .eq('id', staleNotice.id)
    .single();
  expect(staleRead.data?.read_at).toBeNull();
  await staleCard
    .getByRole('button', { name: spanish.notifications.markRead, exact: true })
    .click();
  await expect
    .poll(async () => {
      const row = await staleWitness.client
        .from('notifications')
        .select('read_at')
        .eq('id', staleNotice.id)
        .single();
      return row.data?.read_at;
    })
    .toBeTruthy();
  await expect(staleLink).toBeVisible();
  await staleLink.click();
  await expect(stalePage).toHaveURL(/result_version=1#result-group-1$/);
  await waitForHydratedPage(stalePage);
  const currentCard = stalePage.locator('article[data-result-status="pending"]');
  await expect(currentCard).toContainText(
    fill(spanish.matches.results.versionLabel, { version: 2 })
  );
  await currentCard.getByText(spanish.matches.results.timelineTitle, { exact: true }).click();
  await expect(currentCard).toContainText(
    fill(spanish.matches.results.versionLabel, { version: 1 })
  );
  await stalePage.context().close();

  await f.expireProposal(versionOne.proposal_id);
  await sql('select public.process_due_match_event_results(25) as scheduler_run');
  const confirmationRows = await sql(`select p.status, p.review_deadline_at::text as deadline,
      c.id::text as confirmation_id, c.source, c.effective_at::text as effective_at
    from public.match_event_result_proposals p
    join public.match_event_result_confirmations c on c.proposal_id=p.id
    where p.id='${versionOne.proposal_id}' and p.active_version=2`);
  expect(confirmationRows).toHaveLength(1);
  expect(confirmationRows[0]).toMatchObject({ status: 'confirmed', source: 'AUTO_48H' });
  expect(Date.parse(String(confirmationRows[0]?.['effective_at']))).toBe(
    Date.parse(String(confirmationRows[0]?.['deadline']))
  );
  const confirmationId = String(confirmationRows[0]?.['confirmation_id']);
  const confirmedNotifications = await sql(`select n.recipient_user_id::text as recipient_id,
      n.kind, n.event_key from public.notifications n
    where n.category='results' and n.target_id='${eventId}'
      and n.event_key='result.confirmed:${confirmationId}'`);
  const expectedRecipients = [
    ...new Set([
      ...versionTwo.teams.team_a.map((player) => player.user_id),
      ...versionTwo.teams.team_b.map((player) => player.user_id),
      f.creator.id
    ])
  ].sort();
  expect(confirmedNotifications).toHaveLength(expectedRecipients.length);
  expect(confirmedNotifications.map((row) => String(row['recipient_id'])).sort()).toEqual(
    expectedRecipients
  );
  expect(confirmedNotifications.every((row) => row['kind'] === 'result_confirmed')).toBe(true);
  expect(
    confirmedNotifications.every((row) => row['event_key'] === `result.confirmed:${confirmationId}`)
  ).toBe(true);

  const confirmedPage = await f.page(reviewerA, 'pt-BR', 390, 'light');
  await confirmedPage.goto('/notifications');
  await waitForHydratedPage(confirmedPage);
  const activeV2Href = `/matches/${eventId}?result_group=1&result_proposal=${versionOne.proposal_id}&result_version=2#result-group-1`;
  const confirmedNotice = confirmedPage
    .locator('main li')
    .filter({
      has: confirmedPage.locator(`a[href="${activeV2Href}"]`)
    })
    .filter({
      has: confirmedPage.getByRole('heading', {
        name: pt.notifications.kinds.result_confirmed,
        exact: true
      })
    });
  await expect(confirmedNotice).toHaveCount(1);
  await confirmedNotice
    .getByRole('link', { name: pt.notifications.result.openResult, exact: true })
    .click();
  const confirmedCard = confirmedPage.locator('article[data-result-status="confirmed"]');
  await expect(confirmedCard).toContainText(pt.matches.results.confirmation.auto);
  await expect(confirmedPage).toHaveURL(/result_version=2#result-group-1$/);
  await confirmedPage.context().close();
});
