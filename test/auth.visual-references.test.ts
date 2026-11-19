import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authLogoMask, deriveCroppedTopPng, deriveMaskedPng } from '../e2e/png-mask';
import manifest from '../e2e/references/paf-202-auth/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const root = new URL('../e2e/references/paf-202-auth/', import.meta.url);
const snapshots = new URL('../e2e/auth-visual.spec.ts-snapshots/', import.meta.url);
const frames = [
  ['login-welcome.png', 'wzWLt'],
  ['account-signup.png', 'EGb2g'],
  ['forgot-password.png', 'ieoni'],
  ['login-inbox.png', 'FZlHy'],
  ['reset-password.png', 'ZthyR']
] as const;

describe('PAF-202 U6 auth visual references', () => {
  it('pins exactly the five Clubhouse auth frames from the canonical pen', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(Object.keys(manifest.frames).sort()).toEqual(frames.map(([name]) => name).sort());
    for (const [name, frameId] of frames) expect(manifest.frames[name].frameId).toBe(frameId);
  });

  it('pins each export by digest and size, and each baseline as its status-bar-free derivation', () => {
    for (const [name] of frames) {
      const frame = manifest.frames[name];
      const source = readFileSync(new URL(frame.source, root));
      expect([name, digest(source)]).toEqual([name, frame.sourceSha256]);
      expect([name, source.readUInt32BE(16), source.readUInt32BE(20)]).toEqual([name, 390, 844]);
      const cropped = deriveCroppedTopPng(source, 44);
      const derived =
        name === 'login-welcome.png' || name === 'login-inbox.png'
          ? deriveMaskedPng(cropped, authLogoMask)
          : cropped;
      expect([name, digest(derived)]).toEqual([name, frame.baselineSha256]);
      expect([name, derived.readUInt32BE(16), derived.readUInt32BE(20)]).toEqual([
        name,
        frame.width,
        frame.height
      ]);
      expect(readFileSync(new URL(name, snapshots)).equals(derived)).toBe(true);
    }
  }, 30_000);

  it('keeps nonzero budgets just above each measured residual with documented rationale', () => {
    expect(manifest.calibration.justification).toContain('Figtree');
    for (const [name] of frames) {
      const frame = manifest.frames[name];
      const measured = manifest.calibration.measured[name].ratio;
      expect(frame.maxDiffPixelRatio).toBeGreaterThan(measured);
      // Budgets only absorb raster variance: a budget far above the residual would hide defects.
      expect(frame.maxDiffPixelRatio - measured).toBeLessThanOrEqual(0.003);
    }
  });
});
