import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

function leaves(tree: object, prefix: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = `${prefix}.${key}`;
    if (typeof value === 'string') result[path] = value;
    else if (typeof value === 'object' && value !== null)
      Object.assign(result, leaves(value, path));
  }
  return result;
}

const variables = (text: string) =>
  [...text.matchAll(/\{\{\s*([^{}\s]+)\s*\}\}/g)].map((match) => match[1]!).sort();

const copy = {
  en: leaves(en.rating, 'rating'),
  'pt-BR': leaves(pt.rating, 'rating'),
  es: leaves(es.rating, 'rating')
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );
}
const source = sourceFiles('src')
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

describe('rating copy', () => {
  it('has the same keys and interpolation variables in en, pt-BR and es', () => {
    const keys = Object.keys(copy.en).sort();
    expect(keys.length).toBeGreaterThan(60);
    for (const locale of ['pt-BR', 'es'] as const) {
      expect(Object.keys(copy[locale]).sort()).toEqual(keys);
      const mismatched = keys.filter(
        (key) => variables(copy[locale][key]!).join() !== variables(copy.en[key]!).join()
      );
      expect(mismatched).toEqual([]);
    }
  });

  it('translates every string: no pt-BR or es value falls back to the English text', () => {
    for (const locale of ['pt-BR', 'es'] as const) {
      const untranslated = Object.entries(copy[locale])
        .filter(([key, value]) => value === copy.en[key])
        .map(([key]) => key);
      expect(untranslated).toEqual([]);
    }
  });

  it('defines every rating key the code references', () => {
    const referenced = [...source.matchAll(/'(rating\.[A-Za-z_.]+)'/g)].map((match) => match[1]!);
    expect(referenced.length).toBeGreaterThan(30);
    const undefinedKeys = referenced.filter(
      (key) => !(key in copy.en || `${key}_one` in copy.en || `${key}_other` in copy.en)
    );
    expect(undefinedKeys).toEqual([]);
  });

  it('keeps no unused rating copy', () => {
    const dynamic = ['rating.errors.', 'rating.explanation.note.', 'rating.outcome.'];
    const unused = Object.keys(copy.en).filter((key) => {
      const base = key.replace(/_(one|other)$/, '');
      return !(
        source.includes(`'${base}'`) ||
        dynamic.some((prefix) => base.startsWith(prefix) && source.includes(`\`${prefix}\${`))
      );
    });
    expect(unused).toEqual([]);
  });

  it('covers every dynamic error code, explanation note and outcome', () => {
    const expected = [
      ...['unauthenticated', 'forbidden', 'stale_revision', 'invalid_request', 'unavailable'].map(
        (code) => `rating.errors.${code}`
      ),
      ...[
        'gain',
        'loss',
        'zero_rounded',
        'draw_equal',
        'boundary',
        'clamped_gain',
        'clamped_loss'
      ].map((note) => `rating.explanation.note.${note}`),
      ...['win', 'draw', 'loss'].map((outcome) => `rating.outcome.${outcome}`)
    ];
    expect(expected.filter((key) => !(key in copy.en))).toEqual([]);
  });
});
