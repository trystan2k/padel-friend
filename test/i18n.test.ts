import { describe, expect, it } from 'vitest';
import { createI18n, resolveLocale } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

function getTranslationKeyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') {
    return prefix ? [prefix] : [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    getTranslationKeyPaths(child, prefix ? `${prefix}.${key}` : key)
  );
}

function getKeyDiff(expected: unknown, actual: unknown) {
  const expectedKeys = getTranslationKeyPaths(expected).sort();
  const actualKeys = getTranslationKeyPaths(actual).sort();
  const expectedKeySet = new Set(expectedKeys);
  const actualKeySet = new Set(actualKeys);

  return {
    missing: expectedKeys.filter((key) => !actualKeySet.has(key)),
    extra: actualKeys.filter((key) => !expectedKeySet.has(key))
  };
}

describe('localized SSR resources', () => {
  it('maps supported language variants and falls back to English', () => {
    expect(resolveLocale('pt-PT')).toBe('pt-BR');
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale()).toBe('en');
  });

  it('keeps all locale translation keys in sync', () => {
    const locales = [
      { locale: 'pt-BR', translations: pt },
      { locale: 'es', translations: es }
    ];

    for (const { locale, translations } of locales) {
      const diff = getKeyDiff(en, translations);
      expect(
        diff,
        `${locale} locale key mismatch: missing [${diff.missing.join(', ')}], extra [${diff.extra.join(', ')}]`
      ).toEqual({ missing: [], extra: [] });
    }

    expect(createI18n('es').t('title')).toBe(es.title);
  });

  it('detects missing keys in nested namespaces', () => {
    const onboardingWithoutTitle = Object.fromEntries(
      Object.entries(en.onboarding).filter(([key]) => key !== 'title')
    );
    const incompleteLocale = { ...en, onboarding: onboardingWithoutTitle };

    expect(getKeyDiff(en, incompleteLocale)).toEqual({
      missing: ['onboarding.title'],
      extra: []
    });
  });
});
