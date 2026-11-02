import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { day, leagueFixtures } from './leagues-fixtures';
import { en, organizerMenu } from './matches-management-fixtures';
import {
  correctTeams,
  enterScore,
  fill,
  openRecord,
  review,
  sql
} from './matches-results-fixtures';

// PAF-11 Ranked acceptance (U5.1, AC2-AC8, AC10, AC13, AC15). Real routes/RPCs; trusted SQL is
// used for setup and time anchors only (past events/membership history), never to assert outcomes.
const m = en.matches;
const edit = m.management.edit;
const comp = en.matchCreate.competition;
const mc = en.matchCreate;
const MAILPIT_URL = 'http://127.0.0.1:55324';
const venue = (name: string) => `Ranked E2E ${name}`;

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

let f: Awaited<ReturnType<typeof leagueFixtures>>;
let spring: string;
let summer: string;
const addedEmails: string[] = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await leagueFixtures(browser, { memberCount: 8, communityName: 'Ranked Club' });
  // Upcoming League covering the default event day (+3): the only eligible League at first.
  spring = await f.createLeague(f.members[0]!, {
    name: 'Spring League',
    start: day(1),
    end: day(30)
  });
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  const ids = (email: string) => `(select id from auth.users where email='${email}')`;
  for (const email of addedEmails)
    await sql(`do $$ begin
      delete from public.match_player_add_recipient_sends where operation_id in (select id from public.match_player_add_operations where actor_id='${f.creator.id}');
      delete from public.match_player_add_throttle_hits where actor_id='${f.creator.id}';
      delete from public.match_player_add_actor_windows where actor_id='${f.creator.id}';
      delete from public.match_player_add_operations where actor_id='${f.creator.id}';
      alter table public.player_rating_initializations disable trigger player_rating_initializations_immutable;
      delete from public.player_rating_initializations where user_id in ${ids(email)};
      alter table public.player_rating_initializations enable trigger player_rating_initializations_immutable;
      alter table public.player_profiles disable trigger player_profile_provenance_guard;
      delete from public.player_profiles where user_id in ${ids(email)};
      alter table public.player_profiles enable trigger player_profile_provenance_guard;
      alter table public.community_members disable trigger community_member_guard;
      delete from public.community_members where user_id in ${ids(email)};
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  await f?.cleanup();
  for (const email of addedEmails)
    await sql(`do $$ begin delete from auth.users where email='${email}'; end $$;`);
});
test.beforeEach(() => {
  test.setTimeout(120_000);
});

/** A real, decodable 1x1 PNG, as in the wizard journeys of matches.spec.ts. */
const png = () =>
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );

async function startWizard(page: Page, options: { name: string; date?: string; time?: string }) {
  await page.goto('/matches/create');
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: mc.title })).toBeVisible();
  await page.getByLabel(mc.fields.date).fill(options.date ?? day(3));
  await page.getByLabel(mc.fields.startTime).fill(options.time ?? '19:00');
  await page.getByLabel(mc.fields.type).selectOption('competitive');
  await page.getByLabel(mc.fields.venueName).fill(venue(options.name));
  await page
    .getByLabel(mc.fields.mapsUrl)
    .fill(`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(options.name)}`);
  await page
    .getByLabel(mc.fields.photo)
    .setInputFiles({ name: 'venue.png', mimeType: 'image/png', buffer: png() });
  await expect(page.getByRole('button', { name: mc.photo.remove })).toBeVisible({
    timeout: 15_000
  });
}

const competition = (page: Page) => page.getByRole('group', { name: comp.legend });
const rankedRadio = (page: Page) =>
  competition(page).getByRole('radio', { name: m.competition.ranked, exact: true });
const unrankedRadio = (page: Page) =>
  competition(page).getByRole('radio', { name: m.competition.unranked, exact: true });

async function continueToReview(page: Page) {
  await page.getByRole('button', { name: mc.next }).click();
  await expect(page.getByText(mc.steps.players, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: mc.next }).click();
  await expect(page.getByText(mc.steps.teams, { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: m.teamMode.POST_MATCH_TEAMS }).check();
  await page.getByRole('button', { name: mc.next }).click();
  await expect(page.getByRole('heading', { name: mc.review })).toBeVisible();
}

async function continueToReviewAndPublish(page: Page) {
  await continueToReview(page);
  await page.getByRole('button', { name: mc.publish }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await waitForHydratedPage(page);
}

async function eventIdByVenue(name: string) {
  const [row] = await sql(
    `select id::text, league_id::text from public.match_events where venue_name='${venue(name)}' and community_id='${f.community}'`
  );
  if (!row) throw new Error(`Event ${name} was not published`);
  return {
    id: typeof row.id === 'string' ? row.id : '',
    league_id: typeof row.league_id === 'string' ? row.league_id : null
  };
}

async function openEdit(page: Page) {
  await page.getByRole('button', { name: m.management.edit.title, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: edit.title, exact: true })).toBeVisible();
  return dialog;
}

const optionValue = (scope: ReturnType<Page['locator']>, text: string) =>
  scope.locator('option', { hasText: text }).getAttribute('value');

test('Competitive event defaults to Ranked in the one eligible Upcoming League (AC2)', async () => {
  const page = await f.page(f.creator);
  await startWizard(page, { name: 'default' });
  await expect(competition(page)).toBeVisible();
  await expect(rankedRadio(page)).toBeChecked();
  const select = competition(page).getByRole('combobox', { name: comp.league, exact: true });
  await expect(select).toHaveValue(spring);
  await expect(competition(page)).toContainText(comp.guidance.defaultOne);
  await expect(competition(page)).toContainText(comp.members);
  await continueToReviewAndPublish(page);

  const published = await eventIdByVenue('default');
  expect(published.league_id).toBe(spring);
  await page.goto(`/matches/${published.id}`);
  await waitForHydratedPage(page);
  await expect(page.getByText(m.competition.ranked, { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Spring League').first()).toBeVisible();
});

test('overlapping Upcoming Leagues need an explicit choice; explicit Unranked persists (AC3)', async () => {
  summer = await f.createLeague(f.members[0]!, {
    name: 'Summer League',
    start: day(2),
    end: day(20)
  });
  const page = await f.page(f.creator);
  await startWizard(page, { name: 'choose' });
  await expect(rankedRadio(page)).toBeChecked();
  await expect(competition(page)).toContainText(comp.guidance.chooseOne);
  const select = competition(page).getByRole('combobox', { name: comp.league, exact: true });
  await expect(select).toHaveValue('');
  await expect(select.getByRole('option', { name: comp.choose })).toBeAttached();

  // Publishing without choosing is refused, with an associated alert.
  await continueToReview(page);
  await page.getByRole('button', { name: mc.publish }).click();
  await expect(competition(page).getByRole('alert')).toContainText(mc.errors.leagueRequired);
  await expect(select).toHaveAttribute('aria-invalid', 'true');

  await select.selectOption(await optionValue(select, 'Summer League'));
  await expect(select).toHaveValue(summer);
  await continueToReviewAndPublish(page);
  const chosen = await eventIdByVenue('choose');
  expect(chosen.league_id).toBe(summer);

  // Explicit opt-out survives a schedule change and option reloads.
  await startWizard(page, { name: 'optout' });
  await unrankedRadio(page).check();
  await page.getByLabel(mc.fields.startTime).fill('20:30');
  await page.getByLabel(mc.fields.date).fill(day(4));
  await expect(unrankedRadio(page)).toBeChecked();
  await expect(
    competition(page).getByRole('combobox', { name: comp.league, exact: true })
  ).toHaveCount(0);
  await continueToReviewAndPublish(page);
  const optedOut = await eventIdByVenue('optout');
  expect(optedOut.league_id).toBeNull();
  await page.goto(`/matches/${optedOut.id}`);
  await waitForHydratedPage(page);
  await expect(page.getByText(m.competition.unranked, { exact: true }).first()).toBeVisible();
});

test('Public guest can request only Unranked matches; Ranked is members-only (AC4)', async () => {
  const rankedId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId: spring,
    venue: venue('guest-ranked')
  });
  const unrankedId = await f.publish(f.creator, { venue: venue('guest-unranked') });
  const guestPage = await f.page(f.guest);

  await f.open(guestPage, rankedId);
  await expect(guestPage.getByText(m.detail.rankedMembersOnly).first()).toBeVisible();
  await expect(
    guestPage.getByRole('button', { name: en.matchRegistration.join.requestButton })
  ).toHaveCount(0);
  const denied = await f.guest.client.rpc('submit_match_registration', {
    p_match_event_id: rankedId
  });
  expect(denied.error).not.toBeNull();
  expect(await f.registrations(rankedId)).not.toContainEqual(
    expect.objectContaining({ user_id: f.guest.id })
  );

  await f.open(guestPage, unrankedId);
  await guestPage
    .getByRole('button', { name: en.matchRegistration.join.requestButton, exact: true })
    .click();
  await expect
    .poll(async () => (await f.registrations(unrankedId)).some((r) => r.user_id === f.guest.id))
    .toBe(true);
});

test('accepted non-member blocks Ranked conversion until resolved (AC5)', async () => {
  const eventId = await f.publish(f.creator, { venue: venue('convert') });
  await f.rpc(f.guest, 'submit_match_registration', { p_match_event_id: eventId });
  const attempt = await f.attempt(eventId, f.guest);
  await f.rpc(f.creator, 'decide_match_registration', {
    p_match_event_id: eventId,
    p_attempt_id: attempt,
    p_decision: 'approve'
  });

  const page = await f.page(f.creator);
  await f.open(page, eventId);
  const dialog = await openEdit(page);
  await rankedRadioIn(dialog).check();
  await dialog.getByRole('combobox', { name: comp.league, exact: true }).selectOption(spring);
  await dialog.getByRole('button', { name: edit.save, exact: true }).click();
  const rejection = dialog.getByRole('alert').filter({
    hasText: edit.rejection.ranked_nonmembers_accepted.title
  });
  await expect(rejection).toBeVisible();
  await expect(rejection).toContainText(
    fill(edit.rejection.ranked_nonmembers_accepted.description_one, { count: 1 })
  );
  // Atomic rejection: event, roster and generations unchanged.
  expect((await f.eventRow(eventId))?.league_id).toBeNull();
  await rejection.getByRole('button', { name: edit.rejection.keepUnranked, exact: true }).click();
  await expect(unrankedRadioIn(dialog)).toBeChecked();
});

function rankedRadioIn(scope: ReturnType<Page['locator']>) {
  return scope.getByRole('radio', { name: m.competition.ranked, exact: true });
}
function unrankedRadioIn(scope: ReturnType<Page['locator']>) {
  return scope.getByRole('radio', { name: m.competition.unranked, exact: true });
}

test('date outside the League period: rejection, explicit Unranked repair, participant reconfirmation (AC7, AC8)', async () => {
  const eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId: spring,
    venue: venue('move')
  });
  const players = f.members.slice(0, 3);
  for (const player of players)
    await f.rpc(player, 'submit_match_registration', { p_match_event_id: eventId });
  const before = await f.eventRow(eventId);

  const creatorPage = await f.page(f.creator);
  await f.open(creatorPage, eventId);
  const dialog = await openEdit(creatorPage);
  await dialog.getByLabel(en.matchCreate.fields.startsAt, { exact: true }).fill(`${day(90)}T19:00`);
  await dialog.getByRole('button', { name: edit.save, exact: true }).click();

  const rejection = dialog.getByRole('alert').filter({
    hasText: edit.rejection.league_out_of_period.title
  });
  await expect(rejection).toBeVisible();
  await expect(rejection).toContainText('Spring League');
  // Both repair choices are offered; nothing was saved and the League was not changed.
  await expect(
    rejection.getByRole('button', { name: edit.rejection.adjustDate, exact: true })
  ).toBeVisible();
  await expect(
    rejection.getByRole('button', { name: edit.rejection.saveUnranked, exact: true })
  ).toBeVisible();
  expect(await f.eventRow(eventId)).toEqual(before);
  for (const row of await f.registrations(eventId))
    expect(row.required_generation).toBe(row.confirmed_generation);

  // Explicit Unranked repair keeps the new date and sends participants to reconfirmation.
  await rejection.getByRole('button', { name: edit.rejection.saveUnranked, exact: true }).click();
  await expect(dialog.getByRole('button', { name: edit.save, exact: true })).toBeDisabled();
  const after = await f.eventRow(eventId);
  expect(after?.league_id).toBeNull();
  expect(after?.starts_at).not.toBe(before?.starts_at);
  const rows = await f.registrations(eventId);
  expect(rows.filter((row) => row.required_generation !== row.confirmed_generation)).toHaveLength(
    4
  );

  const memberPage = await f.page(players[0]!);
  await f.open(memberPage, eventId);
  await memberPage.getByRole('button', { name: m.reconfirmation.reviewTerms, exact: true }).click();
  const terms = memberPage.getByRole('dialog');
  await expect(terms).toContainText(m.leagueImpact.title);
  await expect(terms).toContainText(m.leagueImpact.effect.rankedToUnranked);
  await terms.getByRole('button', { name: m.reconfirmation.confirm, exact: true }).click();
  await expect(memberPage.getByRole('dialog')).toHaveCount(0);
  const confirmed = (await f.registrations(eventId)).find((row) => row.user_id === players[0]!.id);
  expect(confirmed?.required_generation).toBe(confirmed?.confirmed_generation);
});

async function mailpitJson(response: Awaited<ReturnType<APIRequestContext['get']>>) {
  const body: unknown = await response.json();
  if (typeof body !== 'object' || body === null) throw new Error('Unexpected Mailpit response');
  return Object.fromEntries(Object.entries(body));
}

async function invitationLink(request: APIRequestContext, email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  const found = async () => {
    const messages = (
      await mailpitJson(await request.get(`${MAILPIT_URL}/api/v1/search?query=${query}`))
    ).messages;
    if (!Array.isArray(messages)) throw new Error('Unexpected Mailpit search response');
    return messages;
  };
  await expect.poll(async () => (await found()).length).toBe(1);
  const messages = await found();
  const message = await request.get(
    `${MAILPIT_URL}/api/v1/message/${String(Reflect.get(messages[0], 'ID'))}`
  );
  const html = (await mailpitJson(message)).HTML;
  if (typeof html !== 'string') throw new Error('Unexpected Mailpit message response');
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) =>
    match[1]!.replaceAll('&amp;', '&')
  );
  expect(links).toHaveLength(1);
  return links[0]!;
}

test('provisional player joins a Ranked event, is carried on League change and keeps counters across claim (AC10, AC13, AC15)', async ({
  browser,
  request
}) => {
  test.setTimeout(240_000);
  const eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId: spring,
    venue: venue('provisional')
  });
  for (const player of f.members.slice(0, 2))
    await f.rpc(player, 'submit_match_registration', { p_match_event_id: eventId });

  // Organizer adds a provisional player to the Ranked event through the real dialog.
  const email = `ranked-prov-${crypto.randomUUID()}@test.local`;
  addedEmails.push(email);
  const organizer = await f.page(f.creator);
  await f.open(organizer, eventId);
  await organizerMenu(organizer, m.addPlayer.action);
  const add = organizer.getByRole('dialog', { name: m.addPlayer.title });
  await add.getByLabel(m.addPlayer.nameLabel).fill('Carla Convidada');
  await add.getByLabel(m.addPlayer.emailLabel).fill(email);
  await add.getByRole('slider').fill('3.5');
  await add.getByRole('button', { name: m.addPlayer.submit, exact: true }).click();
  await expect(add).toHaveCount(0);
  await expect(organizer.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(1);
  const [provisional] = await sql(
    `select r.user_id::text as id, r.lifecycle::text, p.is_provisional::text as provisional,
            (select league_id::text from public.match_events where id='${eventId}') as league
       from public.match_event_registrations r join public.player_profiles p on p.user_id=r.user_id
      where r.match_event_id='${eventId}' and p.display_name='Carla Convidada'`
  );
  expect(provisional).toMatchObject({ lifecycle: 'accepted', provisional: 'true', league: spring });
  const userId = String(provisional?.id);

  // Provisional member shows in the League participants with the badge and zero counters.
  const leagueUrl = `/community/${f.community}/leagues/${spring}`;
  // The full statistics table lives in a collapsed "All statistics" disclosure.
  const participant = async (page: Page, name: string) => {
    const table = page.getByRole('region', { name: en.leagues.standings.tableLabel });
    if (!(await table.isVisible()))
      await page.getByText(en.leagues.standings.allStats, { exact: true }).click();
    await expect(table).toBeVisible();
    return table.getByRole('row').filter({ hasText: name });
  };
  await organizer.goto(leagueUrl);
  await waitForHydratedPage(organizer);
  const entry = await participant(organizer, 'Carla Convidada');
  await expect(entry).toContainText(en.player.provisional.badge);
  await expect(entry.getByRole('cell').nth(1)).toHaveText('0');

  // League change is a major edit: registered players must reconfirm, the provisional one is
  // carried over automatically (both generations advance together, nobody blocked).
  await f.open(organizer, eventId);
  const dialog = await openEdit(organizer);
  await dialog.getByRole('combobox', { name: comp.league, exact: true }).selectOption(summer);
  await dialog.getByRole('button', { name: edit.save, exact: true }).click();
  await expect(dialog.getByRole('button', { name: edit.save, exact: true })).toBeDisabled();
  expect((await f.eventRow(eventId))?.league_id).toBe(summer);
  const rows = await f.registrations(eventId);
  const carried = rows.find((row) => row.user_id === userId)!;
  expect(carried.required_generation).toBe(carried.confirmed_generation);
  expect(carried.participation_status).not.toBeNull();
  const registered = rows.filter((row) => row.user_id !== userId);
  expect(registered).toHaveLength(3);
  for (const row of registered) expect(row.required_generation).not.toBe(row.confirmed_generation);

  // Verified claim through the real invitation link: same identity, badge gone, counters stable,
  // and the claim adds no consent debt.
  const link = await invitationLink(request, email);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block'
  });
  try {
    const player = await context.newPage();
    await player.goto(link);
    await expect(player).toHaveURL(/\/onboarding\?next=/);
    await waitForHydratedPage(player);
    await player.getByLabel(en.onboarding.name).fill('Carla Reclamada');
    await player.getByLabel(en.onboarding.sideLeftShort).first().check();
    await player.getByRole('button', { name: en.auth.claim.submit }).click();
    await expect(
      player.getByRole('heading', { level: 1, name: en.auth.claim.passwordTitle })
    ).toBeVisible();
    const password = 'Claim-pass-9!';
    await player.getByLabel(en.auth.resetNewPasswordLabel, { exact: true }).fill(password);
    await player.getByLabel(en.auth.resetConfirmPasswordLabel, { exact: true }).fill(password);
    await player.getByRole('button', { name: en.auth.resetSubmit }).click();
    await expect(player).toHaveURL(new RegExp(`/matches/${eventId}$`));
  } finally {
    await context.close();
  }
  const afterClaim = (await f.registrations(eventId)).find((row) => row.user_id === userId)!;
  expect(afterClaim).toEqual(carried);
  await organizer.goto(`/community/${f.community}/leagues/${summer}`);
  await waitForHydratedPage(organizer);
  const claimed = await participant(organizer, 'Carla Reclamada');
  await expect(claimed).toBeVisible();
  await expect(claimed).not.toContainText(en.player.provisional.badge);
  await expect(claimed.getByRole('cell').nth(1)).toHaveText('0');
});

test('invalid Ranked result is rejected, then blocked visibly with a correction path (AC6)', async () => {
  test.setTimeout(240_000);
  const r = m.results;
  const eventId = await f.publish(f.creator, {
    competition: 'ranked',
    leagueId: spring,
    venue: venue('result')
  });
  for (const player of f.members.slice(0, 7))
    await f.rpc(player, 'submit_match_registration', { p_match_event_id: eventId });
  // Time anchors only: the League and the event move into the past; the real result flow runs.
  await f.cutoff(eventId);
  await sql(`do $$ begin
    update public.leagues set start_at='2026-10-01T00:00:00Z', end_at='2026-12-31T23:59:59Z' where id='${spring}';
    alter table public.match_events disable trigger match_event_immutable;
    alter table public.match_events disable trigger match_event_league_binding;
    update public.match_events set starts_at='2026-10-23T17:00:00Z', registration_cutoff_at='2026-10-23T16:00:00Z'
      where id='${eventId}';
    alter table public.match_events enable trigger match_event_league_binding;
    alter table public.match_events enable trigger match_event_immutable;
  end $$;`);
  const page = await f.page(f.creator);
  // Memberships began today, so nobody was an active member at the played time.
  await openRecord(page, eventId);
  await correctTeams(page);
  await enterScore(page);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByText(r.errors.rankedMembership).first()).toBeVisible();
  expect(
    await sql(`select 1 from public.match_event_result_proposals where match_event_id='${eventId}'`)
  ).toHaveLength(0);

  // Backdate the memberships (truthful history), then the same submission is accepted...
  await sql(`do $$ begin
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set valid_from='2026-10-01T00:00:00Z', activated_at='2026-10-01T00:00:00Z'
      where community_id='${f.community}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  await openRecord(page, eventId);
  await correctTeams(page);
  await enterScore(page);
  await review(page);
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByRole('region', { name: r.pending })).toBeVisible();

  // ...and a participant whose membership ended before the played time blocks the group.
  await sql(`do $$ begin
    alter table public.community_members disable trigger community_member_guard;
    update public.community_members set status='inactive', valid_until='2026-10-10T00:00:00Z'
      where community_id='${f.community}' and user_id='${f.members[0]!.id}';
    alter table public.community_members enable trigger community_member_guard;
  end $$;`);
  await f.open(page, eventId);
  const blocked = page.getByRole('region', { name: r.rankedBlocked.title });
  await expect(blocked).toBeVisible();
  await expect(blocked).toContainText(r.rankedBlocked.resolution);
  await blocked.getByRole('link', { name: r.correctResult, exact: true }).click();
  await expect(page).toHaveURL(/correctionProposalId=/);
  await waitForHydratedPage(page);
  await expect(page.getByRole('heading', { name: r.correctTitle, exact: true })).toBeVisible();
  expect(
    await sql(
      `select 1 from public.match_event_result_confirmations where match_event_id='${eventId}'`
    )
  ).toHaveLength(0);
});
