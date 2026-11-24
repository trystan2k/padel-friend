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
      page.locator('[data-route-chrome="navigation"]'),
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

/**
 * Header geometry per pattern. A route that owns its top chrome must also render that chrome, so a
 * missing or mispositioned header cannot hide behind the chips-suppression mark.
 *  - 'topbar': the shared TopBar (back slot, title, trailing slot): first block of the page, ≥56px
 *    tall, title centred between equal slots (the same probe matches-visual uses), 17px/700.
 *  - 'navbar': a back control plus a short nav label in the header, with the page h1 as its own block
 *    below it (league index): not the centred TopBar, so only order and target size are asserted.
 *  - 'diagnostics' (cuVwp/bomAY): own header, not a TopBar: back control, then an eyebrow above a
 *    left-aligned page title, then the reload action at the end of the row. A centred bar is wrong here.
 */
export type TopChromePattern = 'topbar' | 'navbar' | 'diagnostics';

export async function assertTopChrome(
  page: Page,
  label: string,
  pattern: TopChromePattern
): Promise<void> {
  const original = page.viewportSize() ?? { width: 390, height: 844 };
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: original.height });
    await expect(
      page.locator('main header').first(),
      `${label} @${width}: header renders`
    ).toBeVisible();
    const reading = await page.evaluate(() => {
      const header = document.querySelector('main header');
      if (!header) return null;
      const box = header.getBoundingClientRect();
      const kids = Array.from(header.children);
      const title = header.querySelector('h1') ?? kids[1] ?? null;
      const titleBox = title?.getBoundingClientRect();
      const titleStyle = title ? getComputedStyle(title) : null;
      const hit = titleBox
        ? document.elementFromPoint(
            titleBox.x + titleBox.width / 2,
            titleBox.y + titleBox.height / 2
          )
        : null;
      const eyebrow = header.querySelector('p');
      const eyebrowBox = eyebrow?.getBoundingClientRect();
      const back = header.querySelector('a, button');
      const backBox = back?.getBoundingClientRect();
      const action = header.querySelector('button');
      const actionBox = action?.getBoundingClientRect();
      return {
        top: box.top + window.scrollY,
        height: box.height,
        left: box.left,
        right: box.right,
        kids: kids.length,
        titleTag: title?.tagName.toLowerCase() ?? null,
        titleText: title?.textContent?.trim() ?? '',
        titleCentre: titleBox ? titleBox.left + titleBox.width / 2 : null,
        titleLeft: titleBox?.left ?? null,
        titleTop: titleBox?.top ?? null,
        titleFont: titleStyle ? [titleStyle.fontSize, titleStyle.fontWeight] : null,
        titleAlign: titleStyle?.textAlign ?? null,
        titleHit: hit !== null && title !== null && title.contains(hit),
        eyebrowText: eyebrow?.textContent?.trim() ?? '',
        eyebrowBottom: eyebrowBox?.bottom ?? null,
        backRight: backBox?.right ?? null,
        actionRight: actionBox?.right ?? null,
        centre: (box.left + box.right) / 2,
        bottom: box.bottom + window.scrollY,
        pageH1Top: document.querySelector('main h1')?.getBoundingClientRect().top ?? null,
        backHeight: backBox?.height ?? null,
        backBottom: backBox?.bottom ?? null
      };
    });
    const at = `${label} @${width}`;
    expect(reading, `${at}: header present`).not.toBeNull();
    const h = reading!;
    expect(h.top, `${at}: header is the first block of the page`).toBeLessThanOrEqual(48);
    expect(h.titleText, `${at}: header carries a title`).not.toBe('');
    expect(h.titleHit, `${at}: title is not covered`).toBe(true);
    if (pattern === 'topbar') {
      expect(h.kids, `${at}: TopBar renders start slot, title, end slot`).toBe(3);
      expect(h.height, `${at}: TopBar height`).toBeGreaterThanOrEqual(56);
      expect(
        Math.abs(h.titleCentre! - h.centre),
        `${at}: TopBar title is centred between equal slots`
      ).toBeLessThanOrEqual(1);
      expect(h.titleFont, `${at}: TopBar title is 17px/700`).toEqual(['17px', '700']);
    } else if (pattern === 'navbar') {
      expect(h.kids, `${at}: navbar renders back control and nav label`).toBe(2);
      expect(h.backHeight!, `${at}: back control keeps a 44px target`).toBeGreaterThanOrEqual(44);
      expect(h.titleLeft!, `${at}: nav label follows the back control`).toBeGreaterThanOrEqual(
        h.backRight!
      );
      expect(h.pageH1Top, `${at}: page title is its own block below the nav`).not.toBeNull();
      expect(h.pageH1Top!, `${at}: page title sits below the nav`).toBeGreaterThanOrEqual(
        h.bottom - 1
      );
    } else {
      expect(h.eyebrowText, `${at}: diagnostics eyebrow`).not.toBe('');
      expect(h.titleTag, `${at}: diagnostics title is the h1`).toBe('h1');
      expect(h.eyebrowBottom!, `${at}: eyebrow sits above the title`).toBeLessThanOrEqual(
        h.titleTop! + 1
      );
      // The row may wrap at 320px: the title then starts below the back control instead of beside it.
      expect(
        h.titleLeft! >= h.backRight! || h.titleTop! >= h.backBottom! - 1,
        `${at}: page title follows the back control (beside it, or below when the row wraps)`
      ).toBe(true);
      expect(
        ['start', 'left'],
        `${at}: page title is start-aligned, not a centred bar title`
      ).toContain(h.titleAlign);
      expect(Number.parseFloat(h.titleFont![0]!), `${at}: page-title scale`).toBeGreaterThanOrEqual(
        28
      );
      expect(h.actionRight!, `${at}: reload sits at the end of the row`).toBeGreaterThan(h.centre);
    }
  }
  await page.setViewportSize(original);
}

/** Preferences stay reachable where the page does not own the chrome: the chips render and switch language. */
export async function assertChipsOnUnmarkedRoute(page: Page, label: string): Promise<void> {
  await expect(
    page.locator('[data-route-chrome="navigation"]'),
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

/**
 * F66 class guard: a <fieldset> that no style resets renders the UA default 2px groove frame, which
 * no clubhouse frame draws. Designed fieldsets are either borderless or carry a token border (solid),
 * so this flags only the UA signature (a groove, ridge, inset or outset side with a non-zero width;
 * a width-0 side draws nothing) and leaves the intentionally bordered ones (e.g. the notification
 * push group) alone. Scans every fieldset in the
 * document, including ones inside open dialogs.
 */
export async function assertNoUaFieldsetBorders(page: Page, label: string): Promise<void> {
  const uaBordered = await page.evaluate(() => {
    const ua = new Set(['groove', 'ridge', 'inset', 'outset']);
    return [...document.querySelectorAll('fieldset')]
      .filter((node) => {
        const style = getComputedStyle(node);
        return [
          [style.borderTopStyle, style.borderTopWidth],
          [style.borderRightStyle, style.borderRightWidth],
          [style.borderBottomStyle, style.borderBottomWidth],
          [style.borderLeftStyle, style.borderLeftWidth]
        ].some(([side, width]) => ua.has(side!) && Number.parseFloat(width!) > 0);
      })
      .map(
        (node) =>
          node.getAttribute('aria-label') ?? node.querySelector('legend')?.textContent ?? 'fieldset'
      );
  });
  expect(uaBordered, `${label}: fieldsets render no UA default border`).toEqual([]);
}
