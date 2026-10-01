import { expect, type Page } from '@playwright/test';

/** Waits for the root React effect, not a timing-based animation-frame proxy. */
export async function waitForHydratedPage(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Captures the full-document auth response and requires a successful destination response. */
export async function submitAndWaitForAuthDestination(
  page: Page,
  destination: RegExp,
  submit: () => Promise<void>
): Promise<void> {
  const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  await submit();
  const response = await navigation;
  if (!response) throw new Error('Expected a full-document response after authentication');

  expect(
    response.status(),
    `Auth destination returned ${response.status()} at ${response.url()}`
  ).toBeLessThan(400);
  await expect(page).toHaveURL(destination);
}
