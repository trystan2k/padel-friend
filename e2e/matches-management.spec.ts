import { expect, test, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { en, fill, fixtures, organizerMenu, sql } from './matches-management-fixtures';

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
let f: Awaited<ReturnType<typeof fixtures>>;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await fixtures(browser);
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});
test.beforeEach(() => {
  test.setTimeout(90_000);
});
const m = en.matches.management;
const r = en.matches.reconfirmation;
const invitation = en.matches.invitations;

async function roster(id: string) {
  return sql(
    `select id::text,user_id::text,accepted_order::text,lifecycle::text,participation_status::text from public.match_event_registrations where match_event_id='${id}' order by accepted_order`
  );
}
async function edit(page: Page) {
  await page.getByRole('button', { name: m.edit.title, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: m.edit.title, exact: true })).toBeVisible();
  return dialog;
}
async function reconfirm(page: Page) {
  await page.getByRole('button', { name: r.reviewTerms, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: r.confirm, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('invite acceptance joins ordinary FIFO as Reserve', async () => {
  const invitee = f.members[5]!;
  const fullInvitee = f.members[8]!;
  const id = await f.event(6, [invitee, fullInvitee], 8);
  const page = await f.page(invitee);
  await f.notice(page, invitee, 'match_event_invitation', id);
  expect(await roster(id)).toHaveLength(6); // Two pending invites reserve nothing.
  // Pending invitation and both response controls must be discoverable above
  // the fold at the approved Fyhbv mobile viewport, before long match details.
  await expect(page.getByRole('region', { name: invitation.title })).toBeInViewport({ ratio: 1 });
  for (const name of [invitation.accept, invitation.decline]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 });
  }
  await page.getByRole('button', { name: invitation.accept, exact: true }).click();
  await expect(page.getByText(invitation.accepted, { exact: true })).toBeVisible();
  const rows = await roster(id);
  expect(rows.find((row) => row.user_id === invitee.id)).toMatchObject({
    accepted_order: '7',
    participation_status: 'reserve'
  });
  await expect(
    page
      .getByRole('region', { name: en.matchRegistration.aria.roster })
      .getByText(en.matchRegistration.roster.you, { exact: true })
  ).toBeVisible();
  const creatorPage = await f.page(f.creator);
  await f.notice(creatorPage, f.creator, 'match_invitation_accepted', id);
  await f.rpc(f.members[6]!, 'submit_match_registration', { p_match_event_id: id });
  await page.reload();
  await waitForHydratedPage(page);
  await expect(
    page.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 2 }))
  ).toBeVisible();
  expect((await roster(id)).filter((row) => row.participation_status === 'playing')).toHaveLength(
    8
  );
  // Capacity is consumed by acceptance, not invitation. A full response must
  // leave the last invite pending, with no phantom accepted ordinal/attempt.
  const fullPage = await f.page(fullInvitee);
  await f.open(fullPage, id);
  const before = await sql(
    `select next_accepted_ordinal::text from public.match_event_registration_state where match_event_id='${id}'`
  );
  await fullPage.getByRole('button', { name: invitation.accept, exact: true }).click();
  await expect(fullPage.getByText(invitation.errors.full, { exact: true })).toBeVisible();
  expect(await roster(id)).toHaveLength(8);
  expect(
    await sql(
      `select next_accepted_ordinal::text from public.match_event_registration_state where match_event_id='${id}'`
    )
  ).toEqual(before);
  expect(
    await sql(
      `select status::text from public.match_event_invites where match_event_id='${id}' and invitee_user_id='${fullInvitee.id}'`
    )
  ).toEqual([{ status: 'pending' }]);
  expect(
    await sql(
      `select id from public.match_event_registration_attempts where match_event_id='${id}' and user_id='${fullInvitee.id}'`
    )
  ).toEqual([]);
});

test('creator removal promotes earliest Reserve with audited reason', async () => {
  const id = await f.event();
  const target = f.members[0]!;
  const reserve = f.members[7]!;
  const before = await roster(id);
  const page = await f.page(f.creator);
  await f.open(page, id);
  await page
    .getByRole('button', { name: fill(m.participantActions, { name: target.name }) })
    .click();
  await page.getByRole('menuitem', { name: m.remove, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: m.remove, exact: true })).toBeDisabled();
  const reason = 'Unavailable for the agreed court booking';
  await dialog.getByLabel(m.reason, { exact: true }).fill(reason);
  await dialog.getByRole('button', { name: m.remove, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const after = await roster(id);
  expect(after.find((row) => row.user_id === target.id)).toMatchObject({
    lifecycle: 'removed_by_creator',
    participation_status: null
  });
  expect(after.find((row) => row.user_id === reserve.id)).toMatchObject({
    accepted_order: '9',
    participation_status: 'playing'
  });
  expect(
    after.map(({ id: registrationId, user_id, accepted_order }) => ({
      id: registrationId,
      user_id,
      accepted_order
    }))
  ).toEqual(
    before.map(({ id: registrationId, user_id, accepted_order }) => ({
      id: registrationId,
      user_id,
      accepted_order
    }))
  );
  expect(
    await sql(
      `select reason,actor_id::text,target_user_id::text from public.match_event_audit_log where match_event_id='${id}' and action='remove'`
    )
  ).toEqual([{ reason, actor_id: f.creator.id, target_user_id: target.id }]);
  const targetPage = await f.page(target);
  await f.notice(targetPage, target, 'match_registration_removed', id);
  await expect(
    targetPage.getByText(fill(m.removalReason, { reason }), { exact: true })
  ).toBeVisible();
  await expect(targetPage.getByText(m.removed, { exact: true })).toBeVisible();
  const reservePage = await f.page(reserve);
  await f.open(reservePage, id);
  await reservePage.reload();
  await waitForHydratedPage(reservePage);
  await expect(
    reservePage.getByText(fill(en.matchRegistration.request.joinedPlayingBadge, { group: 2 }))
  ).toBeVisible();
  const otherPage = await f.page(f.members[2]!);
  const response = await otherPage.goto(`/matches/${id}`);
  await waitForHydratedPage(otherPage);
  const body = await response!.text();
  // Public roster is names/levels only; never target user/registration/attempt IDs.
  for (const row of before) {
    if (row.user_id === f.members[2]!.id || row.user_id === f.creator.id) continue;
    expect(body).not.toContain(String(row.user_id));
    expect(body).not.toContain(String(row.id));
  }
  expect(body).not.toContain(await f.attempt(id, target));
  expect(body).not.toContain(reason);
  await expect(
    otherPage.getByRole('button', { name: fill(m.participantActions, { name: target.name }) })
  ).toHaveCount(0);
});

test('major change requires consent and excludes unreconfirmed at cutoff', async () => {
  const id = await f.event();
  const excluded = f.members[7]!;
  const creatorPage = await f.page(f.creator);
  await f.open(creatorPage, id);
  const dialog = await edit(creatorPage);
  await dialog
    .getByRole('combobox', { name: en.matchCreate.fields.type, exact: true })
    .selectOption('competitive');
  await dialog.getByRole('button', { name: m.edit.save, exact: true }).click();
  await expect(dialog.getByRole('button', { name: m.edit.save, exact: true })).toBeDisabled();
  await creatorPage
    .getByRole('dialog')
    .getByRole('button', { name: m.cancel, exact: true })
    .click();
  await expect(creatorPage.getByRole('heading', { name: r.title })).toBeVisible();
  const required = await roster(id);
  expect(required.every((row) => row.participation_status === null)).toBe(true);
  // Explicit browser consent from every remaining player, including editing creator.
  for (const actor of [f.creator, ...f.members.slice(0, 7)]) {
    const page = actor === f.creator ? creatorPage : await f.page(actor);
    await f.open(page, id);
    await reconfirm(page);
  }
  const excludedPage = await f.page(excluded);
  await f.open(excludedPage, id);
  await expect(
    excludedPage.getByRole('button', { name: r.reviewTerms, exact: true })
  ).toBeEnabled();
  expect(
    (await roster(id)).find((row) => row.user_id === excluded.id)?.participation_status
  ).toBeNull();
  await f.cutoff(id);
  await f.notice(excludedPage, excluded, 'match_reconfirmation_expired', id);
  await expect.soft(excludedPage.getByText(r.excluded, { exact: true })).toBeVisible();
  await creatorPage.reload();
  await waitForHydratedPage(creatorPage);
  await expect(creatorPage.getByRole('heading', { name: r.title })).toHaveCount(0);
  const final = await roster(id);
  expect(final.filter((row) => row.participation_status === 'playing')).toHaveLength(8);
  expect(final.find((row) => row.user_id === excluded.id)).toMatchObject({
    lifecycle: 'expired',
    participation_status: null
  });
  const detail = await f.rpc(f.creator, 'get_match_event', { p_event_id: id });
  expect(Array.isArray(detail) ? detail[0] : detail).toMatchObject({
    playing_count: 8,
    group_count: 2,
    reconfirmation_required_count: 0
  });
});

test('cancellation notification opens safe cancelled match', async () => {
  const invitee = f.members[8]!;
  const accepted = f.members[0]!;
  const id = await f.event(4, [invitee]);
  await f.rpc(f.guest, 'submit_match_registration', { p_match_event_id: id });
  const page = await f.page(f.creator);
  await f.open(page, id);
  // Capture a real shipped server-action request; replay it directly after
  // cancellation to prove server enforcement independently from hidden controls.
  const editor = await edit(page);
  await editor
    .getByLabel(en.matchCreate.fields.venueName, { exact: true })
    .fill('Updated management court');
  const actionResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).origin === 'http://127.0.0.1:4173'
  );
  await editor.getByRole('button', { name: m.edit.save, exact: true }).click();
  const original = (await actionResponse).request();
  await expect(editor.getByRole('button', { name: m.edit.save, exact: true })).toBeDisabled();
  await editor.getByRole('button', { name: m.cancel, exact: true }).click();
  // The captured edit is setup for the direct-action security probe. Reload
  // its authoritative version before opening a separate cancellation intent;
  // a temporarily disabled Save button is not proof of loader invalidation.
  await f.open(page, id);
  await organizerMenu(page, m.cancelMatch);
  const cancel = page.getByRole('dialog');
  await cancel.getByLabel(m.cancelReason, { exact: true }).fill('Court closed by venue');
  await cancel.getByRole('button', { name: m.cancelMatch, exact: true }).click();
  await expect(cancel).toHaveCount(0);
  for (const actor of [invitee, f.guest, accepted]) {
    const recipientPage = await f.page(actor);
    await f.notice(recipientPage, actor, 'match_event_cancelled', id);
    await expect(
      recipientPage.getByText(m.unavailable.cancelled, { exact: true }).first()
    ).toBeVisible();
    for (const label of [
      invitation.accept,
      invitation.decline,
      m.leave,
      m.edit.title,
      m.actions,
      r.reviewTerms,
      en.matchRegistration.join.button,
      en.matchRegistration.join.requestButton
    ]) {
      await expect(recipientPage.getByRole('button', { name: label, exact: true })).toHaveCount(0);
    }
  }
  const forged = await page.request.fetch(original);
  expect(await forged.text()).toContain('cancelled');
  expect(
    await sql(`select version::text,status,venue_name from public.match_events where id='${id}'`)
  ).toEqual([{ version: '3', status: 'cancelled', venue_name: 'Updated management court' }]);
});

test('organizer can leave without transferring then transfer to Reserve', async () => {
  const id = await f.event(10);
  const target = f.members[8]!;
  const page = await f.page(f.creator);
  await f.open(page, id);
  await page.getByRole('button', { name: m.leave, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: m.confirm, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText(m.organizerOnly, { exact: true })).toBeVisible();
  expect(await sql(`select created_by::text from public.match_events where id='${id}'`)).toEqual([
    { created_by: f.creator.id }
  ]);
  expect((await roster(id)).find((row) => row.user_id === target.id)?.participation_status).toBe(
    'reserve'
  );
  await organizerMenu(page, m.transfer);
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(m.newOrganizer, { exact: true }).selectOption(target.id);
  await dialog.getByRole('button', { name: m.transfer, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: m.edit.title, exact: true })).toHaveCount(0);
  const targetPage = await f.page(target);
  await f.open(targetPage, id);
  await expect(targetPage.getByRole('button', { name: m.edit.title, exact: true })).toBeEnabled();
  expect(await sql(`select created_by::text from public.match_events where id='${id}'`)).toEqual([
    { created_by: target.id }
  ]);
});

test('stale minor edit keeps draft and requires review', async () => {
  const id = await f.event(4);
  const page = await f.page(f.creator);
  await f.open(page, id);
  const dialog = await edit(page);
  const field = dialog.getByLabel(en.matchCreate.fields.venueName, { exact: true });
  await field.fill('Unsaved court draft');
  await f.rpc(f.creator, 'edit_match_event', {
    p_match_event_id: id,
    p_expected_version: 1,
    p_patch: { notes: 'Another organizer tab saved this' },
    p_request_id: crypto.randomUUID()
  });
  await dialog.getByRole('button', { name: m.edit.save, exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(m.edit.conflictTitle);
  await expect(field).toHaveValue('Unsaved court draft');
  await expect(dialog.getByRole('button', { name: m.edit.save, exact: true })).toBeDisabled();
  // Conflict copy appears before the controller finishes router.invalidate().
  // Wait for its explicit idle control before asserting programmatic focus.
  await expect(dialog.getByRole('button', { name: m.edit.reload, exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: m.edit.reviewDraft, exact: true }).click();
  await expect(dialog.locator('input').first()).toBeFocused();
  await expect(field).toHaveValue('Unsaved court draft');
  expect(
    await sql(`select venue_name,version::text from public.match_events where id='${id}'`)
  ).toEqual([{ venue_name: 'Management court', version: '2' }]);
});

test('expired invitation cannot accept', async () => {
  const invitee = f.members[8]!;
  const id = await f.event(4, [invitee]);
  await f.cutoff(id);
  const page = await f.page(invitee);
  await f.notice(page, invitee, 'match_invitation_expired', id);
  await expect.soft(page.getByText(invitation.expired, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: invitation.accept, exact: true })).toHaveCount(0);
  const invites = await sql(
    `select id::text from public.match_event_invites where match_event_id='${id}' and invitee_user_id='${invitee.id}'`
  );
  const result = await f.rpc(invitee, 'respond_match_event_invitation', {
    p_match_event_id: id,
    p_invitation_id: invites[0]!.id,
    p_response: 'accept'
  });
  expect(result).toMatchObject({ status: 'expired' });
  expect((await roster(id)).some((row) => row.user_id === invitee.id)).toBe(false);
});

test('unavailable result state explains correction without dead link', async () => {
  const id = await f.event(4);
  await sql(`select public.protect_match_event_results('${id}')`);
  const page = await f.page(f.creator);
  await f.open(page, id);
  const banner = page.getByRole('region', {
    name: en.matches.detail.statusTitles.result_protected,
    exact: true
  });
  await expect(
    banner.getByRole('heading', {
      level: 2,
      name: en.matches.detail.statusTitles.result_protected,
      exact: true
    })
  ).toBeVisible();
  await expect(banner.getByRole('status')).toHaveText(
    [
      m.unavailable.resultProtected,
      m.unavailable.correctionExplanation,
      m.unavailable.correctionUnavailable
    ].join(' ')
  );
  await expect(page.getByRole('link', { name: /correction|dispute/i })).toHaveCount(0);
  for (const label of [m.leave, m.actions, m.edit.title])
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveCount(0);
  const denied = await f.creator.client.rpc('edit_match_event', {
    p_match_event_id: id,
    p_expected_version: 1,
    p_patch: { notes: 'Forbidden' },
    p_request_id: crypto.randomUUID()
  });
  expect(denied.error?.message).toContain('MATCH_MANAGEMENT_RESULT_PROTECTED');
});
