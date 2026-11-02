import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { formatSignedDelta } from '../player/rating-format';
import {
  type HistoryItem,
  type HistoryStatus,
  type HistoryView,
  type StatisticsErrorCode
} from './statistics-history-contracts';
import { getStatisticsHistory } from './statistics-history.functions';
import { historyStyles as s } from './statistics-history.styles';
import type { StatisticsFilters } from './statistics-contracts';

const STATUS_TONE: Record<HistoryStatus, StatusBadgeTone> = {
  played: 'positive',
  incomplete: 'neutral',
  disputed: 'danger',
  pending: 'neutral',
  awaiting_result: 'muted',
  canceled: 'danger',
  reserve_not_playing: 'muted'
};

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

function failureCode(cause: unknown): StatisticsErrorCode {
  return cause instanceof Error && cause.message.includes('UNAUTHENTICATED')
    ? 'STATISTICS_UNAUTHENTICATED'
    : 'STATISTICS_UNAVAILABLE';
}

/**
 * The caller's match history, newest first, with keyset "load more". Lifecycle badges are separate
 * from the match type; unresolved entries show no score and never look like played matches. A page
 * served from another statistics revision is never appended: the list reloads from the top.
 */
export function MatchHistory({
  initial,
  filters,
  initialError = null
}: {
  initial: HistoryView | null;
  filters: StatisticsFilters;
  initialError?: StatisticsErrorCode | null;
}) {
  const { t, i18n } = useTranslation();
  const [view, setView] = useState<HistoryView | null>(initial);
  const [items, setItems] = useState<HistoryItem[]>(initial?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(initial?.next_cursor ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<StatisticsErrorCode | null>(initialError);
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;

  async function load(from: string | null) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await getStatisticsHistory({
        data: { ...filters, limit: 20, ...(from ? { cursor: from } : {}) }
      });
      if (response.status === 'error') {
        setError(response.code);
        // A page from another revision is never appended: restart from the top next time.
        if (response.code === 'STATISTICS_STALE_REVISION') setCursor(null);
        return;
      }
      setView(response.value);
      setItems((current) => (from ? [...current, ...response.value.items] : response.value.items));
      setCursor(response.value.next_cursor);
    } catch (cause) {
      setError(failureCode(cause));
    } finally {
      setLoading(false);
    }
  }

  const restart = !view || error === 'STATISTICS_STALE_REVISION' || cursor === null;
  return (
    <section aria-labelledby="statistics-history-title" {...stylex.props(s.section)}>
      <div>
        <h2 id="statistics-history-title" {...stylex.props(s.heading)}>
          {t('statistics.history.title')}
        </h2>
        <p {...stylex.props(s.copy)}>{t('statistics.history.subtitle')}</p>
      </div>
      {error && (
        <div role="alert">
          <p {...stylex.props(s.error)}>{t(`statistics.errors.${error}`)}</p>
          {RETRYABLE.includes(error) && (
            <button
              type="button"
              onClick={() => void load(restart ? null : cursor)}
              {...stylex.props(s.button)}
            >
              {t('statistics.history.retry')}
            </button>
          )}
        </div>
      )}
      {!error && items.length === 0 && (
        <SurfaceCard>
          <p {...stylex.props(s.copy)}>{t('statistics.history.empty')}</p>
        </SurfaceCard>
      )}
      {items.length > 0 && (
        <ul aria-label={t('statistics.history.listLabel')} {...stylex.props(s.list)}>
          {items.map((item) => (
            <HistoryEntry key={item.key} item={item} locale={locale} />
          ))}
        </ul>
      )}
      {cursor && (
        <button
          type="button"
          disabled={loading}
          aria-busy={loading}
          onClick={() => void load(cursor)}
          {...stylex.props(s.button)}
        >
          {t(loading ? 'statistics.history.loadingMore' : 'statistics.history.loadMore')}
        </button>
      )}
    </section>
  );
}

function HistoryEntry({ item, locale }: { item: HistoryItem; locale: string }) {
  const { t } = useTranslation();
  const when = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: item.timezone
  }).format(new Date(item.sort_at));
  const type = t(`matches.type.${item.match_type}`);
  const mine = item.viewer_side === 'team_b' ? 'b' : 'a';
  const confirmed = item.status === 'played' || item.status === 'incomplete';
  const detailsHref = item.game_group_id !== null && confirmed;
  return (
    <li {...stylex.props(s.entry)}>
      <div {...stylex.props(s.badges)}>
        <StatusBadge tone={STATUS_TONE[item.status]}>
          {t(`statistics.history.status.${item.status}`)}
        </StatusBadge>
        <StatusBadge tone="neutral">{type}</StatusBadge>
        {item.group_number !== null && (
          <StatusBadge tone="muted">
            {t('statistics.history.group', { number: item.group_number })}
          </StatusBadge>
        )}
      </div>
      <p {...stylex.props(s.strong)}>
        {item.community_name} · {item.venue_name}
      </p>
      <p {...stylex.props(s.copy)}>
        <time dateTime={item.sort_at}>{when}</time>
        {item.league_name && <> · {t('statistics.history.league', { name: item.league_name })}</>}
      </p>
      <p {...stylex.props(s.copy)}>{t(`statistics.history.statusHelp.${item.status}`)}</p>
      {confirmed && (
        <div {...stylex.props(s.scoreLine)}>
          {item.outcome && (
            <span {...stylex.props(s.outcome)}>
              {t(`statistics.history.outcome.${item.outcome}`)}
            </span>
          )}
          <span {...stylex.props(s.copy)}>
            {t('statistics.history.sets', {
              won: mine === 'a' ? item.sets_a : item.sets_b,
              lost: mine === 'a' ? item.sets_b : item.sets_a
            })}
          </span>
          <span {...stylex.props(s.copy)}>
            {t('statistics.history.games', {
              won: mine === 'a' ? item.games_a : item.games_b,
              lost: mine === 'a' ? item.games_b : item.games_a
            })}
          </span>
          {item.rating_delta === null ? (
            <span {...stylex.props(s.delta)}>{t('statistics.history.noRating')}</span>
          ) : (
            <span
              {...stylex.props(
                s.delta,
                item.rating_delta > 0 && s.deltaGain,
                item.rating_delta < 0 && s.deltaLoss
              )}
            >
              {t('statistics.history.ratingChange', {
                delta: formatSignedDelta(item.rating_delta, locale)
              })}
            </span>
          )}
        </div>
      )}
      {detailsHref && item.game_group_id ? (
        <Link
          to="/matches/$eventId/groups/$groupId"
          params={{ eventId: item.event_id, groupId: item.game_group_id }}
          aria-label={t('statistics.history.detailsLabel', { type, date: when })}
          {...stylex.props(s.link)}
        >
          {t('statistics.history.viewDetails')}
        </Link>
      ) : (
        <Link
          to="/matches/$eventId"
          params={{ eventId: item.event_id }}
          aria-label={t('statistics.history.matchLabel', { type, date: when })}
          {...stylex.props(s.link)}
        >
          {t('statistics.history.viewMatch')}
        </Link>
      )}
    </li>
  );
}
