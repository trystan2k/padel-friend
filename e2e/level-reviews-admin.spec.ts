import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  cleanupLevelReviews,
  confirmApproval,
  confirmDecision as confirm,
  fillApproval as decision,
  grantPlatformAdmin,
  lr,
  ratingCopy,
  requestRows,
  submitRequest
} from './level-reviews-fixtures';
import { fixtures, sql, type Actor } from './matches-management-fixtures';
import { confirmGroup, pastEvent, states } from './player-ratings-fixtures';

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof fixtures>>;
let admin: Actor;
let player: Actor;

test.beforeEach(async ({ browser }) => {
  test.setTimeout(180_000);
  f = await fixtures(browser, { memberCount: 5 });
  admin = f.members[0]!;
  player = f.members[1]!;
  await grantPlatformAdmin(admin.id);
});
test.afterEach(async () => {
  test.setTimeout(180_000);
  if (!f) return;
  await cleanupLevelReviews([f.creator.id, f.guest.id, ...f.members.map((actor) => actor.id)]);
  await f.cleanup();
});

async function open(page: Page, path: string) {
  await page.goto(path);
  await waitForHydratedPage(page);
}

test('admin approves from queue and player sees the adjustment', async () => {
  test.setTimeout(180_000);
  const id = await submitRequest(player, { min: 4, max: 4.2 });
  const page = await f.page(admin);
  await open(page, '/platform-admin/level-reviews');
  await expect(page.getByRole('heading', { name: lr.admin.title })).toBeVisible();
  const item = page.getByRole('link').filter({ hasText: player.name });
  await expect(item).toContainText(lr.status.pending);
  await item.click();
  await expect(page).toHaveURL(new RegExp(id + '$'));
  await expect(page.getByRole('heading', { name: lr.adminDecision.preview })).toBeVisible();
  await expect(page.getByText(/Internal μ/)).toContainText('3.20');
  await expect(page.getByRole('radio', { name: lr.adminDecision.preserve })).toBeChecked();
  await decision(page, '4.1', 'Evidence supports correction.');
  const dialog = page.getByRole('alertdialog', { name: lr.adminDecision.confirmApprove });
  await expect(dialog).toContainText('internal μ');
  await expect(dialog).toContainText('4.1');
  await confirmApproval(page);
  await expect(
    page.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();
  expect((await requestRows(player.id))[0]).toMatchObject({
    status: 'approved',
    decision_note: 'Evidence supports correction.'
  });
  const ownerPage = await f.page(player);
  await open(ownerPage, '/dashboard');
  const adjustment = ownerPage
    .getByRole('listitem')
    .filter({ hasText: ratingCopy.history.adjustmentTitle });
  await expect(adjustment).toContainText('Level 3.20 to 4.10');
});

test('reject records note without changing rating', async () => {
  test.setTimeout(180_000);
  const id = await submitRequest(player);
  const before = await states([player.id]);
  const page = await f.page(admin);
  await open(page, '/platform-admin/level-reviews/' + id);
  await page.getByRole('textbox', { name: lr.adminDecision.note }).fill('Insufficient evidence.');
  await page.getByRole('button', { name: lr.adminDecision.reject, exact: true }).click();
  await expect(
    page.getByRole('alertdialog', { name: lr.adminDecision.confirmReject })
  ).toBeVisible();
  await confirm(page);
  await expect(
    page.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();
  expect((await requestRows(player.id))[0]).toMatchObject({
    status: 'rejected',
    decision_note: 'Insufficient evidence.'
  });
  expect(await states([player.id])).toEqual(before);
});

test('nonadmins cannot open queue or resolve directly', async () => {
  test.setTimeout(180_000);
  const id = await submitRequest(player);
  await f.event(1);
  await sql(
    `update public.community_members set role='admin' where community_id='${f.community}' and user_id='${f.members[2]!.id}'`
  );
  // Capture the compiled server-function request without committing the decision.
  const adminPage = await f.page(admin);
  await open(adminPage, '/platform-admin/level-reviews/' + id);
  await adminPage.getByRole('textbox', { name: lr.adminDecision.note }).fill('Denied');
  await adminPage.getByRole('button', { name: lr.adminDecision.reject, exact: true }).click();
  await adminPage.route('**/_serverFn/**', (route) => route.abort());
  const requestPromise = adminPage.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/_serverFn/')
  );
  await confirm(adminPage);
  const request = await requestPromise;
  const body = request.postData();
  expect(body).not.toBeNull();
  for (const actor of [f.creator, f.members[2]!, f.guest]) {
    const page = await f.page(actor);
    await open(page, '/platform-admin/level-reviews');
    await expect(page.getByRole('alert')).toContainText(lr.errors.forbidden);
    const response = await page.context().request.post(request.url(), {
      data: body!,
      headers: {
        ...request.headers(),
        origin: new URL(request.url()).origin,
        cookie: (await page.context().cookies())
          .map((cookie) => cookie.name + '=' + cookie.value)
          .join('; ')
      }
    });
    expect(await response.text()).toMatch(/LEVEL_REVIEW_FORBIDDEN/i);
  }
  expect((await requestRows(player.id))[0]?.status).toBe('pending');
});

test('stale preview refreshes after a real match confirmation before approval', async () => {
  test.setTimeout(180_000);
  const id = await submitRequest(player);
  const page = await f.page(admin);
  await open(page, '/platform-admin/level-reviews/' + id);
  await expect(page.getByRole('heading', { name: lr.adminDecision.preview })).toBeVisible();
  const eventId = await pastEvent(f);
  await confirmGroup({
    eventId,
    players: [player.id, f.members[2]!.id, f.members[3]!.id, f.members[4]!.id],
    playedAt: '2026-10-01T22:00:00Z',
    submittedBy: f.creator.id
  });
  await decision(page, '4.1', 'Confirmed after match.');
  await confirm(page);
  await expect(page.getByText(lr.adminDecision.stale)).toBeVisible();
  expect((await requestRows(player.id))[0]?.status).toBe('pending');
  await page.getByRole('button', { name: lr.adminDecision.approve, exact: true }).click();
  await confirmApproval(page);
  await expect(
    page.getByRole('status').filter({ hasText: lr.adminDecision.resolved })
  ).toBeVisible();
  expect((await requestRows(player.id))[0]?.status).toBe('approved');
});

test('reliability reset requires justification', async () => {
  test.setTimeout(180_000);
  const eventId = await pastEvent(f);
  await confirmGroup({
    eventId,
    players: [player.id, f.members[2]!.id, f.members[3]!.id, f.members[4]!.id],
    playedAt: '2026-10-01T22:00:00Z',
    submittedBy: f.creator.id
  });
  const id = await submitRequest(player);
  const page = await f.page(admin);
  await open(page, '/platform-admin/level-reviews/' + id);
  await page.getByRole('radio', { name: lr.adminDecision.reset }).check();
  await decision(page, '4.1', 'Review note.');
  await expect(page.getByText(lr.adminDecision.justificationError)).toBeVisible();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  expect((await requestRows(player.id))[0]?.status).toBe('pending');
});
