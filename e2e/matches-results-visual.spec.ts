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
  sql,
  type Locale
} from './matches-results-fixtures';
import manifest from './references/paf-7/manifest.json' with { type: 'json' };
import paf8Manifest from './references/paf-8/manifest.json' with { type: 'json' };

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
  for (const [name, reference] of Object.entries(manifest.approvedReferences)) {
    const bytes = readFileSync(new URL(`./references/paf-7/${name}`, import.meta.url));
    expect(hash(bytes)).toBe(reference.sha256);
    await info.attach(name, { body: bytes, contentType: 'image/png' });
  }
});

test('Pencil full-frame comparisons require matching composition and reviewed budgets', async ({
  browserName
}, info) => {
  test.setTimeout(120_000);
  expect(browserName).toBe('chromium');
  const r = copies.en.matches.results;
  let page = await f.page(f.creator);
  async function routeEvent(type: 'competitive' | 'friendly' = 'competitive') {
    const id = await f.completedEvent(type, 4);
    await sql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
    end $$;`);
    try {
      await sql(`update public.match_events
        set venue_name='Padel Indoor', notes='Friday open play', court_notes='Play under the lights.', duration_minutes=90, starts_at='2026-10-23T18:30:00Z'
        where id='${id}'`);
    } finally {
      await sql(`do $$ begin
        alter table public.match_events enable trigger match_event_immutable;
      end $$;`);
    }
    return id;
  }
  async function compare(frame: keyof typeof manifest.visualBudgets.perScreen) {
    await page.setViewportSize({ width: 390, height: frame === 'alZmm' ? 1042 : 844 });
    await page.getByRole('heading', { level: 1 }).click();
    for (const image of await page.locator('main img').all()) {
      await image.evaluate(async (node) => {
        if (!(node instanceof HTMLImageElement)) throw new Error('Expected image');
        await node.decode();
      });
    }
    const cards = await page.locator('form > fieldset > section').evaluateAll((nodes) =>
      nodes.map((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return [x + scrollX, y + scrollY, width, height];
      })
    );
    if (frame !== 'alZmm') {
      const invalid = frame === 'wsXWA';
      const score = frame === 'XySt5' || invalid;
      const expected = [
        [18, 109, 354, 202],
        [18, 323, 354, invalid ? 246 : 207],
        [18, invalid ? 581 : 542, 354, score ? 202 : 268]
      ];
      if (!invalid) expected.push([18, score ? 756 : 822, 354, frame === 'NZk5H' ? 160 : 145]);
      expect.soft(cards, `${frame} exact card structure`).toEqual(expected);
    } else {
      const route = page.locator('main[data-result-route="lifecycle"]');
      const proposal = route.locator('article[data-result-status="pending"]');
      await expect(proposal).toBeVisible();
      await expect(
        proposal.getByRole('heading', { name: r.proposalTitle, exact: true })
      ).toBeVisible();
      await expect(proposal.getByRole('region', { name: r.pending, exact: true })).toBeVisible();
      await expect(proposal.getByRole('region', { name: r.setScores, exact: true })).toBeVisible();
      await expect(proposal.getByText(r.pendingDescription, { exact: true })).toBeVisible();
      await expect(
        proposal.getByText(fill(r.approvalProgress, { received: 0, required: 1 }), { exact: true })
      ).toBeVisible();
      await expect(
        proposal.getByRole('button', { name: r.review.approve, exact: true })
      ).toBeVisible();
      await expect(
        proposal.getByRole('button', { name: r.review.reject, exact: true })
      ).toBeVisible();
      await expect(
        route.getByRole('region', { name: r.resolution.title, exact: true })
      ).toHaveCount(0);
      const rows = await proposal
        .locator('section[aria-label="' + r.pending + '"] > div > div > div')
        .count();
      expect(rows).toBe(2);
      const structure = await route
        .locator(':scope > header, :scope > div, :scope > nav')
        .evaluateAll((nodes) =>
          nodes.map((node) => ({
            tag: node.tagName,
            childTags: [...node.children].map((child) => child.tagName)
          }))
        );
      expect.soft(structure, 'alZmm lifecycle detail order').toEqual([
        { tag: 'HEADER', childTags: ['A', 'H1', 'P'] },
        { tag: 'DIV', childTags: ['SECTION', 'SECTION', 'DIV'] },
        { tag: 'NAV', childTags: ['A', 'A', 'BUTTON', 'BUTTON', 'A'] }
      ]);
      await expect(route.locator(':scope > div > div#result-group-1 > article')).toHaveCount(1);
      const proposalStructure = await proposal.evaluate((node) =>
        [...node.children].map((child) => child.tagName)
      );
      expect
        .soft(proposalStructure, 'alZmm pending facts precede progress and actions')
        .toEqual(['SECTION', 'DIV']);
      await expect(page.getByText('PADEL INDOOR MADRID', { exact: true })).toBeVisible();
      await expect(page.getByText('Fri, 23 Oct · 18:30–20:00', { exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: /Calle de Alcalá.*Open map/ })).toBeVisible();
    }
    if (frame === 'alZmm') await page.setViewportSize({ width: 390, height: 1042 });
    const actual = await page.screenshot({
      fullPage: frame !== 'alZmm',
      animations: 'disabled',
      caret: 'hide',
      path: info.outputPath(`${frame}-actual.png`)
    });
    const referencePath =
      frame === 'alZmm' ? './references/paf-8/alZmm.png' : `./references/paf-7/${frame}.png`;
    const approved = readFileSync(new URL(referencePath, import.meta.url));
    const measured = await page.evaluate(
      async ({ actualUrl, approvedUrl }) => {
        async function pixels(url: string, scale: number) {
          const image = new Image();
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = image.width / scale;
          canvas.height = image.height / scale;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('No comparison canvas');
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          return {
            width: canvas.width,
            height: canvas.height,
            rgba: context.getImageData(0, 0, canvas.width, canvas.height).data
          };
        }
        // Only normalize the documented 2x Pencil export scale. Never stretch
        // either image to conceal a layout or composition mismatch.
        const [a, b] = await Promise.all([pixels(actualUrl, 1), pixels(approvedUrl, 2)]);
        const dimensions = { actual: [a.width, a.height], reference: [b.width, b.height] };
        if (a.width !== b.width || a.height !== b.height)
          return { ...dimensions, dimensionMismatch: true, perceptualPixelDifference: null };
        let changed = 0;
        const pendingRegions = [
          { name: 'header', start: 0, end: 72, changed: 0 },
          { name: 'hero', start: 72, end: 216, changed: 0 },
          { name: 'overview', start: 216, end: 326, changed: 0 },
          { name: 'pending-and-provenance', start: 326, end: 544, changed: 0 },
          { name: 'teams', start: 544, end: 758, changed: 0 },
          { name: 'scores-and-action', start: 758, end: 972, changed: 0 },
          { name: 'navigation', start: 972, end: a.height, changed: 0 }
        ];
        for (let i = 0; i < a.rgba.length; i += 4) {
          const red = a.rgba[i]! - b.rgba[i]!;
          const green = a.rgba[i + 1]! - b.rgba[i + 1]!;
          const blue = a.rgba[i + 2]! - b.rgba[i + 2]!;
          const y = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
          const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
          const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
          if (
            0.5053 * y * y + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
            35215 * 0.1 ** 2
          ) {
            changed++;
            const row = Math.floor(i / 4 / a.width);
            const region = pendingRegions.find(({ start, end }) => row >= start && row < end);
            if (region) region.changed++;
          }
        }
        return {
          ...dimensions,
          dimensionMismatch: false,
          perceptualPixelDifference: changed / (a.width * a.height),
          pendingRegions: a.height === 1042 ? pendingRegions : undefined
        };
      },
      {
        actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
        approvedUrl: `data:image/png;base64,${approved.toString('base64')}`
      }
    );
    console.info(`${frame} full-frame measurement: ${JSON.stringify(measured)}`);
    const elements = await page.getByRole('main').evaluate((main) =>
      [
        ...main.querySelectorAll(
          'h1, h2, h3, section[aria-live], section[aria-atomic] > p, fieldset, legend, ol, #set-error-1, button[aria-pressed], #score-0-team_a, #score-0-team_b'
        )
      ].map((node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName,
          id: node.id,
          text: node.matches('fieldset, section, ol') ? undefined : node.textContent?.trim(),
          x: rect.x + scrollX,
          y: rect.y + scrollY,
          width: rect.width,
          height: rect.height,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          color: style.color,
          backgroundColor: style.backgroundColor,
          padding: style.padding,
          gap: style.gap,
          borderRadius: style.borderRadius
        };
      })
    );
    console.info(`${frame} element geometry: ${JSON.stringify(elements)}`);
    await info.attach(`${frame}-element-geometry`, {
      body: JSON.stringify(elements, null, 2),
      contentType: 'application/json'
    });
    await info.attach(`${frame}-measurement`, {
      body: JSON.stringify(measured),
      contentType: 'application/json'
    });
    await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
    await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
    const budgets: Record<string, number | null> =
      frame === 'alZmm' ? paf8Manifest.visualBudgets.perScreen : manifest.visualBudgets.perScreen;
    const budget = budgets[frame];
    expect.soft(measured.dimensionMismatch, `${frame} composition dimensions`).toBe(false);
    expect
      .soft(budget, `${frame} reviewed raster tolerance required; no self-baseline`)
      .not.toBeNull();
    if (budget !== null && budget !== undefined && measured.perceptualPixelDifference !== null) {
      expect.soft(budget).toBeGreaterThan(0);
      expect.soft(measured.perceptualPixelDifference).toBeLessThanOrEqual(budget);
    }
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
  await sql(`do $$ begin
    alter table public.match_events disable trigger match_event_immutable;
  end $$;`);
  try {
    await sql(
      `update public.match_events set venue_name='PADEL INDOOR MADRID', court_notes='Calle de Alcalá' where id='${id}'`
    );
  } finally {
    await sql(`do $$ begin
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
  }
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
  await expect(page.getByRole('button', { name: r.submit, exact: true })).toBeDisabled();
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
        await expect(page.locator('[aria-current="step"]')).toHaveText(`${r.steps.players} 1`);
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
        await expect(page.locator('[aria-current="step"]')).toHaveText(`${r.steps.score} 2`);
        await expect(page.getByRole('button', { name: r.submit, exact: true })).toBeDisabled();
        await expect(page.locator('#set-error-1')).toContainText(
          fill(r.invalidCompletedSet, { number: 1, team: r.teams.team_b, score: '6–5' })
        );
        await expect(page.locator('#score-0-team_b')).toHaveAttribute('aria-invalid', 'true');
        await geometry(page);
        await capture('LD9Jv-inline-error-actual');
        // Correct in place: incomplete -> Draw -> WIN; each retains actual teams.
        await page.locator('#score-0-team_b').fill('4');
        await page.locator('#score-0-team_b').blur();
        await expect(page.getByText(r.outcome.incomplete, { exact: true })).toBeVisible();
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
        await expect(page.getByText(r.outcome.draw, { exact: true })).toBeVisible();
        await expect(page.getByText(r.ratingEffect, { exact: true })).toBeVisible();
        await capture('lKv9B-draw-actual');
        await geometry(page);
        await page.locator('#score-2-team_a').fill('7');
        await page.locator('#score-2-team_b').fill('5');
        await page.locator('#score-2-team_b').blur();
        await page.getByRole('button', { name: fill(r.setStateLabel, { number: 3 }) }).click();
        await expect(
          page.getByText(fill(r.outcome.team_a, { winnerSets: 2, loserSets: 1 }), { exact: true })
        ).toBeVisible();
        await capture('Hzcid-win-actual');
        await page.locator('#score-2-team_a').fill('5');
        await page.locator('#score-2-team_b').fill('7');
        await page.locator('#score-2-team_b').blur();
        await expect(
          page.getByText(fill(r.outcome.team_b, { winnerSets: 2, loserSets: 1 }), { exact: true })
        ).toBeVisible();
        await expect(page.locator('form fieldset > legend')).toHaveCount(3);
        for (const number of [1, 2, 3]) {
          await expect(
            page.getByRole('button', { name: fill(r.setStateLabel, { number }) })
          ).toHaveAttribute('aria-pressed', 'true');
        }
        await review(page, locale);
        await expect(page.locator('[aria-current="step"]')).toHaveText(`${r.steps.review} 3`);
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
        await expect(page.getByText(r.ratingEffect, { exact: true })).toHaveCount(0);
        await geometry(page);
        await page.context().close();
        await stale.context().close();
      });
    }
  }
}
