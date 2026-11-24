import { expect, test, type Locator, type Page } from '@playwright/test';

// PAF-202 frame-relative comparison. The Chromium snapshots of the visual specs only prove
// browser-to-browser stability: after a re-baseline a wrong layout would still pass. This helper
// compares measured regions of the LIVE page against the same region of the hash-pinned Pencil
// export, so the design stays the reference:
//  - gated: live geometry must sit on the frame rect (after the device status bar offset) and the
//    perceptual residual must stay under the manifest's measured budget. Gated regions compare
//    stable content, so the caller's dynamic masks apply and their coverage is reported.
//  - finding: the live element does not match the frame (different surface, size or position). It is
//    never budgeted and never masked: the raw, unmasked delta is the evidence, attached to the test
//    as an annotation and recorded in the manifest, so the divergence stays visible until the UI or
//    the frame changes. Axes listed in `geometry` still match the frame and stay gated.
// Integrity: a pixel comparison fails loudly instead of passing vacuously. The crop must have exactly
// the manifest dimensions (no clipped or off-screen crop, in the live capture and in the export) and
// at least MIN_COVERAGE of its area must be compared after masks. A region that is genuinely off
// screen declares `pixels: 'none'` with its reason in `classification`; geometry is still measured.
// Pixels covered by a Playwright mask (#FF00FF) are excluded from the residual.

export type FrameRect = { x: number; y: number; width: number; height: number };
type Axis = 'x' | 'y' | 'width' | 'height';

export type FrameRegionRecord = {
  status: 'gated' | 'finding' | 'measure';
  /** Element rect in the Pencil export, in export pixels. */
  reference: FrameRect;
  /** Export rows the live viewport does not draw (device status bar, taller export). */
  offsetY: number;
  /** Crop compared, relative to the element's top-left. Defaults to the full reference rect. */
  crop?: { dx: number; dy: number; width: number; height: number };
  /** Axes whose live-vs-reference delta is gated. Gated regions default to all four; findings
   * gate none unless listed. */
  geometry?: Axis[];
  /** Max absolute delta (px) per gated axis. */
  geometryTolerance?: number;
  /** Max changed-pixel ratio in the crop (measured + margin). */
  budget?: number;
  /** `none` records geometry only (finding regions that are off screen in the live capture). */
  pixels?: 'compare' | 'none';
  /** Required with `pixels: 'none'`: why the region cannot be compared as pixels. */
  pixelsReason?: string;
  classification: string;
};

type Measured = {
  geometry: Record<Axis, number>;
  residual: number | null;
  compared: number;
  maskedCoverage: number;
};

const MASK = '#FF00FF';
/** Fraction of the expected crop area that must be compared after masks. */
const MIN_COVERAGE = 0.5;

export async function assertFrameRegions(options: {
  page: Page;
  frame: string;
  reference: Buffer;
  regions: Record<string, FrameRegionRecord>;
  locators: Record<string, Locator>;
  mask?: Locator[];
}): Promise<Record<string, Measured>> {
  const { page, frame, reference, regions, locators, mask = [] } = options;
  const names = Object.keys(regions);
  expect(
    names.filter((name) => !locators[name]),
    `${frame}: every manifest region needs a live locator`
  ).toEqual([]);
  expect(
    Object.keys(locators).filter((name) => !regions[name]),
    `${frame}: every live locator needs a manifest region`
  ).toEqual([]);

  await page.evaluate(() => document.fonts.ready);
  const capture = {
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: 0, width: 390, height: 844 },
    maskColor: MASK
  } as const;
  // Gated regions compare stable content under the caller's masks; finding regions need the raw page.
  const masked = await page.screenshot({ ...capture, mask });
  const raw =
    mask.length > 0 && names.some((name) => regions[name]!.status === 'finding')
      ? await page.screenshot(capture)
      : masked;

  const jobs: {
    name: string;
    source: 'masked' | 'raw';
    skipPixels: boolean;
    live: FrameRect;
    reference: FrameRect;
    crop: { dx: number; dy: number; width: number; height: number };
  }[] = [];
  for (const name of names) {
    const record = regions[name]!;
    const box = await locators[name]!.first().boundingBox();
    if (!box) throw new Error(`${frame}/${name}: live region is not rendered`);
    jobs.push({
      name,
      source: record.status === 'finding' ? 'raw' : 'masked',
      skipPixels: record.pixels === 'none',
      live: box,
      reference: record.reference,
      crop: record.crop ?? {
        dx: 0,
        dy: 0,
        width: record.reference.width,
        height: record.reference.height
      }
    });
  }

  const toUrl = (image: Buffer) => `data:image/png;base64,${image.toString('base64')}`;
  const residuals = await page.evaluate(
    async ({ maskedUrl, rawUrl, referenceUrl, work }) => {
      const load = async (url: string) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, 0, 0);
        return ctx;
      };
      const [maskedImage, rawImage, frameImage] = await Promise.all([
        load(maskedUrl),
        load(rawUrl),
        load(referenceUrl)
      ]);
      return work.map((job) => {
        const live = job.source === 'raw' ? rawImage : maskedImage;
        const area = job.crop.width * job.crop.height;
        const lx = Math.round(job.live.x + job.crop.dx);
        const ly = Math.round(job.live.y + job.crop.dy);
        const rx = Math.round(job.reference.x + job.crop.dx);
        const ry = Math.round(job.reference.y + job.crop.dy);
        const inside = (ctx: CanvasRenderingContext2D, x: number, y: number) =>
          x >= 0 &&
          y >= 0 &&
          x + job.crop.width <= ctx.canvas.width &&
          y + job.crop.height <= ctx.canvas.height;
        const base = { name: job.name, area, residual: 0, compared: 0, masked: 0 };
        if (job.skipPixels) return { ...base, residual: null, inLive: true, inReference: true };
        const inLive = inside(live, lx, ly);
        const inReference = inside(frameImage, rx, ry);
        if (!inLive || !inReference) return { ...base, inLive, inReference };
        const a = live.getImageData(lx, ly, job.crop.width, job.crop.height).data;
        const b = frameImage.getImageData(rx, ry, job.crop.width, job.crop.height).data;
        let changed = 0;
        let compared = 0;
        let maskedPixels = 0;
        for (let index = 0; index < a.length; index += 4) {
          if (a[index] === 255 && a[index + 1] === 0 && a[index + 2] === 255) {
            maskedPixels++;
            continue;
          }
          compared++;
          const red = a[index]! - b[index]!;
          const green = a[index + 1]! - b[index + 1]!;
          const blue = a[index + 2]! - b[index + 2]!;
          const luma = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
          const i = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
          const q = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
          if (0.5053 * luma * luma + 0.299 * i * i + 0.1957 * q * q > 35215 * 0.1 ** 2) changed++;
        }
        return {
          ...base,
          residual: compared === 0 ? 0 : changed / compared,
          compared,
          masked: maskedPixels,
          inLive,
          inReference
        };
      });
    },
    {
      maskedUrl: toUrl(masked),
      rawUrl: toUrl(raw),
      referenceUrl: toUrl(reference),
      work: jobs
    }
  );

  const measured: Record<string, Measured> = {};
  const integrity: string[] = [];
  for (const job of jobs) {
    const record = regions[job.name]!;
    const found = residuals.find((entry) => entry.name === job.name)!;
    const round = (value: number) => Math.round(value * 100) / 100;
    const geometry: Record<Axis, number> = {
      x: round(job.live.x - job.reference.x),
      y: round(job.live.y - (job.reference.y - record.offsetY)),
      width: round(job.live.width - job.reference.width),
      height: round(job.live.height - job.reference.height)
    };
    measured[job.name] = {
      geometry,
      residual: found.residual === null ? null : Math.round(found.residual * 10000) / 10000,
      compared: found.compared,
      maskedCoverage: Math.round((found.masked / found.area) * 10000) / 10000
    };
    if (job.skipPixels) {
      if (!record.pixelsReason)
        integrity.push(`${frame}/${job.name}: pixels 'none' needs a pixelsReason`);
      continue;
    }
    const where = `${frame}/${job.name}`;
    if (!found.inLive)
      integrity.push(
        `${where}: ${job.crop.width}x${job.crop.height} crop is clipped or off screen in the live capture`
      );
    if (!found.inReference)
      integrity.push(`${where}: crop lies outside the Pencil export (check reference rect)`);
    if (found.inLive && found.inReference && found.compared < MIN_COVERAGE * found.area)
      integrity.push(
        `${where}: only ${found.compared} of ${found.area} px compared (${found.masked} masked); need at least ${MIN_COVERAGE * 100}%`
      );
  }
  console.info(`PAF-202 ${frame} frame regions: ${JSON.stringify(measured)}`);
  expect(integrity, `${frame}: frame region crops must be complete and unmasked enough`).toEqual(
    []
  );

  for (const name of names) {
    const record = regions[name]!;
    const result = measured[name]!;
    if (record.status === 'measure') {
      if (process.env['PAF202_FRAME_MEASURE'] !== '1')
        throw new Error(`${frame}/${name}: unmeasured region; run with PAF202_FRAME_MEASURE=1`);
      continue;
    }
    if (record.status === 'finding') {
      // Axes that do match the frame stay gated; the divergence itself is never budgeted or masked.
      for (const axis of record.geometry ?? [])
        expect
          .soft(Math.abs(result.geometry[axis]), `${frame}/${name}: live ${axis} vs frame`)
          .toBeLessThanOrEqual(record.geometryTolerance ?? 1);
      test.info().annotations.push({
        type: 'frame-divergence',
        description: `${frame}/${name}: ${JSON.stringify(result)} — ${record.classification}`
      });
      continue;
    }
    const tolerance = record.geometryTolerance ?? 1;
    for (const axis of record.geometry ?? ['x', 'y', 'width', 'height'])
      expect
        .soft(Math.abs(result.geometry[axis]), `${frame}/${name}: live ${axis} vs frame`)
        .toBeLessThanOrEqual(tolerance);
    expect(record.budget, `${frame}/${name}: gated regions need a measured budget`).toBeGreaterThan(
      0
    );
    expect(
      result.residual,
      `${frame}/${name}: gated regions need a pixel comparison`
    ).not.toBeNull();
    expect
      .soft(result.residual!, `${frame}/${name}: residual vs the Pencil export`)
      .toBeLessThanOrEqual(record.budget!);
  }
  return measured;
}
