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
  it('contains the complete match UI key contract in every locale', () => {
    const required = [
      'matches.title',
      'matches.subtitle',
      'matches.navigationLabel',
      'matches.create',
      'matches.back',
      'matches.loading',
      'matches.error',
      'matches.retry',
      'matches.unavailable',
      'matches.offline',
      'matches.stale',
      'matches.loadMore',
      'matches.tabs.available',
      'matches.tabs.my',
      'matches.tabs.past',
      'matches.empty.available',
      'matches.empty.my',
      'matches.empty.past',
      'matches.type.competitive',
      'matches.type.friendly',
      'matches.visibility.community_open',
      'matches.visibility.invite_only',
      'matches.teamMode.PREDEFINED_TEAMS',
      'matches.teamMode.POST_MATCH_TEAMS',
      'matches.badges.playing',
      'matches.badges.reserve',
      'matches.badges.invited',
      'matches.badges.resultActionRequired',
      'matches.counts.playing_one',
      'matches.counts.playing_other',
      'matches.counts.reserve_one',
      'matches.counts.reserve_other',
      'matches.counts.groups_one',
      'matches.counts.groups_other',
      'matches.counts.moreNeeded_one',
      'matches.counts.moreNeeded_other',
      'matches.card.creator',
      'matches.card.approximateLevel',
      'matches.card.levelRange',
      'matches.card.noLevelRestriction',
      'matches.card.maximum',
      'matches.card.notes',
      'matches.card.pricePerPlayer',
      'matches.card.openMaps',
      'matches.card.photoAlt',
      'matches.detail.title',
      'matches.detail.participants',
      'matches.detail.accepted',
      'matches.detail.creatorAccepted',
      'matches.detail.timezone',
      'matches.detail.registrationClosed',
      'matches.detail.guestApprovalRequired',
      'matches.detail.outOfRangeApprovalRequired',
      'matches.detail.invitationInfo',
      'matches.detail.pastScheduled',
      'matches.detail.outcomeUnavailable',
      'matches.detail.share',
      'matches.detail.shareUnavailable',
      'matches.detail.copyLink',
      'matches.detail.copied',
      'matches.detail.copyFailed',
      'matches.detail.shareUrl'
    ];
    for (const locale of [en, pt, es]) {
      const paths = new Set(getTranslationKeyPaths(locale));
      expect(required.filter((key) => !paths.has(key))).toEqual([]);
    }
  });
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
