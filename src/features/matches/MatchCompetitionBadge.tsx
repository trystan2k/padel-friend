import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { MatchEventDetail } from './match-contracts';
import { matchListStyles as s } from './match-list.styles';

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
    <p {...stylex.props(s.chips)}>
      <StatusBadge tone={ranked ? 'neutral' : 'muted'} xstyle={ranked ? s.accentChip : undefined}>
        {t(`matches.competition.${event.competition_status}`)}
      </StatusBadge>
      {ranked && event.league_name ? (
        <span {...stylex.props(s.chipNote)}>{event.league_name}</span>
      ) : null}
    </p>
  );
}
