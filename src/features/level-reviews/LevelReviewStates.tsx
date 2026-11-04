import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { normalizeReturnPath } from '../auth/return-path';
import { levelReviewErrorKind } from './level-review-form';
import type { LevelReviewErrorCode } from './level-review-contracts';
import { levelReview as s } from './level-review.styles';

/** Route-level pending state shared by the level review pages. */
export function LevelReviewLoading({ title, description }: { title: string; description: string }) {
  return (
    <main {...stylex.props(s.page)}>
      <output {...stylex.props(s.card)}>
        <span {...stylex.props(s.cardTitle)}>{title}</span>
        <span {...stylex.props(s.muted)}>{description}</span>
      </output>
    </main>
  );
}

/**
 * Explicit failure state. A denial, a missing request or an outage is always shown as such,
 * never as an empty list; only transient failures offer a retry, an expired session offers sign-in.
 */
export function LevelReviewLoadError({
  code,
  onRetry,
  returnPath = '/level-reviews',
  backTo = '/dashboard'
}: {
  code: LevelReviewErrorCode;
  onRetry?: () => void;
  returnPath?: string;
  backTo?: '/dashboard' | '/level-reviews';
}) {
  const { t } = useTranslation();
  const kind = levelReviewErrorKind(code);
  const retryable = kind === 'unavailable';
  return (
    <main {...stylex.props(s.page)}>
      <div role="alert" {...stylex.props(s.alert)}>
        <p {...stylex.props(s.cardTitle)}>{t('levelReview.loadErrorTitle')}</p>
        <p {...stylex.props(s.alertText)}>{t(`levelReview.errors.${kind}`)}</p>
        <div {...stylex.props(s.actions)}>
          {retryable && onRetry && (
            <button type="button" onClick={onRetry} {...stylex.props(s.textButton)}>
              {t('levelReview.errors.retry')}
            </button>
          )}
          {kind === 'unauthenticated' && (
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
          <Link to={backTo} {...stylex.props(s.actionLink)}>
            {t(
              backTo === '/dashboard' ? 'levelReview.request.backLabel' : 'levelReview.detail.back'
            )}
          </Link>
        </div>
      </div>
    </main>
  );
}
