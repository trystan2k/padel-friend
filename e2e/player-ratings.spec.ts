import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { testMailpitUrl } from './test-supabase-config';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import { waitForHydratedPage } from './auth-helpers';
import { acquireRatingSuite, releaseRatingSuite } from './rating-suite-lock';
import {
  confirmGroup,
  eventCount,
  finalize,
  ledger,
  pastEvent,
  removeProvisionalEvidence,
  reserveRegistration,
  review as reviewRow,
  secondCommunity,
  states,
  submitGroup,
  type Quartet
} from './player-ratings-fixtures';
import {
  copies,
  enterScore,
  fill,
  openRecord,
  resultFixtures,
  review,
  sql,
  sqlWithFixtureTriggersDisabled,
  type Actor,
  type Locale
} from './matches-results-fixtures';
import { en, organizerMenu } from './matches-management-fixtures';

type Fixtures = Awaited<ReturnType<typeof resultFixtures>>;
let f: Fixtures;
const provisionalEmails: string[] = [];
let cross: Awaited<ReturnType<typeof secondCommunity>> | undefined;
const rating = copies.en.rating;
// enterScore() plays the UI-submitted group at this instant.
const PLAYED_AT = '2026-10-23T18:30:00Z';
const r = copies.en.matches.results;

test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(1_500_000);
  await acquireRatingSuite();
  f = await resultFixtures(browser, { memberCount: 10 });
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await cross?.cleanup();
  // Events and the rating evidence of every player go in one transaction; only then the leftovers.
  await f?.cleanup();
  await removeProvisionalEvidence(provisionalEmails);
  for (const email of provisionalEmails)
    await sql(`do $$ begin
      delete from public.match_player_add_recipient_sends where operation_id in (select id from public.match_player_add_operations where actor_id='${f.creator.id}');
      delete from public.match_player_add_throttle_hits where actor_id='${f.creator.id}';
      delete from public.match_player_add_actor_windows where actor_id='${f.creator.id}';
      delete from public.match_player_add_operations where actor_id='${f.creator.id}';
      alter table public.player_profiles disable trigger player_profile_provenance_guard;
      delete from public.player_profiles where user_id in (select id from auth.users where email='${email}');
      alter table public.player_profiles enable trigger player_profile_provenance_guard;
      alter table public.community_members disable trigger community_member_guard;
      delete from public.community_members where user_id in (select id from auth.users where email='${email}');
      alter table public.community_members enable trigger community_member_guard;
    end $$;`);
  for (const email of provisionalEmails)
    await sql(`do $$ begin delete from auth.users where email='${email}'; end $$;`);
});
// Declared after the cleanup hook so the suite lock is released last.
test.afterAll(releaseRatingSuite);
test.beforeEach(() => test.setTimeout(180_000));
// Every f.page() opens a signed-in context that the shared fixture keeps until suite cleanup.
// Release each test's browsers right away (actors and community stay): the serial suite otherwise
// holds 20+ live renderers beside the CI workers, starving later tests of CPU and memory.
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

// --- helpers -----------------------------------------------------------------------------

const level = (value: number, locale: Locale = 'en') =>
  new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value
  );
const signed = (value: number, locale: Locale = 'en') =>
  new Intl.NumberFormat(locale, {
    signDisplay: 'exceptZero',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
const percent = (value: number, locale: Locale = 'en') =>
  new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(value / 100);
const day = (instant: string, locale: Locale = 'en') =>
  new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(instant)
  );

const ids = (...actors: Actor[]) => actors.map((actor) => actor.id);
const quartet = (a: Actor, b: Actor, c: Actor, d: Actor): Quartet => [a.id, b.id, c.id, d.id];

/** Captures every rating response body so privacy can be asserted on the wire. */
function watchRatingResponses(page: Page) {
  const bodies: string[] = [];
  page.on('response', (response) => {
    if (/_serverFn|rating/i.test(response.url()))
      void response
        .text()
        .then((text) => {
          // Only rating DTOs: other server functions have their own (older) contracts.
          if (/display_level|calculation_revision|game_group_id/.test(text)) bodies.push(text);
        })
        .catch(() => undefined);
  });
  return bodies;
}

function assertNoPrivateFields(texts: readonly string[], forbidden: readonly string[]) {
  for (const text of texts) {
    for (const value of forbidden) expect(text).not.toContain(value);
    expect(text).not.toMatch(/invited_by|inviter|added_by|claim_proof|reason_note|"email"/);
  }
}

/**
 * Raw server-rendered HTML (including the dehydrated loader payload) fetched with the page's
 * session, so privacy is asserted on what the server sent before any hydration runs.
 */
async function ssrHtml(page: Page, path = '/dashboard') {
  const response = await page.context().request.get(path);
  expect(response.status(), `${path} SSR status`).toBe(200);
  const html = await response.text();
  expect(html, 'SSR returned the app document').toContain('<html');
  return html;
}

async function journey(page: Page, locale: Locale = 'en') {
  const region = page.getByRole('region', { name: copies[locale].rating.journey.title });
  await expect(region).toBeVisible();
  return region;
}

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow, 'horizontal overflow').toBeLessThanOrEqual(0);
}

async function touchTargets(root: Locator) {
  const sizes = await root.locator('button, a').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent?.trim(), width: rect.width, height: rect.height };
    })
  );
  for (const size of sizes) {
    expect.soft(size.height, `${size.text} height`).toBeGreaterThanOrEqual(44);
    expect.soft(size.width, `${size.text} width`).toBeGreaterThanOrEqual(44);
  }
}

/**
 * Opens the stored-values explanation. The dialog is bound to the GLOBAL committed rating
 * projection revision (control row), so any confirmation or level-review decision committed by
 * a concurrent worker between page load and open legitimately yields the product's stale alert
 * instead of numbers (the deterministic stale path is covered by the dedicated "stale
 * explanation" test below). Recover through the product's own Reload action, then reopen
 * against the refreshed revision; bounded, no sleeps.
 */
async function openExplanation(page: Page, trigger: Locator, locale: Locale) {
  const copy = copies[locale].rating;
  const dialog = page.getByRole('dialog', { name: copy.explanation.title });
  for (let attempt = 0; attempt < 5; attempt++) {
    await trigger.focus();
    await trigger.press('Enter');
    await expect(dialog).toBeVisible();
    const stale = dialog.getByRole('alert').filter({ hasText: copy.errors.stale_revision });
    await expect(stale.or(dialog.getByRole('listitem').first())).toBeVisible();
    if (!(await stale.isVisible())) {
      await expect(dialog.getByText(copy.explanation.loading)).toHaveCount(0);
      return dialog;
    }
    await dialog.getByRole('button', { name: copy.errors.reload }).click();
    await expect(dialog).toBeHidden();
  }
  throw new Error('Rating explanation stayed stale after 5 reloads');
}

async function closeWithKeyboard(page: Page, dialog: Locator, trigger: Locator) {
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}

async function teamsOf(proposalEventId: string) {
  const proposals = await f.rpc(f.creator, 'get_match_event_result_proposals', {
    p_match_event_id: proposalEventId
  });
  const parsed = parseResultProposals(proposals);
  const first = parsed?.[0];
  if (!first) throw new Error('Expected a proposal');
  return {
    team_a: first.teams.team_a.map((p) => p.user_id),
    team_b: first.teams.team_b.map((p) => p.user_id)
  };
}

function actorFor(userId: string): Actor {
  const actor = [f.creator, ...f.members, f.guest].find((candidate) => candidate.id === userId);
  if (!actor) throw new Error(`No fixture actor ${userId}`);
  return actor;
}

// --- AC1/AC4/AC6: real manual confirmation through the UI --------------------------------

test('manual confirmation changes the level; dashboard, history and explanation show the stored numbers', async ({
  browserName,
  request
}) => {
  expect(browserName).toBe('chromium');
  const players = [f.creator, f.members[0]!, f.members[1]!, f.members[2]!];
  const before = await states(ids(...players));
  expect(before).toHaveLength(4);
  const eventId = await f.completedEvent('competitive', 4);

  const submitter = await f.page(f.creator);
  await openRecord(submitter, eventId);
  await enterScore(submitter, [
    [6, 4, true],
    [6, 3, true]
  ]);
  await review(submitter);
  await submitter.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(submitter.getByText(r.pending, { exact: true })).toBeVisible();

  const teams = await teamsOf(eventId);
  const mine = teams.team_a.includes(f.creator.id) ? 'team_a' : 'team_b';
  const opposing = actorFor(teams[mine === 'team_a' ? 'team_b' : 'team_a'][0]!);
  expect(await eventCount(ids(...players))).toBe(0);

  const reviewer = await f.page(opposing);
  const privacy = watchRatingResponses(reviewer);
  await f.open(reviewer, eventId);
  const card = reviewer.getByRole('article', { name: fill(r.group, { number: 1 }), exact: true });
  await card.getByRole('button', { name: r.review.approve, exact: true }).click();
  await expect(card).toHaveAttribute('data-result-status', 'confirmed');

  // Result-detail entry point: per-player changes for the four who played.
  const changes = reviewer.getByRole('heading', { name: rating.changes.title });
  await expect(changes).toBeVisible();
  const section = changes.locator('xpath=..');
  await expect(section.getByRole('listitem')).toHaveCount(4);
  const ownEntry = section.getByRole('button', {
    name: fill(rating.changes.explainLabel, { name: opposing.name, number: 1 })
  });
  const detailDialog = await openExplanation(reviewer, ownEntry, 'en');
  await expect(detailDialog.getByRole('listitem').filter({ hasText: opposing.name })).toBeVisible();
  await closeWithKeyboard(reviewer, detailDialog, ownEntry);
  assertNoPrivateFields(privacy, [f.creator.email, opposing.email]);

  // One logical event per played participant, stored once.
  expect(await eventCount(ids(...players))).toBe(4);
  const mineLedger = await ledger(f.creator.id);
  expect(mineLedger).toHaveLength(1);
  const event = mineLedger[0]!;
  expect(event.calculations).toBe(1);
  expect(event.after).not.toBe(event.before); // first ratable group moves the level
  expect(event.after).toBeCloseTo(event.before + event.delta, 2);

  // Dashboard: summary, chart text equivalent, history row, explanation with stored values.
  const page = await f.page(f.creator, 'en', 390, 'light', 844);
  const wire = watchRatingResponses(page);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  await expect(page.getByText(level(event.after), { exact: true }).first()).toBeVisible();

  // SSR: the owner's HTML already carries the stored rating (so this inspects real server
  // output, not the hydrated DOM) and none of the other players' or adder/claim private data.
  const html = await ssrHtml(page);
  expect(html).toContain(rating.journey.title);
  expect(html).toContain(level(event.after));
  assertNoPrivateFields(
    [html],
    [opposing.email, f.members[0]!.email, f.members[1]!.email, f.members[2]!.email]
  );
  // The assertion is live: a leaked marker or address in the same HTML would fail it.
  expect(() => assertNoPrivateFields([`${html}"invited_by":"x"`], [])).toThrow();
  expect(() => assertNoPrivateFields([html], [f.creator.name])).toThrow();
  // Anonymous access to the protected route never serves rating data (redirected, not rendered).
  const anonymousResponse = await request.get('/dashboard');
  const anonymousHtml = await anonymousResponse.text();
  expect(anonymousHtml).not.toMatch(/display_level|calculation_revision|game_group_id/);
  expect(anonymousHtml).not.toContain(rating.journey.title);
  expect(anonymousHtml).not.toContain(level(event.after));
  expect(anonymousHtml).not.toContain(f.creator.email);

  const region = await journey(page);
  await expect(
    region.getByText(
      fill(rating.progress.summary_one, {
        count: 1,
        from: day(PLAYED_AT),
        to: day(PLAYED_AT),
        start: level(event.before),
        end: level(event.after)
      })
    )
  ).toBeVisible();
  await region.getByRole('button', { name: rating.progress.showTable }).click();
  const table = region.getByRole('table', { name: rating.progress.tableCaption });
  await expect(table.getByRole('row')).toHaveCount(3); // header + baseline + one game
  await expect(table.getByRole('row').nth(2)).toContainText(level(event.after));

  const rows = region
    .getByRole('listitem')
    .filter({ hasText: fill(rating.history.groupTitle, { number: 1 }) });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText(signed(event.delta));
  await expect(rows.first()).toContainText(
    fill(rating.history.levelChange, { before: level(event.before), after: level(event.after) })
  );
  await expect(
    region.getByText(fill(rating.history.showing_one, { shown: 1, count: 1 }))
  ).toBeVisible();

  const trigger = rows.first().getByRole('button');
  const dialog = await openExplanation(page, trigger, 'en');
  const own = dialog.getByRole('listitem').filter({ hasText: f.creator.name }).first();
  await expect(own).toContainText(
    fill(rating.explanation.transition, { before: level(event.before), after: level(event.after) })
  );
  await expect(own).toContainText(signed(event.delta));
  await expect(own).toContainText(
    new Intl.NumberFormat('en', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(
      Number(event.explanation['own_team_strength'])
    )
  );
  await expect(dialog.getByText(rating.explanation.expectedHint)).toBeVisible();
  await closeWithKeyboard(page, dialog, trigger);

  // Mobile geometry + touch targets, then a refresh adds nothing.
  await noOverflow(page);
  await touchTargets(region);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(rows).toHaveCount(1);
  expect(await eventCount(ids(...players))).toBe(4);
  assertNoPrivateFields(wire, [opposing.email, f.members[3]!.email]);
  expect(consoleErrors.filter((text) => /hydrat/i.test(text))).toEqual([]);

  // Same stored explanation in every locale: formatting, copy and focus handling.
  for (const locale of ['pt-BR', 'es'] as const) {
    const localized = await f.page(f.creator, locale, 390, 'dark', 844);
    const errors: string[] = [];
    localized.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await localized.goto('/dashboard');
    await waitForHydratedPage(localized);
    await expect(localized.locator('html')).toHaveAttribute('lang', locale);
    const copy = copies[locale].rating;
    const localRegion = await journey(localized, locale);
    const row = localRegion.getByRole('listitem').filter({ hasText: signed(event.delta, locale) });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(
      fill(copy.history.levelChange, {
        before: level(event.before, locale),
        after: level(event.after, locale)
      })
    );
    await expect(row).toContainText(
      fill(copy.history.reliabilityChange, {
        before: percent(event.before_reliability, locale),
        after: percent(event.after_reliability, locale)
      })
    );
    const localTrigger = row.getByRole('button');
    const localDialog = await openExplanation(localized, localTrigger, locale);
    await expect(localDialog.getByText(copy.explanation.expectedHint)).toBeVisible();
    await closeWithKeyboard(localized, localDialog, localTrigger);
    await noOverflow(localized);
    expect(errors.filter((text) => /hydrat/i.test(text))).toEqual([]);
  }
});

// --- AC4: automatic confirmation is equivalent; retries add nothing -----------------------

test('AUTO_48H and MANUAL confirmation store equivalent calculations; retries and refresh add nothing', async () => {
  const manualPlayers = quartet(f.members[3]!, f.members[4]!, f.members[5]!, f.members[6]!);
  const autoPlayers = quartet(f.members[7]!, f.members[8]!, f.members[9]!, f.guest);
  const manual = await confirmGroup(
    {
      eventId: await pastEvent(f),
      players: manualPlayers,
      playedAt: '2026-10-11T18:00:00Z',
      submittedBy: f.creator.id
    },
    'MANUAL'
  );
  const auto = await confirmGroup({
    eventId: await pastEvent(f),
    players: autoPlayers,
    playedAt: '2026-10-12T18:00:00Z',
    submittedBy: f.creator.id
  });
  const [manualSource, autoSource] = await Promise.all(
    [manual, auto].map(async (group) => {
      const [row] = await sql(
        `select source from public.match_event_result_confirmations where id='${group.confirmationId}'`
      );
      return row?.['source'];
    })
  );
  expect([manualSource, autoSource]).toEqual(['MANUAL', 'AUTO_48H']);

  // Equal starting states + same classification: same numbers, whichever path confirmed.
  const a = (await ledger(manualPlayers[0]))[0]!;
  const b = (await ledger(autoPlayers[0]))[0]!;
  expect([a.before, a.after, a.delta, a.before_reliability, a.after_reliability]).toEqual([
    b.before,
    b.after,
    b.delta,
    b.before_reliability,
    b.after_reliability
  ]);
  expect(await eventCount([...manualPlayers, ...autoPlayers])).toBe(8);

  // Retry of the same confirmation is idempotent: same id, no new evidence, same state.
  const all = [...manualPlayers, ...autoPlayers];
  const stateBefore = await states(all);
  const fingerprints = await Promise.all(all.map((id) => ledger(id)));
  expect(await finalize(manual.proposalId, 'AUTO_48H')).toBe(manual.confirmationId);
  await sql('select public.process_due_match_event_results(25)');
  expect(await states(all)).toEqual(stateBefore);
  expect(await Promise.all(all.map((id) => ledger(id)))).toEqual(fingerprints);
  expect(await eventCount(all)).toBe(8);

  const page = await f.page(f.members[7]!);
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  const region = await journey(page);
  await expect(region.getByRole('listitem').filter({ hasText: signed(b.delta) })).toHaveCount(1);
  await page.reload();
  await waitForHydratedPage(page);
  await expect(region.getByRole('listitem').filter({ hasText: signed(b.delta) })).toHaveCount(1);
});

// --- AC3: excluded inputs change nothing --------------------------------------------------

test('friendly, incomplete, pending, disputed, cancelled and reserve inputs have no rating effect', async () => {
  const players = quartet(f.members[3]!, f.members[4]!, f.members[5]!, f.members[6]!);
  const reserve = f.members[2]!;
  const snapshot = async () => ({
    states: await states([...players, reserve.id]),
    events: await eventCount([...players, reserve.id])
  });
  const before = await snapshot();
  const reserveEventsBefore = await eventCount([reserve.id]);
  const reserveStateBefore = await states([reserve.id]);
  const at = '2026-10-20T18:00:00Z';

  await confirmGroup({
    eventId: await pastEvent(f, 'friendly'),
    players,
    playedAt: at,
    submittedBy: f.creator.id
  });
  await confirmGroup({
    eventId: await pastEvent(f),
    players,
    playedAt: at,
    submittedBy: f.creator.id,
    classification: 'incomplete'
  });
  await submitGroup(
    { eventId: await pastEvent(f), players, playedAt: at, submittedBy: f.creator.id },
    1
  );
  const disputed = await submitGroup(
    { eventId: await pastEvent(f), players, playedAt: at, submittedBy: f.creator.id },
    1
  );
  await reviewRow(disputed, players[2], 'reject');
  await reviewRow(disputed, players[0], 'approve');
  expect(await finalize(disputed, 'MANUAL', players[0])).toBeNull();

  const cancelledEvent = await pastEvent(f);
  // Cancelled events never reach confirmation: cancellation is refused once results exist, and
  // submission is refused afterwards, so a cancelled event can only ever hold unrated rows. The
  // production RPC path of both directions is proven in player.rating.projection.integration.test.ts;
  // this fixture bypass only shows that even forced cancelled rows stay unrated.
  await sqlWithFixtureTriggersDisabled(
    ['matchEventImmutable'],
    [
      `update public.match_events set status='cancelled', cancelled_at=now(),
         cancelled_by='${f.creator.id}', cancel_reason='e2e' where id='${cancelledEvent}'`
    ]
  );
  await submitGroup({
    eventId: cancelledEvent,
    players,
    playedAt: at,
    submittedBy: f.creator.id
  }).catch(() => undefined);
  expect(await snapshot()).toEqual(before);

  // A reserve on a rated event is not one of the four played participants.
  const ratedEvent = await pastEvent(f);
  await reserveRegistration(ratedEvent, reserve.id);
  await confirmGroup({
    eventId: ratedEvent,
    players,
    playedAt: '2026-10-21T18:00:00Z',
    submittedBy: f.creator.id
  });
  expect(await states([reserve.id])).toEqual(reserveStateBefore);
  expect(await eventCount([reserve.id])).toBe(reserveEventsBefore);
});

// --- AC7: one global state across communities ---------------------------------------------

test('a player shared by two communities keeps one global state and continuous history', async () => {
  const shared = f.members[0]!;
  cross = await secondCommunity(f.members[1]!);
  const firstGroup = await confirmGroup({
    eventId: await pastEvent(f),
    players: quartet(shared, f.members[3]!, f.members[4]!, f.members[5]!),
    playedAt: '2026-10-05T18:00:00Z',
    submittedBy: f.creator.id,
    classification: 'team_b'
  });
  await confirmGroup({
    eventId: cross.eventId,
    players: quartet(f.members[6]!, shared, f.members[7]!, f.members[8]!),
    playedAt: '2026-10-06T18:00:00Z',
    submittedBy: f.members[1]!.id
  });
  expect(firstGroup.confirmationId).toBeTruthy();

  const own = await ledger(shared.id);
  expect(own.length).toBeGreaterThanOrEqual(2);
  const [rowCount] = await sql(
    `select count(*)::int as n from public.global_player_ratings where user_id='${shared.id}'`
  );
  expect(rowCount?.['n']).toBe(1);
  // The later game starts exactly where the earlier one ended, across communities.
  for (const [index, row] of own.entries())
    if (index > 0)
      expect(row.before, `game ${index + 1} starts where game ${index} ended`).toBe(
        own[index - 1]!.after
      );
  expect(own.some((row) => row.match_event_id === cross!.eventId)).toBe(true);
  const [current] = await states([shared.id]);
  expect(Number(current?.['display_level'])).toBe(own.at(-1)!.after);

  const page = await f.page(shared);
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  const region = await journey(page);
  await expect(
    region.getByText(fill(rating.history.showing_other, { shown: own.length, count: own.length }))
  ).toBeVisible();
});

// --- AC8–AC13: provisional identities, either side, claim continuity ----------------------

const MAILPIT_URL = testMailpitUrl();

async function invitationLink(request: APIRequestContext, email: string) {
  const query = encodeURIComponent(`to:"${email}"`);
  const json = async (url: string): Promise<Record<string, unknown>> => {
    const body: unknown = await (await request.get(url)).json();
    if (typeof body !== 'object' || body === null) throw new Error('Unexpected Mailpit response');
    return Object.fromEntries(Object.entries(body));
  };
  const found = async () => {
    const messages = (await json(`${MAILPIT_URL}/api/v1/search?query=${query}`))['messages'];
    if (!Array.isArray(messages)) return [];
    return messages;
  };
  await expect.poll(async () => (await found()).length).toBe(1);
  const html = (
    await json(`${MAILPIT_URL}/api/v1/message/${String(Reflect.get((await found())[0], 'ID'))}`)
  )['HTML'];
  if (typeof html !== 'string') throw new Error('Unexpected Mailpit message');
  const links = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]!.replaceAll('&amp;', '&'));
  expect(links).toHaveLength(1);
  return links[0]!;
}

async function addProvisional(organizer: Page, name: string, estimate: string) {
  const email = `rating-prov-${crypto.randomUUID()}@test.local`;
  provisionalEmails.push(email);
  const a = en.matches.addPlayer;
  await organizerMenu(organizer, a.action);
  const dialog = organizer.getByRole('dialog', { name: a.title });
  await dialog.getByLabel(a.nameLabel).fill(name);
  await dialog.getByLabel(a.emailLabel).fill(email);
  await dialog.getByRole('slider').fill(estimate);
  await dialog.getByRole('button', { name: a.submit, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(organizer.getByText(fill(a.success, { name }), { exact: true })).toBeVisible();
  const [row] = await sql(`select id::text as id from auth.users where email='${email}'`);
  return { email, id: String(row?.['id']) };
}

async function claim(
  browser: import('@playwright/test').Browser,
  request: APIRequestContext,
  email: string,
  next: string,
  edit?: { name: string; startLevel?: string }
) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  await page.goto(await invitationLink(request, email));
  await expect(page).toHaveURL(/\/onboarding\?next=/);
  await waitForHydratedPage(page);
  const locked = page.getByText(en.auth.claim.levelLocked);
  if (edit?.name) await page.getByLabel(en.onboarding.name).fill(edit.name);
  if (edit?.startLevel) await page.getByLabel(en.onboarding.preciseLevel).fill(edit.startLevel);
  await page.getByLabel(en.onboarding.sideLeftShort).first().check();
  const lockedShown = await locked.isVisible();
  await page.getByRole('button', { name: en.auth.claim.submit }).click();
  const password = 'Claim-pass-9!';
  await page.getByLabel(en.auth.resetNewPasswordLabel, { exact: true }).fill(password);
  await page.getByLabel(en.auth.resetConfirmPasswordLabel, { exact: true }).fill(password);
  await page.getByRole('button', { name: en.auth.resetSubmit }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
  await waitForHydratedPage(page);
  return { context, page, lockedShown };
}

test('provisional players on either side are rated normally; claims keep ratings and evidence intact', async ({
  browser,
  request
}) => {
  test.setTimeout(420_000);
  const futureEvent = await f.event(3);
  const organizer = await f.page(f.creator);
  await f.open(organizer, futureEvent);
  const p1 = await addProvisional(organizer, 'Prov Alpha', '3.5');
  const p2 = await addProvisional(organizer, 'Prov Beta', '3.5');
  const p3 = await addProvisional(organizer, 'Prov Gamma', '3.5');

  // Creator-estimate initialization exists and carries no adder identity in rating DTOs.
  const [init] = await sql(`select provenance, reason, initial_level::text as level
    from public.player_rating_initializations where user_id='${p1.id}' order by sequence limit 1`);
  expect(init).toMatchObject({ provenance: 'creator_estimated', level: '3.5' });

  const m3 = f.members[3]!;
  const m4 = f.members[4]!;
  const m5 = f.members[5]!;
  const at = (n: number) => `2026-10-${String(24 + n)}T18:00:00Z`;
  // P1 on team A, P3 on team B of the same group: both sides carry a provisional.
  const g1 = await confirmGroup({
    eventId: await pastEvent(f),
    players: [p1.id, m3.id, m4.id, p3.id],
    playedAt: at(1),
    submittedBy: f.creator.id
  });
  expect(g1.confirmationId).toBeTruthy();
  const p1Before = await ledger(p1.id);
  const p3Before = await ledger(p3.id);
  expect(p1Before).toHaveLength(1);
  expect(p3Before).toHaveLength(1);
  // Provisional rated exactly like a registered 3.5 player: same start state, same count.
  expect(p1Before[0]!.before).toBe(3.5);
  expect(p1Before[0]!.before_reliability).toBe(10);
  expect((await states([p1.id]))[0]!['groups']).toBe(1);

  // A viewer who played sees the provisional badge and name, never the adder.
  const viewer = await f.page(m3);
  const wire = watchRatingResponses(viewer);
  await viewer.goto('/dashboard');
  await waitForHydratedPage(viewer);
  const viewerRegion = await journey(viewer);
  const dialog = await openExplanation(
    viewer,
    viewerRegion
      .getByRole('listitem')
      .filter({ hasText: day(at(1)) })
      .getByRole('button'),
    'en'
  );
  await expect(dialog.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(2);
  await expect(dialog.getByText(f.creator.name)).toHaveCount(0);
  assertNoPrivateFields(wire, [f.creator.id, f.creator.email, p1.email, p3.email]);
  // SSR of a viewer who shares a group with provisionals: no adder identity, no addresses.
  const viewerHtml = await ssrHtml(viewer);
  expect(viewerHtml).toContain(rating.journey.title);
  assertNoPrivateFields(
    [viewerHtml],
    [f.creator.id, f.creator.email, p1.email, p2.email, p3.email, p1.id, p3.id]
  );

  // Claim of P1 sits between two rated groups: same id, evidence and sequence untouched.
  const claimed = await claim(browser, request, p1.email, `/matches/${futureEvent}`, {
    name: 'Prov Alpha Claimed'
  });
  expect(await ledger(p1.id)).toEqual(p1Before); // identical stored evidence, fingerprint included
  expect(await eventCount([p1.id])).toBe(1); // claim itself adds no match event
  const [identity] = await sql(
    `select is_provisional::text as p from public.player_profiles where user_id='${p1.id}'`
  );
  expect(identity?.['p']).toBe('false');

  await confirmGroup({
    eventId: await pastEvent(f),
    players: [m5.id, m3.id, p1.id, m4.id],
    playedAt: at(2),
    submittedBy: f.creator.id,
    classification: 'team_b'
  });
  const p1After = await ledger(p1.id);
  expect(p1After).toHaveLength(2);
  expect(p1After[0]).toEqual(p1Before[0]); // replay/claim never rewrote the past
  expect(p1After[1]!.before).toBe(p1Before[0]!.after); // continuity across the claim
  expect(p1After[1]!.calculations).toBe(1);

  await claimed.page.goto('/dashboard');
  await waitForHydratedPage(claimed.page);
  const region = await journey(claimed.page);
  await expect(
    region.getByRole('listitem').filter({ hasText: fill(rating.history.groupTitle, { number: 1 }) })
  ).toHaveCount(2);
  await expect(
    claimed.page.getByText(level(p1After[1]!.after), { exact: true }).first()
  ).toBeVisible();
  await expect(claimed.page.getByText(en.player.provisional.badge, { exact: true })).toHaveCount(0);
  await claimed.context.close();

  // Zero-history claim may adjust the starting level: initialization audit only, no event.
  const zero = await claim(browser, request, p2.email, `/matches/${futureEvent}`, {
    name: 'Prov Beta Claimed',
    startLevel: '4'
  });
  expect(zero.lockedShown).toBe(false);
  const inits =
    await sql(`select reason, initial_level::text as level from public.player_rating_initializations
    where user_id='${p2.id}' order by sequence`);
  expect(inits.at(-1)).toMatchObject({ reason: 'claim_before_history', level: '4.0' });
  expect(await eventCount([p2.id])).toBe(0);
  await zero.context.close();

  // Rated history locks the starting level; the same-level claim still succeeds.
  const locked = await claim(browser, request, p3.email, `/matches/${futureEvent}`, {
    name: 'Prov Gamma Claimed'
  });
  expect(locked.lockedShown).toBe(true);
  expect(await ledger(p3.id)).toEqual(p3Before);
  await locked.context.close();
});

// --- recovery paths: stale revision focus and sign-in return context ---------------------------

test('a stale explanation reloads the journey, moves focus to its heading and announces the refresh', async () => {
  const viewer = f.members[7]!;
  const [seen] = await ledger(viewer.id);
  expect(seen).toBeTruthy();
  const page = await f.page(viewer, 'en', 390, 'light', 844);
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  const region = await journey(page);
  const rows = region.getByRole('listitem').filter({ has: page.locator('time') });
  const before = await rows.count();

  // The home view re-reads every 3 s while visible; on a slower runner that poll lands between the
  // confirmation and the click, refreshes the journey and leaves no stale revision to report. A
  // hidden tab pauses the loop (the real `paused` path), so the stale-revision path is exercised
  // deterministically instead of racing the poll.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  // A newer confirmation moves the projection revision while this page is still open.
  await confirmGroup({
    eventId: await pastEvent(f),
    players: quartet(viewer, f.members[8]!, f.members[9]!, f.members[3]!),
    playedAt: '2026-10-28T18:00:00Z',
    submittedBy: f.creator.id
  });

  const trigger = rows.first().getByRole('button');
  await trigger.focus();
  await trigger.press('Enter');
  const dialog = page.getByRole('dialog', { name: rating.explanation.title });
  await expect(dialog.getByRole('alert')).toContainText(copies.en.rating.errors.stale_revision);
  await dialog.getByRole('button', { name: copies.en.rating.errors.reload }).click();

  await expect(dialog).toBeHidden();
  await expect(region.getByRole('heading', { name: rating.journey.title })).toBeFocused();
  await expect(region.getByRole('status')).toHaveText(rating.journey.refreshed);
  await expect(rows).toHaveCount(before + 1);
});

test('sign-in recovery returns to the result detail or the dashboard and ignores unsafe destinations', async () => {
  // The creator played the UI-confirmed group of the first test, so owns a result-detail entry.
  const viewer = f.creator;
  const eventId = (await ledger(viewer.id))[0]!.match_event_id;

  // Result detail: session gone, then an explanation read reports the expired session.
  const detail = await f.page(viewer, 'en', 390, 'light', 844);
  await f.open(detail, eventId);
  const changes = detail.getByRole('heading', { name: rating.changes.title });
  await expect(changes).toBeVisible();
  const entry = changes
    .locator('xpath=..')
    .getByRole('button', { name: /^Explain rating change for/ })
    .first();
  // Bound the failure seen in CI: a visible heading with a never-rendering
  // entry list used to burn the full 180s timeout inside focus().
  await expect(entry).toBeVisible();
  await detail.context().clearCookies();
  await entry.focus();
  await entry.press('Enter');
  const expired = detail.getByRole('dialog').getByRole('alert');
  await expect(expired).toContainText(copies.en.rating.errors.unauthenticated);
  await detail.getByRole('dialog').getByRole('button', { name: copies.en.signIn }).click();
  await expect
    .poll(() => new URL(detail.url()).search)
    .toBe(`?next=${encodeURIComponent(`/matches/${eventId}`)}`);

  // Dashboard entry point keeps its own destination.
  const dash = await f.page(viewer, 'en', 390, 'light', 844);
  await dash.goto('/dashboard');
  await waitForHydratedPage(dash);
  const region = await journey(dash);
  const trigger = region
    .getByRole('listitem')
    .filter({ has: dash.locator('time') })
    .first()
    .getByRole('button');
  await dash.context().clearCookies();
  await trigger.focus();
  await trigger.press('Enter');
  await dash.getByRole('dialog').getByRole('button', { name: copies.en.signIn }).click();
  await expect(dash).toHaveURL(/\/login\?next=%2Fdashboard$/);

  // An unsafe destination never survives sign-in.
  await dash.goto('/login?next=//evil.com');
  await expect(dash).not.toHaveURL(/evil\.com/);
});
