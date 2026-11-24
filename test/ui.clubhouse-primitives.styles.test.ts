import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Structural probes for the shared primitives against the Clubhouse frames: Button B3Uqv, text
// input Ilxwe, text link QFH5u, card RMese. Style source is read as text, so the contract is the
// token usage rather than a rendered pixel value.
const read = (name: string) => readFileSync(`src/components/ui/${name}`, 'utf8');
const control = read('control.styles.ts');
const button = read('button.styles.ts');
const field = read('text-field.styles.ts');
const link = read('text-link.styles.ts');
const card = read('surface-card.styles.ts');
const badge = read('status-badge.styles.ts');
const step = read('step-badge.styles.ts');

const CONSUMES_CONTROL = ['Button.tsx', 'TextField.tsx', 'TextLink.tsx'];
const stylesFor = [
  'button.styles.ts',
  'text-field.styles.ts',
  'text-link.styles.ts',
  'status-badge.styles.ts',
  'step-badge.styles.ts',
  'surface-card.styles.ts',
  'roster-row.styles.ts',
  'or-divider.styles.ts',
  'account-prompt.styles.ts',
  'control.styles.ts'
];

describe('control sizing and focus', () => {
  it('sets the 52px control minimum from tokens', () => {
    expect(control).toContain("minHeight: 'calc(var(--space-40) + var(--space-12))'");
  });

  it('uses the unified focus tokens and no hand-rolled green outline', () => {
    expect(control).toContain("outline: 'var(--focus-width) solid var(--color-focus)'");
    expect(control).toContain("outlineOffset: 'var(--focus-offset)'");
    for (const file of [button, field, link]) {
      expect(file).not.toContain('focus-visible');
      expect(file).not.toMatch(/outline(Offset)?:/);
    }
  });

  it.each(CONSUMES_CONTROL)('%s composes the shared focus ring', (name) => {
    expect(read(name)).toContain('controlStyles.focusRing');
  });

  it('keeps links at the 44px touch-target floor', () => {
    expect(link).toContain("minHeight: 'calc(var(--space-40) + var(--space-4))'");
  });
});

describe('typography', () => {
  it('uses 15px labels and links, 16px button labels and input values', () => {
    expect(field).toMatch(/label: \{[^}]*font-size-15/s);
    expect(link).toContain("fontSize: 'var(--font-size-15)'");
    expect(button).toContain("fontSize: 'var(--font-size-16)'");
    expect(field).toMatch(/control: \{[^}]*font-size-16/s);
  });

  it('renders chips at 13px with no CSS casing transform or tracking', () => {
    expect(badge).toContain("fontSize: 'var(--font-size-13)'");
    expect(step).toContain("fontSize: 'var(--font-size-13)'");
    for (const name of stylesFor) {
      expect(read(name)).not.toMatch(/textTransform|letter-spacing/);
    }
  });
});

describe('semantic colour', () => {
  it('puts primary button text on the on-green token', () => {
    expect(button).toContain("color: 'var(--color-on-green)'");
    expect(button).not.toContain("color: 'var(--color-bg)'");
  });

  it('uses green-ink on soft-green chips', () => {
    expect(badge).toContain("color: 'var(--color-green-ink)'");
    expect(step).toContain("color: 'var(--color-green-ink)'");
  });

  it('never places the theme text token on lime', () => {
    for (const name of stylesFor) {
      expect(read(name)).not.toContain('--color-lime');
    }
  });

  it('keeps legacy hero tokens only in the hero card until page units migrate them', () => {
    expect(card).toContain('--color-green-deep');
    for (const name of stylesFor.filter((n) => n !== 'surface-card.styles.ts')) {
      expect(read(name)).not.toMatch(/--color-(green-deep|on-hero|hero-)/);
    }
  });

  it('draws the card with the hairline border and 20px radius', () => {
    expect(card).toContain("borderColor: 'var(--color-hairline)'");
    expect(card).toContain("borderRadius: 'var(--radius-20)'");
  });
});

describe('invalid and destructive states', () => {
  it('flags invalid fields with the red token', () => {
    expect(field).toContain('[aria-invalid="true"]');
    expect(field).toContain("borderColor: 'var(--color-red)'");
  });

  it('outlines the destructive button in red', () => {
    expect(button).toMatch(/destructive: \{[^}]*--color-red/s);
  });
});
