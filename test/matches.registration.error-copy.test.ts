import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/config';
import {
  MATCH_REGISTRATION_ERROR_COPY,
  matchRegistrationErrorKey
} from '../src/features/matches/match-registration-error-copy';
import type { MatchRegistrationErrorCode } from '../src/features/matches/match-registration-model';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';

// Every code the registration server functions can surface to the UI. Mirrors
// `MatchRegistrationErrorCode`; the exhaustive map must cover each one.
const CODES: MatchRegistrationErrorCode[] = [
  'event_not_found',
  'invite_only',
  'closed',
  'started',
  'cancelled',
  'result_protected',
  'denied',
  'duplicate',
  'pending_duplicate',
  'full',
  'not_found',
  'already_resolved',
  'requester_ineligible',
  'forbidden',
  'invalid',
  'unauthenticated',
  'unavailable'
];

function readPath(resource: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, segment) =>
        typeof current === 'object' && current !== null ? Reflect.get(current, segment) : undefined,
      resource
    );
}

describe('match registration error copy', () => {
  it('maps every server error code to a translation key', () => {
    expect(Object.keys(MATCH_REGISTRATION_ERROR_COPY).sort()).toEqual([...CODES].sort());
    for (const code of CODES) {
      const key = matchRegistrationErrorKey(code);
      expect(/^(matchRegistration.feedback|matches.management.errors)\./.test(key)).toBe(true);
      expect(key).not.toBe(code);
    }
  });

  it.each([
    ['en', en, 'en'],
    ['pt-BR', pt, 'pt-BR'],
    ['es', es, 'es']
  ] as const)('renders real translated text for every code in %s', (_label, resource, locale) => {
    const i18n = createI18n(locale);
    for (const code of CODES) {
      const key = matchRegistrationErrorKey(code);
      const value = readPath(resource, key);
      if (typeof value !== 'string')
        throw new Error(`${locale} ${code} (${key}) is not a translated string`);
      expect(value.length, `${locale} ${code} (${key})`).toBeGreaterThan(0);
      // A missing key falls back to the key itself, which is the raw-key bug.
      expect(i18n.t(key), `${locale} ${code}`).toBe(value);
      expect(i18n.t(key), `${locale} ${code}`).not.toBe(key);
    }
  });
});
