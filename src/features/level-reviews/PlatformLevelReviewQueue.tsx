import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LEVEL_REVIEW_STATUSES,
  type LevelReviewErrorCode,
  type LevelReviewQueueResult,
  type LevelReviewStatus
} from './level-review-contracts';
import { levelReviewErrorCode } from './level-review-errors';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { levelReviewErrorKind } from './level-review-form';
import { listLevelReviewQueueRequests } from './level-review.functions';
import { levelReview as s } from './level-review.styles';
import { formatLevel } from '../player/rating-format';

const tones = {
  pending: s.toneAmber,
  under_review: s.toneGreen,
  approved: s.toneGreen,
  rejected: s.toneRed,
  canceled: s.toneMuted
} as const;
type Filter = LevelReviewStatus | 'all';

export function PlatformLevelReviewQueue({ initial }: { initial: LevelReviewQueueResult }) {
  const { t, i18n } = useTranslation();
  const [page, setPage] = useState(initial);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<LevelReviewErrorCode | null>(null);
  const [retryMore, setRetryMore] = useState(false);
  const sequence = useRef(0);

  async function load(nextFilter: Filter, more: boolean) {
    const request = ++sequence.current;
    setLoading(true);
    setError(null);
    setRetryMore(more);
    try {
      const result = await listLevelReviewQueueRequests({
        data: {
          limit: 20,
          ...(nextFilter === 'all' ? {} : { status: nextFilter }),
          ...(more && page.next_cursor ? { cursor: page.next_cursor } : {})
        }
      });
      if (sequence.current !== request) return;
      setPage((previous) =>
        more ? { ...result, items: [...previous.items, ...result.items] } : result
      );
    } catch (cause) {
      if (sequence.current === request) setError(levelReviewErrorCode(cause));
    } finally {
      if (sequence.current === request) setLoading(false);
    }
  }

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <h1 {...stylex.props(s.title)}>{t('levelReview.admin.title')}</h1>
        <p {...stylex.props(s.context)}>{t('levelReview.admin.subtitle')}</p>
        <p {...stylex.props(s.statusLabel, s.toneAmber, s.pendingBadge)}>
          {t('levelReview.admin.pendingCount', { count: page.pending_count })}
        </p>
      </header>
      <label {...stylex.props(s.strong)} htmlFor="review-filter">
        {t('levelReview.admin.filter')}
      </label>
      <select
        id="review-filter"
        value={filter}
        {...stylex.props(s.filterSelect)}
        onChange={(event) => {
          const value = event.target.value;
          const next =
            value === 'all' ? 'all' : LEVEL_REVIEW_STATUSES.find((status) => status === value);
          if (!next) return;
          setFilter(next);
          void load(next, false);
        }}
      >
        <option value="all">{t('levelReview.admin.all')}</option>
        {LEVEL_REVIEW_STATUSES.map((status) => (
          <option value={status} key={status}>
            {t(`levelReview.status.${status}`)}
          </option>
        ))}
      </select>
      {loading && <output {...stylex.props(s.muted)}>{t('levelReview.admin.loading')}</output>}
      {error && (
        <div role="alert" {...stylex.props(s.alert)}>
          <p {...stylex.props(s.alertText)}>
            {t(`levelReview.errors.${levelReviewErrorKind(error)}`)}
          </p>
          <button
            type="button"
            {...stylex.props(s.textButton)}
            onClick={() => void load(filter, retryMore)}
          >
            {t('levelReview.errors.retry')}
          </button>
        </div>
      )}
      {(!error || retryMore) &&
        (!loading || retryMore) &&
        (page.items.length === 0 ? (
          <div {...stylex.props(s.card)}>
            <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.admin.empty')}</h2>
          </div>
        ) : (
          <ul {...stylex.props(s.list)}>
            {page.items.map((item) => (
              <li key={item.id}>
                <Link
                  to="/platform-admin/level-reviews/$requestId"
                  params={{ requestId: item.id }}
                  {...stylex.props(s.itemLink)}
                >
                  <span {...stylex.props(s.strong)}>
                    {item.owner_display_name || item.owner_id}
                  </span>
                  <span {...stylex.props(s.muted)}>
                    {t('levelReview.admin.current', {
                      level: formatLevel(item.snapshot_display_level, i18n.language),
                      reliability: item.snapshot_reliability_percent
                    })}
                  </span>
                  <span {...stylex.props(s.strong)}>
                    {t('levelReview.history.itemRequested', {
                      range: formatRequestedRange(item, i18n.language, t)
                    })}
                  </span>
                  <span {...stylex.props(s.statusLabel, tones[item.status])}>
                    {t(`levelReview.status.${item.status}`)}
                  </span>
                  <span {...stylex.props(s.muted)}>
                    {t('levelReview.history.itemSubmitted', {
                      date: formatReviewDate(item.created_at, i18n.language)
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ))}
      {page.next_cursor && !loading && !error && (
        <button
          type="button"
          {...stylex.props(s.textButton)}
          onClick={() => void load(filter, true)}
        >
          {t('levelReview.history.loadMore')}
        </button>
      )}
    </main>
  );
}
