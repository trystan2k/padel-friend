import { describe, expect, it } from 'vitest';
import en from '../src/locales/en/translation.json';
import pt from '../src/locales/pt-BR/translation.json';
import es from '../src/locales/es/translation.json';
import { MATCH_RESULT_ERROR_COPY } from '../src/features/matches/match-result-error-copy';

describe('result copy', () => {
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
