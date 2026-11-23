import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchCreationOptions, MatchDraft } from './match-contracts';
import { createMatchStyles as s } from './create-match.styles';
import { MatchChoiceGroup } from './MatchChoiceGroup';
import { MatchDetailTextField } from './MatchDetailsForm';

type DraftChange = <K extends keyof MatchDraft>(key: K, value: MatchDraft[K]) => void;

const registrations = [
  'community_open',
  'invite_only'
] as const satisfies readonly MatchDraft['visibility'][];
// Frame Format presets: one group plays four players, so each preset is a real maximum registrations value.
const formatGroups = [1, 2, 3] as const;
const placesPerGroup = 4;
const customFormat = 'custom';

/**
 * Wizard step 2 controls (frame vAxZh) over the real draft fields: Format presets and the exact
 * Maximum registrations input are one field (maximumRegistrations); Registration is the draft
 * visibility; Level range chips and the minimum/maximum inputs are the level restriction and range.
 */
export function MatchPlayersForm({
  value,
  change,
  levelDefaults,
  errors
}: {
  value: MatchDraft;
  change: DraftChange;
  levelDefaults: MatchCreationOptions['level_defaults'];
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const [customLevel, setCustomLevel] = useState(false);
  const suggested =
    levelDefaults?.min == null || levelDefaults.max == null
      ? null
      : { min: String(levelDefaults.min), max: String(levelDefaults.max) };
  const levelMode = !value.levelRestriction
    ? 'any'
    : !customLevel && suggested?.min === value.minLevel && suggested.max === value.maxLevel
      ? 'suggested'
      : 'custom';
  const formatValue =
    value.maximumRegistrations === ''
      ? customFormat
      : (formatGroups
          .find((groups) => String(groups * placesPerGroup) === value.maximumRegistrations)
          ?.toString() ?? customFormat);
  const rangeLabel = (min: string, max: string) =>
    `${Number(min).toFixed(1)}–${Number(max).toFixed(1)}`;

  return (
    <div {...stylex.props(s.fields)}>
      <MatchChoiceGroup
        variant="segmented"
        legend={t('matchCreate.players.format')}
        value={formatValue}
        choices={formatGroups.map((groups) => ({
          value: String(groups),
          label: t('matchCreate.players.formatGroups', {
            count: groups,
            places: groups * placesPerGroup
          })
        }))}
        onChange={(next) => {
          const groups = formatGroups.find((candidate) => String(candidate) === next);
          if (groups) change('maximumRegistrations', String(groups * placesPerGroup));
        }}
      />
      <MatchDetailTextField
        name="maximumRegistrations"
        type="number"
        value={value.maximumRegistrations}
        onChange={(next) => change('maximumRegistrations', next)}
        error={errors.maximumRegistrations}
        constraints={{ min: 1, step: 1 }}
      />
      <p {...stylex.props(s.muted)}>{t('matchCreate.players.formatHelp')}</p>
      <MatchChoiceGroup
        variant="segmented"
        legend={t('matchCreate.players.registration')}
        value={value.visibility}
        choices={registrations.map((visibility) => ({
          value: visibility,
          label: t(`matchCreate.players.registrationOptions.${visibility}`)
        }))}
        onChange={(next) => {
          const selected = registrations.find((candidate) => candidate === next);
          if (selected) change('visibility', selected);
        }}
      />
      <p {...stylex.props(s.muted)}>
        {t(`matchCreate.players.registrationHelp.${value.visibility}`)}
      </p>
      <MatchChoiceGroup
        variant="chips"
        legend={t('matchCreate.players.levelRange')}
        value={levelMode}
        choices={[
          { value: 'any', label: t('matchCreate.players.anyLevel') },
          ...(suggested
            ? [{ value: 'suggested', label: rangeLabel(suggested.min, suggested.max) }]
            : []),
          { value: 'custom', label: t('matchCreate.players.customRange') }
        ]}
        onChange={(next) => {
          if (next === 'any') {
            setCustomLevel(false);
            change('levelRestriction', false);
          } else if (next === 'suggested' && suggested) {
            setCustomLevel(false);
            change('levelRestriction', true);
            change('minLevel', suggested.min);
            change('maxLevel', suggested.max);
          } else {
            setCustomLevel(true);
            change('levelRestriction', true);
          }
        }}
      />
      {value.levelRestriction && (
        <div {...stylex.props(s.levels)}>
          <MatchDetailTextField
            name="minLevel"
            type="number"
            value={value.minLevel}
            onChange={(next) => change('minLevel', next)}
            error={errors.minLevel}
            constraints={{ step: 0.5, min: 0, max: 7 }}
          />
          <MatchDetailTextField
            name="maxLevel"
            type="number"
            value={value.maxLevel}
            onChange={(next) => change('maxLevel', next)}
            error={errors.maxLevel}
            constraints={{ step: 0.5, min: 0, max: 7 }}
          />
        </div>
      )}
    </div>
  );
}
