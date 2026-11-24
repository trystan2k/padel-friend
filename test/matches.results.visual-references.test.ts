import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import clubhouse from '../e2e/references/paf-202-match-management/manifest.json';
import decision from '../e2e/references/paf-202-result-decision/manifest.json';
import recording from '../e2e/references/paf-202-result-recording/manifest.json';

describe('result visual reference provenance', () => {
  it('uses semantic hero and amber tokens instead of primitive palette tokens', () => {
    const styles = readFileSync('src/features/matches/match-result.styles.ts', 'utf8');
    for (const token of ['amber']) {
      expect(styles).toContain(`var(--color-${token})`);
    }
    expect(styles).not.toContain('--palette-');
  });
  it('pins started-unavailable ownership in decision and management', () => {
    expect(decision.surfaces.MatchResultDetail.frames).toContain('iXRPp');
    expect(clubhouse.frames['started-unavailable']).toBe('ccicygl');
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
  it('pins the approved Chromium recording baselines and navigation band', () => {
    const { frames, width, height, pixelThreshold } = recording.pixelEvidence;
    expect(Object.keys(frames).sort()).toEqual(
      ['XySt5', 'GPo9z', 'c0wbmu', 'NZk5H', 'wsXWA'].sort()
    );
    expect(pixelThreshold).toBe(12);
    for (const frame of Object.values(frames)) {
      expect(Buffer.from(frame.baseline, 'base64')).toHaveLength(width * height);
      expect(frame.maxDiffRatio).toBe(0.005);
    }
    const source = readFileSync(recording.sourceDesign.path);
    expect(createHash('sha256').update(source).digest('hex')).toBe(recording.sourceDesign.sha256);
  });
});
