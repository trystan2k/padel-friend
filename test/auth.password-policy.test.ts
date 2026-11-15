import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MIN_LENGTH,
  getPasswordIssues,
  isPasswordValid
} from '../src/features/auth/password-policy';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';
import { readFileSync } from 'node:fs';

describe('password policy', () => {
  it('requires at least 10 characters at the 9/10 boundary', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(getPasswordIssues('Abcdef1!x')).toEqual(['tooShort']);
    expect(getPasswordIssues('Abcdef1!xy')).toEqual([]);
  });

  it.each([
    ['123456', ['tooShort', 'missingLowercase', 'missingUppercase', 'missingSymbol']],
    ['abcdefghij1!', ['missingUppercase']],
    ['ABCDEFGHIJ1!', ['missingLowercase']],
    ['Abcdefghijk!', ['missingDigit']],
    ['Abcdefghijk1', ['missingSymbol']]
  ])('reports the failed rules for %s', (password, issues) => {
    expect(getPasswordIssues(password)).toEqual(issues);
  });

  it('never trims: whitespace is neither stripped nor a symbol', () => {
    expect(isPasswordValid('Abcdefgh1 ')).toBe(false);
    expect(isPasswordValid(' Abcdefg1!')).toBe(true);
  });

  it('counts code points and treats non-ASCII letters as no ASCII case class', () => {
    expect(getPasswordIssues('Ab1!éééééé')).toEqual([]);
    expect(getPasswordIssues('ÁÉÍÓÚ1234!')).toContain('missingLowercase');
  });

  it.each(['Password123!', 'Squatter123!', 'Claim-pass-9!', 'Recovered123!'])(
    'accepts the shared test credential %s',
    (password) => {
      expect(isPasswordValid(password)).toBe(true);
    }
  );

  it('matches the Supabase Auth settings in both configs', () => {
    for (const path of ['../supabase/config.toml', '../test/stack/supabase/config.toml']) {
      const toml = readFileSync(new URL(path, import.meta.url), 'utf8');
      expect(toml).toContain(`minimum_password_length = ${PASSWORD_MIN_LENGTH}`);
      expect(toml).toContain('password_requirements = "lower_upper_letters_digits_symbols"');
      expect(toml).toContain('enable_anonymous_sign_ins = false');
      expect(toml).toMatch(/\[auth\.captcha\][^[]*enabled = false/);
    }
  });

  it('has the policy and captcha strings in every locale', () => {
    for (const locale of [en, es, ptBR]) {
      for (const key of [
        'passwordRequirements',
        'passwordInvalid',
        'passwordLegacyHint',
        'resetRequirements',
        'captchaRequired',
        'captchaError'
      ] as const) {
        expect(locale.auth[key]).toBeTruthy();
      }
    }
  });
});
