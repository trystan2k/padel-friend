import { expect, test, type Page } from '@playwright/test';
import type { ResultProposal } from '../src/features/matches/match-result-model';
import { waitForHydratedPage } from './auth-helpers';
import {
  expectedFirstGroupRatings,
  expectedLeagueCounters,
  releaseLayout,
  standingsCells,
  WINNING_SETS
} from './release-oracle';
import { finalize, ledger, eventCount } from './player-ratings-fixtures';
import { acquireRatingSuite, releaseRatingSuite } from './rating-suite-lock';
import { releaseWorld, copies, day, sql, PLAYED_EXTRA, PLAYED_GROUP_2 } from './release-fixtures';
import type { Actor, ReleaseWorld, Teams } from './release-fixtures';
import { enterScore, openRecord, review } from './matches-results-fixtures';
import { fill } from './matches-management-fixtures';

// PAF-170: the release loop from membership to notification with isolated authenticated contexts,
// plus the failure edges that only matter once everything is assembled. Expected rating and League
// values come from the approved golden oracle (e2e/release-oracle.ts), never from reread output.

const CONVERGENCE_BUDGET_MS = 5_000;
const en = copies.en;
const m = en.matches;
const r = m.results;
const s = en.leagues.standings;
const home = en.home;

test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

let w: ReleaseWorld;
let crossBefore: Awaited<ReturnType<ReleaseWorld['unrelatedSnapshot']>>['other'];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(900_000);
  await acquireRatingSuite();
  w = await releaseWorld(browser);
  crossBefore = (await w.unrelatedSnapshot()).other;
});
test.afterAll(async () => {
  test.setTimeout(240_000);
  await w?.cleanup();
});
// Declared after the cleanup hook so the suite lock is released last.
test.afterAll(releaseRatingSuite);
test.beforeEach(() => test.setTimeout(300_000));
// Release each test's browsers right away: actors and community stay for the serial suite.
test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

const everyone = () => [w.organizer, ...w.players];
const byId = (id: string): Actor => {
  const actor = [...everyone(), w.observer, w.outsider].find((candidate) => candidate.id === id);
  if (!actor) throw new Error(`No fixture actor for ${id}`);
  return actor;
};
const groupCard = (page: Page, number: number) =>
  page.getByRole('article', { name: fill(r.group, { number }), exact: true });

async function proposalRow(eventId: string, groupNumber: number) {
  const value = await w.f.rpc(w.organizer, 'get_match_event_result_proposals', {
    p_match_event_id: eventId
  });
  if (!Array.isArray(value)) throw new Error('Expected proposal rows');
  const row = value.find(
    (item): item is ResultProposal =>
      typeof item === 'object' &&
      item !== null &&
      'group_number' in item &&
      item.group_number === groupNumber
  );
  if (!row) throw new Error(`Missing proposal for group ${groupNumber}`);
  return row;
}

const teamsOf = (proposal: ResultProposal): Teams => ({
  team_a: proposal.teams.team_a.map((player) => player.user_id),
  team_b: proposal.teams.team_b.map((player) => player.user_id)
});

async function confirmationFor(eventId: string, groupNumber: number) {
  const [row] = await sql(`select c.id::text from public.match_event_result_confirmations c
      join public.match_event_result_proposals p on p.id = c.proposal_id
     where p.match_event_id='${eventId}' and p.group_number=${groupNumber}`);
  return String(row?.['id']);
}

async function unreadKinds(who: Actor) {
  return sql(`select kind, event_key from public.notifications
     where recipient_user_id='${who.id}' and read_at is null order by kind, event_key`);
}

const standings = (page: Page) => page.getByRole('region', { name: s.tableLabel });
async function standingsCellsFor(page: Page, name: string) {
  if (!(await standings(page).isVisible()))
    await page.getByText(s.allStats, { exact: true }).click();
  await expect(standings(page)).toBeVisible();
  const row = standings(page)
    .getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name, exact: true }) });
  await expect(row).toHaveCount(1);
  const texts = await row.getByRole('cell').allTextContents();
  // The place cell also carries a visually hidden shared-place announcement.
  return texts.map((text, index) =>
    index === 0 ? (text.match(/^\d+/)?.[0] ?? text) : text.trim()
  );
}

test('membership to selected Home to Ranked League event, two quartets and a Reserve, reviewed results, rating, standings and recipient notification', async ({
  browserName
}) => {
  expect(browserName).toBe('chromium');
  const unrelatedBefore = await w.unrelatedSnapshot();
  const roster9 = [w.organizer, ...w.players.slice(0, 8)];
  const layout = releaseLayout(roster9);
  const [quartet1, quartet2] = layout.groups;
  const reserve = layout.reserve;

  // 1. Membership + selected Home: members land in the community; the outsider sees discovery only.
  const observerPage = await w.openAs(w.observer);
  await observerPage.goto(`/dashboard?community=${w.f.community}`);
  await waitForHydratedPage(observerPage);
  await expect(
    observerPage.getByRole('combobox', { name: new RegExp(home.switcherLabel) })
  ).toContainText('Release Club');
  const outsiderPage = await w.openAs(w.outsider);
  await outsiderPage.goto(`/dashboard?community=${w.f.community}`);
  await waitForHydratedPage(outsiderPage);
  await expect(outsiderPage.getByRole('link', { name: home.noCommunity.action })).toBeVisible();
  await expect(outsiderPage.getByText('Release Club')).toHaveCount(0);

  // 2. Ranked event linked to the chosen League (the Decoy League exists and must stay untouched).
  const eventId = await w.f.publish(w.organizer, {
    competition: 'ranked',
    leagueId: w.leagueId,
    date: day(1),
    venue: 'Release Ranked Court'
  });
  expect(await w.f.eventRow(eventId)).toMatchObject({
    league_id: w.leagueId,
    event_type: 'competitive'
  });

  // 3. Registrations: seven real joins by command, the ninth through the browser while the
  // organizer watches a mounted roster that must converge without a reload.
  await w.joinInOrder(eventId, w.players.slice(0, 7));
  const organizerPage = await w.openAs(w.organizer);
  await w.f.open(organizerPage, eventId);
  await expect(organizerPage.getByText(`8 · ${m.detail.accepted}`)).toBeVisible();
  const ninthPage = await w.openAs(w.players[7]!);
  await w.f.open(ninthPage, eventId);
  await ninthPage.getByRole('button', { name: en.matchRegistration.join.button }).click();
  await expect(ninthPage.getByText(en.matchRegistration.feedback.accepted)).toBeVisible();
  await expect(organizerPage.getByText(`9 · ${m.detail.accepted}`)).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS
  });

  // 4. Cutoff through the production processor: FIFO gives two complete quartets and a Reserve.
  await w.closeRegistration(eventId);
  const rows = await w.roster(eventId);
  const groupNames = (group: number) =>
    rows
      .filter((row) => row.group === group)
      .sort((a, b) => a.order - b.order)
      .map((row) => row.name);
  expect(groupNames(1)).toEqual(quartet1.map((actor) => actor.name));
  expect(groupNames(2)).toEqual(quartet2.map((actor) => actor.name));
  expect(rows.filter((row) => row.participation === 'playing')).toHaveLength(8);
  expect(rows.filter((row) => row.participation !== 'playing').map((row) => row.name)).toEqual([
    reserve.name
  ]);

  // The selected League standings stay mounted for another active observer from here on: every
  // later confirmation must reach it with no reload.
  const standingsPage = await w.openAs(w.observer);
  await standingsPage.goto(`/community/${w.f.community}/leagues/${w.leagueId}`);
  await waitForHydratedPage(standingsPage);
  await expect(standingsPage.getByRole('heading', { name: s.title, exact: true })).toBeVisible();
  const zero = standingsCells({
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    setsWon: 0,
    setsLost: 0
  });
  expect((await standingsCellsFor(standingsPage, reserve.name)).slice(1, 8)).toEqual(zero);

  // 5. Group 1 through the browser: organizer enters and submits, an eligible opposing player approves.
  const organizerRecord = await w.openAs(w.organizer);
  await openRecord(organizerRecord, eventId);
  await enterScore(
    organizerRecord,
    WINNING_SETS.map(([a, b]) => [a, b, true] as [number, number, boolean])
  );
  await review(organizerRecord);
  await organizerRecord.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(organizerRecord.getByText(r.pending, { exact: true })).toBeVisible();
  const first = await proposalRow(eventId, 1);
  const firstTeams = teamsOf(first);
  expect([...firstTeams.team_a, ...firstTeams.team_b].sort()).toEqual(
    quartet1.map((actor) => actor.id).sort()
  );
  const firstOpposing = firstTeams.team_a.includes(w.organizer.id)
    ? firstTeams.team_b
    : firstTeams.team_a;
  expect(await w.ratingEventCount(eventId)).toBe(0);
  // A winner keeps their own rating view mounted: the committed level must appear on its own.
  const expected = expectedFirstGroupRatings();
  const ratingPage = await w.openAs(byId(firstTeams.team_a[0]!));
  await expect(ratingPage.getByText(expected.winner.level.toFixed(2), { exact: true })).toHaveCount(
    0
  );
  const reviewer1 = await w.openAs(byId(firstOpposing[0]!));
  await w.f.open(reviewer1, eventId);
  // The reviewer's partner keeps the event mounted: it must converge with no reload.
  const watcher1 = await w.openAs(byId(firstOpposing[1]!));
  await w.f.open(watcher1, eventId);
  await expect(groupCard(watcher1, 1)).toHaveAttribute('data-result-status', 'pending');
  await groupCard(reviewer1, 1)
    .getByRole('button', { name: r.review.approve, exact: true })
    .click();
  await expect(groupCard(reviewer1, 1)).toHaveAttribute('data-result-status', 'confirmed');
  await expect(groupCard(watcher1, 1)).toHaveAttribute('data-result-status', 'confirmed', {
    timeout: CONVERGENCE_BUDGET_MS
  });
  expect(await w.ratingEventCount(eventId)).toBe(4);
  await expect(
    ratingPage.getByText(expected.winner.level.toFixed(2), { exact: true }).first()
  ).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS
  });
  const group1Winners = firstTeams.team_a.map((id) => byId(id).name);
  const standingsAfter1 = async (name: string) =>
    (await standingsCellsFor(standingsPage, name)).slice(1, 8);
  await expect
    .poll(() => standingsAfter1(group1Winners[0]!), { timeout: CONVERGENCE_BUDGET_MS })
    .toEqual(standingsCells(expectedLeagueCounters('winner')));
  expect(await standingsAfter1(quartet2[0]!.name)).toEqual(zero);

  // 6. Group 2: the non-playing organizer submits, so one approver per team is required; the
  // recipient (on the second team) keeps Home mounted until the final approval lands.
  const [g2a1, g2a2, g2b1, g2b2] = quartet2;
  const secondTeams: Teams = { team_a: [g2a1!.id, g2a2!.id], team_b: [g2b1!.id, g2b2!.id] };
  const secondProposal = await w.submitResult(
    eventId,
    w.organizer,
    2,
    secondTeams,
    WINNING_SETS,
    PLAYED_GROUP_2
  );
  const recipient = g2b2!;
  expect((await w.approve(g2a1!, secondProposal)).error).toBeNull();
  expect((await proposalRow(eventId, 2)).status).toBe('pending');
  const recipientPage = await w.openAs(recipient);
  await recipientPage.goto('/notifications');
  await waitForHydratedPage(recipientPage);
  await recipientPage.getByRole('button', { name: en.notifications.markAllRead }).click();
  await expect.poll(async () => (await unreadKinds(recipient)).length).toBe(0);
  await recipientPage.goto(`/dashboard?community=${w.f.community}`);
  await waitForHydratedPage(recipientPage);
  const badge = recipientPage.getByRole('link', { name: /Notifications/ });

  const reviewer2 = await w.openAs(g2b1!);
  await w.f.open(reviewer2, eventId);
  await expect(groupCard(reviewer2, 2)).toHaveAttribute('data-result-status', 'pending');
  await groupCard(reviewer2, 2)
    .getByRole('button', { name: r.review.approve, exact: true })
    .click();
  await expect(groupCard(reviewer2, 2)).toHaveAttribute('data-result-status', 'confirmed');

  // 7. Recipient notification + unread badge converge on the mounted Home, then the detail link.
  const confirmation2 = await confirmationFor(eventId, 2);
  await expect(badge).toHaveAccessibleName(/Notifications · [1-9]\d* unread/, {
    timeout: CONVERGENCE_BUDGET_MS
  });
  const unread = await unreadKinds(recipient);
  const confirmedKeys = unread.filter((row) => row['kind'] === 'result_confirmed');
  expect(confirmedKeys).toEqual([
    { kind: 'result_confirmed', event_key: `result.confirmed:${confirmation2}` }
  ]);
  expect(
    unread.every((row) => ['result_confirmed', 'rating_changed'].includes(String(row['kind'])))
  ).toBe(true);
  const template = unread.length === 1 ? en.notifications.badge_one : en.notifications.badge_other;
  await expect(badge).toHaveAccessibleName(fill(template, { count: unread.length }));
  await badge.click();
  await expect(recipientPage).toHaveURL(/\/notifications$/);
  await waitForHydratedPage(recipientPage);
  const notice = recipientPage.getByRole('listitem').filter({
    has: recipientPage.getByRole('heading', { name: en.notifications.kinds.result_confirmed })
  });
  await expect(notice).toHaveCount(1);
  await notice.getByRole('link', { name: en.notifications.result.openResult, exact: true }).click();
  await expect(recipientPage).toHaveURL(new RegExp(`/matches/${eventId}.*#result-group-2$`));

  // 8. Exactly the right recipients: each group's four players and the organizer; nobody else.
  const confirmation1 = await confirmationFor(eventId, 1);
  const notices = await w.noticeRows('result_confirmed', eventId);
  const expectedRecipients = (key: string, quartet: Actor[]) =>
    [...new Set([...quartet.map((actor) => actor.id), w.organizer.id])]
      .sort()
      .map((id) => ({ recipient: id, event_key: key }));
  const byKey = (key: string) =>
    notices
      .filter((row) => row['event_key'] === key)
      .map((row) => ({ recipient: String(row['recipient']), event_key: String(row['event_key']) }))
      .sort((a, b) => a.recipient.localeCompare(b.recipient));
  expect(byKey(`result.confirmed:${confirmation1}`)).toEqual(
    expectedRecipients(`result.confirmed:${confirmation1}`, quartet1)
  );
  expect(byKey(`result.confirmed:${confirmation2}`)).toEqual(
    expectedRecipients(`result.confirmed:${confirmation2}`, quartet2)
  );
  const noticeRecipients = new Set(notices.map((row) => String(row['recipient'])));
  for (const nobody of [reserve, w.observer, w.outsider])
    expect(noticeRecipients.has(nobody.id)).toBe(false);

  // 9. Global rating ledger / projection from the golden oracle; Reserve earns nothing.
  const winners = [...firstTeams.team_a, ...secondTeams.team_a];
  const losers = [...firstTeams.team_b, ...secondTeams.team_b];
  for (const [ids, outcome] of [
    [winners, expected.winner],
    [losers, expected.loser]
  ] as const)
    for (const id of ids) {
      const events = await ledger(id);
      expect(events, byId(id).name).toHaveLength(1);
      expect(events[0]!.calculations).toBe(1);
      expect(events[0]!.before).toBeCloseTo(3.2, 2);
      expect(events[0]!.after).toBeCloseTo(outcome.level, 2);
      expect(events[0]!.after_reliability).toBe(outcome.reliability);
      const [state] = await w.ratingStates([byId(id)]);
      expect(Number(state?.['display_level'])).toBeCloseTo(outcome.level, 2);
      expect(Number(state?.['groups'])).toBe(outcome.groups);
    }
  expect(await w.ratingEventCount(eventId)).toBe(8);
  expect(await eventCount([reserve.id])).toBe(0);
  expect(await ledger(reserve.id)).toEqual([]);
  const [reserveState] = await w.ratingStates([reserve]);
  expect(Number(reserveState?.['display_level'])).toBeCloseTo(3.2, 2);
  expect(Number(reserveState?.['groups'])).toBe(0);

  // 10. The mounted selected-League standings reflect both groups with no reload.
  for (const [ids, side] of [
    [winners, 'winner'],
    [losers, 'loser']
  ] as const)
    for (const id of ids)
      await expect
        .poll(() => standingsAfter1(byId(id).name), { timeout: CONVERGENCE_BUDGET_MS })
        .toEqual(standingsCells(expectedLeagueCounters(side)));
  // Every active member is listed; the Reserve never played, so every counter is zero.
  expect(await standingsAfter1(reserve.name)).toEqual(zero);
  expect(await w.leagueCounters()).toHaveLength(8);
  expect((await w.leagueCounters()).map((row) => String(row['user_id']))).not.toContain(reserve.id);

  // 11. Safe retry: re-running the production confirmation seam adds no rating, notice or counter.
  const before = {
    states: await w.ratingStates(roster9),
    counters: await w.leagueCounters(),
    notices: await w.noticeRows('result_confirmed', eventId),
    events: await w.ratingEventCount(eventId)
  };
  expect(await finalize(first.proposal_id, 'AUTO_48H')).toBe(confirmation1);
  expect(await finalize(secondProposal, 'AUTO_48H')).toBe(confirmation2);
  const replay = await w.approve(byId(firstOpposing[0]!), first.proposal_id);
  // A repeated approval is either an idempotent replay or a typed rejection; never a second effect.
  expect(replay.error === null || /RESULT_/.test(replay.error.message)).toBe(true);
  await sql('select public.process_due_match_event_results(25)');
  expect({
    states: await w.ratingStates(roster9),
    counters: await w.leagueCounters(),
    notices: await w.noticeRows('result_confirmed', eventId),
    events: await w.ratingEventCount(eventId)
  }).toEqual(before);

  // 12. Unrelated League and community are byte-identical.
  expect(await w.unrelatedSnapshot()).toEqual(unrelatedBefore);
  const { decoy } = await w.unrelatedSnapshot();
  expect(decoy?.['status']).toBe('upcoming');
});

test('a Friendly result confirms without any rating or League credit', async () => {
  const quartet = [w.organizer, ...w.players.slice(0, 3)];
  const statesBefore = await w.ratingStates(quartet);
  const countersBefore = await w.leagueCounters();
  const eventId = await w.f.publish(w.organizer, {
    type: 'friendly',
    date: day(1),
    venue: 'Release Friendly Court'
  });
  await w.joinInOrder(eventId, w.players.slice(0, 3));
  await w.closeRegistration(eventId);
  const teams: Teams = {
    team_a: [quartet[0]!.id, quartet[1]!.id],
    team_b: [quartet[2]!.id, quartet[3]!.id]
  };
  const proposal = await w.submitResult(eventId, w.organizer, 1, teams, WINNING_SETS, PLAYED_EXTRA);
  const approved = await w.approve(quartet[2]!, proposal);
  expect(approved.error).toBeNull();
  expect((await proposalRow(eventId, 1)).status).toBe('confirmed');
  expect(await w.ratingEventCount(eventId)).toBe(0);
  expect(await w.ratingStates(quartet)).toEqual(statesBefore);
  expect(await w.leagueCounters()).toEqual(countersBefore);
});

test('disconnect at the trusted auto-confirm deadline: polling catches the committed outcome once, with no reload', async () => {
  const quartet = [w.organizer, ...w.players.slice(0, 3)];
  const eventId = await w.f.publish(w.organizer, {
    competition: 'unranked',
    date: day(1),
    venue: 'Release Deadline Court'
  });
  await w.joinInOrder(eventId, w.players.slice(0, 3));
  await w.closeRegistration(eventId);
  const teams: Teams = {
    team_a: [quartet[0]!.id, quartet[1]!.id],
    team_b: [quartet[2]!.id, quartet[3]!.id]
  };
  const proposal = await w.submitResult(eventId, w.organizer, 1, teams, WINNING_SETS, PLAYED_EXTRA);

  const watcher = await w.openAs(quartet[3]!);
  await w.f.open(watcher, eventId);
  await expect(groupCard(watcher, 1)).toHaveAttribute('data-result-status', 'pending');
  await watcher.evaluate(() => {
    Object.assign(window, { pfNoReload: true });
  });

  await watcher.context().setOffline(true);
  // Trusted side: the 48h window ends and the production processor confirms; the client never writes.
  await w.expireWindow(proposal);
  await sql('select public.process_due_match_event_results(25)');
  await watcher.context().setOffline(false);

  await expect(groupCard(watcher, 1)).toHaveAttribute('data-result-status', 'confirmed', {
    timeout: CONVERGENCE_BUDGET_MS
  });
  expect(await watcher.evaluate(() => 'pfNoReload' in window)).toBe(true);
  const [confirmations] = await sql(`select count(*)::int as n, min(source) as source
      from public.match_event_result_confirmations where match_event_id='${eventId}'`);
  expect(confirmations).toEqual({ n: 1, source: 'AUTO_48H' });
  expect(await w.ratingEventCount(eventId)).toBe(4);
  const notices = await w.noticeRows('result_confirmed', eventId);
  expect(notices).toHaveLength(4);

  // No double apply when the processor runs again.
  await sql('select public.process_due_match_event_results(25)');
  expect(await w.ratingEventCount(eventId)).toBe(4);
  expect(await w.noticeRows('result_confirmed', eventId)).toHaveLength(4);
});

test('Push provider exhaustion leaves the persisted in-app notification and unread badge intact', async () => {
  const [row] = await sql(`select id::text from public.notifications
     where kind='result_confirmed' and recipient_user_id='${w.players[2]!.id}'
       and event_key like 'result.confirmed:%' order by created_at desc limit 1`);
  const notificationId = String(row?.['id']);
  // The outbox job exists for every persisted notification. Delivery workers that keep losing the
  // lease (six consecutive expired claims) make the next claim sweep exhaust the job.
  await sql(
    `update public.notification_push_jobs set status='leased', claim_token=gen_random_uuid(),
        lease_expires_at=now()-interval '1 minute', attempt_count=6
      where notification_id='${notificationId}'`
  );
  await sql('select count(*) from public.claim_notification_push_jobs(25)');
  const [job] = await sql(
    `select status from public.notification_push_jobs where notification_id='${notificationId}'`
  );
  expect(job?.['status']).toBe('exhausted');

  const page = await w.openAs(w.players[2]!);
  await page.goto('/notifications');
  await waitForHydratedPage(page);
  await expect(
    page
      .getByRole('listitem')
      .filter({ has: page.getByRole('heading', { name: en.notifications.kinds.result_confirmed }) })
      .first()
  ).toBeVisible();
  await page.goto(`/dashboard?community=${w.f.community}`);
  await waitForHydratedPage(page);
  await expect(page.getByRole('link', { name: /Notifications · [1-9]\d* unread/ })).toBeVisible();
  const [kept] = await sql(`select read_at from public.notifications where id='${notificationId}'`);
  expect(kept?.['read_at']).toBeNull();
});

test('a stale registration decision is rejected with the current state and the organizer queue converges', async () => {
  const eventId = await w.f.publish(w.organizer, {
    competition: 'unranked',
    date: day(10),
    venue: 'Release Queue Court'
  });
  const organizerPage = await w.openAs(w.organizer);
  await w.f.open(organizerPage, eventId);
  const guestPage = await w.openAs(w.outsider);
  await w.f.open(guestPage, eventId);
  await guestPage.getByRole('button', { name: en.matchRegistration.join.requestButton }).click();
  await expect(guestPage.getByText(en.matchRegistration.feedback.pending)).toBeVisible();
  await expect(organizerPage.getByText(w.outsider.name).first()).toBeVisible({
    timeout: CONVERGENCE_BUDGET_MS
  });

  const [attempt] = await sql(`select id::text from public.match_event_registration_attempts
     where match_event_id='${eventId}' and user_id='${w.outsider.id}' order by requested_at desc limit 1`);
  const attemptId = String(attempt?.['id']);
  const decide = (decision: 'approve' | 'reject') =>
    w.organizer.client.rpc('decide_match_registration', {
      p_match_event_id: eventId,
      p_attempt_id: attemptId,
      p_decision: decision
    });
  expect((await decide('reject')).error).toBeNull();
  const stale = await decide('approve');
  expect(stale.error?.message ?? '').toContain('MATCH_REGISTRATION_ALREADY_RESOLVED');
  const [registration] =
    await sql(`select lifecycle::text, accepted_order from public.match_event_registrations
     where match_event_id='${eventId}' and user_id='${w.outsider.id}'`);
  expect(registration?.['lifecycle']).not.toBe('accepted');
  expect(registration?.['accepted_order']).toBeNull();
  expect(await w.f.notifications(w.outsider, 'match_registration_approved', eventId)).toEqual([]);
  await expect(organizerPage.getByText(w.outsider.name)).toHaveCount(0, {
    timeout: CONVERGENCE_BUDGET_MS
  });
});

test('next match and League cutoff follow the community day, not the browser time zone', async () => {
  const lastDay = await w.f.publish(w.organizer, {
    competition: 'ranked',
    leagueId: w.decoyLeagueId,
    date: day(2),
    time: '23:30',
    venue: 'Release Boundary A'
  });
  expect(await w.f.eventRow(lastDay)).toMatchObject({ league_id: w.decoyLeagueId });
  // Thirty minutes later it is the next calendar day: outside the fixed-date League.
  await expect(
    w.f.publish(w.organizer, {
      competition: 'ranked',
      leagueId: w.decoyLeagueId,
      date: day(3),
      time: '00:30',
      venue: 'Release Boundary Rejected'
    })
  ).rejects.toBeTruthy();
  expect(
    await sql(`select id from public.match_events where venue_name='Release Boundary Rejected'`)
  ).toEqual([]);
  const nextDay = await w.f.publish(w.organizer, {
    competition: 'unranked',
    date: day(3),
    time: '00:30',
    venue: 'Release Boundary B'
  });
  expect(await w.f.eventRow(nextDay)).toMatchObject({ league_id: null });

  const texts: string[] = [];
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
    const page = await w.openAs(w.observer, { timezoneId });
    await page.goto(`/dashboard?community=${w.f.community}`);
    await waitForHydratedPage(page);
    const next = page.getByRole('region', { name: home.nextMatch.title });
    await expect(next.getByRole('link', { name: 'Release Boundary A', exact: true })).toBeVisible();
    // By instant, the League's last evening comes before the next community day, wherever the
    // browser clock is; the earliest match leads the card.
    const names = (await next.getByRole('link').allInnerTexts()).map((text) => text.trim());
    const first = names.indexOf('Release Boundary A');
    expect(first).toBeGreaterThanOrEqual(0);
    const later = names.indexOf('Release Boundary B');
    if (later >= 0) expect(first).toBeLessThan(later);
    texts.push(await next.innerText());
  }
  expect(texts[0]).toBe(texts[1]);
});

test('the unrelated community saw no result, rating or notification activity', async () => {
  expect((await w.unrelatedSnapshot()).other).toEqual(crossBefore);
});
