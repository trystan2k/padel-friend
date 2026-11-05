import { expect, test, type Locator, type Page } from '@playwright/test';
import { amendmentFixtures, copies, fill } from './result-amendments-fixtures';
import {
  assertContained,
  assertContrast,
  assertNoOverflow,
  assertReducedMotion,
  assertStacked,
  assertTargets,
  box,
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

async function structure(kind: Kind, page: Page, root: Locator) {
  const c = copies.en.matches.corrections;
  const main = page.locator('main');
  // Heading semantics: the section heading precedes the card heading in document order.
  // A modal dialog makes the page behind it inert, so its heading is checked in the full tree.
  await expect(
    page.getByRole('heading', { name: c.title, exact: true, includeHidden: true })
  ).toHaveCount(1);
  assertContained(await box(main), await box(root), `${kind} card inside main`);
  if (kind === 'request') {
    assertStacked({
      banner: await box(root.getByText(c.officialLabel, { exact: true })),
      note: await box(root.getByText(c.requestNote, { exact: true })),
      action: await box(root.getByRole('button', { name: c.request.open, exact: true }))
    });
  } else if (kind === 'review') {
    const proposed = root.getByRole('region', { name: c.proposed });
    assertStacked({
      banner: await box(root.locator('p').first()),
      proposed: await box(proposed),
      approve: await box(
        root.getByRole('button', { name: copies.en.matches.results.review.approve, exact: true })
      )
    });
    const approve = await box(
      root.getByRole('button', { name: copies.en.matches.results.review.approve, exact: true })
    );
    const reject = await box(
      root.getByRole('button', { name: copies.en.matches.results.review.reject, exact: true })
    );
    expect.soft(Math.abs(approve.y - reject.y) > 2 || reject.x >= approve.right - 2).toBe(true);
  } else {
    const dialog = page.getByRole('dialog', { name: c.resolve.title, exact: true });
    await expect(dialog).toBeVisible();
    const dialogBox = await box(dialog);
    const radios = dialog.getByRole('radio');
    await expect(radios).toHaveCount(3);
    const rows = await radios.evaluateAll((nodes) =>
      nodes.map((node) => {
        const rect = (node.closest('label') ?? node).getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y + window.scrollY,
          right: rect.right,
          bottom: rect.bottom + window.scrollY,
          width: rect.width,
          height: rect.height
        };
      })
    );
    for (const [index, row] of rows.entries()) {
      assertContained(dialogBox, row, `resolution option ${index + 1}`);
      if (index)
        expect.soft(row.y, 'options stack').toBeGreaterThanOrEqual(rows[index - 1]!.bottom - 2);
    }
    await dialog.getByRole('radio').first().check();
    const field = dialog.getByRole('textbox');
    const submit = dialog.getByRole('button', { name: c.resolve.submit, exact: true });
    // The field is labelled and its error is associated when the justification is missing.
    await submit.click();
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    const describedBy = await field.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    assertStacked({ field: await box(field), submit: await box(submit) });
  }
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
    const scope = kind === 'resolve' ? page.getByRole('dialog') : root;
    await assertTargets(scope, kind);
    await assertContrast(scope, kind);
    await assertReducedMotion(page, scope, kind);
    await assertNoOverflow(page, kind);
    await measureFrame(frames[kind], page, testInfo);
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
