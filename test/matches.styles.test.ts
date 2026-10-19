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
    expect(createStyles).toContain("minInlineSize: 'calc(var(--space-40) + var(--space-4))'");
    expect(createStyles).toContain("minBlockSize: 'calc(var(--space-40) + var(--space-4))'");
    expect(createStyles).toContain('fileInput');
    expect(readFileSync('src/features/matches/MatchInviteePicker.tsx', 'utf8')).toContain(
      'stylex.props(s.button)'
    );
  });
  it('matches the measured match surfaces, rhythm, tab treatment, and card radius', () => {
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    const createStyles = readFileSync('src/features/matches/create-match.styles.ts', 'utf8');
    expect(styles).toContain("padding: 'var(--space-18)'");
    expect(styles).toContain("gap: 'var(--space-8)',\n    width: '100%'");
    expect(styles).toContain("gap: 'var(--space-8)' },");
    expect(styles).toContain("backgroundColor: 'var(--color-surface-2)'");
    expect(styles).toContain("backgroundColor: 'var(--color-surface)',\n    fontWeight");
    expect(styles).toContain("borderRadius: 'var(--radius-12)'");
    expect(createStyles).toContain("padding: 'var(--space-18)'");
    expect(createStyles).toContain("form: { display: 'grid', gap: 'var(--space-10)' }");
    expect(createStyles).toContain("width: '100%',\n    backgroundColor: 'var(--color-green)'");
    expect(readFileSync('src/features/matches/CreateMatchPage.tsx', 'utf8')).toContain(
      'stylex.props(s.button, s.primaryButton)'
    );
  });
  it('uses the theme-aware background foreground against green primary actions', () => {
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    const createStyles = readFileSync('src/features/matches/create-match.styles.ts', 'utf8');
    expect(
      styles.match(/backgroundColor: 'var\(--color-green\)',\s*color: 'var\(--color-bg\)'/g)
    ).toHaveLength(2);
    expect(createStyles).toContain(
      "backgroundColor: 'var(--color-green)',\n    color: 'var(--color-bg)'"
    );
    expect(readFileSync('design-tokens/dist/tokens.css', 'utf8')).toContain(
      '--color-bg: var(--palette-bg-dark)'
    );
  });
});
