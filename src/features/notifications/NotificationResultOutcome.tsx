import { StatusBadge } from '../../components/ui/StatusBadge';
import { useTranslation } from 'react-i18next';
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
  return appearance === 'feed' ? <StatusBadge tone="neutral">{label}</StatusBadge> : <p>{label}</p>;
}
