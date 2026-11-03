import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import { Section, usePlayerFormat } from './PlayerMetric';
import { StatisticsEmpty, StatisticsError, StatisticsLoading } from './StatisticsStates';
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

export function PlayerRecentMatches({
  response,
  onRetry
}: {
  response?: StatisticsResponse<HistoryView>;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  const f = usePlayerFormat();
  return (
    <Section id="player-recent-matches" title={t('statistics.player.recent.title')}>
      {!response ? (
        <StatisticsLoading />
      ) : response.status === 'error' ? (
        <StatisticsError code={response.code} onRetry={onRetry} />
      ) : response.value.items.length === 0 ? (
        <StatisticsEmpty>{t('statistics.history.empty')}</StatisticsEmpty>
      ) : (
        <ul {...stylex.props(s.filters)}>
          {response.value.items.map((item) => {
            const confirmed =
              (item.status === 'played' || item.status === 'incomplete') &&
              item.game_group_id !== null;
            const opponents = (item.opponents ?? []).map(
              (name) => name ?? t('statistics.relationships.unknownPlayer')
            );
            return (
              <li key={item.key}>
                <StatusBadge tone={tones[item.status]}>
                  {t(`statistics.history.status.${item.status}`)}
                </StatusBadge>
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
                <time dateTime={item.sort_at}>{f.date(item.sort_at)}</time>
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
      <Link to="/matches/past" {...stylex.props(s.link)}>
        {t('statistics.player.recent.seeAll')}
      </Link>
    </Section>
  );
}
