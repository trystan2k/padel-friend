import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('uses the existing border-width token for the account-switch warning', () => {
  const styles = readFileSync('src/features/auth/reset-password.styles.ts', 'utf8');
  expect(styles).toContain("border: 'var(--border-width-sm) solid var(--color-muted)'");
  const tokens = JSON.parse(readFileSync('design-tokens/primitives.tokens.json', 'utf8'));
  expect(tokens['border-width'].sm).toBeDefined();
});
