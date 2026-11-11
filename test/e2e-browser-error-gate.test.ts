import type { Page } from '@playwright/test';
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { watchBrowserErrors, withoutSurface } from '../e2e/browser-error-gate';

// The statistics journeys fail on ANY browser error. This pins the attribution the gate adds so a
// missing asset (historically /virtual:stylex.css) is named by status, resource type and URL, a clean
// page records nothing, and an error that lands after a drain is reported on the next drain with the
// page it surfaced on rather than lost or silently cleared.
const ORIGIN = 'http://127.0.0.1:4173';

function fakePage(url = `${ORIGIN}/dashboard`) {
  const events = new EventEmitter();
  const page = Object.assign(events, { url: () => url, navigate: (next: string) => (url = next) });
  const consoleMessage = (type: string, text: string, location = '') =>
    events.emit('console', {
      type: () => type,
      text: () => text,
      location: () => ({ url: location })
    });
  const response = (status: number, resourceType: string, target: string) =>
    events.emit('response', {
      status: () => status,
      url: () => target,
      request: () => ({ resourceType: () => resourceType })
    });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow Playwright double
    page: page as unknown as Page,
    navigate: page.navigate,
    events,
    consoleMessage,
    response
  };
}

describe('watchBrowserErrors', () => {
  it('names an unexpected missing stylesheet by status, type and URL (positive detection)', () => {
    const fake = fakePage();
    const drain = watchBrowserErrors(fake.page);
    fake.response(404, 'stylesheet', `${ORIGIN}/virtual:stylex.css`);
    fake.consoleMessage(
      'error',
      'Failed to load resource: the server responded with a status of 404 (Not Found)',
      `${ORIGIN}/virtual:stylex.css`
    );
    expect(drain().map(withoutSurface)).toEqual([
      `http 404 stylesheet ${ORIGIN}/virtual:stylex.css`,
      `console: Failed to load resource: the server responded with a status of 404 (Not Found) @ ${ORIGIN}/virtual:stylex.css`
    ]);
  });

  it('records page errors and console errors without a location', () => {
    const fake = fakePage();
    const drain = watchBrowserErrors(fake.page);
    fake.events.emit('pageerror', new Error('Hydration failed'));
    fake.consoleMessage('error', 'boom');
    expect(drain().map(withoutSurface)).toEqual(['pageerror: Hydration failed', 'console: boom']);
  });

  it('records nothing for a clean page (negative detection)', () => {
    const fake = fakePage();
    const drain = watchBrowserErrors(fake.page);
    fake.response(200, 'document', `${ORIGIN}/dashboard`);
    fake.response(304, 'stylesheet', `${ORIGIN}/assets/index-Yi0DRkAY.css`);
    fake.response(302, 'document', `${ORIGIN}/login`);
    fake.consoleMessage('log', 'hydrated');
    fake.consoleMessage('warning', 'deprecated');
    expect(drain()).toEqual([]);
  });

  it('keeps a late error for the next drain, attributed to the page it surfaced on', () => {
    const fake = fakePage();
    const drain = watchBrowserErrors(fake.page);
    expect(drain()).toEqual([]);
    fake.navigate(`${ORIGIN}/players/1`);
    fake.response(404, 'image', `${ORIGIN}/late.png`);
    expect(drain()).toEqual([`http 404 image ${ORIGIN}/late.png [page ${ORIGIN}/players/1]`]);
    expect(drain()).toEqual([]);
  });

  it('strips only the trailing surfaced-on suffix', () => {
    expect(withoutSurface(`console: x @ ${ORIGIN}/a [page ${ORIGIN}/b]`)).toBe(
      `console: x @ ${ORIGIN}/a`
    );
  });
});
