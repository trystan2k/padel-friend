import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  adjustmentCount,
  cleanupLevelReviews,
  confirmApproval,
  confirmDecision,
  fillApproval,
  grantPlatformAdmin,
  lr,
  notificationCopy,
  playedAfterCheckpoint,
  requestRows,
  resolutionNotices,
  submitRequest
} from './level-reviews-fixtures';
import { copies, fill, fixtures, type Actor } from './matches-management-fixtures';
import { confirmGroup, ledger, pastEvent, states } from './player-ratings-fixtures';

// Full request -> Platform Admin decision -> notification -> corrected profile flow, with two
// independent actor contexts. Rating values are only ever changed by production seams (submit,
// resolve, result finalizer); no test writes a rating, a role string or a decision directly.

type Fixtures = Awaited<ReturnType<typeof fixtures>>;
let f: Fixtures;
let admin: Actor;
let flowOwner: Actor;
let rejectOwner: Actor;
let cancelOwner: Actor;
let duplicateOwner: Actor;
let raceOwner: Actor;
let unrelated: Actor;
let opponents: [Actor, Actor, Actor];

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  // Unique names: the Platform Admin queue is shared with specs running in parallel workers.
  const run = crypto.randomUUID().slice(0, 6);
  f = await fixtures(browser, {
    memberCount: 9,
    memberNames: [`Reviewer ${run}`, `Flow Owner ${run}`]
  });
  const members = f.members;
  admin = members[0]!;
  flowOwner = members[1]!;
  rejectOwner = members[2]!;
  cancelOwner = members[3]!;
  duplicateOwner = members[4]!;
  raceOwner = members[5]!;
  unrelated = members[6]!;
  opponents = [members[6]!, members[7]!, members[8]!];
  await grantPlatformAdmin(admin.id);
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await cleanupLevelReviews(f?.members.map((member) => member.id) ?? []);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(240_000));

const open = async (page: Page, path: string) => {
  await page.goto(path);
  await waitForHydratedPage(page);
};

const quartet = (owner: Actor): [string, string, string, string] => [
  owner.id,
  opponents[0].id,
  opponents[1].id,
  opponents[2].id
];

async function openNotice(page: Page, noticeId: string) {
  await open(page, '/notifications/' + noticeId);
}

test('request, admin decision, player notification and corrected profile, then the next game starts corrected', async () => {
  const ownerPage = await f.page(flowOwner);
  await open(ownerPage, '/level-reviews/new');
  await ownerPage.getByRole('radio', { name: lr.request.modeRange }).check();
  await ownerPage.getByRole('textbox', { name: lr.request.levelMin }).fill('4');
  await ownerPage.getByRole('textbox', { name: lr.request.levelMax }).fill('4.2');
  await ownerPage
    .getByRole('textbox', { name: lr.request.reasonLabel })
    .fill('I keep beating players rated well above me.');
  await ownerPage.getByRole('button', { name: lr.request.evidenceShow }).click();
  await ownerPage
    .getByRole('textbox', { name: lr.request.evidenceLabel })
    .fill('https://example.com/tournament-results');
  await ownerPage.getByRole('button', { name: lr.request.submit }).click();
  await expect(ownerPage).toHaveURL(/\/level-reviews\/[0-9a-f-]{36}$/);
  await waitForHydratedPage(ownerPage);
  await expect(ownerPage.getByRole('heading', { level: 2, name: lr.status.pending })).toBeVisible();
  const [request] = await requestRows(flowOwner.id);
  expect(request).toMatchObject({
    status: 'pending',
    requested_min_level: 4,
    requested_max_level: 4.2
  });
  expect(await resolutionNotices(flowOwner.id, request!.id)).toEqual([]);

  // Platform Admin context: queue -> detail -> fresh preview -> approve.
  const adminPage = await f.page(admin);
  await open(adminPage, '/platform-admin/level-reviews');
  await expect(adminPage.getByRole('heading', { name: lr.admin.title })).toBeVisible();
  await adminPage.getByRole('link').filter({ hasText: flowOwner.name }).first().click();
  await expect(adminPage).toHaveURL(new RegExp(request!.id + '$'));
  await expect(adminPage.getByRole('heading', { name: lr.adminDecision.preview })).toBeVisible();
  await expect(adminPage.getByText(/Internal μ/)).toContainText('3.20');
  await expect(adminPage.getByRole('radio', { name: lr.adminDecision.preserve })).toBeChecked();
  await fillApproval(adminPage, '4.1', 'Tournament results support a 4.10 level.');
  await confirmApproval(adminPage);
  await expect(
    adminPage.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();
  expect(await adjustmentCount(flowOwner.id)).toBe(1);

  // Exactly one unread in-app notice, produced by the resolving transaction.
  const notices = await resolutionNotices(flowOwner.id, request!.id);
  expect(notices).toEqual([{ id: expect.any(String), kind: 'level_review_approved', read: false }]);

  await open(ownerPage, '/notifications');
  const entry = ownerPage
    .getByRole('listitem')
    .filter({ hasText: notificationCopy.kinds.level_review_approved });
  await expect(entry).toHaveCount(1);
  await entry.getByRole('link', { name: notificationCopy.view }).click();
  await waitForHydratedPage(ownerPage);
  await expect(
    ownerPage.getByRole('heading', { level: 1, name: notificationCopy.kinds.level_review_approved })
  ).toBeVisible();
  await expect(
    ownerPage.getByText(fill(notificationCopy.levelReview.approvedBody, { level: '4.10' }))
  ).toBeVisible();
  await expect(ownerPage.getByText('Tournament results support a 4.10 level.')).toBeVisible();
  await expect
    .poll(async () => (await resolutionNotices(flowOwner.id, request!.id))[0]?.read)
    .toBe(true);
  await ownerPage.getByRole('link', { name: notificationCopy.levelReview.open }).click();
  await expect(ownerPage).toHaveURL(new RegExp(`/level-reviews/${request!.id}$`));
  await waitForHydratedPage(ownerPage);
  await expect(
    ownerPage.getByRole('heading', { level: 2, name: lr.status.approved })
  ).toBeVisible();

  // Read state sticks in the feed: no unread marker / mark-read action remains.
  await open(ownerPage, '/notifications');
  await expect(
    ownerPage
      .getByRole('listitem')
      .filter({ hasText: notificationCopy.kinds.level_review_approved })
      .getByRole('button', { name: notificationCopy.markRead })
  ).toHaveCount(0);

  // Profile timeline carries the correction as a non-game item.
  await open(ownerPage, '/dashboard');
  const adjustment = ownerPage
    .getByRole('listitem')
    .filter({ hasText: copies.en.rating.history.adjustmentTitle });
  await expect(adjustment).toContainText('Level 3.20 to 4.10');

  // A later competitive confirmation starts from the corrected level.
  const eventId = await pastEvent(f);
  await confirmGroup({
    eventId,
    players: quartet(flowOwner),
    playedAt: await playedAfterCheckpoint(),
    submittedBy: f.creator.id
  });
  const [game] = await ledger(flowOwner.id);
  expect(game?.before).toBe(4.1);
});

test('a rejection notifies the player with the visible note and leaves the rating unchanged', async () => {
  const id = await submitRequest(rejectOwner, { min: 5, max: 5 });
  const before = await states([rejectOwner.id]);
  const adminPage = await f.page(admin);
  await open(adminPage, '/platform-admin/level-reviews/' + id);
  await adminPage
    .getByRole('textbox', { name: lr.adminDecision.note })
    .fill('Please play more rated games first.');
  await adminPage.getByRole('button', { name: lr.adminDecision.reject, exact: true }).click();
  await confirmDecision(adminPage);
  await expect(
    adminPage.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();

  const [notice] = await resolutionNotices(rejectOwner.id, id);
  expect(notice).toMatchObject({ kind: 'level_review_rejected', read: false });
  const ownerPage = await f.page(rejectOwner);
  await openNotice(ownerPage, notice!.id);
  await expect(
    ownerPage.getByRole('heading', { level: 1, name: notificationCopy.kinds.level_review_rejected })
  ).toBeVisible();
  await expect(ownerPage.getByText(notificationCopy.levelReview.rejectedBody)).toBeVisible();
  await expect(ownerPage.getByText('Please play more rated games first.')).toBeVisible();
  await expect(ownerPage.getByText(/Your level is now/)).toHaveCount(0);
  expect(await states([rejectOwner.id])).toEqual(before);
  expect(await adjustmentCount(rejectOwner.id)).toBe(0);
  expect((await requestRows(rejectOwner.id))[0]).toMatchObject({
    status: 'rejected',
    decision_note: 'Please play more rated games first.'
  });
});

test('the resolution notice is translated in pt-BR and es', async () => {
  const [row] = await requestRows(rejectOwner.id);
  const [notice] = await resolutionNotices(rejectOwner.id, row!.id);
  for (const locale of ['pt-BR', 'es'] as const) {
    const copy = copies[locale].notifications;
    const page = await f.page(rejectOwner, locale);
    await openNotice(page, notice!.id);
    await expect(
      page.getByRole('heading', { level: 1, name: copy.kinds.level_review_rejected })
    ).toBeVisible();
    await expect(page.getByText(copy.levelReview.rejectedBody)).toBeVisible();
    await expect(page.getByRole('link', { name: copy.levelReview.open })).toBeVisible();
    expect(copy.kinds.level_review_rejected).not.toBe(notificationCopy.kinds.level_review_rejected);
  }
});

test('cancellation closes the request without a notice and permits a later request', async () => {
  const first = await submitRequest(cancelOwner, { min: 4, max: 4 });
  const canceled = await cancelOwner.client.rpc('cancel_level_review_request', {
    p_request_id: first
  });
  expect(canceled.error).toBeNull();
  expect(await resolutionNotices(cancelOwner.id, first)).toEqual([]);
  const second = await submitRequest(cancelOwner, { min: 4.1, max: 4.1 });
  expect((await requestRows(cancelOwner.id)).map((row) => row.status)).toEqual([
    'canceled',
    'pending'
  ]);
  // The canceled request can no longer be decided.
  const late = await admin.client.rpc('resolve_level_review_request', {
    p_request_id: first,
    p_command_id: crypto.randomUUID(),
    p_decision: 'reject',
    p_note: 'Too late.'
  });
  expect(late.error?.message).toContain('LEVEL_REVIEW_INVALID_TRANSITION');
  expect(await resolutionNotices(cancelOwner.id, first)).toEqual([]);
  expect(second).not.toBe(first);
});

test('a duplicate pending request and invalid levels are rejected with nothing stored', async () => {
  await submitRequest(duplicateOwner);
  const submit = (args: { p_requested_min_level: number; p_requested_max_level: number }) =>
    duplicateOwner.client.rpc('submit_level_review_request', {
      p_command_id: crypto.randomUUID(),
      p_reason: 'Another try.',
      ...args
    });
  const duplicate = await submit({ p_requested_min_level: 4.4, p_requested_max_level: 4.4 });
  expect(duplicate.error?.message).toContain('LEVEL_REVIEW_DUPLICATE_ACTIVE');
  for (const args of [
    { p_requested_min_level: 7.5, p_requested_max_level: 7.5 },
    { p_requested_min_level: 5, p_requested_max_level: 4 },
    { p_requested_min_level: 3.805, p_requested_max_level: 4 },
    { p_requested_min_level: -0.5, p_requested_max_level: 1 }
  ]) {
    const invalid = await submit(args);
    expect(invalid.error?.message, JSON.stringify(args)).toContain('LEVEL_REVIEW_INVALID_ARGUMENT');
  }
  expect(await requestRows(duplicateOwner.id)).toHaveLength(1);
});

test('community admin, match creator, unrelated players and guests cannot decide or edit ratings', async () => {
  const [pending] = await requestRows(duplicateOwner.id);
  const before = await states([duplicateOwner.id]);
  for (const actor of [f.creator, unrelated, f.guest]) {
    const decide = await actor.client.rpc('resolve_level_review_request', {
      p_request_id: pending!.id,
      p_command_id: crypto.randomUUID(),
      p_decision: 'reject',
      p_note: 'Not allowed.'
    });
    expect(decide.error?.message, actor.name).toContain('LEVEL_REVIEW_FORBIDDEN');
    const queue = await actor.client.rpc('list_level_review_queue', {});
    expect(queue.error?.message, actor.name).toContain('LEVEL_REVIEW_FORBIDDEN');
    const edit = await actor.client
      .from('global_player_ratings')
      .update({ display_level: 7, mu: 7 })
      .eq('user_id', duplicateOwner.id)
      .select();
    expect(edit.error !== null || (edit.data ?? []).length === 0, actor.name).toBe(true);
    const viewed = await actor.client
      .from('player_level_review_requests')
      .select('id')
      .eq('id', pending!.id);
    expect(viewed.data ?? []).toEqual([]);
  }
  expect(await states([duplicateOwner.id])).toEqual(before);
  expect((await requestRows(duplicateOwner.id))[0]?.status).toBe('pending');
  const page = await f.page(f.creator);
  await open(page, '/platform-admin/level-reviews');
  await expect(page.getByRole('alert')).toContainText(lr.errors.forbidden);
});

test('a result confirmed while the admin decides forces a refreshed preview, with one event and one notice', async () => {
  const id = await submitRequest(raceOwner);
  const adminPage = await f.page(admin);
  await open(adminPage, '/platform-admin/level-reviews/' + id);
  await expect(adminPage.getByRole('heading', { name: lr.adminDecision.preview })).toBeVisible();

  // The competing confirmation commits through the production finalizer after the preview loaded.
  const eventId = await pastEvent(f);
  await confirmGroup({
    eventId,
    players: quartet(raceOwner),
    playedAt: '2026-10-01T22:00:00Z',
    submittedBy: f.creator.id
  });
  await fillApproval(adminPage, '4.1', 'Confirmed after the match.');
  await expect(adminPage.getByRole('alertdialog')).toHaveCount(0);

  // Stale retry: no false success, nothing decided, nothing notified.
  await expect(adminPage.getByText(lr.adminDecision.stale)).toBeVisible();
  await expect(
    adminPage.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toHaveCount(0);
  expect((await requestRows(raceOwner.id))[0]?.status).toBe('pending');
  expect(await adjustmentCount(raceOwner.id)).toBe(0);
  expect(await resolutionNotices(raceOwner.id, id)).toEqual([]);

  // Reconfirming on the refreshed preview succeeds exactly once.
  await adminPage.getByRole('button', { name: lr.adminDecision.approve, exact: true }).click();
  await confirmApproval(adminPage);
  await expect(
    adminPage.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();
  expect(await adjustmentCount(raceOwner.id)).toBe(1);
  expect(await resolutionNotices(raceOwner.id, id)).toHaveLength(1);
  const [after] = await states([raceOwner.id]);
  expect(after?.['display_level']).toBe('4.10');
  expect(after?.['groups']).toBe(1);
});
