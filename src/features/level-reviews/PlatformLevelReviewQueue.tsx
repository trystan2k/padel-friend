import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import {
  LEVEL_REVIEW_STATUSES,
  type LevelReviewErrorCode,
  type LevelReviewQueueResult,
  type LevelReviewStatus
} from './level-review-contracts';
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';
import { levelReviewErrorCode } from './level-review-errors';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { levelReviewErrorKind } from './level-review-form';
import { listLevelReviewQueueRequests } from './level-review.functions';
import { LevelReviewBackLink } from './LevelReviewBackLink';
import { LevelReviewAvatar, LevelReviewLinkIcon, LevelReviewStatusChip } from './LevelReviewParts';
import { formatLevel } from '../player/rating-format';

type Filter = LevelReviewStatus | 'all';

/**
 * Platform queue (frame SCPeI): pending summary chip, then one hairline card per request with the
 * player, status chip, requested range, submitted date and the review link. The status filter and
 * keyset paging are kept. The frame's community line has no source in the queue row, so the
 * player's submitted level and reliability take its place.
 */
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
    <main {...stylex.props(c.page)}>
      <header {...stylex.props(c.topBar, c.topBarFrame)}>
        <LevelReviewBackLink to="/me" label={t('levelReview.request.backLabel')} />
        <p {...stylex.props(c.navTitle)}>{t('levelReview.admin.entryTitle')}</p>
      </header>
      <div {...stylex.props(c.heading)}>
        <h1 {...stylex.props(c.pageTitle)}>{t('levelReview.admin.title')}</h1>
      </div>
      <p {...stylex.props(c.chip, c.toneAmber)}>
        <span aria-hidden="true">◷</span>
        {t('levelReview.admin.pendingCount', { count: page.pending_count })}
      </p>
      <div {...stylex.props(c.section)}>
        <label {...stylex.props(c.label)} htmlFor="review-filter">
          {t('levelReview.admin.filter')}
        </label>
        <select
          id="review-filter"
          value={filter}
          {...stylex.props(c.select)}
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
      </div>
      {loading && <output {...stylex.props(c.meta)}>{t('levelReview.admin.loading')}</output>}
      {error && (
        <div role="alert" {...stylex.props(c.alert)}>
          <p {...stylex.props(c.alertText)}>
            {t(`levelReview.errors.${levelReviewErrorKind(error)}`)}
          </p>
          <button
            type="button"
            {...stylex.props(c.textButton)}
            onClick={() => void load(filter, retryMore)}
          >
            {t('levelReview.errors.retry')}
          </button>
        </div>
      )}
      {(!error || retryMore) &&
        (!loading || retryMore) &&
        (page.items.length === 0 ? (
          <SurfaceCard xstyle={c.card}>
            <h2 {...stylex.props(c.cardHeading)}>{t('levelReview.admin.empty')}</h2>
          </SurfaceCard>
        ) : (
          <ul {...stylex.props(c.cardList)}>
            {page.items.map((item) => {
              const name = item.owner_display_name || item.owner_id;
              return (
                <li key={item.id}>
                  <SurfaceCard xstyle={c.card}>
                    <div {...stylex.props(c.cardHeader)}>
                      <LevelReviewAvatar name={name} locale={i18n.language} />
                      <div {...stylex.props(c.player)}>
                        <h2 {...stylex.props(c.playerName)}>{name}</h2>
                        <p {...stylex.props(c.meta)}>
                          {t('levelReview.admin.current', {
                            level: formatLevel(item.snapshot_display_level, i18n.language),
                            reliability: item.snapshot_reliability_percent
                          })}
                        </p>
                      </div>
                      <LevelReviewStatusChip status={item.status} />
                    </div>
                    <hr {...stylex.props(c.divider)} />
                    <p {...stylex.props(c.levelRow)}>
                      <span {...stylex.props(c.meta)}>{t('levelReview.admin.requestedRange')}</span>
                      <span {...stylex.props(c.rowValue)}>
                        {formatRequestedRange(item, i18n.language, t)}
                      </span>
                    </p>
                    <p {...stylex.props(c.levelRow)}>
                      <span {...stylex.props(c.meta)}>{t('levelReview.admin.submittedLabel')}</span>
                      <span {...stylex.props(c.rowValue)}>
                        {formatReviewDate(item.created_at, i18n.language)}
                      </span>
                    </p>
                    <Link
                      to="/platform-admin/level-reviews/$requestId"
                      params={{ requestId: item.id }}
                      {...stylex.props(c.linkRow)}
                    >
                      <LevelReviewLinkIcon />
                      {t('levelReview.admin.review')}
                    </Link>
                  </SurfaceCard>
                </li>
              );
            })}
          </ul>
        ))}
      {page.next_cursor && !loading && !error && (
        <button
          type="button"
          {...stylex.props(c.textButton)}
          onClick={() => void load(filter, true)}
        >
          {t('levelReview.history.loadMore')}
        </button>
      )}
    </main>
  );
}
