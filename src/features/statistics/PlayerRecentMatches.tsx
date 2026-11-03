import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import { Section, usePlayerFormat } from './PlayerMetric';
import { StatisticsEmpty, StatisticsError } from './StatisticsStates';
import type {
  HistoryStatus,
  HistoryView,
  StatisticsResponse
} from './statistics-history-contracts';
import { playerStyles as s } from './statistics-player.styles';

const tones: Record<HistoryStatus, StatusBadgeTone> = {
  played: 'positive',
  incomplete: 'neutral',
  disputed: 'danger',
  pending: 'neutral',
  awaiting_result: 'muted',
  canceled: 'danger',
  reserve_not_playing: 'muted'
};

/**
 * `response` is null when the subject's matches are not readable for this scope (another player
 * without a shared community selected); the card then explains what to select instead of failing.
 * See-all opens the viewer's own history, so it only shows on the viewer's own profile.
 */
export function PlayerRecentMatches({
  response,
  isOwn,
  onRetry
}: {
  response: StatisticsResponse<HistoryView> | null;
  isOwn: boolean;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  return (
    <Section id="player-recent-matches" title={t('statistics.player.recent.title')}>
      {!response ? (
        <StatisticsEmpty>{t('statistics.player.recent.needsCommunity')}</StatisticsEmpty>
      ) : response.status === 'error' ? (
        <StatisticsError code={response.code} onRetry={onRetry} />
      ) : response.value.items.length === 0 ? (
        <StatisticsEmpty>{t('statistics.history.empty')}</StatisticsEmpty>
      ) : (
        <ul {...stylex.props(s.recentList)}>
          {response.value.items.map((item) => {
            const confirmed =
              (item.status === 'played' || item.status === 'incomplete') &&
              item.game_group_id !== null;
            const opponents = (item.opponents ?? []).map(
              (name) => name ?? t('statistics.relationships.unknownPlayer')
            );
            return (
              <li key={item.key} {...stylex.props(s.recentRow)}>
                <div {...stylex.props(s.recentMeta)}>
                  <time dateTime={item.sort_at}>{f.date(item.sort_at)}</time>
                  <StatusBadge tone={tones[item.status]}>
                    {t(`statistics.history.status.${item.status}`)}
                  </StatusBadge>
                </div>
                <p {...stylex.props(s.copy)}>
                  {opponents.length
                    ? t('statistics.player.recent.opponents', {
                        names: new Intl.ListFormat(f.locale, {
                          style: 'long',
                          type: 'conjunction'
                        }).format(opponents)
                      })
                    : t('statistics.player.recent.noOpponents')}
                </p>
                {confirmed && item.game_group_id && (
                  <Link
                    to="/matches/$eventId/groups/$groupId"
                    params={{ eventId: item.event_id, groupId: item.game_group_id }}
                    {...stylex.props(s.link)}
                  >
                    {t('statistics.history.viewDetails')}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {isOwn && (
        <Link to="/matches/past" {...stylex.props(s.link)}>
          {t('statistics.player.recent.seeAll')}
        </Link>
      )}
    </Section>
  );
}
