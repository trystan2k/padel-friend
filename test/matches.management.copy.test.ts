import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createI18n } from '../src/i18n/config';
import { MANAGEMENT_ERROR_COPY } from '../src/features/matches/match-management-error-copy';
import { MATCH_INVITATION_ERROR_COPY } from '../src/features/matches/match-invitation-model';
import {
  MANAGEMENT_COMPONENTS,
  MANAGEMENT_NOTIFICATION_COPY
} from './helpers/match-management-contract';

function hardcodedCopy(source: string) {
  source = source.slice(Math.max(0, source.indexOf('  return (')));
  const violations: string[] = [];
  for (const match of source.matchAll(
    /\b(?:aria-label|aria-description|title|placeholder|alt|label|description)=["']([^"']+)["']/g
  ))
    violations.push(match[1]!);
  for (const match of source.matchAll(
    /\b(?:aria-label|aria-description|title|placeholder|alt|label|description)=\{\s*["']([^"']+)["']\s*\}/g
  ))
    violations.push(match[1]!);
  for (const match of source.matchAll(/>\s*([^<>{}\n]+)\s*<(?:\/|[a-z])/g)) {
    if (/[\p{L}\p{N}]/u.test(match[1]!) && !match[1]!.includes('&&'))
      violations.push(match[1]!.trim());
  }
  // Source guard, not a JSX parser: runtime locale/role assertions remain in
  // component tests and the separate browser pass. Remove translated/field-render calls
  // before checking direct literal and conditional JSX expressions.
  for (const match of source.matchAll(/>\s*\{([^{}]+)\}\s*</g)) {
    const expression = match[1]!.replace(/\b(?:t|field)\([^)]*\)/g, '');
    for (const literal of expression.matchAll(/["']([^"']+)["']/g)) violations.push(literal[1]!);
  }
  return violations;
}

describe('match management copy contract', () => {
  it('distinguishes field-render identifiers from hardcoded visible copy', () => {
    expect(hardcodedCopy("return (<div>{field('price', 'number')}</div>)")).toEqual([]);
    expect(hardcodedCopy("return (<div>{'Price'}</div>)")).toEqual(['Price']);
    expect(hardcodedCopy('return (<div>Price</div>)')).toEqual(['Price']);
  });
  it('every action error notification and unavailable state has all locale keys', () => {
    const required = [
      ...Object.values(MANAGEMENT_ERROR_COPY),
      ...Object.values(MATCH_INVITATION_ERROR_COPY),
      ...[
        'title',
        'accept',
        'decline',
        'pending',
        'accepted',
        'declined',
        'expired',
        'cancelled',
        'expiresAt',
        'pendingApproval'
      ].map((key) => `matches.invitations.${key}`),
      ...[
        'actions',
        'participants',
        'participantActions',
        'leave',
        'leaveTitle',
        'leaveDescription',
        'leaveKeepOrganizing',
        'organizerOnly',
        'title',
        'close',
        'transfer',
        'transferTitle',
        'newOrganizer',
        'cancelMatch',
        'cancelTitle',
        'cancelDescription',
        'cancelReason',
        'cancelled',
        'ownershipTransferred',
        'confirm',
        'remove',
        'removeTitle',
        'removeDescription',
        'reason',
        'reasonInvalid',
        'cancel',
        'withdrawn',
        'removed',
        'removalReason',
        'reenter',
        'withdrawnFeedback',
        'removedFeedback',
        'offline'
      ].map((key) => `matches.management.${key}`),
      ...[
        'title',
        'save',
        'minorNotice',
        'conflictTitle',
        'conflictDescription',
        'conflictHelper',
        'reload',
        'reviewDraft',
        'saved'
      ].map((key) => `matches.management.edit.${key}`),
      ...[
        'cancelled',
        'started',
        'cutoff',
        'resultProtected',
        'correctionExplanation',
        'correctionUnavailable',
        'backToMatch'
      ].map((key) => `matches.management.unavailable.${key}`),
      ...[
        'title',
        'description',
        'deadline',
        'reviewTerms',
        'confirm',
        'confirmed',
        'requiredBadge',
        'creatorSummary_one',
        'creatorSummary_other',
        'excluded',
        'staleGeneration'
      ].map((key) => `matches.reconfirmation.${key}`),
      ...Object.entries(MANAGEMENT_NOTIFICATION_COPY).flatMap(([kind, body]) => [
        `notifications.kinds.${kind}`,
        `notifications.match.${body}`
      ])
    ];
    for (const locale of ['en', 'pt-BR', 'es'] as const) {
      const i18n = createI18n(locale);
      for (const key of required) {
        // Exact resource lookup: English fallback must not hide a missing translation.
        expect(i18n.getResource(locale, 'translation', key), `${locale}: ${key}`).toEqual(
          expect.any(String)
        );
        expect(
          String(i18n.getResource(locale, 'translation', key)).trim(),
          `${locale}: ${key}`
        ).not.toBe('');
      }
    }
  });

  it.each(MANAGEMENT_COMPONENTS)(
    '%s contains no hardcoded visible or accessible copy',
    (component) => {
      const source = readFileSync(`src/features/matches/${component}.tsx`, 'utf8');
      expect(hardcodedCopy(source)).toEqual([]);
      for (const match of source.matchAll(/['"]((?:matches|notifications)\.[\w.]+)['"]/g)) {
        for (const locale of ['en', 'pt-BR', 'es'] as const)
          expect(
            createI18n(locale).getResource(locale, 'translation', match[1]!) ??
              createI18n(locale).getResource(locale, 'translation', `${match[1]}_other`),
            `${locale}: ${match[1]}`
          ).toBeDefined();
      }
    }
  );

  it('detects literal JSX text, conditional copy and accessible names', () => {
    expect(hardcodedCopy('<button aria-label="Remove">Remove player</button>')).toEqual([
      'Remove',
      'Remove player'
    ]);
    expect(hardcodedCopy('<p>{busy ? "Saving" : "Ready"}</p>')).toEqual(['Saving', 'Ready']);
    expect(hardcodedCopy('<button aria-label={"Remove"}>{t("key")}</button>')).toEqual(['Remove']);
    expect(hardcodedCopy('<button aria-label={t("key")}>{t("key")}</button>')).toEqual([]);
  });
});
