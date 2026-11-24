import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

const locales = { en, es, 'pt-BR': ptBR } as const;
// Tokens that are legitimately upper-case in any locale (units, formats, codes).
const allowedAcronyms = /\b(UTC|EUR|JPEG|PNG|WebP|MiB)\b/g;

function flatten(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key)
  );
}

describe('community admin clubhouse copy', () => {
  for (const [locale, translation] of Object.entries(locales)) {
    const entries = flatten(translation.communityAdmin);

    it(`${locale}: copy is sentence case (no caps-authored strings)`, () => {
      const shouted = entries.filter(([, text]) =>
        /[A-ZÀ-ÝÑ]{3,}/.test(text.replace(allowedAcronyms, '').replace(/\{\{[^}]+\}\}/g, ''))
      );
      expect(shouted).toEqual([]);
    });
  }

  it('every locale defines the same communityAdmin keys', () => {
    const keys = (value: unknown) =>
      flatten(value)
        .map(([key]) => key)
        .sort();
    expect(keys(es.communityAdmin)).toEqual(keys(en.communityAdmin));
    expect(keys(ptBR.communityAdmin)).toEqual(keys(en.communityAdmin));
  });

  it('screen titles match the clubhouse frames', () => {
    expect(en.communityAdmin.title).toMatchObject({
      requests: 'Access requests',
      members: 'Members',
      settings: 'Settings',
      venues: 'Saved venues',
      audit: 'Audit log'
    });
  });
});
