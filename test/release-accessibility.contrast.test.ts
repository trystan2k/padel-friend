import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Read generated tokens, not a duplicate palette. Token/state changes invalidate this proof.
const css = readFileSync(new URL('../design-tokens/dist/tokens.css', import.meta.url), 'utf8');
const declarations = (block: string) =>
  Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()])
  );
const light = declarations(css.split('[data-theme="dark"]')[0]!);
const dark = { ...light, ...declarations(css.split('[data-theme="dark"]')[1]!) };

function luminance(value: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function contrast(tokens: Record<string, string>, foreground: string, background: string) {
  const resolve = (name: string): string => {
    const value = tokens[`--${name}`];
    if (!value) throw new Error(`Unknown token ${name}`);
    const variable = /^var\(--([\w-]+)\)$/.exec(value);
    if (variable) return resolve(variable[1]!);
    if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Unsupported colour ${value}`);
    return value;
  };
  const values = [luminance(resolve(foreground)), luminance(resolve(background))].sort(
    (a, b) => a - b
  );
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}

describe.each([
  ['light', light],
  ['dark', dark]
] as const)('%s actual token contrast', (_theme, tokens) => {
  for (const background of ['color-bg', 'color-surface', 'color-surface-2', 'color-green-soft']) {
    it.each(['color-text', 'color-muted', 'color-green', 'color-red', 'color-amber'])(
      `%s on ${background} normal text ≥4.5:1`,
      (foreground) => {
        expect(contrast(tokens, foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    );
    it(`focus ring and control boundary on ${background} ≥3:1`, () => {
      expect(contrast(tokens, 'color-green', background)).toBeGreaterThanOrEqual(3);
      expect(contrast(tokens, 'color-line', background)).toBeGreaterThanOrEqual(3);
    });
  }
  it.each(['color-bg', 'color-surface'])('primary action %s on green ≥4.5:1', (foreground) => {
    expect(contrast(tokens, foreground, 'color-green')).toBeGreaterThanOrEqual(4.5);
  });
  it.each(['color-on-hero', 'color-hero-copy', 'color-hero-muted', 'color-hero-label'])(
    'hero %s ≥4.5:1',
    (foreground) => {
      expect(contrast(tokens, foreground, 'color-green-deep')).toBeGreaterThanOrEqual(4.5);
    }
  );
  it('reject action and chart trend retain text/UI contrast', () => {
    expect(contrast(tokens, 'color-bg', 'color-red')).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens, 'color-green', 'color-surface')).toBeGreaterThanOrEqual(3);
  });
});
