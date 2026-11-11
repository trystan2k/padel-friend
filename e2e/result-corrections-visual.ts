import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import frameReference from './references/paf-14/frame-reference.json' with { type: 'json' };
import manifest from './references/paf-14/manifest.json' with { type: 'json' };

// PAF-14 visual certification helpers (same method as PAF-8/PAF-12): capture at the exact half-scale
// reference size and compare with the uncropped 2x Pencil export under the pinned perceptual
// threshold. Composition differences are declared adaptations in the manifest: they are masked out of
// the whole-screen compare and covered by exact geometry probes in the journeys. Raster budgets only
// absorb font/antialiasing noise on the comparable surfaces (per-region) and the unmasked remainder.
export type CorrectionFrame = 'adujr' | 's5TRC' | 'CWJkF' | 'xbIxj' | 'cuVwp' | 'Jjrtb' | 'SluH3';
export const frameViewport = { width: 390, height: 844 };

export type Box = {
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y: y + window.scrollY, right, bottom: bottom + window.scrollY, width, height };
  });
}

export type Geometry = { box: Box; inner: Box };

/**
 * Atomic geometry sample: border boxes and content boxes of every locator, read in ONE browser
 * evaluation (a single synchronous task, so no layout change can land between the reads). Compared
 * sets must come from one call: separate `box()` calls are separate evaluates, and a diagnostics poll
 * or lease-status refresh between them yields a torn comparison even after waitForRenderSettled.
 * Locators resolve to elements first (waiting for attachment); the reads then happen together.
 */
export async function captureGeometry<K extends string>(
  locators: Record<K, Locator>
): Promise<Record<K, Geometry>> {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries/fromEntries erase the key union; the keys are exactly the locator keys
  const entries = Object.entries<Locator>(locators) as [K, Locator][];
  const first = entries[0];
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- no locators, so no keys
  if (!first) return {} as Record<K, Geometry>;
  const handles = await Promise.all(entries.map(([, locator]) => locator.elementHandle()));
  try {
    const sampled = await first[1].page().evaluate((elements) => {
      const toBox = ({ x, y, right, bottom, width, height }: DOMRect): Box => ({
        x,
        y: y + window.scrollY,
        right,
        bottom: bottom + window.scrollY,
        width,
        height
      });
      return elements.map((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const left =
          Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
        const right =
          Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
        const top = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
        const bottom =
          Number.parseFloat(style.borderBottomWidth) + Number.parseFloat(style.paddingBottom);
        return {
          box: toBox(rect),
          inner: {
            x: rect.x + left,
            y: rect.y + top + window.scrollY,
            right: rect.right - right,
            bottom: rect.bottom - bottom + window.scrollY,
            width: rect.width - left - right,
            height: rect.height - top - bottom
          }
        };
      });
    }, handles);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries/fromEntries erase the key union; the keys are exactly the locator keys
    return Object.fromEntries(entries.map(([key], index) => [key, sampled[index]])) as Record<
      K,
      Geometry
    >;
  } finally {
    await Promise.all(handles.map((handle) => handle.dispose()));
  }
}

/** Border boxes of every locator from one atomic sample (see captureGeometry). */
export async function captureBoxes<K extends string>(
  locators: Record<K, Locator>
): Promise<Record<K, Box>> {
  const geometry = await captureGeometry(locators);
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Object.entries/fromEntries erase the key union; the keys are exactly the locator keys
  return Object.fromEntries(
    Object.entries<Geometry>(geometry).map(([key, value]) => [key, value.box])
  ) as Record<K, Box>;
}

/**
 * Render readiness gate: waits until the page lays out the way it will keep laying out, so the geometry
 * probes and screenshot captures that follow never sample a layout that is about to reflow.
 * Hypothesised mechanism (PAF-175, UNCONFIRMED pending the loaded-gate campaign, AC1): the bundled
 * Inter/Manrope faces are @fontsource subsets with font-display: swap, fetched lazily on first use. Under
 * full-gate load the first sample may have run on fallback metrics, with the swap reflowing text after it
 * (a wrapped line would explain the ~22px drift that exceeded the 2px assertStacked tolerance). Failure
 * geometry matching fallback-font metrics would confirm it. Every font used by visible text is loaded explicitly, images are decoded, then the layout
 * must be identical across consecutive animation frames. Persistent instability fails with the
 * unsettled element count instead of passing on a lucky sample.
 */
export async function waitForRenderSettled(page: Page) {
  await page.evaluate(async () => {
    const faces = new Map<string, string>();
    for (const element of document.querySelectorAll('body *')) {
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join('')
        .trim();
      if (!text) continue;
      const style = getComputedStyle(element);
      const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      faces.set(font, (faces.get(font) ?? '') + text);
    }
    await Promise.all([...faces].map(([font, text]) => document.fonts.load(font, text)));
    await document.fonts.ready;
    for (const [font, text] of faces)
      if (!document.fonts.check(font, text)) throw new Error(`Font not ready: ${font}`);
    await Promise.all([...document.images].map((image) => image.decode()));
    const sample = () =>
      [...document.querySelectorAll('body *')]
        .map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return `${x},${y},${width},${height}`;
        })
        .join('|');
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    let previous = sample();
    for (let stable = 0, frames = 0; stable < 3; frames++) {
      if (frames > 600) throw new Error('Layout did not settle within 600 animation frames');
      await frame();
      const current = sample();
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
  });
}

/** Document-order stacking: each box ends before the next begins (small subpixel tolerance). */
export function assertStacked(boxes: Record<string, Box>) {
  const entries = Object.entries(boxes);
  for (let index = 1; index < entries.length; index++)
    expect
      .soft(entries[index]![1].y, `${entries[index]![0]} follows ${entries[index - 1]![0]}`)
      .toBeGreaterThanOrEqual(entries[index - 1]![1].bottom - 2);
}

export function assertContained(parent: Box, child: Box, label: string, tolerance = 2) {
  expect.soft(child.x, `${label} left`).toBeGreaterThanOrEqual(parent.x - tolerance);
  expect.soft(child.right, `${label} right`).toBeLessThanOrEqual(parent.right + tolerance);
  expect.soft(child.y, `${label} top`).toBeGreaterThanOrEqual(parent.y - tolerance);
  expect.soft(child.bottom, `${label} bottom`).toBeLessThanOrEqual(parent.bottom + tolerance);
}

/** No horizontal scroll and nothing painted outside the viewport width (long translated text). */
export async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - window.innerWidth,
    // Content inside a scroll container that itself fits the viewport is reachable, not overflow.
    outside: [...document.querySelectorAll('main *')]
      .filter((element) => {
        if (element.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        for (let node = element.parentElement; node; node = node.parentElement) {
          const scrolls = ['auto', 'scroll'].includes(getComputedStyle(node).overflowX);
          if (scrolls && node.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        }
        return true;
      })
      .map((element) => element.tagName + ':' + (element.textContent ?? '').slice(0, 30))
  }));
  expect.soft(overflow.scroll, `${label} horizontal scroll`).toBeLessThanOrEqual(0);
  expect.soft(overflow.outside, `${label} elements beyond viewport`).toEqual([]);
}

/** Every visible interactive control inside the root meets the 44px target on both axes. */
export async function assertTargets(root: Locator, label: string) {
  const targets = await root
    .locator('a, button, summary, [role=radio], input:not([type=hidden]), textarea, select')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const target = node.closest('label') ?? node;
          const rect = target.getBoundingClientRect();
          return {
            name: (node.textContent ?? '').trim().slice(0, 40),
            w: rect.width,
            h: rect.height
          };
        })
        .filter((item) => item.w > 0 && item.h > 0)
    );
  expect(targets.length, `${label} has controls`).toBeGreaterThan(0);
  for (const item of targets) {
    expect.soft(item.h, `${label} ${item.name} height`).toBeGreaterThanOrEqual(44);
    expect.soft(item.w, `${label} ${item.name} width`).toBeGreaterThanOrEqual(44);
  }
}

/** WCAG AA text contrast of every visible text element against its effective background. */
export async function assertContrast(root: Locator, label: string) {
  const failures = await root.evaluate((container) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const background = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0.99) return color;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const bad: string[] = [];
    for (const element of container.querySelectorAll('*')) {
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()
      );
      const style = getComputedStyle(element);
      if (!own || style.visibility === 'hidden' || element.getBoundingClientRect().width === 0)
        continue;
      const color = parse(style.color);
      if (!color) continue;
      const fg = luminance(color);
      const bg = luminance(background(element));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        bad.push(`${(element.textContent ?? '').trim().slice(0, 30)} ${ratio.toFixed(2)}`);
    }
    return bad;
  });
  expect.soft(failures, `${label} AA contrast`).toEqual([]);
}

/** Reduced motion: no running animation and no transition longer than a frame inside the root. */
export async function assertReducedMotion(page: Page, root: Locator, label: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const moving = await root.evaluate((container) =>
    [container, ...container.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const seconds = (value: string) =>
          Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0));
        return (
          (style.animationName !== 'none' && seconds(style.animationDuration) > 0.01) ||
          seconds(style.transitionDuration) > 0.01
        );
      })
      .map((element) => element.tagName)
  );
  expect.soft(moving, `${label} honours reduced motion`).toEqual([]);
}

type Rect = { x: number; y: number; width: number; height: number };

type RegionSpec = {
  reference: Rect;
  capture: string;
  fill: number[];
  cornerRadius: number;
  edgeInset: number;
  budget: number;
  measured: number | null;
  rationale: string;
};
type ScreenSpec = {
  mode: string;
  budget: number | null;
  measured: number | null;
  maxMaskedFraction: number | null;
};
const screenSpecs: Record<string, ScreenSpec> = manifest.visualBudgets.perScreen;
const regionSpecs: Record<string, Record<string, RegionSpec>> = manifest.visualBudgets.perRegion;
const referenceMasks: Record<string, Rect[]> = manifest.visualBudgets.referenceMasks;
const minComparedFraction = manifest.visualBudgets.minComparedRegionFraction;

export function assertNear(actual: number, expected: number, label: string, tolerance = 0.75) {
  expect
    .soft(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`)
    .toBeLessThanOrEqual(tolerance);
}

/** Column structure of a data table: header and first body row share the same ordered columns. */
export async function assertColumnStructure(table: Locator, label: string, minColumns = 4) {
  const geometry = await table.evaluate((element) => {
    const edges = (node: Element) => {
      const { x, right } = node.getBoundingClientRect();
      return { x, right };
    };
    const firstRow = element.querySelector('tbody tr');
    return {
      table: edges(element),
      header: [...element.querySelectorAll('thead th')].map(edges),
      cells: firstRow ? [...firstRow.children].map(edges) : []
    };
  });
  expect
    .soft(geometry.header.length, `${label} has the ranking columns`)
    .toBeGreaterThanOrEqual(minColumns);
  expect
    .soft(geometry.cells.length, `${label} body row matches header columns`)
    .toBe(geometry.header.length);
  for (const [index, head] of geometry.header.entries()) {
    const cell = geometry.cells[index];
    if (!cell) continue;
    assertNear(cell.x, head.x, `${label} column ${index + 1} left edge`, 1);
    assertNear(cell.right, head.right, `${label} column ${index + 1} right edge`, 1);
    if (index)
      expect
        .soft(head.x, `${label} column ${index + 1} follows column ${index}`)
        .toBeGreaterThanOrEqual(geometry.header[index - 1]!.right - 1);
  }
}

type FrameElement = {
  kind: string;
  text?: string;
  size?: number;
  weight?: number;
  color?: string;
  letterSpacing?: number;
  fill?: string | null;
  radius?: number;
  padding?: unknown;
  gap?: number;
  width: number;
  height: number;
};
const frameElements: Record<string, Record<string, FrameElement>> = frameReference.frames;
type ContractField =
  | 'size'
  | 'weight'
  | 'color'
  | 'letterSpacing'
  | 'family'
  | 'caps'
  | 'radius'
  | 'padding'
  | 'gap'
  | 'fill';
/**
 * One production element that stands for a Pencil element. Every field is compared with the frame
 * value unless `allow` names a design-token expression for it; an allowed field must really differ
 * from the frame (an obsolete allowance fails) and must cite a declared adaptation.
 */
export type ContractEntry = {
  ref: string;
  locator: Locator;
  allow?: Partial<Record<ContractField, string>>;
  adaptation?: string;
  /** Block width: frame width minus a card inset, or within a tolerance of the frame width. */
  widthInset?: number;
  widthTolerance?: number;
  /** Equal-width actions sharing one row separated by the 8px action gap. */
  columns?: number;
  /** Content-hugging frame control: width is not comparable (declared adaptation). */
  skipWidth?: boolean;
  /** Single-line chips and controls: inclusive production height range. */
  heightRange?: [number, number];
};

const hexToRgb = (hex: string) => {
  const [red, green, blue] = [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16)
  );
  return `rgb(${red}, ${green}, ${blue})`;
};
const paddingSides = (padding: unknown) => {
  if (typeof padding === 'number') return { top: padding, left: padding };
  if (Array.isArray(padding) && padding.length === 2)
    return { top: Number(padding[0]), left: Number(padding[1]) };
  if (Array.isArray(padding) && padding.length === 4)
    return { top: Number(padding[0]), left: Number(padding[3]) };
  return { top: 0, left: 0 };
};

/**
 * Renderer-independent typography, color and geometry contract: DOM computed styles of every
 * production element that replaces a Pencil element, compared with the frame snapshot in
 * `frame-reference.json`. Differences are only accepted through a declared adaptation.
 */
export async function assertFrameContract(
  frame: CorrectionFrame,
  state: string,
  entries: ContractEntry[]
) {
  const reference = frameElements[frame] ?? {};
  const expectedRefs = Object.entries(manifest.inventory[frame].probed).find(
    ([key]) => key === state
  )?.[1];
  expect
    .soft(
      entries.map((entry) => entry.ref).sort(),
      `${frame} ${state} asserts exactly the inventory`
    )
    .toEqual([...(expectedRefs ?? [])].sort());
  const declared = Object.entries(manifest.declaredAdaptations).find(([key]) => key === frame)?.[1];
  const adaptations = Array.isArray(declared) ? declared : [];
  for (const entry of entries) {
    const label = `${frame} ${entry.ref}`;
    const frameValue = reference[entry.ref];
    if (!frameValue) {
      expect.soft(false, `${label} exists in the frame snapshot`).toBe(true);
      continue;
    }
    const allow = entry.allow ?? {};
    if (Object.keys(allow).length)
      expect
        .soft(
          adaptations.some((item) => item.id === entry.adaptation),
          `${label} allowance cites a declared adaptation (${entry.adaptation})`
        )
        .toBe(true);
    const properties: Record<string, string> = {
      size: 'font-size',
      weight: 'font-weight',
      color: 'color',
      letterSpacing: 'letter-spacing',
      family: 'font-family',
      radius: 'border-top-left-radius',
      padding: 'padding-left',
      gap: 'row-gap',
      fill: 'background-color'
    };
    const measured = await entry.locator.evaluate(
      (element, input) => {
        const style = getComputedStyle(element);
        const probe = document.createElement('span');
        document.body.append(probe);
        const resolved: Record<string, string> = {};
        for (const [field, expression] of Object.entries(input.allow)) {
          const property = input.properties[field];
          if (!property) continue;
          probe.style.setProperty(property, expression);
          resolved[field] = getComputedStyle(probe).getPropertyValue(property);
          probe.style.removeProperty(property);
        }
        probe.remove();
        const rect = element.getBoundingClientRect();
        const spacing = style.letterSpacing;
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        return {
          resolved,
          size: Number.parseFloat(style.fontSize),
          weight: Number(style.fontWeight),
          color: style.color,
          letterSpacing: spacing === 'normal' ? 0 : Number.parseFloat(spacing),
          family: style.fontFamily.split(',')[0]!.replaceAll('"', '').trim().toLowerCase(),
          caps:
            style.textTransform === 'uppercase' ||
            (text.length > 0 && text === text.toUpperCase() && /[A-Z]/.test(text)),
          radius: Number.parseFloat(style.borderTopLeftRadius),
          paddingLeft: Number.parseFloat(style.paddingLeft),
          paddingTop: Number.parseFloat(style.paddingTop),
          gap: Number.parseFloat(style.rowGap) || 0,
          fill: style.backgroundColor,
          width: rect.width,
          height: rect.height
        };
      },
      { allow, properties },
      { timeout: 5000 }
    );
    const pick = (field: ContractField, own: number | string | boolean, frameExpected: unknown) => {
      const allowed = allow[field];
      if (allowed === undefined)
        return expect
          .soft(
            own,
            `${label} ${field}: production ${String(own)} vs frame ${String(frameExpected)}`
          )
          .toEqual(frameExpected);
      const resolved = measured.resolved[field] ?? '';
      const normalized =
        field === 'family'
          ? resolved.split(',')[0]!.replaceAll('"', '').trim().toLowerCase()
          : field === 'caps'
            ? allowed === 'caps'
            : ['size', 'letterSpacing', 'radius', 'padding', 'gap'].includes(field)
              ? Number.parseFloat(resolved)
              : field === 'weight'
                ? Number(resolved)
                : resolved;
      expect
        .soft(own, `${label} ${field} resolves to its allowed token (${allowed})`)
        .toEqual(normalized);
      expect
        .soft(normalized, `${label} ${field} allowance is obsolete: it equals the frame value`)
        .not.toEqual(frameExpected);
    };
    if (frameValue.kind === 'text') {
      pick('size', measured.size, frameValue.size);
      pick('weight', measured.weight, frameValue.weight);
      pick('color', measured.color, hexToRgb(frameValue.color ?? '#000000'));
      pick('letterSpacing', measured.letterSpacing, frameValue.letterSpacing ?? 0);
      pick('family', measured.family, 'inter');
      const text = frameValue.text ?? '';
      pick('caps', measured.caps, text === text.toUpperCase() && /[A-Z]/.test(text));
    } else {
      pick('radius', measured.radius, frameValue.radius ?? 0);
      pick('padding', measured.paddingLeft, paddingSides(frameValue.padding).left);
      pick('gap', measured.gap, frameValue.gap ?? 0);
      if (frameValue.fill) pick('fill', measured.fill, hexToRgb(frameValue.fill));
      const columns = entry.columns ?? 1;
      const widthTarget =
        (frameValue.width - (entry.widthInset ?? 0) - (columns - 1) * 8) / columns;
      if (!entry.skipWidth)
        expect
          .soft(
            Math.abs(measured.width - widthTarget),
            `${label} width ${measured.width} vs frame ${frameValue.width} (inset ${entry.widthInset ?? 0}, columns ${columns})`
          )
          .toBeLessThanOrEqual(entry.widthTolerance ?? 0.75);
      if (entry.heightRange)
        expect
          .soft(measured.height, `${label} height ${measured.height} vs frame ${frameValue.height}`)
          .toBeGreaterThanOrEqual(entry.heightRange[0]);
      if (entry.heightRange)
        expect
          .soft(measured.height, `${label} height upper bound`)
          .toBeLessThanOrEqual(entry.heightRange[1]);
    }
  }
}

/** Every Pencil element is probed in some capture state or tied to a declared adaptation. */
export function assertInventory(frame: CorrectionFrame) {
  const inventory = manifest.inventory[frame];
  const probed = Object.values(inventory.probed).flat();
  const adapted = Object.keys(inventory.adapted);
  const names = Object.keys(frameElements[frame] ?? {});
  expect
    .soft(
      names.filter((name) => !probed.includes(name) && !adapted.includes(name)),
      `${frame} has Pencil elements that are neither probed nor adapted`
    )
    .toEqual([]);
  expect
    .soft(
      [...probed, ...adapted].filter((name) => !names.includes(name)),
      `${frame} inventory only lists Pencil elements`
    )
    .toEqual([]);
  expect
    .soft(
      probed.filter((name) => adapted.includes(name)),
      `${frame} element is not both probed and adapted`
    )
    .toEqual([]);
  const declared = Object.entries(manifest.declaredAdaptations).find(([key]) => key === frame)?.[1];
  const ids = Array.isArray(declared) ? declared.map((item) => item.id) : [];
  for (const [name, id] of Object.entries(inventory.adapted))
    expect.soft(ids, `${frame} ${name} cites a declared adaptation (${id})`).toContain(id);
  // Every declared adaptation needs at least one covering composition probe in a state the tests run.
  for (const item of adaptationsOf(frame)) {
    const states = Object.keys(item.probes);
    expect
      .soft(
        Object.values(item.probes).flat().length,
        `${frame} ${item.id} has a covering composition probe`
      )
      .toBeGreaterThan(0);
    expect
      .soft(
        states.filter((state) => !compositionStates[frame].includes(state)),
        `${frame} ${item.id} lists probes only in states its tests run`
      )
      .toEqual([]);
  }
}

/** Capture states in which each frame's tests run composition probes (see declaredAdaptations.*.probes). */
const compositionStates: Record<CorrectionFrame, string[]> = {
  adujr: ['page', 'dialog'],
  s5TRC: ['page'],
  CWJkF: ['dialog'],
  xbIxj: ['page'],
  cuVwp: ['page', 'dialog', 'empty'],
  Jjrtb: ['page', 'dialog', 'empty'],
  SluH3: ['page', 'dialog', 'empty', 'desktop-light']
};
type ProbeRegistry = Record<string, () => Promise<void>>;
const adaptationsOf = (frame: CorrectionFrame) => {
  const declared = Object.entries(manifest.declaredAdaptations).find(([key]) => key === frame)?.[1];
  return Array.isArray(declared) ? declared : [];
};
const probeIdsFor = (frame: CorrectionFrame, state: string) =>
  adaptationsOf(frame).flatMap(
    (item) => Object.entries(item.probes).find(([key]) => key === state)?.[1] ?? []
  );

/**
 * Runs the manifest's composition probes for one frame and capture state. The registry must hold
 * exactly the probe ids the manifest lists for that state: an unregistered id or an unlisted probe fails.
 */
export async function runCompositionProbes(
  frame: CorrectionFrame,
  state: string,
  registry: ProbeRegistry
) {
  const expected = [...probeIdsFor(frame, state)].sort((a, b) => a.localeCompare(b));
  expect
    .soft(
      Object.keys(registry).sort((a, b) => a.localeCompare(b)),
      `${frame} ${state} registers exactly the manifest composition probes`
    )
    .toEqual(expected);
  for (const id of expected) {
    const probe = registry[id];
    if (probe) await probe();
  }
}

/** Tag and normalized text of each direct child, in DOM order (renderer-independent composition). */
export async function childSummary(locator: Locator) {
  return locator.evaluate(
    (element) =>
      [...element.children].map((child) => ({
        tag: child.tagName,
        text: (child instanceof HTMLElement ? child.innerText : (child.textContent ?? ''))
          .replace(/\s+/g, ' ')
          .trim()
      })),
    undefined,
    { timeout: 5000 }
  );
}

/** Content box (inside border and padding) of an element in document coordinates. */
export async function innerBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const left = Number.parseFloat(style.borderLeftWidth) + Number.parseFloat(style.paddingLeft);
    const right = Number.parseFloat(style.borderRightWidth) + Number.parseFloat(style.paddingRight);
    const top = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop);
    const bottom =
      Number.parseFloat(style.borderBottomWidth) + Number.parseFloat(style.paddingBottom);
    return {
      x: rect.x + left,
      y: rect.y + top + window.scrollY,
      right: rect.right - right,
      bottom: rect.bottom - bottom + window.scrollY,
      width: rect.width - left - right,
      height: rect.height - top - bottom
    };
  });
}

/** Production text and control boxes inside a region: they are excluded from its raster compare. */
async function regionData(locator: Locator, offsetY: number) {
  return locator.evaluate((element, offset) => {
    const toRect = ({ x, y, width, height }: DOMRect) => ({ x, y: y + offset, width, height });
    const ignore: { x: number; y: number; width: number; height: number }[] = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) ignore.push(toRect(rect));
    }
    // Descendant controls and nested filled surfaces carry their own fill: they are not this surface.
    for (const child of element.querySelectorAll('*')) {
      const background = getComputedStyle(child).backgroundColor;
      const filled = background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent';
      if (filled || child.matches('button, textarea, input, output, summary, select, svg, img'))
        ignore.push(toRect(child.getBoundingClientRect()));
    }
    return { rect: toRect(element.getBoundingClientRect()), ignore };
  }, offsetY);
}

/** Boxes of every production block inside main: declared adaptations never reach the whole-screen compare. */
async function productionMasks(page: Page): Promise<Rect[]> {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        'main :is(h1,h2,h3,h4,p,section,article,header,div,dl,dd,dt,table,details,summary,button,a,ol,ul,li,output,select,label,span,td,th,tr)'
      )
    ]
      .map((element) => element.getBoundingClientRect())
      .filter(({ width, height }) => width > 0 && height > 0)
      .map(({ x, y, width, height }) => ({ x, y, width, height }))
  );
}

export async function measureFrame(
  frame: CorrectionFrame,
  page: Page,
  info: TestInfo,
  state: string,
  regions: Record<string, Locator>,
  capture: { viewport: { width: number; height: number }; fullPage: boolean } = {
    viewport: frameViewport,
    fullPage: false
  }
) {
  await page.setViewportSize(capture.viewport);
  const screen = screenSpecs[frame]!;
  const specs = regionSpecs[frame] ?? {};
  // Exact set per capture state: a missing region would silently skip its comparison.
  const expectedRegions = Object.entries(specs)
    .filter(([, spec]) => spec.capture === state)
    .map(([name]) => name)
    .sort();
  expect(
    expectedRegions.length,
    `${frame} declares regions for the ${state} capture`
  ).toBeGreaterThan(0);
  expect
    .soft(
      Object.keys(regions).sort(),
      `${frame} ${state} capture supplies exactly the manifest regions`
    )
    .toEqual(expectedRegions);
  const maskRects = [
    ...(referenceMasks[frame] ?? []),
    ...(screen.mode === 'masked' ? await productionMasks(page) : [])
  ];
  const regionInputs = [];
  const offsetY = capture.fullPage ? await page.evaluate(() => window.scrollY) : 0;
  for (const [name, locator] of Object.entries(regions))
    regionInputs.push({
      name,
      spec: specs[name]!,
      production: await regionData(locator, offsetY)
    });
  const actual = await page.screenshot({
    fullPage: capture.fullPage,
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-14/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, maskRects: masks, regionInputs: inputs }) => {
      async function readPixels(url: string, scale: number) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width / scale;
        canvas.height = image.height / scale;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data
        };
      }
      const [rendered, reference] = await Promise.all([
        readPixels(actualUrl, 1),
        readPixels(approvedUrl, 2)
      ]);
      const differs = (a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number) => {
        const red = a[ai]! - b[bi]!;
        const green = a[ai + 1]! - b[bi + 1]!;
        const blue = a[ai + 2]! - b[bi + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        return (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        );
      };
      const dimensionMismatch =
        rendered.width !== reference.width || rendered.height !== reference.height;
      let screenResult = {
        dimensionMismatch,
        difference: null as number | null,
        fullFrame: null as number | null,
        maskedFraction: null as number | null
      };
      if (!dimensionMismatch) {
        let changed = 0;
        let changedAll = 0;
        let masked = 0;
        for (let index = 0; index < rendered.data.length; index += 4) {
          const pixel = index / 4;
          const x = (pixel % rendered.width) + 0.5;
          const y = Math.floor(pixel / rendered.width) + 0.5;
          const inMask = masks.some(
            (rect) =>
              x >= rect.x - 1 &&
              x < rect.x + rect.width + 1 &&
              y >= rect.y - 1 &&
              y < rect.y + rect.height + 1
          );
          if (inMask) masked++;
          if (differs(rendered.data, index, reference.data, index)) {
            changedAll++;
            if (!inMask) changed++;
          }
        }
        const total = rendered.width * rendered.height;
        screenResult = {
          dimensionMismatch,
          difference: changed / (total - masked),
          fullFrame: changedAll / total,
          maskedFraction: masked / total
        };
      }

      // Region compare: top-left aligned crops of one comparable surface. Corners and the edge band
      // (different backdrop and border), production text/controls and the reference's own
      // foreground pixels are excluded, so only surface fill and raster noise is measured.
      const regionResults: Record<
        string,
        {
          difference: number;
          comparedFraction: number;
          cropSize: [number, number];
          productionSize: [number, number];
          referenceFill: number[];
        }
      > = {};
      for (const { name, spec, production } of inputs) {
        const width = Math.floor(Math.min(production.rect.width, spec.reference.width));
        const height = Math.floor(Math.min(production.rect.height, spec.reference.height));
        const originX = Math.round(production.rect.x);
        const originY = Math.round(production.rect.y);
        const refIndex = (column: number, row: number) =>
          ((spec.reference.y + row) * reference.width + spec.reference.x + column) * 4;
        const counts = new Map<string, number>();
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++) {
            const index = refIndex(column, row);
            const key = [0, 1, 2].map((offset) => reference.data[index + offset]).join(',');
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        const modal = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
        const referenceFill = modal.split(',').map(Number);
        const foreground = (column: number, row: number) => {
          const index = refIndex(column, row);
          return (
            Math.abs(reference.data[index]! - referenceFill[0]!) +
              Math.abs(reference.data[index + 1]! - referenceFill[1]!) +
              Math.abs(reference.data[index + 2]! - referenceFill[2]!) >
            24
          );
        };
        const ignoredReference = new Uint8Array(width * height);
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++)
            if (foreground(column, row))
              for (let dy = -2; dy <= 2; dy++)
                for (let dx = -2; dx <= 2; dx++) {
                  const cx = column + dx;
                  const cy = row + dy;
                  if (cx >= 0 && cy >= 0 && cx < width && cy < height)
                    ignoredReference[cy * width + cx] = 1;
                }
        let compared = 0;
        let changed = 0;
        for (let row = 0; row < height; row++)
          for (let column = 0; column < width; column++) {
            const radius = spec.cornerRadius;
            const nearX = column < radius || column >= width - radius;
            const nearY = row < radius || row >= height - radius;
            if (nearX && nearY) continue;
            if (
              column < spec.edgeInset ||
              row < spec.edgeInset ||
              column >= width - spec.edgeInset ||
              row >= height - spec.edgeInset
            )
              continue;
            if (ignoredReference[row * width + column]) continue;
            const px = originX + column + 0.5;
            const py = originY + row + 0.5;
            if (
              production.ignore.some(
                (rect) =>
                  px >= rect.x - 2 &&
                  px < rect.x + rect.width + 2 &&
                  py >= rect.y - 2 &&
                  py < rect.y + rect.height + 2
              )
            )
              continue;
            compared++;
            const actualIndex = ((originY + row) * rendered.width + originX + column) * 4;
            if (differs(rendered.data, actualIndex, reference.data, refIndex(column, row)))
              changed++;
          }
        regionResults[name] = {
          difference: compared ? changed / compared : 1,
          comparedFraction: compared / (width * height),
          cropSize: [width, height],
          productionSize: [production.rect.width, production.rect.height],
          referenceFill
        };
      }
      return { screen: screenResult, regions: regionResults };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      maskRects,
      regionInputs
    }
  );
  console.info(`${frame} PAF-14 measurement: ${JSON.stringify(measured)}`);
  if (screen.mode === 'masked')
    expect
      .soft(measured.screen.dimensionMismatch, `${frame} dimensions match the 2x Pencil export`)
      .toBe(false);
  if (screen.mode === 'masked' && measured.screen.difference !== null) {
    expect
      .soft(screen.budget, `${frame} needs a reviewed nonzero screen budget`)
      .toBeGreaterThan(0);
    expect
      .soft(measured.screen.difference, `${frame} unmasked-area raster budget`)
      .toBeLessThanOrEqual(screen.budget ?? 0);
    expect
      .soft(measured.screen.maskedFraction, `${frame} masks stay a bounded share of the frame`)
      .toBeLessThanOrEqual(screen.maxMaskedFraction ?? 0);
  }
  for (const [name, result] of Object.entries(measured.regions)) {
    const spec = specs[name]!;
    expect
      .soft(result.referenceFill, `${frame} ${name} reference fill matches the manifest`)
      .toEqual(spec.fill);
    expect
      .soft(result.comparedFraction, `${frame} ${name} keeps a meaningful compared share`)
      .toBeGreaterThanOrEqual(minComparedFraction);
    expect.soft(spec.budget, `${frame} ${name} needs a nonzero budget`).toBeGreaterThan(0);
    expect
      .soft(result.difference, `${frame} ${name} region raster budget`)
      .toBeLessThanOrEqual(spec.budget);
  }
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-measurement`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json'
  });
  return measured;
}
