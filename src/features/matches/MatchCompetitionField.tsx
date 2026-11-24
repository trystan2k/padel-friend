import { Switch } from '@base-ui/react/switch';
import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { createMatchStyles as s } from './create-match.styles';
import { formatMatchLeaguePeriod, type MatchCompetitionState } from './match-league-selection';
import type { MatchDraft } from './match-contracts';

type DraftChange = <K extends keyof MatchDraft>(key: K, value: MatchDraft[K]) => void;

/**
 * Ranked switch (frame Switch · Ranked) plus the eligible League selector for a Competitive draft.
 * Switching Ranked off stores the deliberate Unranked choice on the draft; it survives option
 * reloads. While the League list is not ready the switch shows the stored intent, so a player can
 * opt out of Ranked even when the list is loading or failed; it is only locked once the list is
 * ready and no League covers the schedule.
 */
export function MatchCompetitionField({
  competition,
  choice,
  change,
  error
}: {
  competition: MatchCompetitionState;
  choice: MatchDraft['competitionChoice'];
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
  const checked = status === 'ready' ? ranked : choice !== 'unranked';
  const locked = status === 'ready' && !rankedAvailable;
  const leagueSelect = ranked && rankedAvailable;
  return (
    <fieldset
      {...stylex.props(s.group)}
      aria-describedby={`${id}-guidance${error ? ` ${id}-error` : ''}`}
    >
      <legend {...stylex.props(s.hidden)}>{t('matchCreate.competition.legend')}</legend>
      <Switch.Root
        checked={checked}
        disabled={locked}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-meta`}
        aria-invalid={Boolean(error) && !leagueSelect}
        onCheckedChange={(next) => change('competitionChoice', next ? 'ranked' : 'unranked')}
        render={<div />}
        {...stylex.props(stylex.defaultMarker(), s.switchCard)}
      >
        <span {...stylex.props(s.switchText)}>
          <span id={`${id}-title`} {...stylex.props(s.switchTitle)}>
            {t('matches.competition.ranked')}
          </span>
          <span id={`${id}-meta`} {...stylex.props(s.switchMeta)}>
            {resolution.league
              ? t('matchCreate.competition.switchMetaLeague', { league: resolution.league.name })
              : t('matchCreate.competition.switchMeta')}
          </span>
        </span>
        <span aria-hidden="true" {...stylex.props(s.switchTrack)}>
          <Switch.Thumb {...stylex.props(s.switchThumb)} />
        </span>
      </Switch.Root>
      {leagueSelect && (
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
          <p role="alert" {...stylex.props(s.fieldError)}>
            {t('matchCreate.errors.leagueOptionsUnavailable')}
          </p>
          <Button variant="secondary" onClick={competition.retry}>
            {t('matches.retry')}
          </Button>
        </>
      )}
      {error && (
        <span id={`${id}-error`} role="alert" {...stylex.props(s.fieldError)}>
          {t(`matchCreate.errors.${error}`)}
        </span>
      )}
    </fieldset>
  );
}
