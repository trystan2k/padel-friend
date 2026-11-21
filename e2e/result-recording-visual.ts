import { expect, type Page } from '@playwright/test';
import manifest from './references/paf-202-result-recording/manifest.json' with { type: 'json' };

const evidence = manifest.pixelEvidence;
export type RecordingReference = keyof typeof evidence.frames;
type LifecycleReference = keyof typeof evidence.lifecycle;

export async function assertResultScreenshot(
  page: Page,
  actual: Buffer,
  ...[frame, kind]:
    | [frame: RecordingReference, kind: 'recording']
    | [frame: LifecycleReference, kind: 'lifecycle']
) {
  if (kind === 'recording' && frame === 'alZmm') {
    const band = await page.evaluate(
      async ({ src, height, rgb }) => {
        const image = new Image();
        image.src = src;
        await image.decode();
        const start = image.height - height;
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No comparison canvas');
        context.drawImage(image, 0, -start);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let changed = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] !== rgb[0] || pixels[i + 1] !== rgb[1] || pixels[i + 2] !== rgb[2]) {
            changed++;
          }
        }
        return { width: canvas.width, height: canvas.height, changed };
      },
      {
        src: `data:image/png;base64,${actual.toString('base64')}`,
        height: evidence.navigationBandHeight,
        rgb: evidence.frames.alZmm.solidRgb
      }
    );
    expect(band, 'alZmm D9 band uses the measured no-navigation background').toEqual({
      width: 390,
      height: 70,
      changed: 0
    });
    return;
  }
  const reference = kind === 'lifecycle' ? evidence.lifecycle[frame] : evidence.frames[frame];
  if (!('baseline' in reference)) throw new Error(`No luma baseline for ${frame}`);
  const { width, height, recordingStartRow } = evidence;
  const firstCell = kind === 'recording' ? width * recordingStartRow : 0;
  const grid = await page.evaluate(
    async ({ src, cols, rows }) => {
      const image = new Image();
      image.src = src;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = rows;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No comparison canvas');
      context.drawImage(image, 0, 0, cols, rows);
      const rgba = context.getImageData(0, 0, cols, rows).data;
      return Array.from({ length: rgba.length / 4 }, (_, index) => {
        const offset = index * 4;
        return Math.round(
          rgba[offset]! * 0.299 + rgba[offset + 1]! * 0.587 + rgba[offset + 2]! * 0.114
        );
      });
    },
    {
      src: `data:image/png;base64,${actual.toString('base64')}`,
      cols: width,
      rows: height
    }
  );
  if (process.env.RESULT_BASELINE_CAPTURE) {
    // Re-measure: prints the luma grid to paste into the manifest after an intended visual change.
    console.info(`BASELINE ${kind}:${frame} ${Buffer.from(grid).toString('base64')}`);
    return;
  }
  const baseline = Buffer.from(reference.baseline, 'base64');
  expect(baseline.length, `${frame} baseline dimensions`).toBe(grid.length);
  const lastCell =
    kind === 'recording' ? width * (frame === 'XySt5' || frame === 'wsXWA' ? 38 : 32) : grid.length;
  const changed = grid
    .slice(firstCell, lastCell)
    .filter(
      (value, index) => Math.abs(value - baseline[index + firstCell]!) > evidence.pixelThreshold
    );
  const ratio = changed.length / (lastCell - firstCell);
  console.info(`${frame} Clubhouse fixture changed ratio: ${ratio}`);
  expect(ratio, `${frame} measured browser budget`).toBeLessThanOrEqual(reference.maxDiffRatio);
}
