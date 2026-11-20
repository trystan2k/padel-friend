import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  copies,
  correctTeams,
  enterScore,
  fill,
  openRecord,
  resultFixtures,
  review,
  sqlWithFixtureTriggersDisabled,
  type Locale
} from './matches-results-fixtures';
import manifest from './references/paf-7/manifest.json' with { type: 'json' };
import clubhouseManifest from './references/paf-202-result-recording/manifest.json' with { type: 'json' };
import { assertResultScreenshot, type RecordingReference } from './result-recording-visual';

let f: Awaited<ReturnType<typeof resultFixtures>>;
test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await resultFixtures(browser, {
    creatorName: 'Thiago R.',
    memberNames: ['Ana M.', 'Pedro L.', 'Carlos F.'],
    communityName: 'Padel Friends'
  });
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await f?.cleanup();
});

async function geometry(page: Page) {
  const overflow = await page.locator('main *').evaluateAll((nodes) =>
    nodes.flatMap((node) => {
      const rect = node.getBoundingClientRect();
      return rect.right > innerWidth
        ? [
            {
              tag: node.tagName,
              text: node.textContent?.slice(0, 90),
              right: rect.right,
              width: rect.width,
              whiteSpace: getComputedStyle(node).whiteSpace
            }
          ]
        : [];
    })
  );
  if (overflow.length) console.info('Overflow diagnostics', JSON.stringify(overflow));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const titleClear = await page.evaluate(() => {
    const heading = document.querySelector('main h1');
    if (!heading) throw new Error('Expected result heading');
    const range = document.createRange();
    range.selectNodeContents(heading);
    const title = range.getBoundingClientRect();
    const controls = document
      .querySelector('#locale')
      ?.parentElement?.parentElement?.getBoundingClientRect();
    if (!controls) throw new Error('Expected global controls');
    return (
      title.right <= controls.left ||
      title.left >= controls.right ||
      title.bottom <= controls.top ||
      title.top >= controls.bottom
    );
  });
  expect(titleClear, 'Result title clears global locale/theme chips').toBe(true);
  const main = page.getByRole('main');
  expect(await main.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  const sizes = await main
    .getByRole('button')
    .or(main.getByRole('textbox'))
    .or(main.getByRole('combobox'))
    .or(main.getByRole('link'))
    .or(main.locator('input[type="date"], input[type="time"]'))
    .evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return {
          width: rect.width,
          height: rect.height,
          label: node.getAttribute('aria-label') ?? node.textContent
        };
      })
    );
  for (const size of sizes) {
    expect.soft(size.width, `${size.label} touch width`).toBeGreaterThanOrEqual(44);
    expect.soft(size.height, `${size.label} touch height`).toBeGreaterThanOrEqual(44);
  }
}

test('approved reference provenance remains immutable', async ({ browserName }, info) => {
  expect(browserName).toBe('chromium');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  expect(hash(readFileSync(manifest.sourceDesign.path))).toBe(manifest.sourceDesign.sha256);
  expect(hash(readFileSync(clubhouseManifest.sourceDesign.path))).toBe(
    clubhouseManifest.sourceDesign.sha256
  );
  for (const [name, reference] of Object.entries(manifest.approvedReferences)) {
    const bytes = readFileSync(new URL(`./references/paf-7/${name}`, import.meta.url));
    expect(hash(bytes)).toBe(reference.sha256);
    await info.attach(name, { body: bytes, contentType: 'image/png' });
  }
});

test('Clubhouse result fragments retain approved structure and measured visual budgets', async ({
  browserName
}, info) => {
  // Full-frame raster comparisons + fixture SQL run far past the default under AC1 saturation
  // (NCPU-2 spinners); the budget is wall-clock headroom for the same assertions, not a loosened oracle.
  test.setTimeout(180_000);
  expect(browserName).toBe('chromium');
  const r = copies.en.matches.results;
  let page = await f.page(f.creator);
  async function routeEvent(type: 'competitive' | 'friendly' = 'competitive') {
    const id = await f.completedEvent(type, 4);
    await sqlWithFixtureTriggersDisabled(
      ['matchEventImmutable'],
      [
        `update public.match_events
          set venue_name='Padel Indoor', notes='Friday open play',
              court_notes='Play under the lights.', duration_minutes=90,
              starts_at='2026-10-23T18:30:00Z'
        where id='${id}'`
      ]
    );
    return id;
  }
  async function compare(frame: RecordingReference) {
    await page.setViewportSize({ width: 390, height: frame === 'alZmm' ? 1042 : 844 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      window.scrollTo(0, 0);
    });
    const isLifecycle = frame === 'alZmm';
    const main = page.locator(`main[data-result-route="${isLifecycle ? 'lifecycle' : 'record'}"]`);
    await expect(main).toBeVisible();
    await expect(page.getByRole('navigation', { name: copies.en.appShell.navigation })).toHaveCount(
      0
    );
    if (isLifecycle) {
      const proposal = main.locator('article[data-result-status="pending"]');
      await expect(
        proposal.getByRole('heading', { name: r.proposalTitle, exact: true })
      ).toBeVisible();
      await expect(proposal.getByRole('region', { name: r.pending, exact: true })).toBeVisible();
      await expect(proposal.getByRole('region', { name: r.setScores, exact: true })).toBeVisible();
      await expect(
        proposal.getByRole('button', { name: r.review.approve, exact: true })
      ).toBeVisible();
      await expect(
        proposal.getByRole('button', { name: r.review.reject, exact: true })
      ).toBeVisible();
    } else {
      await expect(page.locator('#locale')).toBeHidden();
      const scoring = frame === 'XySt5' || frame === 'wsXWA';
      await expect(
        main.getByRole('heading', {
          name: scoring ? r.record.scoreTitle : r.record.reviewTitle,
          exact: true
        })
      ).toBeVisible();
      const parts = main.locator('form > fieldset > [data-result-section]');
      expect(
        await parts.evaluateAll((nodes) =>
          nodes.map((node) => node.getAttribute('data-result-section'))
        )
      ).toEqual(
        scoring
          ? frame === 'wsXWA'
            ? ['sets', 'details']
            : ['sets', 'details', 'outcome']
          : ['score-summary', 'outcome', 'facts']
      );
      await expect(main.locator('form ol > li')).toHaveCount(3);
      const footer = main.locator('[data-result-section="actions"]');
      await expect(footer).toHaveCSS('position', 'sticky');
      const back = footer.getByRole('button', { name: r.back, exact: true });
      await expect(back).toBeVisible();
      expect((await back.boundingBox())?.width).toBe(112);
      expect((await back.boundingBox())?.height).toBeGreaterThanOrEqual(52);
      const action = footer.getByRole('button', {
        name: scoring ? r.record.reviewAction : r.submit,
        exact: true
      });
      if (frame === 'wsXWA') await expect(action).toBeDisabled();
      else await expect(action).toBeEnabled();
      expect((await action.boundingBox())?.height).toBeGreaterThanOrEqual(52);
      if (scoring) {
        const set = main.getByRole('group', {
          name: fill(r.setNumber, { number: 1 }),
          exact: true
        });
        await expect(set.getByRole('textbox')).toHaveCount(2);
        for (const side of ['team_a', 'team_b'] as const) {
          for (const copy of [r.decrease, r.increase]) {
            const control = set.getByRole('button', {
              name: fill(copy, { number: 1, team: r.teams[side] }),
              exact: true
            });
            expect((await control.boundingBox())?.width).toBeGreaterThanOrEqual(52);
          }
        }
      } else {
        const effect =
          frame === 'GPo9z'
            ? r.record.ratingUnavailable
            : frame === 'c0wbmu'
              ? r.ratingEffectIncomplete
              : r.ratingEffectNone;
        await expect(main.locator('[data-result-section="outcome"]')).toContainText(effect);
        await expect(main.locator('[data-result-section="facts"] dt')).toHaveCount(5);
      }
    }
    const actual = await page.screenshot({
      animations: 'disabled',
      caret: 'hide',
      path: info.outputPath(`${frame}-actual.png`)
    });
    await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
    if (frame === 'alZmm') {
      // The pending detail ends near the old band start: measure the bottom 70px of a taller capture.
      await page.setViewportSize({ width: 390, height: 1042 + 120 });
      const tall = await page.screenshot({ animations: 'disabled', caret: 'hide' });
      await assertResultScreenshot(page, tall, frame, 'recording');
      return;
    }
    await assertResultScreenshot(page, actual, frame, 'recording');
  }
  const scoreId = await routeEvent();
  await openRecord(page, scoreId);
  await enterScore(page, [
    [6, 4, true],
    [4, 6, true],
    [3, 2, false]
  ]);
  await compare('XySt5');
  const id = await routeEvent();
  await openRecord(page, id);
  await enterScore(page, [
    [6, 4, true],
    [4, 6, true],
    [7, 5, true]
  ]);
  await review(page);
  await compare('GPo9z');
  await page.getByRole('button', { name: r.submit, exact: true }).click();
  await expect(page.getByRole('region', { name: r.pending })).toBeVisible();
  await sqlWithFixtureTriggersDisabled(
    ['matchEventImmutable'],
    [
      `update public.match_events
        set venue_name='PADEL INDOOR MADRID', court_notes='Calle de Alcalá'
      where id='${id}'`
    ]
  );
  await page.context().close();
  page = await f.page(f.members[1]!, 'en', 390, 'light', 1042);
  await f.open(page, id);
  await compare('alZmm');
  await page.context().close();
  page = await f.page(f.creator);
  const incomplete = await routeEvent();
  await openRecord(page, incomplete);
  await enterScore(page, [
    [6, 4, true],
    [2, 3, false]
  ]);
  await review(page);
  await compare('c0wbmu');
  const invalid = await routeEvent();
  await openRecord(page, invalid);
  await enterScore(page, [
    [6, 4, true],
    [4, 6, true],
    [3, 2, false]
  ]);
  await page.locator('#score-0-team_b').fill('5');
  await page.locator('#score-0-team_b').blur();
  await expect(page.locator('#set-error-1')).toBeVisible();
  await expect(page.locator('#score-0-team_b')).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByRole('button', { name: r.record.reviewAction, exact: true })
  ).toBeDisabled();
  await compare('wsXWA');
  const friendly = await routeEvent('friendly');
  await openRecord(page, friendly);
  await enterScore(page, [
    [6, 4, true],
    [4, 6, true],
    [7, 5, true]
  ]);
  await review(page);
  await compare('NZk5H');
  await page.context().close();
});

for (const width of [320, 390, 1280]) {
  for (const theme of ['light', 'dark'] as const) {
    for (const locale of ['en', 'pt-BR', 'es'] as const satisfies readonly Locale[]) {
      test(`result states ${width}px ${theme} ${locale}`, async ({ browserName }, info) => {
        test.setTimeout(180_000);
        expect(browserName).toBe('chromium');
        const r = copies[locale].matches.results;
        const id = await f.completedEvent();
        const page = await f.page(f.creator, locale, width, theme);
        async function capture(name: string, target = page) {
          if (width === 390 && theme === 'light' && locale === 'en') {
            await info.attach(name, {
              body: await target.screenshot({
                path: info.outputPath(`${name}.png`),
                fullPage: true,
                animations: 'disabled',
                caret: 'hide'
              }),
              contentType: 'image/png'
            });
          }
        }
        await openRecord(page, id);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.locator('form ol > li')).toHaveCount(3);
        await expect(page.locator('[aria-current="step"]')).toHaveText(r.steps.players);
        for (const side of ['team_a', 'team_b'] as const) {
          const section = page
            .locator('form section')
            .filter({ has: page.getByRole('heading', { name: r.teams[side], exact: true }) })
            .last();
          await expect(section.locator('span')).toHaveCount(2);
        }
        await geometry(page);
        await capture('lKv9B-players-actual');
        await correctTeams(page, locale);
        await enterScore(page, [[6, 5, true]], locale);
        await expect(page.locator('[aria-current="step"]')).toHaveText(r.steps.score);
        await expect(
          page.getByRole('button', { name: r.record.reviewAction, exact: true })
        ).toBeDisabled();
        await expect(page.locator('#set-error-1')).toContainText(
          fill(r.invalidCompletedSet, { number: 1, team: r.teams.team_b, score: '6–5' })
        );
        await expect(page.locator('#score-0-team_b')).toHaveAttribute('aria-invalid', 'true');
        await geometry(page);
        await capture('LD9Jv-inline-error-actual');
        // Correct in place: incomplete -> Draw -> WIN; each retains actual teams.
        await page.locator('#score-0-team_b').press('ArrowDown');
        await page.locator('#score-0-team_b').blur();
        await expect(page.getByText(r.record.outcome.incomplete, { exact: true })).toBeVisible();
        await expect(page.getByText(r.ratingEffectIncomplete, { exact: true })).toBeVisible();
        await capture('BnwEB-incomplete-actual');
        await page.getByRole('button', { name: r.addSet }).click();
        await page.locator('#score-1-team_a').fill('4');
        await page.locator('#score-1-team_b').fill('6');
        await page.locator('#score-1-team_b').blur();
        await page.getByRole('button', { name: fill(r.setStateLabel, { number: 2 }) }).click();
        await page.getByRole('button', { name: r.addSet }).click();
        await expect(
          page.getByRole('group', { name: fill(r.setNumber, { number: 3 }), exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: fill(r.setStateLabel, { number: 3 }) })
        ).toHaveAttribute('aria-pressed', 'false');
        await expect(page.getByText(r.record.outcome.draw, { exact: true })).toBeVisible();
        await expect(page.getByText(r.record.ratingUnavailable, { exact: true })).toBeVisible();
        await capture('lKv9B-draw-actual');
        await geometry(page);
        await page.locator('#score-2-team_a').fill('7');
        await page.locator('#score-2-team_b').fill('5');
        await page.locator('#score-2-team_b').blur();
        await page.getByRole('button', { name: fill(r.setStateLabel, { number: 3 }) }).click();
        await expect(
          page.getByText(fill(r.record.outcome.team_a, { winnerSets: 2, loserSets: 1 }), {
            exact: true
          })
        ).toBeVisible();
        await capture('Hzcid-win-actual');
        await page.locator('#score-2-team_a').fill('5');
        await page.locator('#score-2-team_b').fill('7');
        await page.locator('#score-2-team_b').blur();
        await expect(
          page.getByText(fill(r.record.outcome.team_b, { winnerSets: 2, loserSets: 1 }), {
            exact: true
          })
        ).toBeVisible();
        await expect(page.locator('form fieldset > legend')).toHaveCount(3);
        for (const number of [1, 2, 3]) {
          await expect(
            page.getByRole('button', { name: fill(r.setStateLabel, { number }) })
          ).toHaveAttribute('aria-pressed', 'true');
        }
        await review(page, locale);
        await expect(page.locator('[aria-current="step"]')).toHaveText(r.steps.review);
        await geometry(page);
        await info.attach('review-structural-evidence', {
          body: await page.screenshot({ fullPage: true }),
          contentType: 'image/png'
        });
        const stale = await f.page(f.creator, locale, width, theme);
        await openRecord(stale, id);
        await enterScore(stale, undefined, locale);
        await review(stale, locale);
        await page.getByRole('button', { name: r.submit, exact: true }).click();
        await expect(page.getByRole('region', { name: r.pending, exact: true })).toBeVisible();
        await expect(
          page.getByText(fill(r.autoConfirmIn, { hours: 48 }), { exact: true })
        ).toBeVisible();
        await expect(page.getByText(r.pendingDescription, { exact: true })).toBeVisible();
        await capture('JXjNs-pending-actual');
        await geometry(page);
        await stale.getByRole('button', { name: r.submit, exact: true }).click();
        await expect(stale.getByText(r.errors.activeProposal, { exact: true })).toBeVisible();
        await expect(stale.getByRole('button', { name: r.reload, exact: true })).toBeVisible();
        await expect(stale.locator('form')).toContainText(fill(r.versionLabel, { version: 1 }));
        await expect(stale.getByRole('button', { name: r.submit, exact: true })).toHaveCount(0);
        await capture('conflict-actual', stale);
        await geometry(stale);
        const friendly = await f.completedEvent('friendly');
        await openRecord(page, friendly);
        await enterScore(
          page,
          [
            [6, 4, true],
            [6, 3, true]
          ],
          locale
        );
        await expect(page.getByText(r.ratingEffectNone, { exact: true })).toBeVisible();
        await capture('u78yF-friendly-actual');
        await expect(page.getByText(r.record.ratingUnavailable, { exact: true })).toHaveCount(0);
        await geometry(page);
        await page.context().close();
        await stale.context().close();
      });
    }
  }
}
