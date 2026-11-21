import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type {
  RatingAdjustmentHistoryItem,
  RatingErrorCode,
  RatingHistoryItem,
  RatingHistoryView,
  RatingMatchHistoryItem
} from './rating-contracts';
import {
  formatLevel,
  formatPercentPoints,
  formatRatingDate,
  formatSignedDelta
} from './rating-format';
import { ratingOutcome } from './rating-model';
import { RATING_HISTORY_PAGE_SIZE, ratingFailureCode } from './rating-view';
import type { ExplanationFocus } from './RatingExplanation';
import { RatingError } from './RatingError';
import { getMyRatingHistory } from './rating.functions';
import { journey as j } from './rating-journey.styles';
import { rating as s } from './rating.styles';

/**
 * Recent games, newest first, with keyset "load more". A page served from a different
 * projection revision is never appended: the parent reloads the whole rating view instead.
 */
export function RatingHistory({
  initial,
  onExplain,
  onStale
}: {
  initial: RatingHistoryView;
  onExplain: (groupId: string, focus: ExplanationFocus, trigger: HTMLButtonElement) => void;
  onStale: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState(initial.items);
  const [cursor, setCursor] = useState(initial.next_cursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RatingErrorCode | null>(null);
  const locale = i18n.language;

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getMyRatingHistory({
        data: { limit: RATING_HISTORY_PAGE_SIZE, cursor }
      });
      if (response.status === 'error') {
        if (response.code === 'stale_revision') onStale();
        else setError(response.code);
        return;
      }
      if (response.value.revision !== initial.revision) {
        onStale();
        return;
      }
      setItems((current) => [...current, ...response.value.items]);
      setCursor(response.value.next_cursor);
    } catch (cause) {
      setError(ratingFailureCode(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-label={t('rating.history.title')} {...stylex.props(j.recent)}>
      <h3 {...stylex.props(j.recentTitle)}>{t('rating.history.title')}</h3>
      <SurfaceCard xstyle={j.card}>
        {items.length === 0 ? (
          <p {...stylex.props(j.emptyBody)}>{t('profile.historyEmpty')}</p>
        ) : (
          <ul {...stylex.props(j.list)}>
            {items.map((item, index) => (
              <HistoryEntry
                key={item.kind === 'match' ? item.game_group_id : item.adjustment_id}
                item={item}
                locale={locale}
                divided={index > 0}
                onExplain={onExplain}
              />
            ))}
          </ul>
        )}
        <div {...stylex.props(s.footer)}>
          {items.length > 0 && (
            <p aria-live="polite" {...stylex.props(j.caption)}>
              {t('rating.history.showing', {
                shown: items.filter((item) => item.kind === 'match').length,
                count: initial.total_events
              })}
            </p>
          )}
          {error && <RatingError code={error} />}
          {cursor && (
            <button
              type="button"
              disabled={loading}
              aria-busy={loading}
              onClick={() => void loadMore()}
              {...stylex.props(s.textButton)}
            >
              {t(loading ? 'rating.history.loadingMore' : 'rating.history.loadMore')}
            </button>
          )}
        </div>
      </SurfaceCard>
    </section>
  );
}

type RowProps = { locale: string; divided: boolean };

function HistoryEntry({
  item,
  locale,
  divided,
  onExplain
}: RowProps & {
  item: RatingHistoryItem;
  onExplain: (groupId: string, focus: ExplanationFocus, trigger: HTMLButtonElement) => void;
}) {
  return item.kind === 'match' ? (
    <HistoryRow item={item} locale={locale} divided={divided} onExplain={onExplain} />
  ) : (
    <AdjustmentRow item={item} locale={locale} divided={divided} />
  );
}

/** "3.76 → 3.82": the visible arrow form of the frame, with the spoken form for assistive tech. */
function LevelChange({ before, after, locale }: { before: number; after: number; locale: string }) {
  const { t } = useTranslation();
  const spoken = t('rating.history.levelChange', {
    before: formatLevel(before, locale),
    after: formatLevel(after, locale)
  });
  return (
    <strong {...stylex.props(j.rowValue)}>
      <span aria-hidden="true">
        {formatLevel(before, locale)} → {formatLevel(after, locale)}
      </span>
      <span {...stylex.props(s.srOnly)}>{spoken}</span>
    </strong>
  );
}

/**
 * An approved level review: a correction point from stored safe audit data. It is never a
 * win/loss, has no opponents or match delta and is not counted as a competitive game.
 */
function AdjustmentRow({
  item,
  locale,
  divided
}: RowProps & { item: RatingAdjustmentHistoryItem }) {
  const { t } = useTranslation();
  return (
    <li {...stylex.props(j.row, divided && j.rowDivided)}>
      <div {...stylex.props(j.rowLine)}>
        <h4 {...stylex.props(j.rowTitle)}>
          <time dateTime={item.effective_at}>{formatRatingDate(item.effective_at, locale)}</time>
          {' · '}
          {t('rating.history.adjustmentTitle')}
        </h4>
        <LevelChange
          before={item.before_display_level}
          after={item.after_display_level}
          locale={locale}
        />
      </div>
      <div {...stylex.props(j.rowMeta)}>
        <span>{t('rating.history.adjustmentChip')}</span>
        <p {...stylex.props(j.rowCopy)}>
          {item.reliability_changed
            ? t('rating.history.reliabilityChange', {
                before: formatPercentPoints(item.before_reliability_percent, locale),
                after: formatPercentPoints(item.after_reliability_percent, locale)
              })
            : t('rating.history.reliabilityKept', {
                value: formatPercentPoints(item.after_reliability_percent, locale)
              })}
        </p>
        <p {...stylex.props(j.rowCopy)}>
          {t('rating.history.adjustmentNote', { note: item.reason })}
        </p>
      </div>
      <Link
        to="/level-reviews/$requestId"
        params={{ requestId: item.level_review_request_id }}
        {...stylex.props(s.textButton)}
      >
        {t('rating.history.adjustmentView')}
      </Link>
    </li>
  );
}

function HistoryRow({
  item,
  locale,
  divided,
  onExplain
}: RowProps & {
  item: RatingMatchHistoryItem;
  onExplain: (groupId: string, focus: ExplanationFocus, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const outcome = ratingOutcome(item.outcome_value);
  const date = formatRatingDate(item.played_at, locale);
  return (
    <li {...stylex.props(j.row, divided && j.rowDivided)}>
      <div {...stylex.props(j.rowLine)}>
        <h4 {...stylex.props(j.rowTitle)}>
          <time dateTime={item.played_at}>{date}</time>
          {' · '}
          {t('rating.history.groupTitle', { number: item.game_group_number })}
          {item.recalculated && (
            <span {...stylex.props(s.recalculated)}>{t('rating.history.recalculated')}</span>
          )}
        </h4>
        <LevelChange
          before={item.before_display_level}
          after={item.after_display_level}
          locale={locale}
        />
      </div>
      <div {...stylex.props(j.rowMeta)}>
        <span>{t(`rating.outcome.${outcome}`)}</span>
        <strong
          {...stylex.props(
            s.delta,
            item.applied_delta > 0 && s.deltaGain,
            item.applied_delta < 0 && s.deltaLoss
          )}
        >
          {formatSignedDelta(item.applied_delta, locale)}
        </strong>
        <span>
          {t('rating.history.reliabilityChange', {
            before: formatPercentPoints(item.before_reliability_percent, locale),
            after: formatPercentPoints(item.after_reliability_percent, locale)
          })}
        </span>
      </div>
      <button
        type="button"
        aria-label={t('rating.history.explainLabel', { number: item.game_group_number, date })}
        onClick={(event) => onExplain(item.game_group_id, { team: item.team }, event.currentTarget)}
        {...stylex.props(s.textButton)}
      >
        {t('rating.history.explain')}
      </button>
    </li>
  );
}
