import { describe, expect, it } from 'vitest';
import { createI18n, resolveLocale } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import pt from '../src/locales/pt-BR/translation.json';

describe('localized SSR resources', () => {
  it('maps supported language variants and falls back to English', () => {
    expect(resolveLocale('pt-PT')).toBe('pt-BR');
    expect(resolveLocale('es-MX')).toBe('es');
    expect(resolveLocale('fr')).toBe('en');
    expect(resolveLocale()).toBe('en');
  });

  it('keeps all locales in sync', () => {
    expect(Object.keys(es).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(pt).sort()).toEqual(Object.keys(en).sort());
    expect(createI18n('es').t('title')).toBe(es.title);
  });
});
