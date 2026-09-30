import { expect, type Page } from '@playwright/test';

/** Waits for the root React effect, not a timing-based animation-frame proxy. */
export async function waitForHydratedPage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Captures the full-document response caused by the auth action. Retry only the exact failed
 * response URL when its 500 body contains PGRST303 plus explicit JWT clock-skew evidence.
 */
export async function submitAndWaitForAuthDestination(
  page: Page,
  destination: RegExp,
  submit: () => Promise<void>
): Promise<void> {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await submit();
  let response = await navigation;
  if (!response) throw new Error('Expected a full-document response after authentication');

  if (response.status() >= 500) {
    const body = await response.text();
    const hasClockSkewEvidence = [
      /\bclock[\s-]+skew\b/i,
      /\bnot[\s-]+yet[\s-]+valid\b/i,
      /\b(?:iat|issued[\s-]+at)\b[\s\S]{0,120}\b(?:future|ahead)\b/i,
      /\b(?:future|ahead)\b[\s\S]{0,120}\b(?:iat|issued[\s-]+at)\b/i
    ].some((pattern) => pattern.test(body));
    const retryableClockSkew =
      response.status() === 500 && /\bPGRST303\b/.test(body) && hasClockSkewEvidence;
    expect(
      retryableClockSkew,
      `Only a 500 PGRST303 response with explicit clock-skew evidence may retry; received ${response.status()} from ${response.url()}`
    ).toBe(true);

    const failedDestination = response.url();
    expect(page.url(), 'retry must use the exact failed auth destination').toBe(failedDestination);
    response = await page.goto(failedDestination, { waitUntil: 'domcontentloaded' });
    if (!response) throw new Error('Expected a response from the single PGRST303 clock-skew retry');
  }

  expect(
    response.status(),
    `Auth destination returned ${response.status()} at ${response.url()}`
  ).toBeLessThan(400);
  await expect(page).toHaveURL(destination);
}
