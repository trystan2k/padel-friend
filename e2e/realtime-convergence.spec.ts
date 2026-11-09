import { expect, test, type Page } from '@playwright/test';
import type { ResultProposal } from '../src/features/matches/match-result-model';
import {
  copies,
  enterScore,
  fill,
  openRecord,
  resultFixtures,
  review,
  type Actor
} from './matches-results-fixtures';

// PAF-167: two separately authenticated BrowserContexts stay mounted and visible; one acts, the
// other must converge through the shared authoritative refresh with no manual reload. Every wait
// is a UI condition bounded by the engineering convergence budget (3 s cadence + read latency).

type Fixtures = Awaited<ReturnType<typeof resultFixtures>>;
const CONVERGENCE_BUDGET_MS = 5_000;
const m = copies.en.matches;
const r = m.results;
let f: Fixtures;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await resultFixtures(browser, { memberCount: 12 });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});

test.beforeEach(() => test.setTimeout(180_000));

function actorFor(userId: string): Actor {
  const actor = [f.creator, ...f.members].find((candidate) => candidate.id === userId);
  if (!actor) throw new Error(`No fixture actor for ${userId}`);
  return actor;
}

async function proposalFor(eventId: string) {
  const value = await f.rpc(f.creator, 'get_match_event_result_proposals', {
    p_match_event_id: eventId
  });
  if (!Array.isArray(value)) throw new Error('Expected proposal rows');
  const proposal = value.find(
    (row): row is ResultProposal =>
      typeof row === 'object' && row !== null && 'group_number' in row && row.group_number === 1
  );
  if (!proposal) throw new Error('Missing proposal for group 1');
  return proposal;
}

function groupCard(page: Page) {
  return page.getByRole('article', { name: fill(r.group, { number: 1 }), exact: true });
}

async function submitAsCreator(eventId: string) {
  const page = await f.page(f.creator);
  await openRecord(page, eventId);
  await enterScore(page);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.pending, { exact: true })).toBeVisible();
  await f.open(page, eventId);
  return page;
}

function opposingReviewers(proposal: ResultProposal) {
  const side = proposal.teams.team_a.some((player) => player.user_id === f.creator.id)
    ? 'team_b'
    : 'team_a';
  return proposal.teams[side].map((player) => actorFor(player.user_id));
}

test('a join in one client reaches the organizer view without a reload', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.event(4);
  const organizer = await f.page(f.creator);
  await f.open(organizer, eventId);
  await expect(organizer.getByText(`4 · ${m.detail.accepted}`)).toBeVisible();

  const joiner = await f.page(f.members[8]!);
  await f.open(joiner, eventId);
  await joiner.getByRole('button', { name: copies.en.matchRegistration.join.button }).click();
  await expect(joiner.getByText(copies.en.matchRegistration.feedback.accepted)).toBeVisible();

  await expect(organizer.getByText(`5 · ${m.detail.accepted}`)).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS
  });
});

test('a proposal and its confirmation converge to every mounted client', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  const watcher = await f.page(f.members[0]!);
  await f.open(watcher, eventId);

  const submitter = await submitAsCreator(eventId);
  await expect(groupCard(watcher)).toHaveAttribute('data-result-status', 'pending', {
    timeout: CONVERGENCE_BUDGET_MS
  });

  const proposal = await proposalFor(eventId);
  const reviewer = await f.page(opposingReviewers(proposal)[0]!);
  await f.open(reviewer, eventId);
  await groupCard(reviewer).getByRole('button', { name: r.review.approve, exact: true }).click();

  await expect(groupCard(submitter)).toHaveAttribute('data-result-status', 'confirmed', {
    timeout: CONVERGENCE_BUDGET_MS
  });
  await expect(groupCard(watcher)).toHaveAttribute('data-result-status', 'confirmed', {
    timeout: CONVERGENCE_BUDGET_MS
  });
  expect((await proposalFor(eventId)).status).toBe('confirmed');
});

test('a stale approval after another reviewer rejected converges to the current proposal', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const eventId = await f.completedEvent('competitive', 4);
  await submitAsCreator(eventId);
  const proposal = await proposalFor(eventId);
  const [rejecting, stale] = opposingReviewers(proposal);

  const rejectingPage = await f.page(rejecting!);
  const stalePage = await f.page(stale!);
  await f.open(rejectingPage, eventId);
  await f.open(stalePage, eventId);
  await expect(
    groupCard(stalePage).getByRole('button', { name: r.review.approve, exact: true })
  ).toBeVisible();

  await groupCard(rejectingPage)
    .getByRole('button', { name: r.review.reject, exact: true })
    .click();
  const dialog = rejectingPage.getByRole('dialog', { name: r.reject.title, exact: true });
  await dialog.getByRole('radio', { name: r.reject.reasons.scoreIncorrect, exact: true }).check();
  await dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(dialog).toBeHidden();

  // The stale client converges on its own: the approve action disappears with the pending state.
  await expect(groupCard(stalePage)).toHaveAttribute('data-result-status', 'disputed', {
    timeout: CONVERGENCE_BUDGET_MS
  });
  await expect(
    groupCard(stalePage).getByRole('button', { name: r.review.approve, exact: true })
  ).toHaveCount(0);
  const current = await proposalFor(eventId);
  expect(current).toMatchObject({ status: 'disputed', version: 1 });
});

test('a withdrawal promotes the Reserve into the second quartet and the cutoff forms the groups in every mounted client', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const reg = copies.en.matchRegistration;
  const eventId = await f.event(9);
  const reserve = f.members[7]!;
  const leaver = f.members[0]!;
  const roster = (page: Page) => page.getByRole('region', { name: reg.aria.roster });
  const reservePage = await f.page(reserve);
  await f.open(reservePage, eventId);
  await expect(
    roster(reservePage).getByText(reg.roster.reserveTitle, { exact: true })
  ).toBeVisible();
  const organizer = await f.page(f.creator);
  await f.open(organizer, eventId);
  await expect(organizer.getByText(`9 · ${m.detail.accepted}`)).toBeVisible();

  // Real withdrawal by a Playing member of the first quartet.
  const leaverPage = await f.page(leaver);
  await f.open(leaverPage, eventId);
  await leaverPage.getByRole('button', { name: m.management.leave, exact: true }).click();
  await leaverPage
    .getByRole('dialog')
    .getByRole('button', { name: m.management.confirm, exact: true })
    .click();
  await expect(leaverPage.getByRole('dialog')).toHaveCount(0);

  // FIFO: the Reserve moves into the second quartet, in the organizer's and the Reserve's view alike.
  await expect(organizer.getByText(`8 · ${m.detail.accepted}`)).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS
  });
  await expect(roster(reservePage).getByText(reg.roster.reserveTitle, { exact: true })).toHaveCount(
    0,
    { timeout: CONVERGENCE_BUDGET_MS }
  );
  await expect(
    roster(reservePage).getByText(fill(reg.roster.groupTitle, { group: 2 }), { exact: true })
  ).toBeVisible();
  const promoted = await f.rpc(f.creator, 'list_match_event_registrations', {
    p_match_event_id: eventId
  });
  const placed = Array.isArray(promoted)
    ? promoted.filter(
        (row): row is { display_name: string; group_number: number | null } =>
          typeof row === 'object' && row !== null && 'display_name' in row && 'group_number' in row
      )
    : [];
  expect(placed.find((row) => row.display_name === reserve.name)?.group_number).toBe(2);

  // Group formation: the production cutoff processor finalizes both quartets for mounted clients.
  await f.cutoff(eventId);
  await expect(reservePage.getByRole('region', { name: m.detail.registrationClosed })).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS * 2
  });
  await expect(
    roster(reservePage).getByText(fill(reg.roster.groupTitle, { group: 2 }), { exact: true })
  ).toBeVisible();
  expect(await f.notifications(reserve, 'match_registration_promoted', eventId)).toHaveLength(1);
});
