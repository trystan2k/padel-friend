import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import { assertDesignSystemStyles, type StyleCheck } from './league-standings-visual';
import { sql } from './matches-management-fixtures';
import {
  amendmentFixtures,
  claimRepair,
  copies,
  fill,
  repairNow
} from './result-amendments-fixtures';
import manifest from './references/paf-14/manifest.json' with { type: 'json' };
import repairManifest from './references/paf-202-repair-diagnostics/manifest.json' with { type: 'json' };
import {
  type ContractEntry,
  assertColumnStructure,
  assertContained,
  assertFrameContract,
  assertInventory,
  childSummary,
  runCompositionProbes,
  assertContrast,
  assertNear,
  assertNoOverflow,
  assertReducedMotion,
  assertStacked,
  waitForRenderSettled,
  assertTargets,
  box,
  captureBoxes,
  captureGeometry,
  type Geometry,
  frameViewport,
  measureFrame
} from './result-corrections-visual';

// Amendment request (adujr), corrected-result review (s5TRC) and dispute resolution (CWJkF): exact
// structural, accessibility and locale probes plus reviewed raster budgets against the Pencil frames.
type Fixtures = Awaited<ReturnType<typeof amendmentFixtures>>;
type Kind = 'request' | 'review' | 'resolve';
let f: Fixtures;
const locales = ['en', 'pt-BR', 'es'] as const;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(240_000);
  f = await amendmentFixtures(browser);
  await f.grantAdmin();
});
test.afterAll(async () => {
  test.setTimeout(180_000);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(180_000));

/** Brings one correction surface to the state its frame shows and returns the surface root. */
async function prepare(
  kind: Kind,
  locale: (typeof locales)[number],
  width: number,
  theme: 'light' | 'dark'
): Promise<{ page: Page; root: Locator }> {
  const c = copies[locale].matches.corrections;
  const group = await f.confirmed();
  if (kind === 'review' || kind === 'resolve') {
    const amendmentId = await f.requested(group);
    const version = await f.candidate(group, amendmentId);
    if (kind === 'resolve')
      await f.rpc(f.members[1]!, 'review_result_amendment', {
        p_amendment_id: amendmentId,
        p_expected_base_confirmation_id: group.baseId,
        p_expected_candidate_version: version,
        p_decision: 'reject',
        p_reason_code: 'SCORE_INCORRECT',
        p_command_id: crypto.randomUUID()
      });
  }
  const viewer = kind === 'review' ? f.members[1]! : f.creator;
  const page = await f.page(viewer, locale, width, theme, 844);
  await f.open(page, group.eventId);
  const root =
    kind === 'request'
      ? page.getByRole('article', { name: fill(c.requestCardLabel, { number: 1 }), exact: true })
      : page.locator(
          kind === 'review'
            ? '[data-amendment-lifecycle=proposal_pending]'
            : '[data-amendment-lifecycle=disputed]'
        );
  await expect(root).toBeVisible();
  await page
    .locator('section[data-result-corrections]')
    .evaluate((element) => element.scrollIntoView({ block: 'start' }));
  if (kind === 'resolve') {
    await root.getByRole('button', { name: c.resolve.open, exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  }
  return { page, root };
}

/** Design-token expressions that production uses where it differs from the frame (declared adaptations). */
const tk = {
  size12: 'var(--font-size-12)',
  size13: 'var(--font-size-13)',
  size16: 'var(--font-size-16)',
  size20: 'var(--font-size-20)',
  regular: 'var(--font-weight-regular)',
  semibold: 'var(--font-weight-semibold)',
  bold: 'var(--font-weight-bold)',
  heading: 'var(--font-family-heading)',
  tracking: 'var(--font-letter-spacing-1-5)',
  radius12: 'var(--radius-12)',
  radius14: 'var(--radius-14)',
  space8: 'var(--space-8)',
  space9: 'var(--space-9)',
  space11: 'var(--space-11)',
  space4: 'var(--space-4)',
  space18: 'var(--space-18)',
  radius16: 'var(--radius-16)',
  space6: 'var(--space-6)',
  transparent: 'transparent',
  space14: 'var(--space-14)',
  zero: '0px',
  muted: 'var(--color-muted)',
  text: 'var(--color-text)',
  red: 'var(--color-red)',
  amber: 'var(--color-amber)',
  bg: 'var(--color-bg)',
  surface: 'var(--color-surface)',
  surface2: 'var(--color-surface-2)'
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startsWith = (value: string) => new RegExp(`^${escapeRegExp(value)}`);
const group1 = fill(copies.en.matches.results.group, { number: 1 });

/** Composition probes of the request frame's adapted elements (order, adjacency, content identity). */
function requestProbes(page: Page, root: Locator) {
  const c = copies.en.matches.corrections;
  const action = root.getByRole('button', { name: c.request.open, exact: true });
  const pageProbes: Record<string, () => Promise<void>> = {
    'A1.heading': async () => {
      const heading = page.getByRole('heading', { name: c.title, exact: true });
      await expect(heading).toHaveCount(1);
      expect(await heading.evaluate((element) => element.tagName)).toBe('H2');
      await expect(root).toHaveAttribute('aria-label', fill(c.requestCardLabel, { number: 1 }));
      assertStacked(await captureBoxes({ heading, card: root }));
    },
    'A2.noInlineReason': async () => {
      await expect(root.getByRole('textbox')).toHaveCount(0);
    },
    'A3.resultLine': async () => {
      const [, result] = await childSummary(root);
      expect(result?.text).toMatch(new RegExp(`^${escapeRegExp(group1)} · \\d+–\\d+`));
    },
    'A4.noteOrder': async () => {
      const children = await childSummary(root);
      expect(
        children.map((child) => child.tag),
        'request card child order'
      ).toEqual(['P', 'P', 'P', 'DIV']);
      expect(children[2]?.text).toBe(c.requestNote);
      expect(children[3]?.text).toBe(c.request.open);
    },
    'A5.sentenceCase': async () => {
      await expect(root.getByRole('button')).toHaveCount(1);
      await expect(action).toHaveText(c.request.open);
      expect(await action.evaluate((element) => getComputedStyle(element).textTransform)).toBe(
        'none'
      );
      // One atomic sample: the action and the card content box are compared together.
      const sampled = await captureGeometry({ action, card: root });
      assertNear(
        sampled.action.box.width,
        sampled.card.inner.width,
        'action spans the card content width'
      );
    },
    'A6.banner': async () => {
      const [banner] = await childSummary(root);
      expect(banner?.tag).toBe('P');
      expect(banner?.text).toBe(c.officialLabel.toUpperCase());
      const sampled = await captureGeometry({ banner: root.locator('p').first(), card: root });
      assertNear(
        sampled.banner.box.width,
        sampled.card.inner.width,
        'banner spans the card content width'
      );
    },
    'A7.cardChrome': async () => {
      const chrome = await root.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          border: style.borderTopWidth,
          padding: style.paddingTop,
          childBorders: [...element.children].map((child) => getComputedStyle(child).borderTopWidth)
        };
      });
      expect(chrome.border).toBe('1px');
      expect(chrome.padding).toBe('18px');
      expect(chrome.childBorders.every((width) => width === '0px')).toBe(true);
    },
    'A8.noShellNav': async () => {
      await expect(root.locator('nav, [role=navigation]')).toHaveCount(0);
    }
  };
  const dialogProbes: Record<string, () => Promise<void>> = {
    'A2.reasonDialog': async () => {
      await action.click();
      const dialog = page.getByRole('dialog', { name: c.request.title, exact: true });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole('textbox', { name: new RegExp(escapeRegExp(c.request.reason)) })
      ).toBeVisible();
      await expect(dialog.getByText(copies.en.matches.corrections.dialog.required)).toBeVisible();
    }
  };
  return { page: pageProbes, dialog: dialogProbes };
}

function reviewProbes(page: Page, root: Locator) {
  const c = copies.en.matches.corrections;
  const review = copies.en.matches.results.review;
  const proposed = root.getByRole('region', { name: c.proposed });
  const approve = root.getByRole('button', { name: review.approve, exact: true });
  const reject = root.getByRole('button', { name: review.reject, exact: true });
  const pageProbes: Record<string, () => Promise<void>> = {
    'B1.banner': async () => {
      const [banner] = await childSummary(root);
      expect(banner?.tag).toBe('P');
      expect(banner?.text).toBe(c.lifecycle.proposal_pending.toUpperCase());
    },
    'B2.childOrder': async () => {
      const children = await childSummary(root);
      expect(
        children.map((child) => child.tag),
        'review card child order'
      ).toEqual(['P', 'H3', 'P', 'DL', 'SECTION', 'DIV', 'DETAILS']);
      expect(children[1]?.text).toBe(fill(c.cardTitle, { number: 1 }));
    },
    'B3.actionRow': async () => {
      const row = approve.locator('xpath=..');
      expect((await childSummary(row)).map((child) => child.text)).toEqual([
        review.approve,
        review.reject
      ]);
      const sampled = await captureGeometry({ approve, reject, card: root });
      const inner = sampled.card.inner;
      assertNear(sampled.approve.box.y, sampled.reject.box.y, 'approve and reject share a row');
      assertNear(sampled.approve.box.x, inner.x, 'approve at the content edge');
      assertNear(sampled.reject.box.right, inner.right, 'reject at the opposite content edge');
    },
    'B4.rejectTone': async () => {
      const row = approve.locator('xpath=..');
      const buttons = await row.locator('button').allInnerTexts();
      expect(buttons.indexOf(review.approve)).toBeLessThan(buttons.indexOf(review.reject));
      await assertDesignSystemStyles(
        page,
        'light',
        [{ name: 'reject label', locator: reject, palette: { color: 'red' } }],
        'review'
      );
    },
    'B5.proposedLines': async () => {
      const lines = await childSummary(proposed);
      expect(
        lines.map((line) => line.tag),
        'proposed card line order'
      ).toEqual(['H4', 'P', 'P', 'P', 'P', 'P', 'P', 'P']);
      expect(lines[0]?.text).toBe(fill(c.proposedVersion, { version: 2 }).toUpperCase());
      expect(lines[1]?.text).toMatch(/^\d+–\d+/);
      expect(lines[4]?.text).toMatch(startsWith(c.proposedBy.split('{{')[0]!));
      expect(lines[5]?.text).toMatch(startsWith(c.autoConfirm.split('{{')[0]!));
      expect(lines[6]?.text).toMatch(/\d+/);
    },
    'B6.rejectRule': async () => {
      const lines = await childSummary(proposed);
      expect(lines.at(-1)?.text).toBe(c.rejectBlocks);
      expect(
        await proposed.evaluate((element) => element.nextElementSibling?.tagName),
        'actions follow the proposed card directly'
      ).toBe('DIV');
    },
    'B7.headerAndShell': async () => {
      assertStacked(
        await captureBoxes({
          heading: page.getByRole('heading', { name: c.title, exact: true }),
          card: root
        })
      );
      await expect(root.locator('nav, [role=navigation]')).toHaveCount(0);
    }
  };
  return { page: pageProbes };
}

function resolveProbes(page: Page) {
  const c = copies.en.matches.corrections;
  const dialog = page.getByRole('dialog', { name: c.resolve.title, exact: true });
  const disputed = page.locator('[data-amendment-lifecycle=disputed]');
  const dialogProbes: Record<string, () => Promise<void>> = {
    'C1.modal': async () => {
      await expect(dialog).toBeVisible();
      await expect(page.getByRole('heading', { name: c.title, exact: true })).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: c.title, exact: true, includeHidden: true })
      ).toHaveCount(1);
    },
    'C2.dialogHeader': async () => {
      const header = await childSummary(dialog.locator('header'));
      expect(header.map((child) => child.text)).toEqual([
        c.resolve.title,
        fill(c.resolve.description, { group: 1 })
      ]);
      await expect(dialog.getByRole('button')).toHaveCount(2);
    },
    'C3.disputeSummary': async () => {
      const children = await childSummary(disputed);
      expect(children[0]?.text).toBe(c.lifecycle.disputed.toUpperCase());
      expect(children[1]).toEqual({ tag: 'H3', text: fill(c.cardTitle, { number: 1 }) });
      expect(children.map((child) => child.tag)).toContain('DL');
      await expect(disputed.locator('dd').first()).toHaveText('Score recorded backwards');
    },
    'C4.options': async () => {
      await expect(dialog.locator('legend')).toHaveText(c.resolve.legend);
      const fieldset = await childSummary(dialog.locator('fieldset'));
      expect(fieldset.map((child) => child.tag).slice(0, 4)).toEqual([
        'LEGEND',
        'LABEL',
        'LABEL',
        'LABEL'
      ]);
      for (const [index, key] of (['uphold', 'replace', 'void'] as const).entries()) {
        expect(fieldset[index + 1]?.text).toContain(c.resolve.options[key]);
        expect(fieldset[index + 1]?.text).toContain(c.resolve.hints[key]);
      }
      await assertDesignSystemStyles(
        page,
        'dark',
        [
          {
            name: 'selected option',
            locator: dialog.getByRole('radio').first().locator('xpath=ancestor::label'),
            palette: { 'background-color': 'green-soft' }
          }
        ],
        'resolve'
      );
    },
    'C5.justification': async () => {
      const form = await childSummary(dialog.locator('form'));
      expect(
        form.map((child) => child.tag),
        'dialog form order'
      ).toEqual(['FIELDSET', 'LABEL', 'P', 'P', 'P', 'DIV']);
      expect(form[2]?.text).toBe(c.dialog.hint);
      expect(form[3]?.text).toBe(c.dialog.text.required);
      expect(form[4]?.text).toBe(c.resolve.notice);
      expect(form[5]?.text).toBe(`${c.dialog.cancel} ${c.resolve.submit}`);
    },
    'C6.dialogEdges': async () => {
      const edges = await box(dialog);
      assertNear(edges.x, frameViewport.width - edges.right, 'dialog is centered', 1);
      expect.soft(edges.x, 'dialog keeps a margin of at least 12px').toBeGreaterThanOrEqual(12);
      expect
        .soft(edges.x, 'dialog margin stays within the frame gutter')
        .toBeLessThanOrEqual(manifest.geometryReference.gutter);
    }
  };
  return { dialog: dialogProbes };
}

/** Composition probes of the diagnostics frames' adapted elements (order, adjacency, identity). */
/** Production element for each Pencil element of the request frame (typography, color, geometry). */
function requestContract(root: Locator): ContractEntry[] {
  const c = copies.en.matches.corrections;
  const banner = root.locator('p').first();
  const action = root.getByRole('button', { name: c.request.open, exact: true });
  return [
    {
      ref: 'CONFIRMED',
      locator: banner,
      widthInset: 38,
      heightRange: [29, 33],
      allow: { padding: tk.space9, radius: tk.radius12 },
      adaptation: 'A6'
    },
    {
      ref: 'CONFIRMED label',
      locator: banner,
      allow: { letterSpacing: tk.tracking },
      adaptation: 'A6'
    },
    { ref: 'Score', locator: root.locator('p').nth(1) },
    {
      ref: 'Navigation / transition',
      locator: root.getByText(c.requestNote, { exact: true }),
      allow: { color: tk.muted, weight: tk.regular },
      adaptation: 'A4'
    },
    {
      ref: 'Submit amendment',
      locator: action,
      widthInset: 38,
      heightRange: [44, 44.5],
      allow: { padding: tk.space9, gap: tk.zero },
      adaptation: 'A5'
    },
    { ref: 'Button label', locator: action, allow: { caps: 'sentence' }, adaptation: 'A5' }
  ];
}

function reviewContract(root: Locator): ContractEntry[] {
  const c = copies.en.matches.corrections;
  const review = copies.en.matches.results.review;
  const proposed = root.getByRole('region', { name: c.proposed });
  const approve = root.getByRole('button', { name: review.approve, exact: true });
  const reject = root.getByRole('button', { name: review.reject, exact: true });
  const banner = root.locator('p').first();
  const actionBlock = { allow: { padding: tk.space9, gap: tk.zero }, adaptation: 'B3' };
  return [
    {
      ref: 'PROPOSAL PENDING',
      locator: banner,
      widthInset: 38,
      heightRange: [29, 33],
      allow: { fill: tk.surface2, padding: tk.space9, radius: tk.radius12 },
      adaptation: 'B1'
    },
    {
      ref: 'PROPOSAL PENDING label',
      locator: banner,
      allow: { color: tk.amber, letterSpacing: tk.tracking },
      adaptation: 'B1'
    },
    { ref: 'Corrected proposal', locator: proposed, widthInset: 38 },
    { ref: 'New score', locator: proposed.locator('p').first() },
    { ref: 'Submitter', locator: proposed.locator('p').nth(3) },
    {
      ref: 'Deadline',
      locator: proposed.locator('p').nth(4),
      allow: { color: tk.muted },
      adaptation: 'B5'
    },
    {
      ref: 'Approve corrected result',
      locator: approve,
      widthInset: 38,
      columns: 2,
      heightRange: [44, 44.5],
      ...actionBlock
    },
    { ref: 'Button label', locator: approve, allow: { caps: 'sentence' }, adaptation: 'B3' },
    {
      ref: 'Reject corrected result',
      locator: reject,
      widthInset: 38,
      columns: 2,
      heightRange: [44, 44.5],
      ...actionBlock
    },
    {
      ref: 'Button label#2',
      locator: reject,
      allow: { caps: 'sentence', color: tk.red },
      adaptation: 'B4'
    }
  ];
}

function resolveContract(page: Page): ContractEntry[] {
  const c = copies.en.matches.corrections;
  const dialog = page.getByRole('dialog', { name: c.resolve.title, exact: true });
  const disputed = page.locator('[data-amendment-lifecycle=disputed]');
  const radios = dialog.getByRole('radio');
  const option = (index: number) => radios.nth(index).locator('xpath=ancestor::label');
  const rowWidth = { widthTolerance: 40 };
  return [
    {
      ref: 'Screen title',
      locator: dialog.getByRole('heading', { name: c.resolve.title, exact: true }),
      allow: { family: tk.heading },
      adaptation: 'C2'
    },
    {
      ref: 'Screen subtitle',
      locator: dialog.locator('header p').first(),
      allow: { size: tk.size13 },
      adaptation: 'C2'
    },
    {
      ref: 'Dispute status',
      locator: disputed.locator('p').first(),
      skipWidth: true,
      heightRange: [25, 40],
      allow: { fill: tk.surface2, gap: tk.zero, radius: tk.radius12 },
      adaptation: 'C3'
    },
    {
      ref: 'Dispute status text',
      locator: disputed.locator('p').first(),
      allow: { color: tk.red, letterSpacing: tk.tracking, weight: tk.bold },
      adaptation: 'C3'
    },
    {
      ref: 'Dispute title',
      locator: disputed.locator('h3'),
      allow: { family: tk.heading },
      adaptation: 'C3'
    },
    {
      ref: 'Dispute reason',
      locator: disputed.locator('dd').first(),
      allow: { color: tk.text, weight: tk.semibold },
      adaptation: 'C3'
    },
    {
      ref: 'Decision title',
      locator: dialog.locator('legend'),
      allow: { size: tk.size13 },
      adaptation: 'C4'
    },
    { ref: 'Request corrected score option', locator: option(0), ...rowWidth },
    {
      ref: 'Button label',
      locator: option(0).locator('span').first(),
      allow: { color: tk.text },
      adaptation: 'C4'
    },
    { ref: 'Approve submitted proposal option', locator: option(1), ...rowWidth },
    { ref: 'Button label#2', locator: option(1).locator('span').first() },
    { ref: 'Void result option', locator: option(2), ...rowWidth },
    { ref: 'Button label#3', locator: option(2).locator('span').first() }
  ];
}

/** Selected-job detail: heading, summary line, attempt timeline, official revision, correlation id. */
/** Running, queued and succeeded cards of the frame: surface, chip, context line and facts. */
/** Status chip and action styles shared by the correction card and the repair diagnostics cards. */
const bannerStyle = (locator: Locator, name: string, background: string, color: string) => ({
  name,
  locator,
  tokens: {
    'border-top-left-radius': 'var(--radius-12)',
    'padding-top': 'var(--space-8)',
    'padding-left': 'var(--space-9)',
    'font-size': 'var(--font-size-12)',
    'font-weight': 'var(--font-weight-bold)'
  },
  palette: { 'background-color': background, color },
  literals: { 'text-transform': 'uppercase' }
});
const actionStyle = (locator: Locator, name: string, background: string, color: string) => ({
  name,
  locator,
  tokens: {
    'border-top-left-radius': 'var(--radius-12)',
    'min-height': 'calc(var(--space-40) + var(--space-4))',
    'font-size': 'var(--font-size-13)',
    'font-weight': 'var(--font-weight-bold)'
  },
  palette: { 'background-color': background, color }
});

async function structure(kind: Kind, page: Page, root: Locator) {
  const c = copies.en.matches.corrections;
  const g = manifest.geometryReference;
  const main = page.locator('main');
  const theme = kind === 'resolve' ? 'dark' : 'light';
  // Heading semantics: the section heading precedes the card heading in document order.
  // A modal dialog makes the page behind it inert, so its heading is checked in the full tree.
  const sectionHeading = page.getByRole('heading', {
    name: c.title,
    exact: true,
    includeHidden: true
  });
  await expect(sectionHeading).toHaveCount(1);
  const banner = root.locator('p').first();
  const result = root.locator('p').nth(1);
  const note = root.getByText(c.requestNote, { exact: true });
  const action = root.getByRole('button', { name: c.request.open, exact: true });
  const proposed = root.getByRole('region', { name: c.proposed });
  const approve = root.getByRole('button', {
    name: copies.en.matches.results.review.approve,
    exact: true
  });
  const reject = root.getByRole('button', {
    name: copies.en.matches.results.review.reject,
    exact: true
  });
  // Every box compared below comes from ONE atomic capture, inner (content) boxes included.
  const targets: Record<string, Locator> = { main, root };
  if (kind === 'request')
    Object.assign(targets, { heading: sectionHeading, banner, result, note, action });
  if (kind === 'review')
    Object.assign(targets, { heading: sectionHeading, banner, proposed, approve, reject });
  const sampled: Record<string, Geometry> = await captureGeometry(targets);
  const at = (name: string) => sampled[name]!;
  assertContained(at('main').box, at('root').box, `${kind} card inside main`);
  const surface = { 'background-color': 'surface' };
  const cardStyle = {
    name: 'correction card',
    locator: root,
    tokens: {
      'background-color': 'var(--color-surface)',
      'border-top-left-radius': 'var(--radius-16)',
      'padding-top': 'var(--space-18)',
      'row-gap': 'var(--space-14)'
    },
    palette: surface
  };
  if (kind !== 'resolve') {
    // Page-level geometry shared with the frames: 18px gutters and the 10px block rhythm.
    const card = at('root').box;
    assertNear(card.x, g.gutter, `${kind} card left gutter equals the frame gutter`);
    assertNear(frameViewport.width - card.right, g.gutter, `${kind} card right gutter`);
    const heading = at('heading').box;
    assertNear(card.y - heading.bottom, g.blockGap, `${kind} section title to card gap`);
  }
  if (kind === 'request') {
    const inner = at('root').inner;
    const bannerBox = at('banner').box;
    const resultBox = at('result').box;
    const noteBox = at('note').box;
    const actionBox = at('action').box;
    assertStacked({ banner: bannerBox, note: noteBox, action: actionBox });
    // Frame order is banner, result, authority note, action (note below the action in the frame).
    assertStacked({ banner: bannerBox, result: resultBox, note: noteBox, action: actionBox });
    for (const [name, item] of Object.entries({ banner: bannerBox, action: actionBox })) {
      assertNear(item.x, inner.x, `request ${name} aligned to card content edge`);
      assertNear(item.width, inner.width, `request ${name} spans the card content width`);
    }
    assertNear(actionBox.height, g.actionHeight, 'request action height equals the frame action');
    expect
      .soft(bannerBox.height, 'request chip is not shorter than the frame chip')
      .toBeGreaterThanOrEqual(g.chipHeight);
    expect
      .soft(
        bannerBox.height,
        'request chip height delta stays within the declared type-token delta'
      )
      .toBeLessThanOrEqual(g.chipHeight + g.chipHeightMaxDelta);
    assertNear(resultBox.y - bannerBox.bottom, 14, 'request banner to result gap = card gap token');
    assertNear(noteBox.y - resultBox.bottom, 14, 'request result to note gap = card gap token');
    assertNear(actionBox.y - noteBox.bottom, 14, 'request note to action gap = card gap token');
    await assertDesignSystemStyles(
      page,
      theme,
      [
        cardStyle,
        bannerStyle(banner, 'official-result chip', 'green-soft', 'green'),
        actionStyle(action, 'request action', 'green', 'bg')
      ],
      kind
    );
  } else if (kind === 'review') {
    const inner = at('root').inner;
    const bannerBox = at('banner').box;
    const proposedBox = at('proposed').box;
    const approveBox = at('approve').box;
    const rejectBox = at('reject').box;
    assertStacked({ banner: bannerBox, proposed: proposedBox, approve: approveBox });
    for (const [name, item] of Object.entries({ banner: bannerBox, proposed: proposedBox })) {
      assertNear(item.x, inner.x, `review ${name} aligned to card content edge`);
      assertNear(item.width, inner.width, `review ${name} spans the card content width`);
    }
    // Approve and reject are two equal 44px actions in one row separated by the action gap token.
    assertNear(approveBox.height, g.actionHeight, 'approve height equals the frame action');
    assertNear(rejectBox.height, g.actionHeight, 'reject height equals the frame action');
    assertNear(approveBox.y, rejectBox.y, 'approve and reject share a row');
    assertNear(approveBox.width, rejectBox.width, 'approve and reject have equal width', 1);
    assertNear(rejectBox.x - approveBox.right, 8, 'approve to reject gap = action gap token');
    assertNear(approveBox.x, inner.x, 'approve starts at the card content edge');
    assertNear(rejectBox.right, inner.right, 'reject ends at the card content edge');
    assertNear(approveBox.y - proposedBox.bottom, 14, 'proposed to actions gap = card gap token');
    await assertDesignSystemStyles(
      page,
      theme,
      [
        cardStyle,
        bannerStyle(banner, 'pending-review chip', 'surface-2', 'amber'),
        {
          name: 'proposed result surface',
          locator: proposed,
          tokens: {
            'border-top-left-radius': 'var(--radius-14)',
            'padding-top': 'var(--space-11)',
            'row-gap': 'var(--space-5)'
          },
          palette: { 'background-color': 'green-soft' }
        },
        actionStyle(approve, 'approve action', 'green', 'bg'),
        actionStyle(reject, 'reject action', 'surface-2', 'red')
      ],
      kind
    );
  } else {
    const dialog = page.getByRole('dialog', { name: c.resolve.title, exact: true });
    await expect(dialog).toBeVisible();
    const radios = dialog.getByRole('radio');
    await expect(radios).toHaveCount(3);
    // The dialog and its three option rows (the radio's label, else the radio) in one capture.
    const rowTargets: Record<string, Locator> = { dialog };
    for (const index of [0, 1, 2])
      rowTargets[`row${index}`] = radios.nth(index).locator('xpath=(ancestor::label[1] | .)[1]');
    const dialogSample: Record<string, Geometry> = await captureGeometry(rowTargets);
    const dialogBox = dialogSample.dialog!.box;
    assertNear(
      dialogBox.x,
      frameViewport.width - dialogBox.right,
      'dialog is horizontally centered',
      1
    );
    expect
      .soft(Math.abs(dialogBox.x - g.gutter), 'dialog edge distance to the frame gutter')
      .toBeLessThanOrEqual(g.dialogGutterMaxDelta);
    const rows = [0, 1, 2].map((index) => dialogSample[`row${index}`]!.box);
    for (const [index, row] of rows.entries()) {
      assertContained(dialogBox, row, `resolution option ${index + 1}`);
      expect
        .soft(row.height, `option ${index + 1} meets the frame option height`)
        .toBeGreaterThanOrEqual(g.optionHeight);
      assertNear(row.x, rows[0]!.x, `option ${index + 1} aligned with option 1`);
      assertNear(row.width, rows[0]!.width, `option ${index + 1} width equals option 1`);
      if (index) {
        expect.soft(row.y, 'options stack').toBeGreaterThanOrEqual(rows[index - 1]!.bottom - 2);
        assertNear(
          row.y - rows[index - 1]!.bottom,
          rows[1]!.y - rows[0]!.bottom,
          `option ${index + 1} rhythm repeats`
        );
      }
    }
    await dialog.getByRole('radio').first().check();
    const field = dialog.getByRole('textbox');
    const submit = dialog.getByRole('button', { name: c.resolve.submit, exact: true });
    const cancel = dialog.getByRole('button', { name: c.dialog.cancel, exact: true });
    const fieldSample = await captureGeometry({ dialog, field });
    const dialogInner = fieldSample.dialog.inner;
    const fieldBox = fieldSample.field.box;
    assertNear(fieldBox.x, dialogInner.x, 'justification field aligned to the dialog content edge');
    assertNear(
      fieldBox.width,
      dialogInner.width,
      'justification field spans the dialog content width'
    );
    // The field is labelled and its error is associated when the justification is missing.
    await submit.click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await field.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    // One post-submit capture: validation may reflow the dialog, so the action boxes and the
    // dialog inner edges they are compared against must come from the same snapshot generation.
    const resolveSamples = await captureGeometry({ dialog, field, submit, cancel });
    assertStacked({ field: resolveSamples.field.box, submit: resolveSamples.submit.box });
    const cancelBox = resolveSamples.cancel.box;
    const submitBox = resolveSamples.submit.box;
    assertNear(cancelBox.y, submitBox.y, 'dialog actions share a row');
    assertNear(cancelBox.height, g.actionHeight, 'cancel action height equals the frame action');
    assertNear(submitBox.height, g.actionHeight, 'record action height equals the frame action');
    assertNear(cancelBox.width, submitBox.width, 'dialog actions have equal width', 1);
    assertNear(
      cancelBox.x,
      resolveSamples.dialog.inner.x,
      'cancel starts at the dialog content edge'
    );
    assertNear(
      submitBox.right,
      resolveSamples.dialog.inner.right,
      'record ends at the dialog content edge'
    );
    await assertDesignSystemStyles(
      page,
      theme,
      [
        {
          name: 'resolution dialog surface',
          locator: dialog,
          tokens: { 'background-color': 'var(--color-surface)' },
          palette: surface
        }
      ],
      kind
    );
  }
}

/** Production counterpart of each manifest region (comparable surface shown in the Pencil frame). */
function regionsFor(kind: Kind, page: Page, root: Locator): Record<string, Locator> {
  const c = copies.en.matches.corrections;
  if (kind === 'request')
    return {
      statusBanner: root.locator('p').first(),
      requestAction: root.getByRole('button', { name: c.request.open, exact: true }),
      correctionCard: root
    };
  if (kind === 'review')
    return {
      proposedResult: root.getByRole('region', { name: c.proposed }),
      approveAction: root.getByRole('button', {
        name: copies.en.matches.results.review.approve,
        exact: true
      }),
      rejectAction: root.getByRole('button', {
        name: copies.en.matches.results.review.reject,
        exact: true
      }),
      correctionCard: root
    };
  return { resolutionSurface: page.getByRole('dialog', { name: c.resolve.title, exact: true }) };
}

const frames: Record<Kind, 'adujr' | 's5TRC' | 'CWJkF'> = {
  request: 'adujr',
  review: 's5TRC',
  resolve: 'CWJkF'
};

for (const kind of ['request', 'review', 'resolve'] as const) {
  test(`${kind} surface matches its Pencil frame structure, accessibility and raster budget`, async ({
    browserName
  }, testInfo) => {
    expect(browserName).toBe('chromium');
    const theme = kind === 'resolve' ? 'dark' : 'light';
    const { page, root } = await prepare(kind, 'en', 390, theme);
    await structure(kind, page, root);
    await assertFrameContract(
      frames[kind],
      kind === 'resolve' ? 'dialog' : 'page',
      kind === 'request'
        ? requestContract(root)
        : kind === 'review'
          ? reviewContract(root)
          : resolveContract(page)
    );
    const scope = kind === 'resolve' ? page.getByRole('dialog') : root;
    await assertTargets(scope, kind);
    await assertContrast(scope, kind);
    await assertReducedMotion(page, scope, kind);
    await assertNoOverflow(page, kind);
    if (kind === 'request')
      await runCompositionProbes('adujr', 'page', requestProbes(page, root).page);
    else if (kind === 'review')
      await runCompositionProbes('s5TRC', 'page', reviewProbes(page, root).page);
    else await runCompositionProbes('CWJkF', 'dialog', resolveProbes(page).dialog);
    await measureFrame(
      frames[kind],
      page,
      testInfo,
      kind === 'resolve' ? 'dialog' : 'page',
      regionsFor(kind, page, root)
    );
    // The request reason dialog opens last: it leaves the page state.
    if (kind === 'request')
      await runCompositionProbes('adujr', 'dialog', requestProbes(page, root).dialog);
  });

  for (const locale of locales) {
    test(`${kind} surface keeps long ${locale} text inside 320px without overlap`, async () => {
      const { page, root } = await prepare(
        kind,
        locale,
        320,
        kind === 'resolve' ? 'dark' : 'light'
      );
      await expect(kind === 'resolve' ? page.getByRole('dialog') : root).toBeVisible();
      await assertNoOverflow(page, `${kind} ${locale}`);
      await assertTargets(
        kind === 'resolve' ? page.getByRole('dialog') : root,
        `${kind} ${locale}`
      );
    });
  }
}

// Platform Admin repair diagnostics (SluH3 desktop dark, cuVwp mobile light, Jjrtb mobile dark). The
// design has no desktop-light frame: that rendering is probed structurally only.
type JobKey = 'failed' | 'running' | 'queued' | 'succeeded';
const jobKeys: JobKey[] = ['failed', 'running', 'queued', 'succeeded'];
const repairJobs: Record<JobKey, string> = { failed: '', running: '', queued: '', succeeded: '' };
const failureFunction = 'public.fixture_result_repair_visual_failure';
const diagnosticsPath = '/platform-admin/result-repairs';
const d = copies.en.matches.corrections;
const jobTone: Record<JobKey, [string, string]> = {
  failed: ['red-soft', 'red'],
  succeeded: ['green-soft', 'green-ink'],
  running: ['surface-2', 'text'],
  queued: ['amber-soft', 'amber']
};

/** Diagnostics page with every seeded job card rendered; `beforeGoto` installs routes before the first request. */
async function diagnosticsPage(
  locale: (typeof locales)[number],
  width: number,
  theme: 'light' | 'dark',
  height = 844,
  beforeGoto?: (page: Page) => Promise<void>
) {
  await f.grantAdmin();
  await sql(
    `insert into public.platform_admins(user_id) values ('${f.creator.id}') on conflict do nothing`
  );
  const page = await f.page(f.creator, locale, width, theme, height);
  await beforeGoto?.(page);
  await page.goto(diagnosticsPath);
  await waitForHydratedPage(page);
  const root = page.locator('[data-result-route=repair-diagnostics]');
  await expect(root).toBeVisible();
  for (const key of jobKeys) await expect(jobArticle(page, key)).toBeVisible();
  return { page, root };
}
/**
 * Body of the selected job's attempt timeline (list, empty note or error). The detail reads its
 * attempts after mount, so the section keeps growing past the job cards and any quiet-frame gate
 * until this body exists.
 */
const repairTimelineBody = (page: Page) => page.locator('[data-repair-detail] h3 ~ :is(ol, p)');
async function openDiagnostics(
  locale: (typeof locales)[number],
  width: number,
  theme: 'light' | 'dark',
  height = 844,
  beforeGoto?: (page: Page) => Promise<void>,
  /** Synchronous markers around the timeline gate, so a regression can prove where the helper is. */
  gateProbe?: { reachedGate: () => void; crossedGate: () => void }
) {
  const opened = await diagnosticsPage(locale, width, theme, height, beforeGoto);
  gateProbe?.reachedGate();
  // Content readiness (the timeline read has landed), then fonts and layout settle before any probe samples.
  await expect(repairTimelineBody(opened.page)).toHaveCount(1);
  gateProbe?.crossedGate();
  await waitForRenderSettled(opened.page);
  return opened;
}
/** The queue job card (the surface) and the transparent status section embedded in it. */
const jobArticle = (page: Page, key: JobKey) =>
  page.locator(`[data-repair-job="${repairJobs[key]}"]`);
const jobStatus = (page: Page, key: JobKey) =>
  jobArticle(page, key).locator('[data-repair-status]');
const statusLabels = ['queued', 'running', 'failed', 'succeeded'] as const;

/** Exact geometry of the elements the diagnostics frames and the route share. */
async function diagnosticsStructure(
  page: Page,
  root: Locator,
  theme: 'light' | 'dark',
  viewportWidth: number
) {
  const g = manifest.geometryReference;
  const desktop = viewportWidth >= 960;
  const title = page.getByRole('heading', { level: 1 });
  const header = root.locator('header').first();
  const scheduler = root.locator('[data-repair-scheduler]');
  const queue = root.locator('[data-repair-region=queue]');
  const detail = root.locator('[data-repair-region=detail]');
  const detailSection = detail.locator('[data-repair-detail]');
  const summary = detail.locator('table').first();
  await expect(scheduler).toBeVisible();
  // Data readiness for every element that is compared, before the single atomic sample below.
  const jobLocators: Record<string, Locator> = {};
  for (const key of jobKeys) {
    const article = jobArticle(page, key);
    const status = jobStatus(page, key);
    await expect(article).toBeVisible();
    const retry = status.getByRole('button', { name: d.repair.retry, exact: true });
    await expect(retry, `${key} retry entry`).toHaveCount(key === 'failed' ? 1 : 0);
    jobLocators[`${key}:article`] = article;
    jobLocators[`${key}:status`] = status;
    jobLocators[`${key}:chip`] = status.locator('output > span').first();
    jobLocators[`${key}:facts`] = status.locator('dl');
    if (key === 'failed') jobLocators[`${key}:retry`] = retry;
  }
  // Every compared box comes from ONE evaluation: a diagnostics refresh or lease-status change
  // between separate samples would otherwise tear the comparison (PAF-175).
  const sampled: Record<string, Geometry> = await captureGeometry({
    root,
    title,
    header,
    scheduler,
    queue,
    detail,
    detailSection,
    summary,
    jobsHeading: page.getByRole('heading', { name: d.diagnostics.jobs, exact: true }),
    summaryHeading: page.getByRole('heading', { name: d.diagnostics.summary, exact: true }),
    ...jobLocators
  });
  const at = (name: string) => sampled[name]!;
  const rootBox = at('root').box;
  const inner = at('root').inner;
  if (desktop) {
    assertNear(inner.x, g.desktopPadding, 'desktop content padding equals the frame padding');
    assertNear(rootBox.x, (viewportWidth - rootBox.width) / 2, 'desktop column is centered', 1);
    expect
      .soft(rootBox.width, 'desktop column keeps the 1280px max width')
      .toBeLessThanOrEqual(1280.5);
  } else {
    assertNear(inner.x, 20, 'mobile content left gutter equals the frame gutter');
    assertNear(viewportWidth - inner.right, 20, 'mobile content right gutter');
    expect
      .soft(rootBox.width, 'mobile column keeps the 480px max width')
      .toBeLessThanOrEqual(480.5);
  }
  const [headerBox, schedulerBox, queueBox, detailBox] = [
    at('header').box,
    at('scheduler').box,
    at('queue').box,
    at('detail').box
  ];
  assertNear(headerBox.x, inner.x, 'header aligned to the content edge');
  assertNear(headerBox.width, inner.width, 'header spans the full content width');
  assertNear(schedulerBox.x, inner.x, 'scheduler card aligned to the content edge');
  assertNear(schedulerBox.width, inner.width, 'scheduler card spans the full content width');
  assertStacked({ title: at('title').box, scheduler: schedulerBox, regions: queueBox });
  assertNear(
    queueBox.y - schedulerBox.bottom,
    desktop ? 16 : 14,
    'regions follow the scheduler by the page gap token'
  );
  expect(
    await queue.evaluate(
      (element, other) =>
        Boolean(element.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING),
      await detail.elementHandle()
    ),
    'queue region precedes detail region in the DOM'
  ).toBe(true);
  const columns = await queue.evaluate(
    (element) => getComputedStyle(element.parentElement!).gridTemplateColumns.split(' ').length
  );
  if (desktop) {
    expect(columns, 'two grid columns at 960px and above').toBe(2);
    assertNear(queueBox.x, inner.x, 'queue region starts at the content edge');
    assertNear(detailBox.right, inner.right, 'detail region ends at the content edge');
    assertNear(detailBox.x - queueBox.right, 24, 'regions are one frame gap apart');
    assertNear(queueBox.width / detailBox.width, 716 / 460, 'frame column ratio', 0.01);
    assertNear(queueBox.y, detailBox.y, 'regions start on the same row', 1);
    assertNear(
      queueBox.width,
      g.queueWidth,
      'queue width stays near the frame queue column',
      g.regionWidthTolerance
    );
    assertNear(
      detailBox.width,
      g.detailWidth,
      'detail width stays near the frame detail column',
      g.regionWidthTolerance
    );
  } else {
    expect(columns, 'one grid column below 960px').toBe(1);
    for (const [name, region] of Object.entries({ queue: queueBox, detail: detailBox })) {
      assertNear(region.x, inner.x, `${name} region aligned to the content edge`);
      assertNear(region.width, inner.width, `${name} region spans the content width`);
    }
    expect
      .soft(detailBox.y, 'detail stacks below the queue')
      .toBeGreaterThanOrEqual(queueBox.bottom + 9);
    assertNear(detailBox.y - queueBox.bottom, 14, 'stacked regions are one page gap apart');
  }
  // Queue region: heading and jobs. Detail region: selected-job detail above the status counts.
  const jobsHeading = at('jobsHeading').box;
  assertContained(queueBox, jobsHeading, 'jobs heading inside the queue region');
  const summaryHeading = at('summaryHeading').box;
  assertContained(detailBox, summaryHeading, 'summary heading inside the detail region');
  assertContained(detailBox, at('detailSection').box, 'job detail inside the detail region');
  assertStacked({ detail: at('detailSection').box, summary: summaryHeading });
  assertContained(detailBox, at('summary').box, 'status counts inside the detail region');
  await assertColumnStructure(summary, 'repair summary table');
  // The four status headers are real, distinct translated labels (no unresolved placeholder).
  const headers = await summary.locator('thead th').allInnerTexts();
  expect(headers, 'status count headers are the translated status labels in order').toEqual(
    statusLabels.map((status) => d.repair.status[status])
  );
  expect(new Set(headers).size, 'four distinct status headers').toBe(4);
  expect(headers.join(' '), 'no unresolved interpolation in the headers').not.toContain('${');
  const articles = await queue.locator('[data-repair-job]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const { y, bottom } = node.getBoundingClientRect();
      return { y: y + window.scrollY, bottom: bottom + window.scrollY };
    })
  );
  for (const [index, item] of articles.entries())
    if (index)
      assertNear(
        item.y - articles[index - 1]!.bottom,
        12,
        `job ${index + 1} follows job ${index} by the section gap token`
      );
  await expect(root.locator('[data-repair-job]')).toHaveCount(articles.length);
  const checks: StyleCheck[] = [
    {
      name: 'job detail card',
      locator: detailSection,
      tokens: {
        'border-top-left-radius': 'var(--radius-20)',
        'padding-top': 'var(--space-16)',
        'row-gap': 'var(--space-12)'
      },
      palette: { 'background-color': 'surface' }
    }
  ];
  for (const key of jobKeys) {
    const article = jobArticle(page, key);
    const status = jobStatus(page, key);
    const articleBox = at(`${key}:article`).box;
    const articleInner = at(`${key}:article`).inner;
    assertContained(queueBox, articleBox, `${key} job card inside the queue region`);
    assertNear(articleBox.x, queueBox.x, `${key} job card aligned to the queue edge`);
    assertNear(articleBox.width, queueBox.width, `${key} job card spans the queue width`);
    // The embedded status section is transparent and sits at the card content edges.
    const statusBox = at(`${key}:status`).box;
    assertNear(statusBox.x, articleInner.x, `${key} status section at the card content edge`);
    assertNear(
      statusBox.width,
      articleInner.width,
      `${key} status section spans the card content width`
    );
    const chip = status.locator('output > span').first();
    const chipBox = at(`${key}:chip`).box;
    assertContained(articleInner, chipBox, `${key} status chip within the card`);
    await expect(status.locator('[data-repair-select]')).toHaveAccessibleName(
      new RegExp(repairJobs[key])
    );
    expect
      .soft(chipBox.width, `${key} status chip hugs its label`)
      .toBeLessThan(articleInner.width);
    assertStacked({ chip: chipBox, facts: at(`${key}:facts`).box });
    const retry = status.getByRole('button', { name: d.repair.retry, exact: true });
    if (key === 'failed') {
      const retryBox = at(`${key}:retry`).box;
      assertNear(retryBox.height, 52, 'retry action meets the Clubhouse control target');
      assertNear(retryBox.x, articleInner.x, 'retry action at the card content edge');
      assertNear(
        retryBox.right,
        articleInner.right,
        'retry action reaches the opposite content edge'
      );
      checks.push({
        name: 'retry entry action',
        locator: retry,
        palette: { 'background-color': 'surface', color: 'text' }
      });
    }
    checks.push(
      {
        name: `${key} job card`,
        locator: article,
        tokens: {
          'border-top-left-radius': 'var(--radius-18)',
          'padding-top': 'var(--space-16)',
          'row-gap': 'var(--space-8)'
        },
        palette: { 'background-color': 'surface' }
      },
      {
        name: `${key} status chip`,
        locator: chip,
        tokens: {
          'border-top-left-radius': 'var(--radius-12)',
          'padding-top': 'var(--space-4)',
          'padding-left': 'var(--space-10)',
          'font-size': 'var(--font-size-13)',
          'font-weight': 'var(--font-weight-semibold)'
        },
        palette: { 'background-color': jobTone[key][0], color: jobTone[key][1] },
        literals: { 'text-transform': 'none' }
      }
    );
  }
  await assertDesignSystemStyles(page, theme, checks, 'diagnostics');
}

/** Retry confirmation: equal 52px actions in one row at reference viewports. */
async function confirmationStructure(page: Page, theme: 'light' | 'dark', viewportWidth: number) {
  const dialog = page.getByRole('dialog', { name: d.repair.confirmTitle, exact: true });
  await expect(dialog).toBeVisible();
  await waitForRenderSettled(page);
  const cancel = dialog.getByRole('button', { name: d.dialog.cancel, exact: true });
  const confirm = dialog.getByRole('button', { name: d.repair.confirmAction, exact: true });
  // One atomic sample for every compared box (see captureGeometry).
  const sampled = await captureGeometry({
    dialog,
    title: dialog.getByRole('heading', { name: d.repair.confirmTitle, exact: true }),
    cancel,
    confirm
  });
  const dialogBox = sampled.dialog.box;
  const dialogInner = sampled.dialog.inner;
  const cancelBox = sampled.cancel.box;
  const confirmBox = sampled.confirm.box;
  assertNear(
    dialogBox.x,
    viewportWidth - dialogBox.right,
    'retry dialog is horizontally centered',
    1
  );
  assertNear(cancelBox.y, confirmBox.y, 'retry dialog actions share a row');
  assertNear(cancelBox.height, 52, 'cancel action meets the Clubhouse control target');
  assertNear(confirmBox.height, 52, 'confirm action meets the Clubhouse control target');
  assertNear(cancelBox.width, confirmBox.width, 'retry dialog actions have equal width', 1);
  assertNear(cancelBox.x, dialogInner.x, 'cancel starts at the dialog content edge');
  assertNear(confirmBox.right, dialogInner.right, 'confirm ends at the dialog content edge');
  assertStacked({ title: sampled.title.box, actions: cancelBox });
  await assertDesignSystemStyles(
    page,
    theme,
    [
      {
        name: 'retry dialog surface',
        locator: dialog,
        palette: { 'background-color': 'surface-2' }
      }
    ],
    'diagnostics dialog'
  );
  return { dialog, cancel };
}

/** Queue selection: aria-current, selected border, detail identity, arrow-key wrap, Enter and Space. */
async function selectionProbes(page: Page, desktop: boolean) {
  const select = (key: JobKey) => jobArticle(page, key).locator('[data-repair-select]');
  const detail = page.locator('[data-repair-detail]');
  const buttons = page.locator('[data-repair-region=queue] [data-repair-select]');
  const count = await buttons.count();
  expect(count, 'every queue job has a select button').toBe(
    await page.locator('[data-repair-job]').count()
  );
  await select('succeeded').click();
  await expect(detail).toHaveAttribute('data-repair-detail', repairJobs.succeeded);
  const identifier = detail.locator('[data-repair-identifier]');
  await expect(identifier).toHaveText(repairJobs.succeeded);
  await expect(identifier).toHaveCSS('overflow-wrap', 'anywhere');
  await expect(identifier).toHaveCSS('user-select', 'text');
  await expect(page.locator('[data-repair-select][aria-current=true]')).toHaveCount(1);
  await expect(select('succeeded')).toHaveAttribute('aria-current', 'true');
  await expect(select('failed')).not.toHaveAttribute('aria-current', 'true');
  await assertDesignSystemStyles(
    page,
    await page.evaluate(() =>
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    ),
    [
      {
        name: 'selected job card border',
        locator: jobArticle(page, 'succeeded'),
        palette: { 'border-top-color': 'green' }
      },
      {
        name: 'unselected job card border',
        locator: jobArticle(page, 'failed'),
        palette: { 'border-top-color': 'hairline' }
      }
    ],
    desktop ? 'selection desktop' : 'selection mobile'
  );
  // A committed job shows "before → after"; an uncommitted one shows a dash.
  await expect(detail.locator('dd').first()).toHaveText(/^\S+ → \d+$/);
  await select('failed').click();
  await expect(detail).toHaveAttribute('data-repair-detail', repairJobs.failed);
  await expect(detail.locator('dd').first()).toHaveText('—');
  // Keyboard: arrows move focus with wrap, Enter and Space select.
  await buttons.first().focus();
  await page.keyboard.press('ArrowUp');
  await expect(buttons.nth(count - 1)).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(buttons.nth(1)).toBeFocused();
  await select('running').focus();
  await page.keyboard.press('Enter');
  await expect(detail).toHaveAttribute('data-repair-detail', repairJobs.running);
  await select('queued').focus();
  await page.keyboard.press('Space');
  await expect(detail).toHaveAttribute('data-repair-detail', repairJobs.queued);
  await select('failed').click();
  await expect(detail).toHaveAttribute('data-repair-detail', repairJobs.failed);
  await expect(detail.locator('ol')).toBeVisible();
  await expect(detail.locator('ol')).toHaveAttribute('aria-label', d.diagnostics.attemptsCaption);
}

async function compareRepairSurfaces(
  page: Page,
  info: TestInfo,
  frame: keyof typeof repairManifest.approvedReferences,
  cards: Record<'queueCard' | 'detailCard', Locator>
) {
  const approved = repairManifest.approvedReferences[frame];
  const reference = readFileSync(
    new URL(`./references/paf-202-repair-diagnostics/${approved.file}`, import.meta.url)
  );
  const full = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
  await info.attach(`${frame}-actual`, { body: full, contentType: 'image/png' });
  const measurements: Record<string, number> = {};
  for (const name of ['queueCard', 'detailCard'] as const) {
    const actual = await cards[name].screenshot({ animations: 'disabled', scale: 'css' });
    const difference = await page.evaluate(
      async ({ approvedImage, actualImage, crop }) => {
        const [x, y, referenceWidth] = crop;
        const width = 96;
        const height = 8;
        const top = 6;
        async function sample(source: string, left: number, offset: number, cropWidth?: number) {
          const image = new Image();
          image.src = `data:image/png;base64,${source}`;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Canvas context unavailable');
          const start = left + Math.floor(((cropWidth ?? image.width) - width) / 2);
          context.drawImage(image, start, offset, width, height, 0, 0, width, height);
          return context.getImageData(0, 0, width, height).data;
        }
        const [expected, produced] = await Promise.all([
          sample(approvedImage, x!, y! + top, referenceWidth),
          sample(actualImage, 0, top)
        ]);
        let changed = 0;
        for (let i = 0; i < produced.length; i += 4) {
          if (
            [0, 1, 2].some(
              (channel) => Math.abs(expected[i + channel]! - produced[i + channel]!) > 8
            )
          ) {
            changed++;
          }
        }
        return changed / (width * height);
      },
      {
        crop: approved.crops[name],
        approvedImage: reference.toString('base64'),
        actualImage: actual.toString('base64')
      }
    );
    measurements[name] = difference;
    expect.soft(difference, `${frame} ${name} raster budget`).toBeLessThanOrEqual(approved.budget);
  }
  await info.attach(`${frame}-measurements`, {
    body: JSON.stringify(measurements),
    contentType: 'application/json'
  });
  console.info(`U22 ${frame}: ${JSON.stringify(measurements)}`);
}

const diagnosticsFrames = [
  { frame: 'bomAY', theme: 'light', width: 1280, height: 900 },
  { frame: 'cuVwp', theme: 'light', width: 390, height: 844 },
  { frame: 'Jjrtb', theme: 'dark', width: 390, height: 844 },
  { frame: 'SluH3', theme: 'dark', width: 1280, height: 900 }
] as const;

test('inventory accounts for every Pencil element of every frame', () => {
  for (const frame of ['adujr', 's5TRC', 'CWJkF', 'xbIxj', 'cuVwp', 'Jjrtb', 'SluH3'] as const)
    assertInventory(frame);
});

test.describe('geometry snapshot helper', () => {
  const markup = `<style>body{margin:0;height:3000px}.box{position:absolute;box-sizing:border-box;border:2px solid;padding:5px;width:100px}</style>
    <div id="a" class="box" style="left:20px;top:10px;height:50px"></div>
    <div id="b" class="box" style="left:20px;top:100px;height:40px"></div>`;

  /** Replaces #a with a moved copy right after the locator resolved its handle (a live re-render). */
  const replacedAfterResolve = (page: Page, locator: Locator, times: number) => {
    let remaining = times;
    return new Proxy(locator, {
      get(target, property) {
        if (property === 'elementHandle')
          return async () => {
            const handle = await target.elementHandle();
            if (remaining-- > 0)
              await page.evaluate(() => {
                const element = document.querySelector('#a');
                const copy = element?.cloneNode(true);
                if (copy instanceof HTMLElement) copy.style.top = '300px';
                if (copy) element?.replaceWith(copy);
              });
            return handle;
          };
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  };

  test('returns border and content boxes in document coordinates, in key order', async ({
    page
  }) => {
    await page.setContent(markup);
    await page.evaluate(() => window.scrollTo(0, 200));
    const sampled = await captureGeometry({ b: page.locator('#b'), a: page.locator('#a') });
    expect(Object.keys(sampled)).toEqual(['b', 'a']);
    expect(sampled.a.box).toEqual({ x: 20, y: 10, right: 120, bottom: 60, width: 100, height: 50 });
    expect(sampled.a.inner).toEqual({
      x: 27,
      y: 17,
      right: 113,
      bottom: 53,
      width: 86,
      height: 36
    });
    expect(sampled.b.box.y).toBe(100);
    const boxes = await captureBoxes({ a: page.locator('#a'), b: page.locator('#b') });
    expect(boxes).toEqual({ a: sampled.a.box, b: sampled.b.box });
  });

  test('retakes the whole snapshot when an element is replaced after its handle resolved', async ({
    page
  }) => {
    await page.setContent(markup);
    const sampled = await captureGeometry({
      a: replacedAfterResolve(page, page.locator('#a'), 1),
      b: page.locator('#b')
    });
    // The detached original (top 10) is never reported; the snapshot is the current generation.
    expect(sampled.a.box.y).toBe(300);
    expect(sampled.a.box.height).toBe(50);
    expect(sampled.b.box.y).toBe(100);
  });

  test('fails loudly instead of returning a degenerate snapshot when elements keep detaching', async ({
    page
  }) => {
    await page.setContent(markup);
    await expect(
      captureGeometry({ a: replacedAfterResolve(page, page.locator('#a'), 100) })
    ).rejects.toThrow(/kept detaching elements.*: a/);
  });
});

test.describe('repair diagnostics', () => {
  test.describe.configure({ mode: 'serial' });
  test.afterAll(async () => {
    test.setTimeout(120_000);
    await sql(
      `do $cleanup$ begin drop trigger if exists fixture_result_repair_visual_failure on public.statistics_group_facts; drop function if exists ${failureFunction}(); end $cleanup$`
    );
  });

  for (const { frame, theme, width, height } of diagnosticsFrames) {
    test(`empty queue (${frame}) keeps the region layout and the empty-state typography`, async () => {
      await f.grantAdmin();
      const page = await f.page(f.creator, 'en', width, theme, height);
      await page.goto(`/community/${f.community}/repairs`);
      await waitForHydratedPage(page);
      const root = page.locator('[data-result-route=repair-diagnostics]');
      await expect(root).toBeVisible();
      const empty = page.getByText(d.diagnostics.empty, { exact: true });
      await expect(empty).toBeVisible();
      for (const count of await root.locator('[data-repair-count]').all())
        await expect(count).toHaveText('0');
      await waitForRenderSettled(page);
      const sampled = await captureGeometry({
        root,
        title: page.getByRole('heading', { level: 1 }),
        jobs: page.getByRole('heading', { name: d.diagnostics.jobs, exact: true }),
        empty,
        summary: page.getByRole('heading', { name: d.diagnostics.summary, exact: true })
      });
      const inner = sampled.root.inner;
      const jobs = sampled.jobs.box;
      const summary = sampled.summary.box;
      if (width >= 960) {
        assertNear(
          inner.x,
          manifest.geometryReference.desktopPadding,
          'empty queue content padding'
        );
        expect.soft(summary.x, 'status counts sit beside the queue').toBeGreaterThan(jobs.right);
      } else {
        assertNear(inner.x, 20, 'empty queue content gutter');
        assertStacked({ title: sampled.title.box, jobs, empty: sampled.empty.box, summary });
      }
      const queue = root.locator('[data-repair-region=queue]');
      await expect(queue.locator('[data-repair-empty]')).toHaveText(d.diagnostics.empty);
      await expect(queue).toContainText(d.diagnostics.communitySubtitle);
      await expect(root).toContainText(d.diagnostics.detailEmpty);
      await expect(root.locator('[data-repair-detail], [data-repair-scheduler]')).toHaveCount(0);
      await assertNoOverflow(page, 'empty diagnostics');
      await assertTargets(root, 'empty diagnostics');
    });
  }

  test('seed a queue with failed, running, queued and succeeded repairs', async () => {
    test.setTimeout(300_000);
    await f.grantAdmin();
    // The repair cron is paused for the whole E2E run (global setup), so a claimed job stays running
    // and a queued one stays queued until a test acts on it.
    const succeeded = await f.accepted(await f.confirmed());
    expect(await repairNow(succeeded.jobId)).toBe('succeeded');
    repairJobs.succeeded = succeeded.jobId;
    const failedGroup = await f.confirmed();
    const failed = await f.accepted(failedGroup);
    await sql(`do $setup$ begin create function ${failureFunction}() returns trigger language plpgsql as $failure$ begin raise exception 'FIXTURE_PUBLICATION_FAILURE'; end $failure$;
      create trigger fixture_result_repair_visual_failure after insert or update on public.statistics_group_facts for each row when (new.game_group_id='${failedGroup.original.proposal_id}'::uuid) execute function ${failureFunction}(); end $setup$`);
    try {
      expect(await repairNow(failed.jobId)).toBe('failed');
    } finally {
      await sql(
        `do $cleanup$ begin drop trigger if exists fixture_result_repair_visual_failure on public.statistics_group_facts; drop function if exists ${failureFunction}(); end $cleanup$`
      );
    }
    repairJobs.failed = failed.jobId;
    const running = await f.accepted(await f.confirmed());
    expect((await claimRepair(running.jobId)).status).toBe('claimed');
    repairJobs.running = running.jobId;
    repairJobs.queued = (await f.accepted(await f.confirmed())).jobId;
  });

  test('openDiagnostics holds sampling until the attempt timeline body exists', async () => {
    // Cleanup ownership starts before navigation: the page is captured and the route installed in the
    // beforeGoto hook, so a setup failure after installation still releases the held request.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let heldPage: Page | undefined;
    let opening: ReturnType<typeof openDiagnostics> | undefined;
    let openingDone = false;
    let crossedGate = false;
    let markReached = () => {};
    const reached = new Promise<void>((resolve) => {
      markReached = resolve;
    });
    const ownedPage = () => {
      if (!heldPage) throw new Error('beforeGoto did not run');
      return heldPage;
    };
    try {
      opening = openDiagnostics(
        'en',
        390,
        'light',
        844,
        async (target) => {
          heldPage = target;
          await target.route('**/_serverFn/**', async (route) => {
            await held;
            await route.continue();
          });
        },
        {
          reachedGate: markReached,
          crossedGate: () => {
            crossedGate = true;
          }
        }
      );
      void opening.then(
        () => {
          openingDone = true;
        },
        () => {}
      );
      // Deterministic boundary: the helper itself reports it reached the timeline gate. Without the
      // gate, `crossedGate` runs in the same microtask chain as `reachedGate` (no Playwright call
      // between them), so it is set before any macrotask, including the page round trip below.
      // Racing `opening` surfaces a setup failure instead of hanging on a gate that was never reached.
      await Promise.race([reached, opening]);
      const page = ownedPage();
      await page.evaluate(() => 0);
      await expect(repairTimelineBody(page)).toHaveCount(0);
      // Mutation: without the timeline-body gate, `crossedGate` is true here (and openDiagnostics goes
      // on to resolve), so this assertion fails regardless of scheduling.
      expect(
        crossedGate,
        'openDiagnostics crossed the timeline gate while the body was missing'
      ).toBe(false);
      expect(openingDone, 'openDiagnostics resolved before the attempt timeline body existed').toBe(
        false
      );
      const pending = (await captureBoxes({ detail: page.locator('[data-repair-detail]') })).detail;
      release();
      await opening;
      await expect(repairTimelineBody(page)).toHaveCount(1);
      const loaded = (await captureBoxes({ detail: page.locator('[data-repair-detail]') })).detail;
      expect(
        loaded.height,
        'the detail section grew after a quiet-frame gate had already passed'
      ).toBeGreaterThan(pending.height);
    } finally {
      release();
      // Never mask the original failure with a secondary cleanup error.
      await opening?.catch(() => {});
      await heldPage?.unrouteAll({ behavior: 'wait' }).catch(() => {});
    }
  });

  for (const { frame, theme, width, height } of diagnosticsFrames) {
    test(`diagnostics ${frame} matches its Pencil frame structure, accessibility and regions`, async ({
      browserName
    }, testInfo) => {
      expect(browserName).toBe('chromium');
      const { page, root } = await openDiagnostics('en', width, theme, height);
      const desktop = width >= 960;
      await diagnosticsStructure(page, root, theme, width);
      await expect(root).toHaveAttribute('data-repair-scope', 'platform');
      await assertTargets(root, `diagnostics ${frame}`);
      await assertContrast(root, `diagnostics ${frame}`);
      await assertReducedMotion(page, root, `diagnostics ${frame}`);
      await assertNoOverflow(page, `diagnostics ${frame}`);
      await compareRepairSurfaces(page, testInfo, frame, {
        queueCard: jobArticle(page, 'failed'),
        detailCard: root.locator('[data-repair-detail]')
      });
      await selectionProbes(page, desktop);
      await jobStatus(page, 'failed')
        .getByRole('button', { name: d.repair.retry, exact: true })
        .click();
      const { dialog, cancel } = await confirmationStructure(page, theme, width);
      await assertTargets(dialog, 'repair confirmation');
      await expect(dialog).toHaveAccessibleDescription(d.repair.confirmBody);
      await cancel.click();
      await expect(
        jobStatus(page, 'failed').getByRole('button', { name: d.repair.retry, exact: true })
      ).toBeFocused();
      await expect(dialog).toBeHidden();
    });
  }

  for (const locale of locales) {
    test(`diagnostics keep long ${locale} text inside 320px without overlap`, async () => {
      const { page, root } = await openDiagnostics(locale, 320, 'light');
      await assertNoOverflow(page, `diagnostics ${locale}`);
      await assertTargets(root, `diagnostics ${locale}`);
      await assertContrast(root, `diagnostics ${locale}`);
      await jobStatus(page, 'failed')
        .getByRole('button', { name: copies[locale].matches.corrections.repair.retry, exact: true })
        .click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const detail = root.locator('[data-repair-detail]');
      const jobId = await detail.getAttribute('data-repair-detail');
      await expect(detail.locator('[data-repair-identifier]')).toHaveText(jobId!);
      await assertNoOverflow(page, `diagnostics dialog ${locale}`);
      await assertTargets(dialog, `diagnostics dialog ${locale}`);
    });
  }
});
