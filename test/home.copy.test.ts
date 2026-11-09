import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

const byText = (a: string, b: string) => a.localeCompare(b);

function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key)
  );
}
const placeholders = (text: string) =>
  [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1] ?? '').sort(byText);

describe('home copy', () => {
  const english = new Map(leaves(en.home));

  it.each([
    ['pt-BR', pt],
    ['es', es]
  ])('%s has the same keys and placeholders as English', (_locale, resource) => {
    const other = new Map(leaves(resource.home));
    expect([...other.keys()].sort(byText)).toEqual([...english.keys()].sort(byText));
    const mismatched = [...english].filter(
      ([key, text]) =>
        placeholders(other.get(key) ?? '').join() !== placeholders(text).join() ||
        !other.get(key)?.trim()
    );
    expect(mismatched.map(([key]) => key)).toEqual([]);
  });

  it('declares one and other forms for every counted message', () => {
    const families = new Map<string, string[]>();
    for (const key of english.keys()) {
      const match = /^(.*)_(one|other)$/.exec(key);
      if (match)
        families.set(match[1] ?? '', [...(families.get(match[1] ?? '') ?? []), match[2] ?? '']);
    }
    expect(families.size).toBeGreaterThan(0);
    const incomplete = [...families].filter(
      ([, forms]) => forms.sort(byText).join() !== 'one,other'
    );
    expect(incomplete).toEqual([]);
  });

  it('reuses the shared navigation copy instead of duplicating it', () => {
    expect(Object.keys(en.matches.results.nav)).toEqual(
      expect.arrayContaining(['home', 'matches', 'community', 'ranking', 'profile'])
    );
  });
});
