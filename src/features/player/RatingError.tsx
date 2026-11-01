import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { RatingErrorCode } from './rating-contracts';
import { rating as s } from './rating.styles';

/**
 * One failure surface for every rating reader. Permission loss and expired sessions never
 * look like an empty history; only transient failures offer a retry.
 */
export function RatingError({
  code,
  onRetry,
  retryLabel
}: {
  code: RatingErrorCode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { t } = useTranslation();
  const retryable = code === 'unavailable' || code === 'stale_revision';
  const label = retryLabel ?? t(code === 'stale_revision' ? 'rating.errors.reload' : 'auth.retry');
  return (
    <div role="alert" {...stylex.props(s.stateCopy)}>
      <p {...stylex.props(s.error)}>{t(`rating.errors.${code}`)}</p>
      {retryable && onRetry && (
        <button type="button" onClick={onRetry} {...stylex.props(s.textButton)}>
          {label}
        </button>
      )}
      {code === 'unauthenticated' && (
        <button
          type="button"
          onClick={() => window.location.assign('/login?next=/dashboard')}
          {...stylex.props(s.textButton)}
        >
          {t('signIn')}
        </button>
      )}
    </div>
  );
}
