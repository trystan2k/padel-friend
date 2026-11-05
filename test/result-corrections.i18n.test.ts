import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

function strings(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') return { [prefix]: value };
  if (!value || typeof value !== 'object') return {};
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, child]) =>
      strings(child, prefix ? `${prefix}.${key}` : key)
    )
  );
}
const placeholders = (value: string) =>
  [...value.matchAll(/{{([^{}]+)}}/g)].map((match) => match[1]!).sort((a, b) => a.localeCompare(b));

describe('correction translation contracts', () => {
  for (const [locale, catalog] of [
    ['en', en],
    ['pt-BR', pt],
    ['es', es]
  ] as const) {
    it(`${locale} contains every correction leaf with matching interpolation`, () => {
      const reference = strings(en.matches.corrections);
      const actual = strings(catalog.matches.corrections);
      expect(Object.keys(actual).sort((a, b) => a.localeCompare(b))).toEqual(
        Object.keys(reference).sort((a, b) => a.localeCompare(b))
      );
      for (const [key, value] of Object.entries(reference)) {
        expect(actual[key]?.trim()).toBeTruthy();
        expect(placeholders(actual[key]!)).toEqual(placeholders(value));
      }
    });
    it(`${locale} resolves correction notification kinds and independent SSR instances`, () => {
      const first = createI18n(locale);
      const second = createI18n(locale === 'en' ? 'es' : 'en');
      for (const kind of [
        'result_amendment_resolved',
        'result_repair_queued',
        'result_repair_applied'
      ]) {
        expect(first.exists(`notifications.kinds.${kind}`)).toBe(true);
      }
      expect(first.language).toBe(locale);
      expect(first).not.toBe(second);
      expect(first.t('matches.corrections.title')).toBe(catalog.matches.corrections.title);
    });
  }
});
