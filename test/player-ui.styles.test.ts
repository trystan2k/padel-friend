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
