import type { Page } from '@playwright/test';

/** An entry without the trailing "observed on" page URL, for exact comparison of the failing resource. */
export const withoutSurface = (entry: string): string =>
  entry.replace(/ \[observed on [^\]]*\]$/, '');

/**
 * Records every browser-side failure of a page: console errors (with the resource URL Chromium
 * attributes them to), uncaught page errors, and every HTTP >= 400 response (status, resource type
 * and URL). A "Failed to load resource" console line names no status; the paired response entry
 * does, so a missing stylesheet, script, font or image is identified instead of guessed. Each entry
 * also carries the URL the page was on when the event ARRIVED. That is observation time, not origin:
 * a resource started by an earlier navigation can fail after the page moved on and is labelled with
 * the new URL. The failing resource's own URL (in the entry body) is what names the culprit.
 *
 * Returns `drain`, which hands back everything recorded since the previous call and empties the
 * list in one step. The caller asserts on the returned snapshot, so nothing is dropped before it is
 * judged and a failing journey cannot leak its errors into the next one.
 */
export function watchBrowserErrors(page: Page): () => string[] {
  const entries: string[] = [];
  const surfacedOn = () => ` [observed on ${page.url()}]`;
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
