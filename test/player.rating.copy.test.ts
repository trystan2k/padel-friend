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
      : /\.tsx?$/.test(entry.name) && !/diagnostics\.server\.ts$/.test(entry.name)
        ? [join(dir, entry.name)]
        : []
  );
}
// Diagnostic event/code unions (e.g. 'rating.failure') are log identifiers, not i18n keys.
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

  it('keeps plural forms paired and free of stray whitespace in every locale', () => {
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const keys = Object.keys(copy[locale]);
      for (const key of keys.filter((candidate) => candidate.endsWith('_one')))
        expect(keys, `${locale} ${key}`).toContain(key.replace(/_one$/, '_other'));
      for (const key of keys.filter((candidate) => candidate.endsWith('_other')))
        expect(keys, `${locale} ${key}`).toContain(key.replace(/_other$/, '_one'));
      const untidy = Object.entries(copy[locale])
        .filter(([, value]) => value !== value.trim() || /\s{2,}/.test(value))
        .map(([key]) => key);
      expect(untidy, `${locale} whitespace`).toEqual([]);
    }
  });

  it('formats levels, deltas and percentages with each locale decimal convention', () => {
    const level = (locale: string) =>
      new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(level('en').format(3.34)).toBe('3.34');
    expect(level('pt-BR').format(3.34)).toBe('3,34');
    expect(level('es').format(3.34)).toBe('3,34');
    const delta = (locale: string) =>
      new Intl.NumberFormat(locale, {
        signDisplay: 'exceptZero',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    expect(delta('en').format(0)).toBe('0.00');
    expect(delta('pt-BR').format(0.14)).toBe('+0,14');
    expect(delta('es').format(-0.22)).toMatch(/^[-−]0,22$/);
    const percent = (locale: string) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
    expect(percent('en').format(0.16)).toBe('16%');
    expect(percent('pt-BR').format(0.16)).toBe('16%');
    // Spanish separates the sign with a no-break space; the static copy uses the same convention.
    expect(percent('es').format(0.16)).toBe('16 %');
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
