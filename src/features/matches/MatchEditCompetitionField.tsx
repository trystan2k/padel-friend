import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { createMatchStyles as create } from './create-match.styles';
import { matchEditStyles as edit } from './match-edit.styles';
import { formatMatchLeaguePeriod, type MatchCompetitionState } from './match-league-selection';
import type { MatchEditDraft } from './match-management-edit';
import { matchManagementStyles as s } from './match-management.styles';

/**
 * Ranked/Unranked choice plus League select of the edit dialog. The current League stays
 * selectable even when the options reader no longer lists it (e.g. closed after booking): the
 * server decides; this control never downgrades the event on its own.
 */
export function MatchEditCompetitionField({
  competition,
  change,
  error
}: {
  competition: MatchCompetitionState;
  change: <K extends 'competitionChoice' | 'leagueId'>(key: K, value: MatchEditDraft[K]) => void;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { status, candidates, resolution } = competition;
  const ranked = resolution.competition === 'ranked';
  const rankedAvailable = candidates.length > 0;
  const guidanceKey =
    status === 'loading'
      ? 'loading'
      : status === 'error'
        ? 'unavailable'
        : candidates.length === 0
          ? 'noEligible'
          : 'members';
  return (
    <fieldset
      {...stylex.props(edit.field)}
      aria-describedby={`${id}-guidance${error ? ` ${id}-error` : ''}`}
    >
      <legend>{t('matchCreate.competition.legend')}</legend>
      <label {...stylex.props(create.touchLabel)}>
        <input
          type="radio"
          name={`${id}-competition`}
          checked={ranked}
          disabled={!rankedAvailable}
          onChange={() => change('competitionChoice', 'ranked')}
        />
        {t('matches.competition.ranked')}
      </label>
      <label {...stylex.props(create.touchLabel)}>
        <input
          type="radio"
          name={`${id}-competition`}
          checked={!ranked}
          onChange={() => change('competitionChoice', 'unranked')}
        />
        {t('matches.competition.unranked')}
      </label>
      {ranked && rankedAvailable && (
        <label {...stylex.props(edit.field)}>
          {t('matchCreate.competition.league')}
          <select
            {...stylex.props(s.input, edit.input)}
            value={resolution.league?.id ?? ''}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              change('competitionChoice', 'ranked');
              change('leagueId', event.currentTarget.value);
            }}
          >
            {resolution.league === null && (
              <option value="">{t('matchCreate.competition.choose')}</option>
            )}
            {candidates.map((league) => (
              <option key={league.id} value={league.id}>
                {league.name} · {formatMatchLeaguePeriod(league, i18n.language)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p id={`${id}-guidance`} {...stylex.props(edit.copy)}>
        {t(`matches.management.edit.competition.${guidanceKey}`)}
      </p>
      {error && (
        <span id={`${id}-error`} role="alert">
          {t(`matchCreate.errors.${error}`)}
        </span>
      )}
    </fieldset>
  );
}
