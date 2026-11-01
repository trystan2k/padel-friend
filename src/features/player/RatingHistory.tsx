import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import type { RatingErrorCode, RatingHistoryItem, RatingHistoryView } from './rating-contracts';
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
import { rating as s } from './rating.styles';

const OUTCOME_STYLE = {
  win: s.outcomeWin,
  draw: s.outcomeDraw,
  loss: s.outcomeLoss
} as const;

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
    <SurfaceCard xstyle={s.card}>
      <h3 {...stylex.props(s.subheading)}>{t('rating.history.title')}</h3>
      {items.length === 0 ? (
        <p {...stylex.props(s.copy)}>{t('profile.historyEmpty')}</p>
      ) : (
        <ul {...stylex.props(s.list)}>
          {items.map((item) => (
            <HistoryRow
              key={item.game_group_id}
              item={item}
              locale={locale}
              onExplain={onExplain}
            />
          ))}
        </ul>
      )}
      <div {...stylex.props(s.footer)}>
        {items.length > 0 && (
          <p aria-live="polite" {...stylex.props(s.copy)}>
            {t('rating.history.showing', { shown: items.length, count: initial.total_events })}
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
  );
}

function HistoryRow({
  item,
  locale,
  onExplain
}: {
  item: RatingHistoryItem;
  locale: string;
  onExplain: (groupId: string, focus: ExplanationFocus, trigger: HTMLButtonElement) => void;
}) {
  const { t } = useTranslation();
  const outcome = ratingOutcome(item.outcome_value);
  const date = formatRatingDate(item.played_at, locale);
  return (
    <li {...stylex.props(s.row)}>
      <div {...stylex.props(s.rowTop)}>
        <span {...stylex.props(s.outcomeChip, OUTCOME_STYLE[outcome])}>
          {t(`rating.outcome.${outcome}`)}
        </span>
        <div {...stylex.props(s.rowMain)}>
          <h4 {...stylex.props(s.rowTitle)}>
            {t('rating.history.groupTitle', { number: item.game_group_number })}
            {item.recalculated && (
              <span {...stylex.props(s.recalculated)}>{t('rating.history.recalculated')}</span>
            )}
          </h4>
          <p {...stylex.props(s.copy)}>
            <time dateTime={item.played_at}>{date}</time>
          </p>
          <p {...stylex.props(s.copy)}>
            {t('rating.history.levelChange', {
              before: formatLevel(item.before_display_level, locale),
              after: formatLevel(item.after_display_level, locale)
            })}
          </p>
          <p {...stylex.props(s.copy)}>
            {t('rating.history.reliabilityChange', {
              before: formatPercentPoints(item.before_reliability_percent, locale),
              after: formatPercentPoints(item.after_reliability_percent, locale)
            })}
          </p>
        </div>
        <strong
          {...stylex.props(
            s.delta,
            item.applied_delta > 0 && s.deltaGain,
            item.applied_delta < 0 && s.deltaLoss
          )}
        >
          {formatSignedDelta(item.applied_delta, locale)}
        </strong>
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
