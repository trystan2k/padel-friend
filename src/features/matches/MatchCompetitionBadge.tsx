import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { MatchEventDetail } from './match-contracts';

/** Ranked/Unranked status for Competitive events; League identity only when the server returned it. */
export function MatchCompetitionBadge({
  event
}: {
  event: Pick<MatchEventDetail, 'competition_status' | 'league_name'>;
}) {
  const { t } = useTranslation();
  if (!event.competition_status) return null;
  const ranked = event.competition_status === 'ranked';
  return (
    <p>
      <StatusBadge tone={ranked ? 'positive' : 'muted'}>
        {t(`matches.competition.${event.competition_status}`)}
      </StatusBadge>
      {ranked && event.league_name ? ` ${event.league_name}` : ''}
    </p>
  );
}
