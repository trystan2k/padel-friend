import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { competitionEffect, type MatchCompetitionSide } from './match-consent-change';
import { formatMatchLeaguePeriod } from './match-league-selection';
import { matchLeagueImpactStyles as s } from './match-league-impact.styles';

/**
 * Before/after Ranked status and League (name + window) of a change, with its effect.
 * Shared by the edit dialog, the participant reconfirmation review and the organizer summary.
 */
export function MatchLeagueImpact({
  from,
  to
}: {
  from: MatchCompetitionSide;
  to: MatchCompetitionSide;
}) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const side = (value: MatchCompetitionSide) => {
    const status = value.status
      ? t(`matches.competition.${value.status}`)
      : t('matches.type.friendly');
    if (!value.leagueName) return status;
    const period = value.window ? ` (${formatMatchLeaguePeriod(value.window, i18n.language)})` : '';
    return `${status} · ${value.leagueName}${period}`;
  };
  return (
    <section aria-labelledby={headingId} {...stylex.props(s.panel)}>
      <h3 id={headingId} {...stylex.props(s.title)}>
        {t('matches.leagueImpact.title')}
      </h3>
      <dl {...stylex.props(s.list)}>
        <div {...stylex.props(s.row)}>
          <dt {...stylex.props(s.term)}>{t('matches.leagueImpact.before')}</dt>
          <dd {...stylex.props(s.value)}>{side(from)}</dd>
        </div>
        <div {...stylex.props(s.row)}>
          <dt {...stylex.props(s.term)}>{t('matches.leagueImpact.after')}</dt>
          <dd {...stylex.props(s.value)}>{side(to)}</dd>
        </div>
      </dl>
      <p {...stylex.props(s.note)}>
        {t(`matches.leagueImpact.effect.${competitionEffect(from, to)}`)}
      </p>
      <p {...stylex.props(s.note)}>{t('matches.leagueImpact.skillIndependent')}</p>
    </section>
  );
}
