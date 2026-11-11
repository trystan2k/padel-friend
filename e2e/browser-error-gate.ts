import type { Page } from '@playwright/test';

/** An entry without the trailing "surfaced on" page URL, for exact comparison of the failing resource. */
export const withoutSurface = (entry: string): string => entry.replace(/ \[page [^\]]*\]$/, '');

/**
 * Records every browser-side failure of a page: console errors (with the resource URL Chromium
 * attributes them to), uncaught page errors, and every HTTP >= 400 response (status, resource type
 * and URL). A "Failed to load resource" console line names no status; the paired response entry
 * does, so a missing stylesheet, script, font or image is identified instead of guessed. Each entry
 * also carries the URL the page was on when it surfaced, so a late error from an earlier navigation
 * is attributed to that navigation and not mistaken for the current journey's own.
 *
 * Returns `drain`, which hands back everything recorded since the previous call and empties the
 * list in one step. The caller asserts on the returned snapshot, so nothing is dropped before it is
 * judged and a failing journey cannot leak its errors into the next one.
 */
export function watchBrowserErrors(page: Page): () => string[] {
  const entries: string[] = [];
  const surfacedOn = () => ` [page ${page.url()}]`;
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const { url } = message.location();
    entries.push(`console: ${message.text()}${url ? ` @ ${url}` : ''}${surfacedOn()}`);
  });
  page.on('pageerror', (error) => entries.push(`pageerror: ${error.message}${surfacedOn()}`));
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400)
      entries.push(
        `http ${status} ${response.request().resourceType()} ${response.url()}${surfacedOn()}`
      );
  });
  return () => entries.splice(0);
}
