import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import type { ResultPlayer, ResultSetRow } from './match-result-model';
import { matchResultStyles as s } from './match-result.styles';

export function resultSetWins(sets: ResultSetRow[]) {
  return {
    team_a: sets.filter((set) => set.completed && set.team_a_games > set.team_b_games).length,
    team_b: sets.filter((set) => set.completed && set.team_b_games > set.team_a_games).length
  };
}

export function MatchResultTeams({
  teams
}: {
  teams: { team_a: readonly ResultPlayer[]; team_b: readonly ResultPlayer[] };
}) {
  const { t } = useTranslation();
  return (
    <section {...stylex.props(s.card, s.teamCard)} aria-label={t('matches.results.confirmPlayers')}>
      <h2 {...stylex.props(s.heading)}>{t('matches.results.confirmPlayers')}</h2>
      {(['team_a', 'team_b'] as const).map((side) => (
        <section key={side} {...stylex.props(s.teamGroup)}>
          <h3 {...stylex.props(s.label)}>{t(`matches.results.teams.${side}`)}</h3>
          <div {...stylex.props(s.row, s.chipRow)}>
            {teams[side].map((player) => (
              <span key={player.user_id} {...stylex.props(s.chip)}>
                {player.display_name ?? t('matches.results.unknownPlayer')}
              </span>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}

export function MatchResultScores({ sets }: { sets: ResultSetRow[] }) {
  const { t } = useTranslation();
  return (
    <section {...stylex.props(s.card)} aria-label={t('matches.results.setScores')}>
      <h2 {...stylex.props(s.heading)}>{t('matches.results.setScores')}</h2>
      {[1, 2, 3].map((position) => {
        const set = sets.find((row) => row.position === position);
        return (
          <div key={position} {...stylex.props(s.scoreRow)}>
            <span {...stylex.props(s.label)}>
              {t('matches.results.setNumber', { number: position })}
            </span>
            <span {...stylex.props(s.scoreValue)}>{set?.team_a_games ?? '—'}</span>
            <span aria-hidden="true" {...stylex.props(s.copy)}>
              —
            </span>
            <span {...stylex.props(s.scoreValue)}>{set?.team_b_games ?? '—'}</span>
            <span {...stylex.props(s.statePill, set?.completed ? s.positive : s.neutral)}>
              {t(
                set
                  ? set.completed
                    ? 'matches.results.setState.complete'
                    : 'matches.results.setState.inProgress'
                  : 'matches.results.setState.notPlayed'
              )}
            </span>
          </div>
        );
      })}
    </section>
  );
}
