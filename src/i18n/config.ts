import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en/translation.json';
import es from '../locales/es/translation.json';
import ptBR from '../locales/pt-BR/translation.json';

export const supportedLocales = ['en', 'pt-BR', 'es'] as const;
export type Locale = (typeof supportedLocales)[number];

export function resolveLocale(value?: string | null): Locale {
  if (value === 'pt' || value?.toLowerCase().startsWith('pt-')) return 'pt-BR';
  if (value === 'es' || value?.toLowerCase().startsWith('es-')) return 'es';
  return 'en';
}

export function createI18n(locale: Locale) {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: 'en',
    resources: {
      en: { translation: en },
      es: { translation: es },
      'pt-BR': { translation: ptBR }
    },
    interpolation: { escapeValue: false },
    initAsync: false
  });
  return instance;
}
