import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveCroppedTopPng } from '../e2e/png-mask';
import manifest from '../e2e/references/paf-202-d1-auth/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = new URL('../e2e/references/paf-202-d1-auth/', import.meta.url);
const snapshots = new URL('../e2e/auth-d1-visual.spec.ts-snapshots/', import.meta.url);
type Frame = (typeof manifest.frames)[keyof typeof manifest.frames];
const entries = Object.entries(manifest.frames) as Array<[string, Frame]>;
const pixel = entries.filter(([, frame]) => frame.comparison === 'pixel');
const frameOnly = entries.filter(([, frame]) => frame.comparison === 'frame-only');
const measured: Record<string, { ratio: number }> = manifest.calibration.measured;
const byText = (a: string, b: string) => a.localeCompare(b);

describe('PAF-202 D1 auth visual references', () => {
  it('pins exactly the twenty approved D1 frames from the canonical pen', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(entries).toHaveLength(20);
    expect(new Set(entries.map(([, frame]) => frame.frameId)).size).toBe(20);
    expect(entries.map(([, frame]) => frame.frameName.split(' — ')[0] ?? '').sort(byText)).toEqual(
      [
        ...Array(8).fill('invite-confirmation'),
        ...Array(6).fill('claim-password'),
        ...Array(6).fill('claim-verify')
      ].sort(byText)
    );
    for (const group of ['invite', 'claim-password', 'claim-verify'])
      expect(entries.filter(([name]) => name.startsWith(group)).length).toBeGreaterThan(0);
  });

  it('pins each export by digest, size and 390x844 dimensions', () => {
    for (const [name, frame] of entries) {
      const source = readFileSync(new URL(frame.source, root));
      expect([name, digest(source)]).toEqual([name, frame.sourceSha256]);
      expect([name, source.length]).toEqual([name, frame.sourceBytes]);
      expect([name, source.readUInt32BE(16), source.readUInt32BE(20)]).toEqual([name, 390, 844]);
    }
  });

  it('derives every pixel-compared baseline from its export without the status bar', () => {
    expect(pixel).toHaveLength(12);
    for (const [name, frame] of pixel) {
      const derived = deriveCroppedTopPng(readFileSync(new URL(frame.source, root)), 44);
      expect([name, digest(derived)]).toEqual([name, frame.baselineSha256]);
      expect([name, derived.readUInt32BE(16), derived.readUInt32BE(20)]).toEqual([
        name,
        frame.width,
        frame.height
      ]);
      expect(readFileSync(new URL(`${name}.png`, snapshots)).equals(derived)).toBe(true);
    }
  }, 30_000);

  it('records the frame-only states with a reason and no budget or baseline', () => {
    expect(frameOnly.map(([name]) => name).sort(byText)).toEqual([
      'claim-verify-dark',
      'claim-verify-expired-code-dark',
      'claim-verify-expired-code-light',
      'claim-verify-invalid-code-dark',
      'claim-verify-invalid-code-light',
      'claim-verify-light',
      'invite-invalid-dark',
      'invite-invalid-light'
    ]);
    for (const [name, frame] of frameOnly) {
      expect([name, frame.maxDiffPixelRatio]).toEqual([name, null]);
      expect([name, frame.baselineSha256]).toEqual([name, null]);
      expect(frame.appState.length).toBeGreaterThan(20);
    }
  });

  it('keeps nonzero budgets just above each measured residual with documented rationale', () => {
    expect(manifest.calibration.justification).toContain('divergences');
    for (const [name, frame] of pixel) {
      const ratio = measured[name]?.ratio ?? Number.NaN;
      const budget = frame.maxDiffPixelRatio ?? Number.NaN;
      expect([name, budget > ratio]).toEqual([name, true]);
      expect([name, budget - ratio <= 0.003]).toEqual([name, true]);
    }
    for (const group of ['invite-default', 'invite-expired', 'claim-password-error'])
      expect(Object.keys(manifest.calibration.knownDivergences)).toContain(group);
  });
});
