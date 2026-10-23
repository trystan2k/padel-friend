import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { matchDetailShellStyles as s } from './match-detail-shell.styles';

export type MatchStatusBannerVariant =
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'closed'
  | 'started'
  | 'cancelled'
  | 'result_protected';

export function MatchStatusBanner({
  variant,
  pendingApproval = false
}: {
  variant: MatchStatusBannerVariant;
  pendingApproval?: boolean;
}) {
  const { t } = useTranslation();
  const headingId = useId();
  const positive = variant === 'accepted' || variant === 'result_protected';
  const invitation = variant === 'accepted' || variant === 'declined' || variant === 'expired';
  const copy = invitation
    ? t(
        `matches.invitations.${pendingApproval && variant === 'accepted' ? 'pendingApproval' : variant}`
      )
    : variant === 'result_protected'
      ? [
          t('matches.management.unavailable.resultProtected'),
          t('matches.management.unavailable.correctionExplanation'),
          t('matches.management.unavailable.correctionUnavailable')
        ].join(' ')
      : t(`matches.management.unavailable.${variant === 'closed' ? 'cutoff' : variant}`);
  return (
    <section
      aria-labelledby={headingId}
      {...stylex.props(s.banner, variant === 'accepted' && s.positive)}
    >
      <div {...stylex.props(s.bannerHeading, positive && s.positiveAccent)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          aria-hidden="true"
          {...stylex.props(s.icon)}
        >
          {variant === 'result_protected' ? (
            <>
              <path d="m12 3 7 3v6c0 4-7 8-7 8s-7-4-7-8V6l7-3Z" />
              <path d="m9 11 2 2 4-4" />
            </>
          ) : variant === 'accepted' || variant === 'declined' || variant === 'cancelled' ? (
            <>
              <circle cx="12" cy="12" r="9" />
              {variant === 'accepted' ? (
                <path d="m8 12 3 3 5-6" />
              ) : variant === 'declined' ? (
                <path d="M8 12h8" />
              ) : (
                <path d="m8 8 8 8m0-8-8 8" />
              )}
            </>
          ) : (
            <>
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
            </>
          )}
        </svg>
        <h2 id={headingId} {...stylex.props(s.title)}>
          {t(`matches.detail.statusTitles.${variant}`)}
        </h2>
      </div>
      <output aria-live="polite" aria-atomic="true" {...stylex.props(s.copy)}>
        {copy}
      </output>
    </section>
  );
}
