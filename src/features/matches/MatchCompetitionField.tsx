import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { createMatchStyles as s } from './create-match.styles';
import { formatMatchLeaguePeriod, type MatchCompetitionState } from './match-league-selection';
import type { MatchDraft } from './match-contracts';

type DraftChange = <K extends keyof MatchDraft>(key: K, value: MatchDraft[K]) => void;

/**
 * Ranked/Unranked control plus the eligible League selector for a Competitive draft.
 * The deliberate Unranked choice is stored on the draft and survives option reloads.
 */
export function MatchCompetitionField({
  competition,
  change,
  error
}: {
  competition: MatchCompetitionState;
  change: DraftChange;
  error?: string;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const { status, candidates, resolution } = competition;
  const ranked = resolution.competition === 'ranked';
  const guidanceKey =
    status === 'idle'
      ? 'scheduleFirst'
      : status === 'loading'
        ? 'loading'
        : status === 'error'
          ? 'unavailable'
          : candidates.length === 0
            ? 'noEligible'
            : candidates.length === 1
              ? 'defaultOne'
              : 'chooseOne';
  const rankedAvailable = status === 'ready' && candidates.length > 0;
  return (
    <fieldset
      {...stylex.props(s.field)}
      aria-describedby={`${id}-guidance${error ? ` ${id}-error` : ''}`}
    >
      <legend>{t('matchCreate.competition.legend')}</legend>
      <label {...stylex.props(s.touchLabel)}>
        <input
          type="radio"
          name={`${id}-competition`}
          checked={ranked}
          disabled={!rankedAvailable}
          onChange={() => change('competitionChoice', 'ranked')}
        />
        {t('matches.competition.ranked')}
      </label>
      <label {...stylex.props(s.touchLabel)}>
        <input
          type="radio"
          name={`${id}-competition`}
          checked={!ranked}
          onChange={() => change('competitionChoice', 'unranked')}
        />
        {t('matches.competition.unranked')}
      </label>
      {ranked && rankedAvailable && (
        <label {...stylex.props(s.field)}>
          {t('matchCreate.competition.league')}
          <select
            {...stylex.props(s.input)}
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
      <p id={`${id}-guidance`} {...stylex.props(s.muted)}>
        {t(`matchCreate.competition.guidance.${guidanceKey}`)}{' '}
        {t('matchCreate.competition.members')}
      </p>
      {status === 'error' && (
        <>
          <p role="alert">{t('matchCreate.errors.leagueOptionsUnavailable')}</p>
          <button type="button" {...stylex.props(s.button)} onClick={competition.retry}>
            {t('matches.retry')}
          </button>
        </>
      )}
      {error && (
        <span id={`${id}-error`} role="alert">
          {t(`matchCreate.errors.${error}`)}
        </span>
      )}
    </fieldset>
  );
}
