import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('match styles', () => {
  it('uses generated design variables and avoids literal color and spacing values', () => {
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    expect(styles).toContain('var(--color-');
    expect(styles).toContain('var(--space-');
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}|\b\d+px\b/i);
  });
  it('keeps measured primary controls at 44px and uses a 2px tokenized focus ring', () => {
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    const createStyles = readFileSync('src/features/matches/create-match.styles.ts', 'utf8');
    const touchMinimum = 'calc(var(--space-40) + var(--space-4))';
    expect(styles).toContain('var(--border-width-lg) solid var(--color-green)');
    expect(styles).toContain(touchMinimum); // detail input and unavailable/back links
    expect(createStyles).toContain(touchMinimum); // file control and team radio labels
    expect(createStyles).toContain('touchLabel');
    expect(createStyles).toContain('fileInput');
    expect(readFileSync('src/features/matches/MatchInviteePicker.tsx', 'utf8')).toContain(
      'stylex.props(s.button)'
    );
  });
});
