import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('match styles', () => {
  it('uses generated design variables and avoids literal color and spacing values', () => {
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    expect(styles).toContain('var(--color-');
    expect(styles).toContain('var(--space-');
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}|\b\d+px\b/i);
  });
});
