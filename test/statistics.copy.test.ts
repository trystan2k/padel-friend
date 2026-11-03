import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const dir = join(__dirname, '../src/features/statistics');
const components = readdirSync(dir).filter((file) => file.endsWith('.tsx'));
const locales = { en, 'pt-BR': ptBR, es };

function resolve(source: unknown, path: string): unknown {
  let node = source;
  for (const key of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = Reflect.get(node, key);
  }
  return node;
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/{{\s*(\w+)\s*}}/g)].map((match) => match[1] ?? '').sort();
}

describe('statistics copy', () => {
  it.each(components)('%s has no hardcoded user-facing text', (file) => {
    const source = readFileSync(join(dir, file), 'utf8');
    // Text between tags that is not an expression: >Some words<
    const jsxText = [...source.matchAll(/>\s*([^<>{}\n]*[A-Za-z]{2,}[^<>{}\n]*)\s*</g)]
      .map((match) => match[1]?.trim() ?? '')
      // Only prose-looking text counts: code fragments such as "items.length && (" are not copy.
      .filter((text) => /^[\p{L}\s.,:;!'’-]+$/u.test(text));
    const attributes = [
      ...source.matchAll(
        /\b(?:aria-label|aria-description|title|placeholder|alt|label|helper)="([^"]*[A-Za-z]{2,}[^"]*)"/g
      )
    ].map((match) => match[1] ?? '');
    expect({
      file,
      jsxText,
      attributes
    }).toEqual({
      file,
      jsxText: [],
      attributes: []
    });
  });

  const ids = new Set<string>();
  for (const file of components) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const match of source.matchAll(/\bid="([a-z]+\.[A-Za-z0-9.]+)"/g)) ids.add(match[1] ?? '');
  }
  for (const kind of ['pair', 'opponent']) ids.add('relationships.' + kind + '.played');

  it('finds the metric inventory', () => {
    expect(ids.size).toBeGreaterThanOrEqual(80);
  });

  it.each([...ids].sort())('metric %s has localized help in every locale', (id) => {
    const expected = placeholders(String(resolve(en.statistics.metrics, id + '.help')));
    for (const [locale, data] of Object.entries(locales)) {
      const help = resolve(data.statistics.metrics, id + '.help');
      const text = typeof help === 'string' ? help : '';
      expect({ locale, id, empty: text.trim() === '' }).toEqual({ locale, id, empty: false });
      expect(placeholders(text)).toEqual(expected);
    }
  });

  it('keeps the statistics navigation keys translated in every locale', () => {
    const keys = Object.keys(en.statistics.navigation).sort();
    expect(keys).toEqual(
      ['community', 'history', 'label', 'opponent', 'pair', 'player', 'records'].sort()
    );
    for (const data of Object.values(locales)) {
      expect(Object.keys(data.statistics.navigation).sort()).toEqual(keys);
      for (const value of Object.values(data.statistics.navigation)) {
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it('keeps interpolation placeholders identical across locales for states and charts', () => {
    for (const group of ['states', 'charts'] as const) {
      for (const [key, value] of Object.entries(en.statistics[group])) {
        for (const data of Object.values(locales)) {
          const translated: string = Reflect.get(data.statistics[group], key);
          expect(placeholders(translated)).toEqual(placeholders(value));
        }
      }
    }
  });
});
