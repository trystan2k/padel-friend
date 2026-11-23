import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { MANAGEMENT_COMPONENTS } from './helpers/match-management-contract';

describe('match styles', () => {
  it('keeps detail photos fixed-height, roster rows compact, and cancelled badges inline', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toMatch(
      /image: \{[^}]*height: 'calc\(var\(--space-40\) \* 3 \+ var\(--space-12\)\)'/
    );
    expect(shell).toMatch(
      /cancelledBadge: \{\s*display: 'flex',\s*justifyContent: 'flex-start',\s*minHeight: 'calc\(var\(--space-20\) \+ var\(--space-4\)\)'/
    );
    const registration = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(registration).toMatch(/playerRow: \{[^}]*minHeight: control/);
    expect(registration).toMatch(
      /passivePlayerRow: \{ minHeight: 'calc\(var\(--space-40\) \+ var\(--space-8\)\)' \}/
    );
    expect(readFileSync('src/features/matches/MatchRosterCard.tsx', 'utf8')).toContain(
      '!participants && s.passivePlayerRow'
    );
    expect(registration).toMatch(/playerRow: \{[^}]*paddingBlock: 0/);
    expect(registration).toMatch(/rosterSection: \{[^}]*gap: 'var\(--space-8\)'/);
    expect(registration).toMatch(/roster: \{[^}]*gap: 'var\(--space-4\)'/);
    expect(registration).toMatch(
      /initials: \{[^}]*width: 'calc\(var\(--space-20\) \+ var\(--space-16\)\)'/
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
    const management = readFileSync('src/features/matches/match-management.styles.ts', 'utf8');
    expect(management).toMatch(/popup: \{[^}]*overscrollBehavior: 'contain'/);
  });
  it('uses body-family card content and bold card headings, retaining the heading-family venue heading', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toMatch(/page: \{[^}]*fontFamily: 'var\(--font-family-body\)'/);
    expect(shell).toMatch(/title: \{[^}]*fontWeight: 'var\(--font-weight-bold\)'/);
    expect(shell).toMatch(/venue: \{[^}]*fontFamily: 'var\(--font-family-heading\)'/);
    for (const name of [
      'match-edit',
      'match-registration',
      'match-management',
      'match-invitation'
    ]) {
      const source = readFileSync(`src/features/matches/${name}.styles.ts`, 'utf8');
      expect(source).toContain('var(--font-family-body)');
    }
    const management = readFileSync('src/features/matches/match-management.styles.ts', 'utf8');
    expect(management).toMatch(/dialogTitle: \{[^}]*fontFamily: 'var\(--font-family-heading\)'/);
    expect(management).not.toMatch(/cardTitle: \{[^}]*fontFamily: 'var\(--font-family-heading\)'/);
  });
  it('reserves global chip width on non-detail headers without changing detail composition', () => {
    const root = readFileSync('src/root.styles.ts', 'utf8');
    expect(root).toMatch(
      /pageHeader: \{[^}]*paddingInlineEnd: 'calc\(var\(--space-40\) \* 2 \+ var\(--space-8\) \* 3\)'/
    );
    expect(root).toMatch(/pageHeader: \{[^}]*overflowWrap: 'anywhere'/);
    // The global language/theme chips still float top-right, so the Clubhouse header reserves them.
    expect(readFileSync('src/features/matches/MatchesPage.tsx', 'utf8')).toContain(
      's.header, rootStyles.pageHeader'
    );
    expect(readFileSync('src/features/matches/MatchDetailPage.tsx', 'utf8')).not.toContain(
      'rootStyles.pageHeader'
    );
  });
  it('gives detail map actions the existing tokenized touch-target link style', () => {
    const source = readFileSync('src/features/matches/MatchDetailPage.tsx', 'utf8');
    expect(source).toMatch(/href=\{event\.maps_url\}[\s\S]*?stylex\.props\(shell\.maps\)/);
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
    'match-result',
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
      /menuItem: \{[^}]*minHeight: 'calc\(var\(--space-40\) \+ var\(--space-12\)\)'/
    );
    const registration = readFileSync('src/features/matches/match-registration.styles.ts', 'utf8');
    expect(registration).toContain("const target = 'calc(var(--space-40) + var(--space-4))'");
    expect(registration).toContain("const control = 'calc(var(--space-40) + var(--space-12))'");
    expect(registration.match(/minHeight: (?:target|control)/g)?.length).toBeGreaterThanOrEqual(2);
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
          /stylex\.props\((?:s\.(?:button|input|menuItem)|page\.back|(?:buttons|card)\.(?:primaryButton|secondaryButton))|render=\{<Button/
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
    expect(createStyles).toContain(touchMinimum); // checkbox label and chip targets
    expect(createStyles).toContain('touchLabel');
    expect(createStyles).toContain('minInlineSize: target');
    expect(createStyles).toContain('minBlockSize: control');
    expect(createStyles).toContain('fileInput');
    expect(createStyles).toContain('minInlineSize: 0');
    expect(createStyles).toContain("maxInlineSize: '100%'");
    expect(createStyles).toContain("inlineSize: '100%'");
    // Remove chips and result rows are the invitee picker's controls (rows 56, chips 44 minimum).
    expect(readFileSync('src/features/matches/MatchInviteePicker.tsx', 'utf8')).toContain(
      'stylex.props(s.chip)'
    );
  });
  it('matches the measured match surfaces, rhythm, tab treatment, and card radius', () => {
    const list = readFileSync('src/features/matches/match-list.styles.ts', 'utf8');
    const createStyles = readFileSync('src/features/matches/create-match.styles.ts', 'utf8');
    // Clubhouse lists (ENn8Q/uePpj/w25dY): 20px safe-area gutter, 12px rhythm, 56px segment track
    // on surface-2 holding surface pills, 18px cards.
    expect(list).toContain("paddingInlineStart: 'max(var(--space-20), env(safe-area-inset-left))'");
    expect(list).toContain("gap: 'var(--space-12)',\n    width: '100%'");
    expect(list).toMatch(/segments: \{[^}]*backgroundColor: 'var\(--color-surface-2\)'/);
    expect(list).toMatch(/segmentActive: \{ backgroundColor: 'var\(--color-surface\)'/);
    expect(list).toMatch(/card: \{[^}]*borderRadius: 'var\(--radius-18\)'/);
    expect(list).toMatch(
      /segment: \{[^}]*minHeight: 'calc\(var\(--space-40\) \+ var\(--space-8\)\)'/
    );
    // Create wizard (wHaAb/vAxZh/b5RR4/RDV2r): 20-unit safe-area gutter, 14-unit content rhythm, 52-unit
    // controls, surface-2 segmented tracks, 18-unit list cards and a sticky surface action bar.
    expect(createStyles).toContain(
      "const gutterStart = 'max(var(--space-20), env(safe-area-inset-left))'"
    );
    expect(createStyles).toMatch(/content: \{[^}]*gap: 'var\(--space-14\)'/);
    expect(createStyles).toMatch(/segmented: \{[^}]*backgroundColor: 'var\(--color-surface-2\)'/);
    expect(createStyles).toMatch(/list: \{[^}]*borderRadius: 'var\(--radius-18\)'/);
    expect(createStyles).toMatch(/actions: \{[^}]*position: 'sticky'/);
    const page = readFileSync('src/features/matches/CreateMatchPage.tsx', 'utf8');
    expect(page).toContain('xstyle={s.primaryAction}');
    expect(page).toContain('xstyle={s.secondaryAction}');
  });
  it('matches rebuilt detail shell card rhythm and compact native global controls', () => {
    const shell = readFileSync('src/features/matches/match-detail-shell.styles.ts', 'utf8');
    expect(shell).toContain("gap: 'var(--space-12)'");
    expect(shell).toContain("padding: 'var(--space-16)'");
    expect(shell).toContain("borderRadius: 'var(--radius-18)'");
    expect(shell).toContain("borderRadius: 'var(--radius-14)'");
    expect(shell).not.toContain('textTransform');
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
        /backgroundColor: 'var\(--color-green\)',\s*color: 'var\(--color-on-green\)'/
      );
      expect(styles).not.toContain('var(--color-on-hero)');
    }
    const styles = readFileSync('src/features/matches/matches.styles.ts', 'utf8');
    const createStyles = readFileSync('src/features/matches/create-match.styles.ts', 'utf8');
    expect(
      styles.match(/backgroundColor: 'var\(--color-green\)',\s*color: 'var\(--color-bg\)'/g)
    ).toHaveLength(2);
    // The wizard's primary action is the shared Button primitive (green fill, on-green label); the
    // background foreground is only used for the inverted selected chip (text fill), never on green.
    expect(createStyles).not.toMatch(/color-green\)',\s*color: 'var\(--color-bg\)'/);
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
