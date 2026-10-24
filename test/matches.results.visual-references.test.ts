import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-7/manifest.json';

describe('result visual reference provenance', () => {
  it('uses semantic hero and amber tokens instead of primitive palette tokens', () => {
    const styles = readFileSync('src/features/matches/match-result.styles.ts', 'utf8');
    for (const token of ['hero-copy', 'on-hero', 'hero-accent', 'amber']) {
      expect(styles).toContain(`var(--color-${token})`);
    }
    expect(styles).not.toContain('--palette-');
  });
  it('compares the approved started-entry successor, not the historical frame', () => {
    expect(manifest.successorStates['started-unavailable'].frameId).toBe('iXRPp');
    expect(manifest.successorStates['started-unavailable'].supersedes).toBe('tVzco');
    const suite = readFileSync('e2e/matches-management-visual.spec.ts', 'utf8');
    expect(suite).toContain("['started-unavailable', 'iXRPp']");
    expect(suite).not.toContain("['started-unavailable', 'tVzco']");
    expect(manifest.approvedReferences['iXRPp.png'].maskRegions).toEqual([
      { x: 32, y: 426, width: 326, height: 38 }
    ]);
    expect(manifest.visualBudgets.perScreen.iXRPp).toBeGreaterThan(0);
  });
  it('pins the approved started-entry line boxes without changing other detail states', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toContain(
      "resultEntryTitle: { lineHeight: 'calc(var(--space-20) + var(--space-6))' }"
    );
    expect(shell).toContain("resultParticipation: { gap: 'var(--space-6)' }");
    const roster = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(roster).toContain(
      "[stylex.when.ancestor('[data-result-entry=\"available\"]')]: 'var(--space-14)'"
    );
    expect(roster).toContain(
      "[stylex.when.ancestor('[data-result-entry=\"available\"]')]: 'var(--space-15)'"
    );
  });
  it('reserves the shared tokenized locale/theme gutter beside translated titles', () => {
    const styles = readFileSync('src/features/matches/match-result.styles.ts', 'utf8');
    expect(styles).toMatch(
      /title: \{[^}]*paddingInlineEnd: 'calc\(var\(--space-40\) \* 2 \+ var\(--space-8\) \* 3\)'/
    );
  });
  it('pins every approved composition to an uncropped real Pencil export', () => {
    expect(Object.keys(manifest.approvedReferences).sort()).toEqual(
      [
        'XySt5.png',
        'GPo9z.png',
        'c0wbmu.png',
        'NZk5H.png',
        'wsXWA.png',
        'alZmm.png',
        'iXRPp.png'
      ].sort()
    );
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    for (const [filename, reference] of Object.entries({
      ...manifest.approvedReferences,
      ...manifest.componentReferences
    })) {
      const bytes = readFileSync(new URL(`../e2e/references/paf-7/${filename}`, import.meta.url));
      expect(digest(bytes)).toBe(reference.sha256);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
      expect(filename).toBe(`${reference.frameId}.png`);
      expect(reference.certifies.length).toBeGreaterThan(0);
    }
    // Opaque byte digest only: never decode the encrypted design.
    expect(digest(readFileSync(manifest.sourceDesign.path))).toBe(manifest.sourceDesign.sha256);
  });
});
