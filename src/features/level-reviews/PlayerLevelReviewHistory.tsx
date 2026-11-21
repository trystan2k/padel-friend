import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type {
  LevelReviewCursor,
  LevelReviewDto,
  LevelReviewErrorCode
} from './level-review-contracts';
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';
import { levelReviewErrorCode } from './level-review-errors';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { isActiveLevelReview, levelReviewErrorKind } from './level-review-form';
import { LEVEL_REVIEW_HISTORY_PAGE_SIZE } from './level-review-view';
import { listMyLevelReviewRequests } from './level-review.functions';
import { LevelReviewBackLink } from './LevelReviewBackLink';
import { LevelReviewLinkIcon, LevelReviewStatusChip } from './LevelReviewParts';

/**
 * The player's own requests, newest first, with keyset "load more" (frame A9f626). A failed page
 * keeps the rows already shown and offers a retry; it never turns into an empty list.
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
    <main {...stylex.props(c.page)}>
      <header {...stylex.props(c.topBar, c.topBarFrame)}>
        <LevelReviewBackLink to="/me" label={t('levelReview.request.backLabel')} />
        <p {...stylex.props(c.navTitle)}>{t('levelReview.entry.title')}</p>
      </header>
      <div {...stylex.props(c.heading)}>
        <h1 {...stylex.props(c.pageTitle)}>{t('levelReview.history.title')}</h1>
        <p {...stylex.props(c.body)}>{t('levelReview.history.subtitle')}</p>
      </div>
      {!active && (
        <Link to="/level-reviews/new" {...stylex.props(c.action)}>
          {t('levelReview.history.newRequest')}
        </Link>
      )}
      {items.length === 0 ? (
        <SurfaceCard xstyle={c.card}>
          <h2 {...stylex.props(c.cardHeading)}>{t('levelReview.history.emptyTitle')}</h2>
          <p {...stylex.props(c.meta)}>{t('levelReview.history.emptyDescription')}</p>
        </SurfaceCard>
      ) : (
        <ul {...stylex.props(c.cardList)}>
          {items.map((item) => {
            const decided = item.status === 'approved' || item.status === 'rejected';
            return (
              <li key={item.id}>
                <SurfaceCard xstyle={c.card}>
                  <div {...stylex.props(c.cardHeader)}>
                    <h2 {...stylex.props(c.cardHeading)}>
                      {t('levelReview.history.itemRequested', {
                        range: formatRequestedRange(item, locale, t)
                      })}
                    </h2>
                    <LevelReviewStatusChip status={item.status} />
                  </div>
                  <p {...stylex.props(c.meta)}>
                    {t('levelReview.history.itemSubmitted', {
                      date: formatReviewDate(item.created_at, locale)
                    })}
                  </p>
                  <hr {...stylex.props(c.divider)} />
                  <p {...stylex.props(decided ? c.userText : c.meta)}>
                    {(decided && item.decision_note) ||
                      t(`levelReview.status.detail.${item.status}`)}
                  </p>
                  <Link
                    to="/level-reviews/$requestId"
                    params={{ requestId: item.id }}
                    {...stylex.props(c.linkRow)}
                  >
                    <LevelReviewLinkIcon />
                    {t(
                      item.id === active?.id
                        ? 'levelReview.history.viewActive'
                        : 'levelReview.history.viewRequest'
                    )}
                  </Link>
                </SurfaceCard>
              </li>
            );
          })}
        </ul>
      )}
      <div {...stylex.props(c.footer)}>
        {items.length > 0 && (
          <p aria-live="polite" {...stylex.props(c.meta)}>
            {t('levelReview.history.showing', { count: items.length })}
          </p>
        )}
        {error && (
          <p role="alert" {...stylex.props(c.alertText)}>
            {t(`levelReview.errors.${levelReviewErrorKind(error)}`)}
          </p>
        )}
        {cursor && (
          <button
            type="button"
            disabled={loading}
            aria-busy={loading}
            onClick={() => void loadMore()}
            {...stylex.props(c.textButton)}
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
