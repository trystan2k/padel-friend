import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The dashboard loading/error state cards are unreachable through black-box E2E (SSR resolves
// the route loaders before the first paint and the app performs no client-side route
// transitions), so their round-2 visual contract is pinned at the source level: these
// assertions fail if the state-card or metric styling drifts off the semantic design tokens.

const stylesSource = readFileSync(
  new URL('../src/features/player/player-ui.styles.ts', import.meta.url),
  'utf8'
);
const profileSource = readFileSync(
  new URL('../src/features/player/PlayerProfile.tsx', import.meta.url),
  'utf8'
);
const onboardingSource = readFileSync(
  new URL('../src/features/player/PlayerOnboarding.tsx', import.meta.url),
  'utf8'
);
const accountStylesSource = readFileSync(
  new URL('../src/features/auth/account-signup.styles.ts', import.meta.url),
  'utf8'
);
const semanticTokens: unknown = JSON.parse(
  readFileSync(new URL('../design-tokens/semantic.tokens.json', import.meta.url), 'utf8')
);
const primitiveTokens: unknown = JSON.parse(
  readFileSync(new URL('../design-tokens/primitives.tokens.json', import.meta.url), 'utf8')
);

function styleBlock(name: string): string {
  const block = stylesSource.match(new RegExp(`^\\s*${name}:\\s*\\{([^}]*)\\}`, 'm'));
  const captured = block?.[1];
  expect(captured, `stylex style '${name}' must stay declared in player-ui.styles.ts`).toBeTruthy();
  return captured!;
}

function contrastRatio(first: string, second: string): number {
  function luminance(hex: string): number {
    const channels = hex.match(/[\da-f]{2}/gi);
    if (!channels || channels.length < 3) throw new Error(`expected a six-digit hex color: ${hex}`);
    const [red = 0, green = 0, blue = 0] = channels.slice(0, 3).map((channel) => {
      const value = Number.parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return ((values[0] ?? 0) + 0.05) / ((values[1] ?? 0) + 0.05);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tokenValue(file: unknown, path: string[]): unknown {
  let node: unknown = file;
  for (const key of path) {
    if (!isRecord(node))
      throw new Error(`design token '${path.join('.')}' must resolve through the token sources`);
    node = node[key];
  }
  if (node === undefined) throw new Error(`design token '${path.join('.')}' must be defined`);
  return node;
}

describe('player dashboard state-card and metric styling contract', () => {
  it('keeps profile endpoint captions full-width while onboarding uses a local inset', () => {
    expect(styleBlock('scaleCaption')).toContain("width: '100%'");
    expect(styleBlock('onboardingScaleCaption')).toContain("width: 'calc(80% + var(--space-3))'");
    expect(profileSource).toContain('stylex.props(ui.progressTrack)');
    expect(profileSource).toContain('stylex.props(ui.scaleCaption)');
    expect(profileSource).toContain('formatDisplayLevel(MIN_LEVEL, i18n.language)');
    expect(profileSource).toContain('formatDisplayLevel(MAX_LEVEL, i18n.language)');
    expect(onboardingSource).toContain('ui.scaleCaption, ui.onboardingScaleCaption');
  });

  it('uses the shared name field and gives the level slider a 44px touch target', () => {
    expect(onboardingSource).toContain('<TextField');
    expect(onboardingSource).toContain('ref={nameRef}');
    expect(onboardingSource).toContain('type="range"');
    expect(styleBlock('sliderInput')).toContain("height: 'calc(var(--space-40) + var(--space-4))'");
  });

  it('maps fixed hero titles to a semantic token with light and dark contrast', () => {
    expect(styleBlock('heroTitle')).toContain("color: 'var(--color-on-hero)'");
    expect(accountStylesSource).toMatch(/heroTitle:\s*\{[^}]*color: 'var\(--color-on-hero\)'/);
    expect(tokenValue(semanticTokens, ['color', 'on-hero', '$value'])).toBe('{palette.surface}');
    const surface = String(tokenValue(primitiveTokens, ['palette', 'surface', '$value']));
    const hero = String(tokenValue(primitiveTokens, ['palette', 'green-deep', '$value']));
    expect(contrastRatio(surface, hero)).toBeGreaterThanOrEqual(4.5);
  });

  it('colors the error-state icon with the semantic red token and the loading icon with green', () => {
    expect(styleBlock('stateErrorIcon')).toContain("color: 'var(--color-red)'");
    expect(styleBlock('stateIcon')).toContain("color: 'var(--color-green)'");
    expect(tokenValue(semanticTokens, ['color', 'red', '$value'])).toBe('{palette.red}');
    expect(tokenValue(semanticTokens, ['color', 'green', '$value'])).toBe('{palette.green}');
  });

  it('sizes the level scale track with the 14px spacing token', () => {
    expect(styleBlock('progressTrack')).toContain("height: 'var(--space-14)'");
    expect(tokenValue(primitiveTokens, ['space', '14', '$value'])).toBe('14px');
  });

  it('keeps the profile header action at the 44px touch-target tokens', () => {
    const headerAction = styleBlock('headerAction');
    for (const property of ['width', 'height', 'minHeight'])
      expect(headerAction).toContain(`${property}: 'calc(var(--space-40) + var(--space-4))'`);
    expect(tokenValue(primitiveTokens, ['space', '40', '$value'])).toBe('40px');
    expect(tokenValue(primitiveTokens, ['space', '4', '$value'])).toBe('4px');
  });
});
