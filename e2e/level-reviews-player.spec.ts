import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import {
  approveRequest,
  cleanupLevelReviews,
  grantPlatformAdmin,
  lr,
  markUnderReview,
  ratingCopy,
  rejectRequest,
  requestRows,
  submitRequest
} from './level-reviews-fixtures';
import { copies, fixtures, type Actor } from './matches-management-fixtures';

type Fixtures = Awaited<ReturnType<typeof fixtures>>;
let f: Fixtures;
let admin: Actor;
let exact: Actor;
let ranged: Actor;
let duplicate: Actor;
let decided: Actor;
let rejected: Actor;
let validating: Actor;
let empty: Actor;
let stranger: Actor;

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await fixtures(browser, { memberCount: 9 });
  const members = f.members;
  admin = members[0]!;
  exact = members[1]!;
  ranged = members[2]!;
  duplicate = members[3]!;
  decided = members[4]!;
  rejected = members[5]!;
  validating = members[6]!;
  empty = members[7]!;
  stranger = members[8]!;
  await grantPlatformAdmin(admin.id);
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await cleanupLevelReviews(f?.members.map((member) => member.id) ?? []);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(120_000));

const open = async (page: Page, path: string) => {
  await page.goto(path);
  await waitForHydratedPage(page);
};

/** Every interactive control on the page meets the 44px touch target. */
async function expectTouchTargets(page: Page) {
  const small = await page
    .locator(
      'main a[href], main button, main input:not([type=radio]), main textarea, main label:has(input[type=radio])'
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const box = element.getBoundingClientRect();
          return box.width > 0 && box.height > 0 && box.height < 44 - 0.5;
        })
        .map((element) => `${element.tagName} ${element.textContent?.trim().slice(0, 30)}`)
    );
  expect(small).toEqual([]);
}

test('profile entry opens the request form with a read-only current level', async () => {
  const page = await f.page(exact);
  await expect(page.getByRole('region', { name: lr.entry.title })).toBeVisible();
  await page.getByRole('link', { name: lr.entry.request }).click();
  await expect(page).toHaveURL(/\/level-reviews\/new$/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { level: 1, name: lr.request.title })).toBeVisible();
  await expect(page.getByText('Your current level is 3.20')).toBeVisible();
  await expect(page.getByText(lr.request.currentHelper)).toBeVisible();
  // The current level is text, never a field.
  await expect(page.locator('input[value="3.20"], textarea:has-text("3.20")')).toHaveCount(0);
  await expect(page.getByText(lr.request.forwardOnly)).toBeVisible();
  await expectTouchTargets(page);
});

test('an exact request with evidence is stored and opens its status', async () => {
  const page = await f.page(exact);
  await open(page, '/level-reviews/new');
  await page.getByRole('textbox', { name: lr.request.levelExact }).fill('3.8');
  await page
    .getByRole('textbox', { name: lr.request.reasonLabel })
    .fill('  I now win most of my games.  ');
  await page.getByRole('button', { name: lr.request.evidenceShow }).click();
  const evidence = 'https://example.com/results <b>bold</b>';
  await page.getByRole('textbox', { name: lr.request.evidenceLabel }).fill(evidence);
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page).toHaveURL(/\/level-reviews\/[0-9a-f-]{36}$/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { level: 2, name: lr.status.pending })).toBeVisible();
  await expect(page.getByText(lr.status.detail.pending)).toBeVisible();
  // Evidence stays inert text: no markup, no link.
  await expect(page.getByText(evidence)).toBeVisible();
  await expect(page.locator('main b')).toHaveCount(0);
  await expect(page.locator('main a[href*="example.com"]')).toHaveCount(0);
  const rows = await requestRows(exact.id);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: 'pending',
    requested_min_level: 3.8,
    requested_max_level: 3.8,
    reason: 'I now win most of my games.',
    evidence
  });
  await expectTouchTargets(page);
});

test('the owner cancels from the keyboard-operable dialog and can request again', async () => {
  const page = await f.page(exact);
  const [row] = await requestRows(exact.id);
  await open(page, `/level-reviews/${row!.id}`);
  const trigger = page.getByRole('button', { name: lr.detail.cancel });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('alertdialog', { name: lr.cancelDialog.title });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await dialog.getByRole('button', { name: lr.cancelDialog.confirm }).click();
  await expect(page.getByRole('heading', { level: 2, name: lr.status.canceled })).toBeVisible();
  await expect(page.getByText(lr.detail.canceled)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: lr.status.canceled })).toBeFocused();
  expect((await requestRows(exact.id))[0]?.status).toBe('canceled');
  // A canceled request does not block a new one.
  await open(page, '/level-reviews/new');
  await page.getByRole('textbox', { name: lr.request.levelExact }).fill('4');
  await page.getByRole('textbox', { name: lr.request.reasonLabel }).fill('Second try.');
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page).toHaveURL(/\/level-reviews\/[0-9a-f-]{36}$/);
  expect((await requestRows(exact.id)).map((request) => request.status)).toEqual([
    'canceled',
    'pending'
  ]);
});

test('a range with a localized decimal sends canonical numbers', async () => {
  const es = copies.es.levelReview;
  const page = await f.page(ranged, 'es');
  await open(page, '/level-reviews/new');
  await page.getByRole('radio', { name: es.request.modeRange }).check();
  await page.getByRole('textbox', { name: es.request.levelMin }).fill('3,8');
  await page.getByRole('textbox', { name: es.request.levelMax }).fill('4,25');
  await page.getByRole('textbox', { name: es.request.reasonLabel }).fill('Motivo');
  await page.getByRole('button', { name: es.request.submit }).click();
  await expect(page).toHaveURL(/\/level-reviews\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 2, name: es.status.pending })).toBeVisible();
  expect((await requestRows(ranged.id))[0]).toMatchObject({
    requested_min_level: 3.8,
    requested_max_level: 4.25
  });
});

test('invalid input is explained, focuses the first error and stores nothing', async () => {
  const page = await f.page(validating);
  await open(page, '/level-reviews/new');
  await page.getByRole('button', { name: lr.request.submit }).click();
  const level = page.getByRole('textbox', { name: lr.request.levelExact });
  await expect(level).toBeFocused();
  await expect(level).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(lr.validation.levelRequired)).toBeVisible();
  await page.getByRole('radio', { name: lr.request.modeRange }).check();
  await page.getByRole('textbox', { name: lr.request.levelMin }).fill('4.5');
  await page.getByRole('textbox', { name: lr.request.levelMax }).fill('4');
  await page.getByRole('textbox', { name: lr.request.reasonLabel }).fill('Because');
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page.getByText(lr.validation.rangeOrder)).toBeVisible();
  await page.getByRole('textbox', { name: lr.request.levelMin }).fill('3.805');
  await page.getByRole('textbox', { name: lr.request.levelMax }).fill('4');
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page.getByText(lr.validation.levelPrecision)).toBeVisible();
  expect(await requestRows(validating.id)).toEqual([]);
});

test('a duplicate active request is rejected and the existing one is offered', async () => {
  const existing = await submitRequest(duplicate);
  const page = await f.page(duplicate);
  await open(page, '/level-reviews/new');
  await page.getByRole('textbox', { name: lr.request.levelExact }).fill('4.4');
  await page.getByRole('textbox', { name: lr.request.reasonLabel }).fill('Again.');
  await page.getByRole('button', { name: lr.request.submit }).click();
  const alert = page.getByRole('alert').filter({ hasText: lr.errors.duplicate });
  await expect(alert).toBeVisible();
  await alert.getByRole('link', { name: lr.errors.viewActive }).click();
  await expect(page).toHaveURL(new RegExp(`/level-reviews/${existing}$`));
  expect(await requestRows(duplicate.id)).toHaveLength(1);
  // The history points at the active request instead of offering a second form.
  await open(page, '/level-reviews');
  await expect(page.getByRole('link', { name: lr.history.viewActive })).toBeVisible();
  await expect(page.getByRole('link', { name: lr.history.newRequest })).toHaveCount(0);
});

test('the lifecycle is shown to the owner: under review, then approved with the correction in the timeline', async () => {
  const id = await submitRequest(decided, { min: 4, max: 4.2 });
  const page = await f.page(decided);
  await open(page, `/level-reviews/${id}`);
  await expect(page.getByRole('heading', { level: 2, name: lr.status.pending })).toBeVisible();
  await markUnderReview(admin, id);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { level: 2, name: lr.status.under_review })).toBeVisible();
  await expect(page.getByText(lr.status.detail.under_review)).toBeVisible();
  await expect(page.getByRole('button', { name: lr.detail.cancel })).toBeVisible();

  await approveRequest(admin, id, 4.1, 'Results confirm a 4.10 level.');
  await page.reload();
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { level: 2, name: lr.status.approved })).toBeVisible();
  await expect(page.getByText('Results confirm a 4.10 level.')).toBeVisible();
  await expect(page.getByText(lr.detail.approvedLevel)).toBeVisible();
  await expect(page.getByText('4.10', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: lr.detail.cancel })).toHaveCount(0);

  await page.getByRole('link', { name: lr.detail.appliedLink }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
  const journey = page.getByRole('region', { name: ratingCopy.journey.title });
  const row = journey.getByRole('listitem').filter({ hasText: ratingCopy.history.adjustmentTitle });
  await expect(row).toBeVisible();
  await expect(row.getByText(ratingCopy.history.adjustmentChip, { exact: true })).toBeVisible();
  await expect(row.getByText('Level 3.20 to 4.10')).toBeVisible();
  await expect(row.getByText(/Win|Loss|Draw/)).toHaveCount(0);
  // No games were played: the correction is not a counted game and no explain control exists.
  await expect(row.getByRole('button')).toHaveCount(0);
  await expect(
    page.getByText('Confirmed competitive groups').locator('xpath=following-sibling::*')
  ).toHaveText('0');
  await row.getByRole('link', { name: ratingCopy.history.adjustmentView }).click();
  await expect(page).toHaveURL(new RegExp(`/level-reviews/${id}$`));
});

test('a rejection shows the review note and leaves the level unchanged', async () => {
  const id = await submitRequest(rejected, { min: 5, max: 5 });
  await rejectRequest(admin, id, 'Not enough evidence yet.');
  const page = await f.page(rejected);
  await open(page, `/level-reviews/${id}`);
  await expect(page.getByRole('heading', { level: 2, name: lr.status.rejected })).toBeVisible();
  await expect(page.getByText('Not enough evidence yet.')).toBeVisible();
  await expect(page.getByText(lr.detail.approvedLevel)).toHaveCount(0);
  await expect(page.getByRole('button', { name: lr.detail.cancel })).toHaveCount(0);
  await open(page, '/dashboard');
  await expect(page.getByText(ratingCopy.history.adjustmentTitle)).toHaveCount(0);
  await expect(
    page.getByText('Global level').locator('xpath=following-sibling::strong')
  ).toContainText('3.20');
});

test('history shows an explicit empty state and every request with its status', async () => {
  const page = await f.page(empty);
  await open(page, '/level-reviews');
  await expect(page.getByRole('heading', { name: lr.history.emptyTitle })).toBeVisible();
  await expect(page.getByRole('link', { name: lr.history.newRequest })).toBeVisible();

  const other = await f.page(decided);
  await open(other, '/level-reviews');
  await expect(other.getByRole('listitem')).toHaveCount(1);
  await expect(other.getByRole('listitem').first()).toContainText(lr.status.approved);
  await expectTouchTargets(other);
});

test("another player cannot open someone else's request", async () => {
  const [row] = await requestRows(duplicate.id);
  const page = await f.page(stranger);
  await open(page, `/level-reviews/${row!.id}`);
  const alert = page.getByRole('alert');
  await expect(alert).toContainText(lr.errors.notFound);
  await expect(page.getByText(lr.status.detail.pending)).toHaveCount(0);
  await expect(alert.getByRole('link', { name: lr.detail.back })).toBeVisible();
});

test('the page keeps working offline: nothing is claimed and retry is safe', async () => {
  const page = await f.page(stranger);
  await open(page, '/level-reviews/new');
  await page.getByRole('textbox', { name: lr.request.levelExact }).fill('4.1');
  await page.getByRole('textbox', { name: lr.request.reasonLabel }).fill('Offline attempt.');
  await page.context().setOffline(true);
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page.getByRole('alert')).toContainText(lr.errors.offline);
  expect(await requestRows(stranger.id)).toEqual([]);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: lr.request.submit }).click();
  await expect(page).toHaveURL(/\/level-reviews\/[0-9a-f-]{36}$/);
  expect(await requestRows(stranger.id)).toHaveLength(1);
});
