import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
import { MATCH_RESULT_ERROR_COPY } from '../src/features/matches/match-result-error-copy';
import { createI18n } from '../src/i18n/config';

function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (!value || typeof value !== 'object') throw new Error(`Invalid copy at ${prefix}`);
  return Object.entries(value).flatMap(([key, child]) =>
    leaves(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('result copy', () => {
  it.each([
    ['en', en],
    ['pt-BR', pt],
    ['es', es]
  ] as const)('resolves every nested state and error without fallback in %s', (locale, catalog) => {
    const expected = leaves(en.matches.results);
    const actual = leaves(catalog.matches.results);
    expect(actual.map(([key]) => key).sort()).toEqual(expected.map(([key]) => key).sort());
    const i18n = createI18n(locale);
    for (const [key, value] of actual) {
      expect(value.trim()).not.toBe('');
      const fullKey = `matches.results.${key}`;
      expect(i18n.exists(fullKey, { lng: locale, fallbackLng: false })).toBe(true);
      const variables = Object.fromEntries(
        [...value.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => [match[1], 'evidence'])
      );
      const translated = i18n.t(fullKey, { ...variables, lng: locale, fallbackLng: false });
      expect(translated).not.toBe(fullKey);
      expect(translated).not.toMatch(/\{\{|\}\}/);
      const source = expected.find(([path]) => path === key)![1];
      const placeholders = (text: string) =>
        [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1]!).sort();
      expect(placeholders(value)).toEqual(placeholders(source));
    }
    expect(
      Object.values(MATCH_RESULT_ERROR_COPY)
        .map((key) => key.split('.').at(-1)!)
        .sort()
    ).toEqual(Object.keys(catalog.matches.results.errors).sort());
  });
  it.each([en, pt, es])('includes every result state and mapped error', (catalog) => {
    for (const key of [
      'steps',
      'teams',
      'suggested',
      'changeTeams',
      'sets',
      'setState',
      'outcome',
      'outcomeHelper',
      'ratingEffect',
      'ratingEffectNone',
      'playedAt',
      'playedAtOffset',
      'courtLabel',
      'preview',
      'submit',
      'submitting',
      'pending',
      'pendingDescription',
      'autoConfirmIn',
      'reviewDeadline',
      'versionLabel'
    ]) {
      expect(catalog.matches.results).toHaveProperty(key);
    }
    for (const key of Object.values(MATCH_RESULT_ERROR_COPY)) {
      const name = key.split('.').at(-1)!;
      expect(catalog.matches.results.errors).toHaveProperty(name);
    }
  });
});
