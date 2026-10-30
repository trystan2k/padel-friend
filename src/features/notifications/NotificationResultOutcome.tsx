import { useTranslation } from 'react-i18next';
import type { ResultNotificationContext } from './notification-target';

export function NotificationResultOutcome({ context }: { context: ResultNotificationContext }) {
  const { t } = useTranslation();
  const { classification, winner_sets, loser_sets } = context;

  if (!classification) return null;

  if (classification === 'team_a' || classification === 'team_b') {
    if (winner_sets === null || loser_sets === null) return null;

    return (
      <p>
        {t(`matches.results.outcome.${classification}`, {
          winnerSets: winner_sets,
          loserSets: loser_sets
        })}
      </p>
    );
  }

  return <p>{t(`matches.results.outcome.${classification}`)}</p>;
}
