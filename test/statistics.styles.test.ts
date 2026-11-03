import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const dir = fileURLToPath(new URL('../src/features/statistics', import.meta.url));
const styleFiles = readdirSync(dir).filter((file) => /\.styles\.ts$/.test(file));

// Documented geometry that has no token: fluid grid minimum column width and the chart height cap.
const GEOMETRY = [/minmax\(min\(100%, \d+px\), 1fr\)/g, /maxHeight: '160px'/];

describe('statistics styles', () => {
  it('finds the statistics style modules', () => {
    expect(styleFiles).toEqual(
      expect.arrayContaining(['statistics.styles.ts', 'statistics-player.styles.ts'])
    );
  });

  it.each(styleFiles)('%s uses design tokens instead of raw theme values', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    const stripped = GEOMETRY.reduce((text, allowed) => text.replace(allowed, ''), source)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    expect(stripped).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(stripped).not.toMatch(/\brgba?\(/);
    expect(stripped).not.toMatch(/\b\d+(\.\d+)?(px|rem|em)\b/);
  });

  it('keeps interactive statistics controls at the 44px floor', () => {
    const source = readFileSync(join(dir, 'statistics.styles.ts'), 'utf8');
    expect(source).toContain('calc(var(--space-40) + var(--space-4))');
    expect(source.match(/minHeight: TOUCH/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
