import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const locales = { en, es, 'pt-BR': ptBR } as const;

// Clubhouse frames are sentence case; the CSS uppercase transform is gone, so copy must be authored
// that way in every locale (frames wzWLt, EGb2g, ieoni, FZlHy, ZthyR).
const sentenceCaseKeys = [
  'loginBrand',
  'welcomeTitle',
  'forgotLink',
  'forgotSubmit',
  'backToSignIn',
  'resetSubmit',
  'loginSubmit',
  'signupSubmit',
  'signupLink',
  'signupSignIn',
  'accountStep',
  'or',
  'back',
  'accountBarTitle',
  'forgotBarTitle',
  'resetBarTitle'
] as const;
const removedKeys = [
  'inboxNoticeTitle',
  'resetDescription',
  'resetRequirements',
  'accountIntro',
  'accountDescription'
] as const;

describe('auth copy for the Clubhouse frames', () => {
  it.each(Object.entries(locales))('%s authors auth copy in sentence case', (_name, locale) => {
    for (const key of sentenceCaseKeys) {
      const value = locale.auth[key];
      expect([key, value === value.toUpperCase()]).toEqual([key, false]);
    }
    expect(locale.signInWithGoogle).not.toBe(locale.signInWithGoogle.toUpperCase());
  });

  it.each(Object.entries(locales))(
    '%s drops the copy the frames no longer render',
    (_name, locale) => {
      for (const key of removedKeys) expect(locale.auth).not.toHaveProperty(key);
    }
  );

  it('keeps the same auth keys in every locale', () => {
    const keys = (locale: typeof en) => Object.keys(locale.auth).sort();
    expect(keys(es)).toEqual(keys(en));
    expect(keys(ptBR)).toEqual(keys(en));
  });
});
