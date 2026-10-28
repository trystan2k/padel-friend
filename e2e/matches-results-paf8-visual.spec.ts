import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import type { ResultProposal } from '../src/features/matches/match-result-model';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import manifest from './references/paf-8/manifest.json' with { type: 'json' };
import {
  copies,
  enterScore,
  fill,
  openRecord,
  resultFixtures,
  review,
  sql,
  type Actor
} from './matches-results-fixtures';

type Fixtures = Awaited<ReturnType<typeof resultFixtures>>;
type Frame = keyof typeof manifest.visualBudgets.perScreen;

const sizes: Record<Frame, { width: number; height: number }> = {
  H6VcqC: { width: 390, height: 844 },
  GMcbD: { width: 390, height: 844 },
  sLXK7: { width: 390, height: 844 },
  CWJkF: { width: 390, height: 844 },
  JXjNs: { width: 431, height: 401 },
  ausNa: { width: 431, height: 561 },
  BcpYH: { width: 390, height: 844 },
  alZmm: { width: 390, height: 1042 }
};

let f: Fixtures;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await resultFixtures(browser, {
    creatorName: 'Thiago R.',
    memberNames: ['Ana M.', 'Pedro L.', 'Carlos F.'],
    communityName: 'Padel Friends',
    memberCount: 15
  });
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});

function actorFor(userId: string): Actor {
  const actor = [f.creator, ...f.members, f.guest].find((candidate) => candidate.id === userId);
  if (!actor) throw new Error(`Missing fixture actor ${userId}`);
  return actor;
}

async function proposalsFor(eventId: string) {
  const result = await f.rpc(f.creator, 'get_match_event_result_proposals', {
    p_match_event_id: eventId
  });
  const proposals = parseResultProposals(result);
  if (!proposals) throw new Error('Expected valid lifecycle proposals');
  return proposals;
}

async function proposalFor(eventId: string, groupNumber = 1): Promise<ResultProposal> {
  const proposal = (await proposalsFor(eventId)).find(
    (value) => value.group_number === groupNumber
  );
  if (!proposal) throw new Error(`Missing group ${groupNumber} proposal`);
  return proposal;
}

function teamReviewer(proposal: ResultProposal, side: 'team_a' | 'team_b') {
  const player = proposal.teams[side].find(
    (candidate) => candidate.user_id !== proposal.submitted_by
  );
  if (!player) throw new Error(`No eligible non-submitter on ${side}`);
  return actorFor(player.user_id);
}

async function submitProposal(
  eventId: string,
  actor: Actor = f.creator,
  groupNumber = 1,
  locale: keyof typeof copies = 'en'
) {
  const page = await f.page(actor, locale);
  await openRecord(page, eventId);
  if (groupNumber > 1)
    await page
      .getByRole('combobox', { name: copies[locale].matches.results.groupLabel, exact: true })
      .selectOption(String(groupNumber));
  await enterScore(page, undefined, locale);
  await review(page, locale);
  await page
    .getByRole('button', { name: copies[locale].matches.results.submit, exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: copies[locale].matches.results.pending })
  ).toBeVisible();
  await page.context().close();
}

async function resultCard(page: Page, groupNumber = 1) {
  const name = fill(copies.en.matches.results.group, { number: groupNumber });
  const namedCard = page.getByRole('article', { name, exact: true });
  if (await namedCard.count()) return namedCard;
  return page.locator('article').filter({
    has: page.getByRole('heading', { name, exact: true })
  });
}

async function openDetails(actor: Actor, eventId: string, size: Frame, theme: 'light' | 'dark') {
  const { width, height } = sizes[size];
  const page = await f.page(actor, 'en', width, theme, height);
  await f.open(page, eventId);
  return page;
}

async function scrollToTopOf(locator: Locator) {
  await locator.evaluate((element) =>
    element.scrollIntoView({ block: 'start', inline: 'nearest' })
  );
}

async function assertTouchTargets(page: Page, root: Locator = page.locator('main')) {
  const targets = await root.locator('a, button, summary, label').evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent?.trim(), width: rect.width, height: rect.height };
    })
  );
  for (const target of targets) {
    expect.soft(target.width, `${target.text} touch width`).toBeGreaterThanOrEqual(44);
    expect.soft(target.height, `${target.text} touch height`).toBeGreaterThanOrEqual(44);
  }
}

async function compareFrame(frame: Frame, page: Page, info: TestInfo) {
  const { width, height } = sizes[frame];
  await page.setViewportSize({ width, height });
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-8/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl }) => {
      async function readPixels(url: string, scale: number) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width / scale;
        canvas.height = image.height / scale;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data
        };
      }
      const [rendered, reference] = await Promise.all([
        readPixels(actualUrl, 1),
        readPixels(approvedUrl, 2)
      ]);
      if (rendered.width !== reference.width || rendered.height !== reference.height)
        return {
          actual: [rendered.width, rendered.height],
          reference: [reference.width, reference.height],
          dimensionMismatch: true,
          perceptualPixelDifference: null
        };
      let changed = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const red = rendered.data[index]! - reference.data[index]!;
        const green = rendered.data[index + 1]! - reference.data[index + 1]!;
        const blue = rendered.data[index + 2]! - reference.data[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        )
          changed++;
      }
      return {
        actual: [rendered.width, rendered.height],
        reference: [reference.width, reference.height],
        dimensionMismatch: false,
        perceptualPixelDifference: changed / (rendered.width * rendered.height)
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`
    }
  );
  console.info(`${frame} PAF-8 full-frame measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.visualBudgets.perScreen[frame];
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions must match the 2x Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).not.toBeNull();
  if (budget !== null && measured.perceptualPixelDifference !== null)
    expect
      .soft(measured.perceptualPixelDifference, `${frame} reviewed raster budget`)
      .toBeLessThanOrEqual(budget);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
  await info.attach(`${frame}-measurement`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json'
  });
  return measured;
}

test('PAF-8 Pencil screens retain exact lifecycle probes and reviewed raster budgets', async ({
  browserName
}, info) => {
  test.setTimeout(300_000);
  expect(browserName).toBe('chromium');
  const r = copies.en.matches.results;

  // H6VcqC: real reviewer opens the accessible, reason-coded dispute flow.
  const disputeEvent = await f.completedEvent('competitive', 4);
  await submitProposal(disputeEvent);
  const firstProposal = await proposalFor(disputeEvent);
  const firstSubmitterSide = firstProposal.teams.team_a.some(
    (player) => player.user_id === firstProposal.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const firstReviewer = teamReviewer(
    firstProposal,
    firstSubmitterSide === 'team_a' ? 'team_b' : 'team_a'
  );
  const disputePage = await openDetails(firstReviewer, disputeEvent, 'H6VcqC', 'dark');
  const firstCard = await resultCard(disputePage);
  await firstCard.getByRole('button', { name: r.review.reject, exact: true }).click();
  const dialog = disputePage.getByRole('dialog', { name: r.reject.title, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(8);
  await dialog.getByRole('radio', { name: r.reject.reasons.other, exact: true }).check();
  await dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(dialog.getByText(r.reject.noteRequired, { exact: true })).toBeVisible();
  await expect(dialog.getByLabel(r.reject.noteLabel)).toHaveAttribute('aria-invalid', 'true');
  await assertTouchTargets(disputePage, dialog);
  await compareFrame('H6VcqC', disputePage, info);
  const rejectButton = firstCard.getByRole('button', { name: r.review.reject, exact: true });
  await dialog.getByRole('button', { name: r.reject.cancel, exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rejectButton).toBeFocused();
  await disputePage.context().close();

  // GMcbD: four frozen groups keep confirmed, pending, disputed and missing independent.
  const mixedEvent = await f.completedEvent('competitive', 16);
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
  end $$;`);
  try {
    await sql(`update public.match_events
      set venue_name='Padel Indoor', notes='Group event',
          photo_path='${f.community}/${mixedEvent}/${f.creator.id}/visual-placeholder.jpg',
          starts_at='2026-09-21T18:30:00Z', registration_cutoff_at='2026-09-21T16:00:00Z'
      where id='${mixedEvent}'`);
  } finally {
    await sql(`do $$ begin
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
  }
  await submitProposal(mixedEvent, f.creator, 1);
  const groupOne = await proposalFor(mixedEvent, 1);
  const groupOneSide = groupOne.teams.team_a.some(
    (player) => player.user_id === groupOne.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const groupOneReviewer = teamReviewer(groupOne, groupOneSide === 'team_a' ? 'team_b' : 'team_a');
  const groupOnePage = await openDetails(groupOneReviewer, mixedEvent, 'GMcbD', 'light');
  const groupOneCard = await resultCard(groupOnePage, 1);
  await groupOneCard.getByRole('button', { name: r.review.approve, exact: true }).click();
  await expect(groupOneCard).toHaveAttribute('data-result-status', 'confirmed');
  await groupOnePage.context().close();
  await submitProposal(mixedEvent, f.creator, 2);
  await submitProposal(mixedEvent, f.creator, 3);
  const groupThree = await proposalFor(mixedEvent, 3);
  const groupThreeSide = groupThree.teams.team_a.some(
    (player) => player.user_id === groupThree.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const rejector = teamReviewer(groupThree, groupThreeSide === 'team_a' ? 'team_b' : 'team_a');
  const rejectPage = await openDetails(rejector, mixedEvent, 'GMcbD', 'light');
  const groupThreeCard = await resultCard(rejectPage, 3);
  await groupThreeCard.getByRole('button', { name: r.review.reject, exact: true }).click();
  const rejectDialog = rejectPage.getByRole('dialog', { name: r.reject.title, exact: true });
  await rejectDialog
    .getByRole('radio', { name: r.reject.reasons.scoreIncorrect, exact: true })
    .check();
  await rejectDialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(groupThreeCard).toHaveAttribute('data-result-status', 'disputed');
  await rejectPage.context().close();
  const mixedPage = await openDetails(f.creator, mixedEvent, 'GMcbD', 'light');
  await expect(mixedPage.getByRole('region', { name: r.resolution.title })).toContainText(
    fill(r.resolution.progress, { confirmed: 1, expected: 4 })
  );
  await expect(mixedPage.locator('article[data-result-status="confirmed"]')).toHaveCount(1);
  await expect(mixedPage.locator('article[data-result-status="pending"]')).toHaveCount(1);
  await expect(mixedPage.locator('article[data-result-status="disputed"]')).toHaveCount(1);
  const groupFour = await resultCard(mixedPage, 4);
  await expect(groupFour).toContainText(r.awaitingResult);
  await assertTouchTargets(mixedPage);
  await scrollToTopOf(mixedPage.getByRole('region', { name: r.resolution.title }));
  await compareFrame('GMcbD', mixedPage, info);
  await mixedPage.context().close();

  // sLXK7: eligible opposing player sees facts and only SQL-authorized actions.
  const approvalEvent = await f.completedEvent('competitive', 4);
  await submitProposal(approvalEvent);
  const approvalProposal = await proposalFor(approvalEvent);
  const approvalSubmitterSide = approvalProposal.teams.team_a.some(
    (player) => player.user_id === approvalProposal.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const approvalReviewer = teamReviewer(
    approvalProposal,
    approvalSubmitterSide === 'team_a' ? 'team_b' : 'team_a'
  );
  const approvalPage = await openDetails(approvalReviewer, approvalEvent, 'sLXK7', 'dark');
  const approvalCard = await resultCard(approvalPage);
  await expect(
    approvalCard.getByRole('button', { name: r.review.approve, exact: true })
  ).toBeVisible();
  await expect(
    approvalCard.getByRole('button', { name: r.review.reject, exact: true })
  ).toBeVisible();
  await expect(approvalCard.getByRole('region', { name: r.pending, exact: true })).toBeVisible();
  await expect(approvalCard.getByRole('region', { name: r.setScores, exact: true })).toBeVisible();
  await expect(approvalCard.getByText(/rating delta/i)).toHaveCount(0);
  await assertTouchTargets(approvalPage);
  await scrollToTopOf(approvalCard);
  await compareFrame('sLXK7', approvalPage, info);
  await approvalPage.context().close();

  // CWJkF: rejected v1, corrected v2, rejected again; old evidence stays in the timeline.
  const correctionEvent = await f.completedEvent('competitive', 4);
  await submitProposal(correctionEvent);
  const v1 = await proposalFor(correctionEvent);
  const v1Side = v1.teams.team_a.some((player) => player.user_id === v1.submitted_by)
    ? 'team_a'
    : 'team_b';
  const v1Reviewer = teamReviewer(v1, v1Side === 'team_a' ? 'team_b' : 'team_a');
  const v1ReviewPage = await openDetails(v1Reviewer, correctionEvent, 'CWJkF', 'dark');
  const v1Card = await resultCard(v1ReviewPage);
  await v1Card.getByRole('button', { name: r.review.reject, exact: true }).click();
  const v1Dialog = v1ReviewPage.getByRole('dialog', { name: r.reject.title, exact: true });
  await v1Dialog.getByRole('radio', { name: r.reject.reasons.teamsIncorrect, exact: true }).check();
  await v1Dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(v1Card).toHaveAttribute('data-result-status', 'disputed');
  await v1ReviewPage.context().close();
  const correctionPage = await f.page(f.creator);
  await f.open(correctionPage, correctionEvent);
  await correctionPage
    .locator('article[data-result-status="disputed"]')
    .getByRole('link', { name: r.correctResult, exact: true })
    .click();
  await correctionPage.getByRole('button', { name: r.confirmTeams, exact: true }).click();
  for (const [index, [a, b]] of [
    [6, 4],
    [4, 6],
    [3, 2]
  ].entries()) {
    await correctionPage.locator(`#score-${index}-team_a`).fill(String(a));
    await correctionPage.locator(`#score-${index}-team_b`).fill(String(b));
    await correctionPage.locator(`#score-${index}-team_b`).blur();
  }
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await correctionPage.getByRole('button', { name: r.correctSubmit, exact: true }).click();
  await expect(correctionPage.locator('article[data-result-status="pending"]')).toBeVisible();
  await correctionPage.context().close();
  const v2 = await proposalFor(correctionEvent);
  expect(v2.version).toBe(2);
  const v2Side = v2.teams.team_a.some((player) => player.user_id === v2.submitted_by)
    ? 'team_a'
    : 'team_b';
  const v2Reviewer = teamReviewer(v2, v2Side === 'team_a' ? 'team_b' : 'team_a');
  const v2ReviewPage = await openDetails(v2Reviewer, correctionEvent, 'CWJkF', 'dark');
  const v2Card = await resultCard(v2ReviewPage);
  await v2Card.getByRole('button', { name: r.review.reject, exact: true }).click();
  const v2Dialog = v2ReviewPage.getByRole('dialog', { name: r.reject.title, exact: true });
  await v2Dialog.getByRole('radio', { name: r.reject.reasons.scoreIncorrect, exact: true }).check();
  await v2Dialog.getByRole('button', { name: r.reject.submit, exact: true }).click();
  await expect(v2Card).toHaveAttribute('data-result-status', 'disputed');
  await expect(v2Card.getByText(r.timelineTitle, { exact: true })).toBeVisible();
  await expect(v2Card.getByRole('button', { name: /override|void/i })).toHaveCount(0);
  await v2ReviewPage.context().close();
  const correctionOwnerPage = await openDetails(f.creator, correctionEvent, 'CWJkF', 'dark');
  const correctionOwnerCard = await resultCard(correctionOwnerPage);
  await expect(
    correctionOwnerCard.getByRole('link', { name: r.correctResult, exact: true })
  ).toBeVisible();
  await expect(correctionOwnerPage.getByText(/override|void/i)).toHaveCount(0);
  await assertTouchTargets(correctionOwnerPage);
  await scrollToTopOf(correctionOwnerCard);
  await compareFrame('CWJkF', correctionOwnerPage, info);
  await correctionOwnerPage.context().close();

  // JXjNs: compact status viewport shows server-seeded countdown, never client confirmation.
  const pendingPage = await openDetails(approvalReviewer, approvalEvent, 'JXjNs', 'light');
  const pendingCard = await resultCard(pendingPage);
  const pendingRegion = pendingCard.getByRole('region', { name: r.pending, exact: true });
  await expect(pendingRegion.getByRole('timer')).toBeVisible();
  await expect(pendingRegion.getByRole('timer')).toContainText('48H');
  await assertTouchTargets(pendingPage);
  await scrollToTopOf(pendingRegion);
  await compareFrame('JXjNs', pendingPage, info);
  await pendingPage.context().close();

  // ausNa: stale submit remains local; offline review creates no server evidence.
  const staleEvent = await f.completedEvent('competitive', 4);
  const stalePage = await f.page(f.creator, 'en', sizes.ausNa.width, 'light', sizes.ausNa.height);
  await openRecord(stalePage, staleEvent);
  await submitProposal(staleEvent);
  await enterScore(stalePage);
  await review(stalePage);
  await stalePage.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(stalePage.getByText(r.errors.activeProposal, { exact: true })).toBeVisible();
  await expect(stalePage.getByRole('button', { name: r.reload, exact: true })).toBeVisible();
  await expect(stalePage.getByRole('button', { name: r.submit, exact: true })).toHaveCount(0);
  await expect(stalePage.locator('form')).toContainText(fill(r.versionLabel, { version: 1 }));
  const staleProposal = await proposalFor(staleEvent);
  const staleSubmitterSide = staleProposal.teams.team_a.some(
    (player) => player.user_id === staleProposal.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const offlineReviewer = teamReviewer(
    staleProposal,
    staleSubmitterSide === 'team_a' ? 'team_b' : 'team_a'
  );
  const offlinePage = await openDetails(offlineReviewer, staleEvent, 'ausNa', 'light');
  await offlinePage.context().setOffline(true);
  const offlineCard = await resultCard(offlinePage);
  await expect(offlineCard.getByText(r.review.offline, { exact: true })).toBeVisible();
  await expect(
    offlineCard.getByRole('button', { name: r.review.approve, exact: true })
  ).toHaveCount(0);
  expect(
    await sql(`select count(*)::int as count from public.match_event_result_reviews
      where proposal_id='${staleProposal.proposal_id}'`)
  ).toEqual([{ count: 0 }]);
  await assertTouchTargets(offlinePage);
  await scrollToTopOf(offlineCard.getByText(r.review.offline, { exact: true }));
  await compareFrame('ausNa', offlinePage, info);
  await offlinePage.context().close();
  await stalePage.context().close();

  // BcpYH: confirmed friendly facts stay factual history without rating effects.
  const friendlyEvent = await f.completedEvent('friendly', 4);
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
  end $$;`);
  try {
    await sql(`update public.match_events
      set venue_name='Padel Indoor', notes='Friendly match',
          photo_path='${f.community}/${friendlyEvent}/${f.creator.id}/visual-placeholder.jpg',
          starts_at='2026-09-21T18:30:00Z', registration_cutoff_at='2026-09-21T16:00:00Z'
      where id='${friendlyEvent}'`);
  } finally {
    await sql(`do $$ begin
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
  }
  await submitProposal(friendlyEvent);
  const friendlyProposal = await proposalFor(friendlyEvent);
  const friendlySubmitterSide = friendlyProposal.teams.team_a.some(
    (player) => player.user_id === friendlyProposal.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const friendlyReviewer = teamReviewer(
    friendlyProposal,
    friendlySubmitterSide === 'team_a' ? 'team_b' : 'team_a'
  );
  const confirmationPage = await openDetails(friendlyReviewer, friendlyEvent, 'BcpYH', 'light');
  const friendlyCard = await resultCard(confirmationPage);
  await friendlyCard.getByRole('button', { name: r.review.approve, exact: true }).click();
  await expect(friendlyCard).toHaveAttribute('data-result-status', 'confirmed');
  await expect(friendlyCard.getByText(r.confirmation.manual, { exact: true })).toBeVisible();
  await expect(friendlyCard.getByText(r.ratingEffectNone, { exact: true })).toBeVisible();
  await assertTouchTargets(confirmationPage);
  await compareFrame('BcpYH', confirmationPage, info);
  await confirmationPage.context().close();

  // alZmm: current lifecycle detail stays in the original match-detail composition.
  const lifecycleEvent = await f.completedEvent('competitive', 4);
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
  end $$;`);
  try {
    await sql(`update public.match_events
      set venue_name='PADEL INDOOR MADRID', notes='Friday open play', court_notes='Calle de Alcalá',
          duration_minutes=90, starts_at='2026-10-23T18:30:00Z'
      where id='${lifecycleEvent}'`);
  } finally {
    await sql(`do $$ begin
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
  }
  await submitProposal(lifecycleEvent);
  const lifecycleProposal = await proposalFor(lifecycleEvent);
  const lifecycleSide = lifecycleProposal.teams.team_a.some(
    (player) => player.user_id === lifecycleProposal.submitted_by
  )
    ? 'team_a'
    : 'team_b';
  const lifecycleReviewer = teamReviewer(
    lifecycleProposal,
    lifecycleSide === 'team_a' ? 'team_b' : 'team_a'
  );
  const lifecyclePage = await openDetails(lifecycleReviewer, lifecycleEvent, 'alZmm', 'light');
  const lifecycleCard = await resultCard(lifecyclePage);
  await expect(
    lifecyclePage.getByRole('heading', { name: r.proposalTitle, exact: true })
  ).toBeVisible();
  await expect(lifecycleCard.getByRole('region', { name: r.pending, exact: true })).toBeVisible();
  await expect(lifecycleCard.getByRole('region', { name: r.setScores, exact: true })).toBeVisible();
  await expect(
    lifecycleCard.getByRole('button', { name: r.review.approve, exact: true })
  ).toBeVisible();
  await expect(
    lifecycleCard.getByRole('button', { name: r.review.reject, exact: true })
  ).toBeVisible();
  await expect(lifecyclePage.getByText('PADEL INDOOR MADRID', { exact: true })).toBeVisible();
  await expect(
    lifecyclePage.getByRole('link', { name: /Calle de Alcalá.*Open map/ })
  ).toBeVisible();
  await assertTouchTargets(lifecyclePage);
  await compareFrame('alZmm', lifecyclePage, info);
  await lifecyclePage.context().close();
});
