import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { copies, day, fill, leagueFixtures, sql, type Actor } from './leagues-fixtures';

// PAF-11 AC1/AC9/AC14 acceptance (U5.1): members create Fixed End Date and Manual Leagues
// through the real form, validation and Active-conflict guidance are visible, the list and
// detail expose Upcoming/Active/blocked states, and the one-Active rule holds end to end.
const l = copies.en.leagues;
test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let member: Actor;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await leagueFixtures(browser, { memberCount: 2, communityName: 'League Club' });
  member = f.members[0]!;
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(90_000);
});

const listUrl = () => `/community/${f.community}/leagues`;

async function openCreate(page: Page, locale: keyof typeof copies = 'en') {
  await page.goto(listUrl());
  await waitForHydratedPage(page);
  await page.getByRole('link', { name: copies[locale].leagues.list.create, exact: true }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: copies[locale].leagues.form.title })
  ).toBeVisible();
  await waitForHydratedPage(page);
}

async function submitCreate(page: Page) {
  await page.getByRole('button', { name: l.form.submit, exact: true }).click();
}

test('member creates an Upcoming Fixed End Date League and sees it in list and detail', async () => {
  const page = await f.page(member);
  // Member-reachable entry point from the dashboard, not only an admin route.
  await expect(
    page.getByRole('link', { name: fill(l.entries.link, { community: 'League Club' }) })
  ).toBeVisible();
  await page
    .getByRole('link', { name: fill(l.entries.link, { community: 'League Club' }) })
    .click();
  await expect(page.getByRole('heading', { level: 1, name: l.title })).toBeVisible();
  await expect(page.getByText(l.list.empty, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: l.list.create, exact: true }).click();
  await waitForHydratedPage(page);
  await page.getByLabel(l.form.nameLabel, { exact: true }).fill('Autumn League');
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(2));
  await page.getByLabel(l.form.endDateLabel, { exact: true }).fill(day(40));
  await expect(page.getByLabel(l.form.minimumLabel, { exact: true })).toHaveValue('1');
  await submitCreate(page);

  await expect(page).toHaveURL(/\/leagues\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Autumn League' })).toBeVisible();
  await expect(page.getByText(l.status.upcoming, { exact: true })).toBeVisible();
  await expect(page.getByText(l.detail.owner, { exact: true })).toBeVisible();
  const [row] = await sql(
    `select owner_id::text, end_mode::text, status::text, minimum_matches_for_final_award::text as minimum,
        timezone from public.leagues where community_id='${f.community}' and name='Autumn League'`
  );
  expect(row).toMatchObject({
    owner_id: member.id,
    end_mode: 'fixed_date',
    status: 'upcoming',
    minimum: '1',
    timezone: 'UTC'
  });

  await page.goto(listUrl());
  await waitForHydratedPage(page);
  const upcoming = page.getByRole('region', { name: l.list.sections.upcoming });
  await expect(upcoming.getByRole('link', { name: /Autumn League/ })).toBeVisible();
});

test('validation errors are announced, associated and focus the first invalid field', async () => {
  const page = await f.page(member);
  await openCreate(page);
  await submitCreate(page);
  const name = page.getByLabel(l.form.nameLabel, { exact: true });
  await expect(name).toBeFocused();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText(l.form.errors.nameRequired, { exact: true })).toBeVisible();
  await expect(page.getByText(l.form.errors.endRequired, { exact: true })).toBeVisible();

  // End before start (Fixed End Date).
  await name.fill('Backwards League');
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(10));
  await page.getByLabel(l.form.endDateLabel, { exact: true }).fill(day(5));
  await submitCreate(page);
  await expect(page.getByText(l.form.errors.endNotAfterStart, { exact: true })).toBeVisible();
  await expect(page.getByLabel(l.form.endDateLabel, { exact: true })).toBeFocused();
  expect(await sql(`select 1 from public.leagues where name='Backwards League'`)).toHaveLength(0);

  // Start in the past.
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(-3));
  await page.getByLabel(l.form.endDateLabel, { exact: true }).fill(day(5));
  await submitCreate(page);
  await expect(page.getByText(l.form.errors.startInPast, { exact: true })).toBeVisible();

  // Invalid minimum matches.
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(10));
  await page.getByLabel(l.form.endDateLabel, { exact: true }).fill(day(20));
  await page.getByLabel(l.form.minimumLabel, { exact: true }).fill('0');
  await submitCreate(page);
  await expect(page.getByText(l.form.errors.minimumInvalid, { exact: true })).toBeVisible();
});

test('member creates a Manual League with no end date', async () => {
  const page = await f.page(member);
  await openCreate(page);
  await page.getByRole('radio', { name: new RegExp(l.form.mode.manual.split(' ')[0]!) }).check();
  await expect(page.getByLabel(l.form.endDateLabel, { exact: true })).toHaveCount(0);
  await page.getByLabel(l.form.nameLabel, { exact: true }).fill('Open Ladder');
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(5));
  await page.getByLabel(l.form.minimumLabel, { exact: true }).fill('3');
  await submitCreate(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Open Ladder' })).toBeVisible();
  await expect(page.getByText(l.status.upcoming, { exact: true })).toBeVisible();
  const [row] = await sql(
    `select end_mode::text, end_at::text, minimum_matches_for_final_award::text as minimum
       from public.leagues where name='Open Ladder' and community_id='${f.community}'`
  );
  expect(row).toMatchObject({ end_mode: 'manual', end_at: null, minimum: '3' });
});

test('one Active League: conflict guidance, rejection and blocked-conflict resolution', async () => {
  const activeId = await f.createLeague(member, {
    name: 'Current League',
    endMode: 'manual',
    start: day(0)
  });
  const [active] = await sql(`select status::text from public.leagues where id='${activeId}'`);
  expect(active).toMatchObject({ status: 'active' });

  const page = await f.page(member);
  await openCreate(page);
  const note = page.getByRole('note');
  await expect(note).toContainText(fill(l.form.conflict.title, { name: 'Current League' }));
  await expect(note).toContainText(l.form.conflict.body);
  await expect(note.getByRole('link', { name: new RegExp(l.form.conflict.review) })).toBeVisible();

  // A second League starting now cannot activate while the first remains Active: it is
  // created Upcoming and the blocked reason is visible in the list and on its detail.
  await page.getByLabel(l.form.nameLabel, { exact: true }).fill('Waiting League');
  await page.getByLabel(l.form.startDateLabel, { exact: true }).fill(day(0));
  await page.getByLabel(l.form.endDateLabel, { exact: true }).fill(day(20));
  await submitCreate(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Waiting League' })).toBeVisible();
  await expect(page.getByText(l.status.upcoming, { exact: true })).toBeVisible();
  await expect(page.getByText(l.blocked.active_league_exists, { exact: true })).toBeVisible();
  await expect(page.getByText(l.detail.activateHint, { exact: true })).toBeVisible();
  expect(
    await sql(
      `select name from public.leagues where community_id='${f.community}' and status='active'`
    )
  ).toEqual([{ name: 'Current League' }]);
  const waiting = page.url().split('/').pop()!;

  // List sections: Active first, then Upcoming with the blocked reason.
  await page.goto(listUrl());
  await waitForHydratedPage(page);
  const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
  expect(headings.indexOf(l.list.sections.active)).toBeLessThan(
    headings.indexOf(l.list.sections.upcoming)
  );
  const upcoming = page.getByRole('region', { name: l.list.sections.upcoming });
  await expect(upcoming.getByText(l.blocked.active_league_exists, { exact: true })).toBeVisible();

  // Closing the Active League frees the slot; the waiting one is NOT auto-promoted.
  await page.goto(`${listUrl()}/${activeId}`);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: l.detail.close, exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: l.detail.closeConfirm.confirm, exact: true })
    .click();
  await expect(page.getByText(l.detail.closedDone, { exact: true })).toBeVisible();

  await page.goto(`${listUrl()}/${waiting}`);
  await waitForHydratedPage(page);
  await expect(
    page.getByText(l.blocked.explicit_activation_required, { exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: l.detail.activate, exact: true }).click();
  await expect(page.getByText(l.detail.activated, { exact: true })).toBeVisible();
  await expect(page.getByText(l.status.active, { exact: true }).first()).toBeVisible();
  expect(
    await sql(
      `select name from public.leagues where community_id='${f.community}' and status='active'`
    )
  ).toEqual([{ name: 'Waiting League' }]);
});

test('three locales render the creation form with translated labels', async () => {
  for (const locale of ['pt-BR', 'es'] as const) {
    const page = await f.page(member, locale);
    await openCreate(page, locale);
    const t = copies[locale].leagues;
    await expect(page.getByLabel(t.form.nameLabel, { exact: true })).toBeVisible();
    await expect(page.getByLabel(t.form.startDateLabel, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: t.form.submit, exact: true }).click();
    await expect(page.getByText(t.form.errors.nameRequired, { exact: true })).toBeVisible();
    await page.context().close();
  }
});

test('disabled member creation hides the form for members but not for Admins', async () => {
  await sql(
    `update public.communities set settings = jsonb_set(settings,'{admin_defaults,member_created_leagues_enabled}','false') where id='${f.community}'`
  );
  try {
    const memberPage = await f.page(member);
    await memberPage.goto(listUrl());
    await waitForHydratedPage(memberPage);
    await expect(memberPage.getByText(l.list.creationDisabled, { exact: true })).toBeVisible();
    await expect(memberPage.getByRole('link', { name: l.list.create, exact: true })).toHaveCount(0);

    const adminPage = await f.page(f.creator);
    await adminPage.goto(listUrl());
    await waitForHydratedPage(adminPage);
    await expect(adminPage.getByRole('link', { name: l.list.create, exact: true })).toBeVisible();
  } finally {
    await sql(
      `update public.communities set settings = jsonb_set(settings,'{admin_defaults,member_created_leagues_enabled}','true') where id='${f.community}'`
    );
  }
});
