import * as stylex from '@stylexjs/stylex';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useTranslation } from 'react-i18next';
import { detailStyles as d } from './notification-detail.styles';
import type { ResultNotificationContext } from './notification-target';

export function NotificationResultOutcome({
  context,
  appearance = 'detail'
}: {
  context: ResultNotificationContext;
  appearance?: 'feed' | 'detail';
}) {
  const { t } = useTranslation();
  const { classification, winner_sets, loser_sets } = context;

  if (!classification) return null;

  const hasWinner = classification === 'team_a' || classification === 'team_b';
  if (hasWinner && (winner_sets === null || loser_sets === null)) return null;

  const label = hasWinner
    ? t(`matches.results.outcome.${classification}`, {
        winnerSets: winner_sets,
        loserSets: loser_sets
      })
    : t(`matches.results.outcome.${classification}`);
  if (appearance === 'feed') return <StatusBadge tone="neutral">{label}</StatusBadge>;
  return <span {...stylex.props(d.chip, hasWinner ? d.chipGreen : d.chipMuted)}>{label}</span>;
}
