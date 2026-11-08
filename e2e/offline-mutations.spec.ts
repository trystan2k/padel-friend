import { expect, test } from '@playwright/test';
import { fixtures, en, fill, sql } from './matches-management-fixtures';
import { enterScore, openRecord, resultFixtures } from './matches-results-fixtures';
import { waitForHydratedPage } from './auth-helpers';

test.setTimeout(180_000);
test('offline join and approval show unsent state and reconnect never replays either command', async ({
  browser
}) => {
  const f = await fixtures(browser, { memberCount: 1 });
  try {
    const id = await f.event(1);
    const member = f.members[0]!;
    const page = await f.page(member);
    await f.open(page, id);
    const join = page.getByRole('button', { name: en.matchRegistration.join.button, exact: true });
    await expect(join).toBeVisible();
    await page.context().setOffline(true);
    await expect(join).toBeDisabled();
    await expect(
      page.getByText(en.matchRegistration.feedback.offline, { exact: true })
    ).toBeVisible();
    await page.context().setOffline(false);
    await expect(join).toBeEnabled();
    const state = await member.client.rpc('get_my_match_registration', { p_match_event_id: id });
    expect(state.error).toBeNull();
    expect(state.data).toMatchObject({ lifecycle: null, accepted_at: null, accepted_order: null });

    expect(
      (await f.guest.client.rpc('submit_match_registration', { p_match_event_id: id })).error
    ).toBeNull();
    const host = await f.page(f.creator);
    await f.open(host, id);
    const approve = host.getByRole('button', {
      name: fill(en.matchRegistration.queue.approveLabel, { name: f.guest.name })
    });
    await expect(approve).toBeVisible();
    await host.context().setOffline(true);
    await expect(approve).toBeDisabled();
    await expect(
      host
        .getByRole('region', { name: en.matchRegistration.queue.title })
        .getByText(en.matchRegistration.feedback.offline, { exact: true })
    ).toBeVisible();
    await host.context().setOffline(false);
    await expect(approve).toBeEnabled();
    const [pending] = await sql(
      `select lifecycle from public.match_event_registrations where match_event_id='` +
        id +
        `' and user_id='` +
        f.guest.id +
        `'`
    );
    expect(pending?.lifecycle).toBe('pending');
  } finally {
    await f.cleanup();
  }
});

test('false-online failed join reports uncertainty, never success or queued replay', async ({
  browser
}) => {
  const f = await fixtures(browser, { memberCount: 1 });
  try {
    const id = await f.event(1);
    const member = f.members[0]!;
    const page = await f.page(member);
    await f.open(page, id);
    await page.route('**/*', (route) =>
      route.request().method() === 'POST' ? route.abort('failed') : route.continue()
    );
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await page.getByRole('button', { name: en.matchRegistration.join.button, exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(en.pwa.offline.unconfirmed);
    await expect(
      page.getByText(en.matchRegistration.feedback.accepted, { exact: true })
    ).toHaveCount(0);
    await page.unroute('**/*');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.reload();
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('button', { name: en.matchRegistration.join.button, exact: true })
    ).toBeVisible();
    const rows = await sql(
      `select id from public.match_event_registrations where match_event_id='` +
        id +
        `' and user_id='` +
        member.id +
        `'`
    );
    expect(rows).toEqual([]);
  } finally {
    await f.cleanup();
  }
});

test('offline result preserves unsent score and court draft without reconnect submission', async ({
  browser
}) => {
  const f = await resultFixtures(browser, { memberCount: 3 });
  try {
    const id = await f.completedEvent('competitive', 4);
    const page = await f.page(f.creator);
    await openRecord(page, id);
    await enterScore(page);
    const court = page.getByLabel(en.matches.results.courtLabel, { exact: true });
    await expect(court).toHaveValue('Court 2');
    await page.context().setOffline(true);
    await expect(
      page.getByText(en.matches.results.review.offlineDraft, { exact: true })
    ).toBeVisible();
    await expect(court).toHaveValue('Court 2');
    await page.context().setOffline(false);
    await expect(court).toHaveValue('Court 2');
    await expect(
      page.getByRole('textbox', { name: en.matches.results.teams.team_a, exact: true }).first()
    ).toHaveValue('6');
    const rows = await sql(
      `select id from public.match_event_result_proposals where match_event_id='` + id + `'`
    );
    expect(rows).toEqual([]);
  } finally {
    await f.cleanup();
  }
});
