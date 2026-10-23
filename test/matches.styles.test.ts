import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANAGEMENT_COMPONENTS } from './helpers/match-management-contract';

describe('match styles', () => {
  it('keeps detail photos fixed-height, roster rows compact, and cancelled badges inline', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toMatch(
      /image: \{[^}]*height: 'calc\(var\(--space-40\) \* 3 \+ var\(--space-8\)\)'/
    );
    expect(shell).toMatch(
      /cancelledBadge: \{\s*display: 'flex',\s*justifyContent: 'flex-start',\s*minHeight: 'calc\(var\(--space-20\) \+ var\(--space-4\)\)'/
    );
    const registration = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(registration).toMatch(
      /playerRow: \{[^}]*minHeight: 'calc\(var\(--space-40\) \+ var\(--space-4\)\)'/
    );
    expect(registration).toMatch(
      /passivePlayerRow: \{[^}]*minHeight: 'calc\(var\(--space-20\) \+ var\(--space-12\)\)'/
    );
    expect(readFileSync('src/features/matches/MatchRosterCard.tsx', 'utf8')).toContain(
      '!participants && s.passivePlayerRow'
    );
    expect(registration).toMatch(/playerRow: \{[^}]*paddingBlock: 0/);
    expect(registration).toMatch(/rosterSection: \{[^}]*gap: 'var\(--space-4\)'/);
    expect(registration).toMatch(/roster: \{[^}]*gap: 'var\(--space-4\)'/);
    expect(registration).toMatch(
      /initials: \{[^}]*width: 'calc\(var\(--space-20\) \+ var\(--space-4\)\)'/
    );
  });
  it('uses flat surface edit fields and unbevelled buttons despite StyleX shorthand resets', () => {
    const edit = readFileSync('src/features/matches/match-edit.styles.ts', 'utf8');
    expect(edit).toMatch(/input: \{[^}]*backgroundColor: 'var\(--color-surface\)'/);
    expect(edit).toMatch(
      /input: \{[^}]*borderWidth: 'var\(--border-width-sm\)'[^}]*borderStyle: 'solid'[^}]*borderColor: 'var\(--color-line\)'/
    );
    expect(edit).toMatch(/input: \{[^}]*appearance: 'none'[^}]*boxShadow: 'none'/);
    expect(edit).toMatch(
      /button: \{[^}]*appearance: 'none'[^}]*borderWidth: 0[^}]*borderStyle: 'none'/
    );
    expect(edit).toContain('backdrop: { opacity: 0.97 }');
  });
  it('uses Inter body/card content and semibold card headings, retaining Manrope venue headings', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toMatch(/page: \{[^}]*fontFamily: 'var\(--font-family-body\)'/);
    expect(shell).toMatch(/title: \{[^}]*fontWeight: 'var\(--font-weight-semibold\)'/);
    expect(shell).toMatch(/venue: \{[^}]*fontFamily: 'var\(--font-family-heading\)'/);
    for (const name of [
      'match-edit',
      'match-registration',
      'match-management',
      'match-invitation'
    ]) {
      const source = readFileSync(`src/features/matches/${name}.styles.ts`, 'utf8');
      expect(source).not.toContain('var(--font-family-heading)');
      expect(source).toContain('var(--font-family-body)');
    }
  });
  it('reserves global chip width on non-detail headers without changing detail composition', () => {
    const root = readFileSync('src/root.styles.ts', 'utf8');
    expect(root).toMatch(
      /pageHeader: \{[^}]*paddingInlineEnd: 'calc\(var\(--space-40\) \* 2 \+ var\(--space-8\) \* 3\)'/
    );
    expect(root).toMatch(/pageHeader: \{[^}]*overflowWrap: 'anywhere'/);
    expect(readFileSync('src/features/matches/MatchesPage.tsx', 'utf8')).toContain(
      's.heading, rootStyles.pageHeader'
    );
    expect(readFileSync('src/features/matches/MatchDetailPage.tsx', 'utf8')).not.toContain(
      'rootStyles.pageHeader'
    );
  });
  it('gives detail map actions the existing tokenized touch-target link style', () => {
    const source = readFileSync('src/features/matches/MatchDetailPage.tsx', 'utf8');
    expect(source).toMatch(
      /href=\{event\.maps_url\}[\s\S]*?stylex\.props\(s\.link, s\.cardLink, shell\.maps\)/
    );
  });
  it('allows management fieldsets and controls to shrink inside narrow translated dialogs', () => {
    const source = readFileSync('src/features/matches/match-management.styles.ts', 'utf8');
    expect(source).toMatch(
      /section: \{\s*display: 'grid',\s*gridTemplateColumns: 'minmax\(0, 1fr\)',\s*minWidth: 0/
    );
    expect(source).toMatch(/input: \{\s*width: '100%',\s*minWidth: 0,\s*maxWidth: '100%'/);
    expect(source).not.toContain("overflowX: 'hidden'");
  });
  it.each([
    'match-management',
    'match-invitation',
    'match-registration',
    'match-edit',
    'create-match',
    'match-detail-shell'
  ])('%s keeps colors, spacing, radius and typography tokenized', (name) => {
    const source = readFileSync(`src/features/matches/${name}.styles.ts`, 'utf8');
    const violations: string[] = [];
    for (const match of source.matchAll(/\b(\w+):\s*('(?:[^']*)'|\d+(?:\.\d+)?)/g)) {
      const [, property, value] = match;
      if (
        /^(?:.*Color|color|background|gap|.*Gap|padding.*|margin.*|borderRadius|fontSize|fontFamily|fontWeight|lineHeight|letterSpacing)$/.test(
          property!
        )
      ) {
        if (
          value !== '0' &&
          value !== "'auto'" &&
          value !== "'transparent'" &&
          !value!.includes('var(--')
        )
          violations.push(`${property}: ${value}`);
      }
    }
    expect(violations).toEqual([]);
    // Unit-bearing zero is valid CSS calc arithmetic, not a design dimension.
    expect(source.replace(/\b0px\b/g, '0')).not.toMatch(
      /#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla)\(|\b\d+px\b/i
    );
  });

  it('management controls retain shared touch-target styles without inline overrides', () => {
    const management = readFileSync('src/features/matches/match-management.styles.ts', 'utf8');
    expect(management).toContain("minHeight: 'calc(var(--space-40) + var(--space-4))'");
    expect(management).toContain("minWidth: 'calc(var(--space-40) + var(--space-4))'");
    expect(management).toContain("minHeight: 'calc(var(--space-40) * 2)'");
    expect(management).toMatch(
      /menuItem: \{[^}]*minHeight: 'calc\(var\(--space-40\) \+ var\(--space-4\)\)'/
    );
    const registration = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(
      registration.match(/minHeight: 'calc\(var\(--space-40\) \+ var\(--space-4\)\)'/g)?.length
    ).toBeGreaterThanOrEqual(2);
    for (const component of MANAGEMENT_COMPONENTS) {
      const source = readFileSync(`src/features/matches/${component}.tsx`, 'utf8');
      expect(source, `Inline style: ${component}`).not.toMatch(/\bstyle\s*=/);
      const controls = [
        ...source.matchAll(
          /<(button|Menu\.(?:Trigger|Item)|Dialog\.Close|select|textarea)\b([\s\S]*?)(?:\/>|<\/\1>)/g
        )
      ];
      for (const control of controls)
        expect(control[2], `Control style: ${component}`).toMatch(
          /stylex\.props\((?:s\.(?:button|input|menuItem)|(?:buttons|card)\.(?:primaryButton|secondaryButton))/
        );
    }
  });
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
    expect(createStyles).toContain('minInlineSize: 0');
    expect(createStyles).toContain("maxInlineSize: '100%'");
    expect(createStyles).toContain("inlineSize: '100%'");
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
  it('matches rebuilt detail shell card rhythm and compact native global controls', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toContain("gap: 'var(--space-12)'");
    expect(shell).toContain("gap: 'var(--space-10)'");
    expect(shell).toContain("padding: 'var(--space-14)'");
    expect(shell).toContain("borderRadius: 'var(--radius-16)'");
    expect(shell).toContain("borderRadius: 'var(--radius-12)'");
    expect(shell).toContain("textTransform: 'uppercase'");
    const root = readFileSync('src/root.styles.ts', 'utf8');
    expect(root).toContain("appearance: 'none'");
    expect(root).toContain("borderRadius: '50%'");
    expect(root).toMatch(/chip: \{[^}]*borderWidth: 0/);
    expect(root).toMatch(/chip: \{[^}]*backgroundColor: 'var\(--color-surface-2\)'/);
    expect(root).toContain("fontSize: 'var(--font-size-11)'");
    expect(root).toContain("textTransform: 'uppercase'");
    expect(shell).toMatch(/input: \{[^}]*resize: 'none'/);
    expect(root).toContain("':has(:focus-visible)'");
  });
  it('uses the theme-aware background foreground against green primary actions', () => {
    for (const file of ['match-management', 'match-edit']) {
      const styles = readFileSync(`src/features/matches/${file}.styles.ts`, 'utf8');
      expect(styles).toMatch(
        /backgroundColor: 'var\(--color-green\)',\s*color: 'var\(--color-bg\)'/
      );
      expect(styles).not.toContain('var(--color-on-hero)');
    }
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
  it.each(['', '-dark'])('keeps green CTA text above AA contrast (%s)', (theme) => {
    const tokens = readFileSync('design-tokens/dist/tokens.css', 'utf8');
    const luminance = (name: string) => {
      const hex = tokens.match(new RegExp(`--palette-${name}${theme}: #([0-9A-F]{6});`))![1]!;
      const linear = [0, 2, 4].map((offset) => {
        const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
    };
    const foreground = luminance('bg');
    const background = luminance('green');
    const contrast =
      (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  });
});
