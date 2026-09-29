import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { playerInitials } from '../src/features/player/player-initials';

const INITIALS_SOURCE = readFileSync(
  new URL('../src/features/player/player-initials.ts', import.meta.url),
  'utf8'
);

describe('playerInitials', () => {
  it('uppercases deterministically: an `i` initial becomes the plain capital I, never the dotted İ', () => {
    // Locale-sensitive casing (tr) maps i → İ (U+0130), which would make SSR and a
    // Turkish-locale browser disagree on hydration. The output must be identical bytes.
    expect(playerInitials('igor silva')).toBe('IS');
    expect(playerInitials('igor silva')).not.toBe('İS');
    // Pin the exact code units: 0x49 (I) and 0x53 (S); U+0130 (İ) must be unreachable.
    expect(playerInitials('igor silva').charCodeAt(0)).toBe(0x49);
    expect(playerInitials('igor silva').charCodeAt(1)).toBe(0x53);
    expect(playerInitials('irene costa')).toBe('IC');
    expect(playerInitials('isabela ivanova')).toBe('II');
  });

  it('trims surrounding whitespace before extracting initials', () => {
    expect(playerInitials('  igor silva  ')).toBe('IS');
    expect(playerInitials('\tana costa\n')).toBe('AC');
  });

  it('returns a single letter for a single-name input', () => {
    expect(playerInitials('ana')).toBe('A');
    expect(playerInitials('  bruno ')).toBe('B');
  });

  it('uses only the first two parts for names of three or more parts', () => {
    expect(playerInitials('ana maria de souza')).toBe('AM');
    expect(playerInitials('maria elena silva pereira')).toBe('ME');
  });

  it('returns an empty string for empty or whitespace-only input', () => {
    expect(playerInitials('')).toBe('');
    expect(playerInitials('   ')).toBe('');
    expect(playerInitials('\t \n')).toBe('');
  });

  it('handles multi-space and tab separators between parts', () => {
    expect(playerInitials('ana\tmaria')).toBe('AM');
    expect(playerInitials('ana   maria')).toBe('AM');
    expect(playerInitials('ana \t maria')).toBe('AM');
  });

  it('uppercases accented Unicode initials deterministically (no locale-dependent mappings)', () => {
    // Plain toUpperCase has no special-cased mappings for these letters in any locale,
    // so SSR and every browser locale must agree on the same output.
    expect(playerInitials('émile dubois')).toBe('ÉD');
    expect(playerInitials('ñoño garcía')).toBe('ÑG');
  });
});

describe('player-initials casing contract', () => {
  it('never uses locale-sensitive casing — the hydration-determinism fix cannot be silently reverted', () => {
    // toLocaleUpperCase/toLocaleLowerCase are runtime-locale dependent: the server Worker
    // defaults to en while a browser on a Turkish OS locale maps i → İ, breaking hydration.
    expect(INITIALS_SOURCE).not.toContain('toLocaleUpperCase');
    expect(INITIALS_SOURCE).not.toContain('toLocaleLowerCase');
    expect(INITIALS_SOURCE).not.toMatch(/toLocale(?:Upper|Lower)Case/);
    // The module must keep using the locale-insensitive uppercase.
    expect(INITIALS_SOURCE).toContain('toUpperCase');
  });
});
