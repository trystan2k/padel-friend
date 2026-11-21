import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { ProvisionalBadge } from '../../components/ui/ProvisionalBadge';
import type { ResultPlayer, ResultSetRow } from './match-result-model';
import { matchResultStyles as s } from './match-result.styles';
import { recordResultStyles as r } from './record-match-result.styles';

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
              <span key={player.user_id} {...stylex.props(s.chip, s.chipGap)}>
                {player.display_name ?? t('matches.results.unknownPlayer')}
                {player.is_provisional && <ProvisionalBadge />}
              </span>
            ))}
          </div>
        </section>
      ))}
      {[...teams.team_a, ...teams.team_b].some((player) => player.is_provisional) && (
        <p {...stylex.props(s.copy)}>{t('player.provisional.reviewNote')}</p>
      )}
    </section>
  );
}

export function MatchResultScores({
  sets,
  teamNames
}: {
  sets: ResultSetRow[];
  teamNames: readonly string[];
}) {
  const { t } = useTranslation();
  return (
    <section
      data-result-section="score-summary"
      {...stylex.props(s.card, r.card)}
      aria-label={t('matches.results.setScores')}
    >
      <p {...stylex.props(s.copy)}>
        {t('matches.results.record.matchup', { first: teamNames[0], second: teamNames[1] })}
      </p>
      <p {...stylex.props(r.summaryScore)} aria-hidden="true">
        {sets.map((set) => `${set.team_a_games}–${set.team_b_games}`).join(' · ')}
      </p>
      <ul {...stylex.props(s.srOnly)}>
        {sets.map((set) => (
          <li key={set.position}>
            {t('matches.results.record.setSummary', {
              set: t('matches.results.setNumber', { number: set.position }),
              first: set.team_a_games,
              second: set.team_b_games,
              status: t(
                set.completed
                  ? 'matches.results.setState.complete'
                  : 'matches.results.setState.inProgress'
              )
            })}
          </li>
        ))}
      </ul>
    </section>
  );
}
