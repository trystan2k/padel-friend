import { expect, type Page } from '@playwright/test';

const WIDTHS = [320, 390, 1280] as const;

// F27: a route that owns its top chrome (wizard, edit-match, community statistics, match detail) opts
// into data-route-chrome="navigation". The global language/theme chips then step aside (display: none)
// instead of floating over progress segments, descriptions or subtitles, and leave no invisible
// focusable controls behind. Unmarked routes keep the chips.
export async function assertChipsStepAside(page: Page, label: string): Promise<void> {
  const original = page.viewportSize() ?? { width: 390, height: 844 };
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: original.height });
    await expect(
      page.locator('main[data-route-chrome="navigation"]'),
      `${label} @${width}: route owns its top chrome`
    ).toHaveCount(1);
    const reading = await page.evaluate(() => {
      const select = document.querySelector('#locale');
      const controls = select?.parentElement?.parentElement;
      return {
        display: controls ? getComputedStyle(controls).display : null,
        boxes: select ? select.getClientRects().length : null,
        scroll: document.documentElement.scrollWidth,
        width: innerWidth
      };
    });
    expect(reading.display, `${label} @${width}: global chips are display none`).toBe('none');
    expect(reading.boxes, `${label} @${width}: chips leave no focusable box`).toBe(0);
    expect(reading.scroll, `${label} @${width}: no horizontal overflow`).toBeLessThanOrEqual(width);
  }
  await page.setViewportSize(original);
}

/** Preferences stay reachable where the page does not own the chrome: the chips render and switch language. */
export async function assertChipsOnUnmarkedRoute(page: Page, label: string): Promise<void> {
  await expect(
    page.locator('main[data-route-chrome="navigation"]'),
    `${label}: unmarked route`
  ).toHaveCount(0);
  const locale = page.locator('#locale');
  await expect(locale, `${label}: language chip is visible`).toBeVisible();
  await locale.selectOption('es');
  await expect(page.locator('html'), `${label}: language chip switches the locale`).toHaveAttribute(
    'lang',
    /^es/
  );
}
