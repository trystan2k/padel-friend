import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { normalizeReturnPath } from '../auth/return-path';
import type { RatingErrorCode } from './rating-contracts';
import { rating as s } from './rating.styles';

/**
 * One failure surface for every rating reader. Permission loss and expired sessions never
 * look like an empty history; only transient failures offer a retry.
 */
export function isRetryableRatingError(code: RatingErrorCode) {
  return code === 'unavailable' || code === 'stale_revision';
}

export function RatingError({
  code,
  onRetry,
  retryLabel,
  returnPath,
  announce = true
}: {
  code: RatingErrorCode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Where sign-in should come back to; validated as a same-origin path, default dashboard. */
  returnPath?: string;
  /** False when a parent live region already announces this failure (no duplicate alert). */
  announce?: boolean;
}) {
  const { t } = useTranslation();
  const retryable = isRetryableRatingError(code);
  const label = retryLabel ?? t(code === 'stale_revision' ? 'rating.errors.reload' : 'auth.retry');
  return (
    <div role={announce ? 'alert' : undefined} {...stylex.props(s.stateCopy)}>
      <p {...stylex.props(s.error)}>{t(`rating.errors.${code}`)}</p>
      {retryable && onRetry && (
        <button type="button" onClick={onRetry} {...stylex.props(s.textButton)}>
          {label}
        </button>
      )}
      {code === 'unauthenticated' && (
        <button
          type="button"
          onClick={() =>
            window.location.assign(
              `/login?next=${encodeURIComponent(normalizeReturnPath(returnPath))}`
            )
          }
          {...stylex.props(s.textButton)}
        >
          {t('signIn')}
        </button>
      )}
    </div>
  );
}
