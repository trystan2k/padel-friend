import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type {
  LevelReviewCursor,
  LevelReviewDto,
  LevelReviewErrorCode,
  LevelReviewStatus
} from './level-review-contracts';
import { levelReviewErrorCode } from './level-review-errors';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { isActiveLevelReview, levelReviewErrorKind } from './level-review-form';
import { LEVEL_REVIEW_HISTORY_PAGE_SIZE } from './level-review-view';
import { listMyLevelReviewRequests } from './level-review.functions';
import { levelReview as s } from './level-review.styles';

const TONE = {
  pending: s.toneAmber,
  under_review: s.toneGreen,
  approved: s.toneGreen,
  rejected: s.toneRed,
  canceled: s.toneMuted
} as const satisfies Record<LevelReviewStatus, unknown>;

/**
 * The player's own requests, newest first, with keyset "load more". A failed page keeps the
 * rows already shown and offers a retry; it never turns into an empty list.
 */
export function PlayerLevelReviewHistory({
  initial,
  nextCursor
}: {
  initial: LevelReviewDto[];
  nextCursor: LevelReviewCursor | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(nextCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LevelReviewErrorCode | null>(null);
  const active = items.find((item) => isActiveLevelReview(item.status));

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const page = await listMyLevelReviewRequests({
        data: { limit: LEVEL_REVIEW_HISTORY_PAGE_SIZE, cursor }
      });
      setItems((current) => [...current, ...page.items]);
      setCursor(page.next_cursor);
    } catch (cause) {
      setError(levelReviewErrorCode(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <div {...stylex.props(s.headingRow)}>
          <Link
            to="/dashboard"
            aria-label={t('levelReview.request.backLabel')}
            {...stylex.props(s.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(s.title)}>{t('levelReview.history.title')}</h1>
        </div>
        <p {...stylex.props(s.context)}>{t('levelReview.history.subtitle')}</p>
      </header>
      {active ? (
        <Link
          to="/level-reviews/$requestId"
          params={{ requestId: active.id }}
          {...stylex.props(s.primaryLink)}
        >
          {t('levelReview.history.viewActive')}
        </Link>
      ) : (
        <Link to="/level-reviews/new" {...stylex.props(s.primaryLink)}>
          {t('levelReview.history.newRequest')}
        </Link>
      )}
      {items.length === 0 ? (
        <SurfaceCard xstyle={s.card}>
          <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.history.emptyTitle')}</h2>
          <p {...stylex.props(s.muted)}>{t('levelReview.history.emptyDescription')}</p>
        </SurfaceCard>
      ) : (
        <ul {...stylex.props(s.list)}>
          {items.map((item) => (
            <li key={item.id}>
              <Link
                to="/level-reviews/$requestId"
                params={{ requestId: item.id }}
                {...stylex.props(s.itemLink)}
              >
                <span {...stylex.props(s.statusLabel, TONE[item.status])}>
                  {t(`levelReview.status.${item.status}`)}
                </span>
                <span {...stylex.props(s.strong)}>
                  {t('levelReview.history.itemRequested', {
                    range: formatRequestedRange(item, locale, t)
                  })}
                </span>
                <span {...stylex.props(s.muted)}>
                  {t('levelReview.history.itemSubmitted', {
                    date: formatReviewDate(item.created_at, locale)
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div {...stylex.props(s.footer)}>
        {items.length > 0 && (
          <p aria-live="polite" {...stylex.props(s.muted)}>
            {t('levelReview.history.showing', { count: items.length })}
          </p>
        )}
        {error && (
          <p role="alert" {...stylex.props(s.alertText)}>
            {t(`levelReview.errors.${levelReviewErrorKind(error)}`)}
          </p>
        )}
        {cursor && (
          <button
            type="button"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void loadMore()}
            {...stylex.props(s.textButton)}
          >
            {t(
              loading
                ? 'levelReview.history.loadingMore'
                : error
                  ? 'levelReview.errors.retry'
                  : 'levelReview.history.loadMore'
            )}
          </button>
        )}
      </div>
    </main>
  );
}
