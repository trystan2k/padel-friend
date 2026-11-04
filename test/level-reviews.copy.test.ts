import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LEVEL_REVIEW_STATUSES,
  type LevelReviewErrorCode
} from '../src/features/level-reviews/level-review-contracts';
import { levelReviewErrorKind } from '../src/features/level-reviews/level-review-form';
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
  en: leaves(en.levelReview, 'levelReview'),
  'pt-BR': leaves(pt.levelReview, 'levelReview'),
  es: leaves(es.levelReview, 'levelReview')
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.gen.ts')
        ? [join(dir, entry.name)]
        : []
  );
}
const source = sourceFiles('src')
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n');

// Values that are only an interpolation (for example an exact level) are identical everywhere.
const language = (text: string) =>
  text.replace(/\{\{[^}]*\}\}/g, '').replace(/[\s\p{P}\p{S}]/gu, '');

const ERROR_CODES: LevelReviewErrorCode[] = [
  'UNAUTHENTICATED',
  'PROVISIONAL_PLAYER_RESTRICTED',
  'LEVEL_REVIEW_NOT_FOUND',
  'LEVEL_REVIEW_INVALID_ARGUMENT',
  'LEVEL_REVIEW_DUPLICATE_ACTIVE',
  'LEVEL_REVIEW_RATE_LIMITED',
  'LEVEL_REVIEW_RATING_UNAVAILABLE',
  'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT',
  'LEVEL_REVIEW_INVALID_TRANSITION',
  'LEVEL_REVIEW_UNAVAILABLE',
  'INVALID_LEVEL_REVIEW_RESPONSE'
];

const DYNAMIC = [
  'levelReview.adminDecision.',
  'levelReview.status.detail.',
  'levelReview.status.',
  'levelReview.errors.',
  'levelReview.validation.'
];

describe('level review copy', () => {
  it('has the same keys and interpolation variables in en, pt-BR and es', () => {
    const keys = Object.keys(copy.en).sort();
    expect(keys.length).toBeGreaterThan(100);
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
        .filter(([key, value]) => value === copy.en[key] && language(value) !== '')
        .map(([key]) => key);
      expect(untranslated).toEqual([]);
    }
  });

  it('defines every level review key the code references', () => {
    const referenced = [...source.matchAll(/'(levelReview\.[A-Za-z_.]+)'/g)].map(
      (match) => match[1]!
    );
    expect(referenced.length).toBeGreaterThan(40);
    const undefinedKeys = referenced.filter(
      (key) => !(key in copy.en || `${key}_one` in copy.en || `${key}_other` in copy.en)
    );
    expect(undefinedKeys).toEqual([]);
  });

  it('keeps no unused level review copy', () => {
    const unused = Object.keys(copy.en).filter((key) => {
      const base = key.replace(/_(one|other)$/, '');
      return !(
        source.includes(`'${base}'`) ||
        DYNAMIC.some((prefix) => base.startsWith(prefix) && source.includes('`' + prefix + '${'))
      );
    });
    expect(unused).toEqual([]);
  });

  it('covers every dynamic status, status detail, error kind and validation message', () => {
    const errorKinds = new Set([
      ...ERROR_CODES.map((code) => levelReviewErrorKind(code)),
      'offline',
      'unconfirmed'
    ]);
    const expected = [
      ...LEVEL_REVIEW_STATUSES.flatMap((status) => [
        `levelReview.status.${status}`,
        `levelReview.status.detail.${status}`
      ]),
      ...[...errorKinds].map((kind) => `levelReview.errors.${kind}`),
      ...[
        'levelRequired',
        'levelFormat',
        'levelPrecision',
        'levelRange',
        'rangeOrder',
        'reasonRequired',
        'reasonTooLong',
        'evidenceTooLong'
      ].map((key) => `levelReview.validation.${key}`)
    ];
    for (const locale of ['en', 'pt-BR', 'es'] as const)
      expect(expected.filter((key) => !(key in copy[locale]))).toEqual([]);
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

  it('states the bounds the form enforces through interpolation, not literals', () => {
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      expect(variables(copy[locale]['levelReview.request.levelHelper']!)).toEqual([
        'example',
        'max',
        'min'
      ]);
      for (const key of ['reasonHelper', 'evidenceHelper'])
        expect(variables(copy[locale][`levelReview.request.${key}`]!)).toEqual(['count', 'max']);
      expect(copy[locale]['levelReview.validation.reasonTooLong']).not.toMatch(/\d{4}/);
      expect(copy[locale]['levelReview.validation.evidenceTooLong']).not.toMatch(/\d{4}/);
    }
  });

  it('has no hardcoded user-facing copy in the level review components', () => {
    const dir = 'src/features/level-reviews';
    const components = readdirSync(dir).filter((file) => file.endsWith('.tsx'));
    expect(components.length).toBeGreaterThanOrEqual(4);
    for (const file of components) {
      const text = readFileSync(join(dir, file), 'utf8');
      // JSX text nodes that contain letters must be expressions ({t(...)}), never literals.
      const literals = [...text.matchAll(/(?<!=)>\s*([A-Za-z][^<>{}\n]*[A-Za-z.])\s*</g)].map(
        (match) => match[1]!
      );
      expect({ file, literals }).toEqual({ file, literals: [] });
      expect({
        file,
        literalAttribute: /(?:aria-label|placeholder|title)="[A-Za-z]/.test(text)
      }).toEqual({
        file,
        literalAttribute: false
      });
      expect({ file, hardcodedColor: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(text) }).toEqual({
        file,
        hardcodedColor: false
      });
    }
  });
});
