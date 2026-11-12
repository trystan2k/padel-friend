import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PLAYING_DAYS,
  PLAYING_TIMES,
  toggleChoice,
  type PlayingDay,
  type PlayingTime
} from './player-availability';
import { ui } from './player-ui.styles';

type Props = {
  days: readonly PlayingDay[] | null;
  times: readonly PlayingTime[] | null;
  onDaysChange: (next: PlayingDay[] | null) => void;
  onTimesChange: (next: PlayingTime[] | null) => void;
  disabled?: boolean;
};

/**
 * Optional, independent playing-day and time-of-day preferences. Two checkbox groups; no
 * selection means "not provided" (null), never an error. Shared by onboarding and profile edit.
 */
export function AvailabilityFields({
  days,
  times,
  onDaysChange,
  onTimesChange,
  disabled = false
}: Props) {
  const { t } = useTranslation();
  const helpId = useId();
  return (
    <div {...stylex.props(ui.availabilityGroups)}>
      <p id={helpId} {...stylex.props(ui.muted)}>
        {t('profile.availabilityHelp')}
      </p>
      <fieldset aria-describedby={helpId} {...stylex.props(ui.fieldset, ui.bareFieldset)}>
        <legend {...stylex.props(ui.label)}>{t('profile.availabilityDaysLegend')}</legend>
        <div {...stylex.props(ui.availabilityChoices)}>
          {PLAYING_DAYS.map((value) => (
            <AvailabilityChoice
              key={value}
              name="preferred-playing-days"
              value={value}
              label={t(`profile.availabilityDays.${value}`)}
              checked={days?.includes(value) ?? false}
              disabled={disabled}
              onChange={(checked) => onDaysChange(toggleChoice(days, PLAYING_DAYS, value, checked))}
            />
          ))}
        </div>
      </fieldset>
      <fieldset aria-describedby={helpId} {...stylex.props(ui.fieldset, ui.bareFieldset)}>
        <legend {...stylex.props(ui.label)}>{t('profile.availabilityTimesLegend')}</legend>
        <div {...stylex.props(ui.availabilityChoices)}>
          {PLAYING_TIMES.map((value) => (
            <AvailabilityChoice
              key={value}
              name="preferred-playing-times"
              value={value}
              label={t(`profile.availabilityTimes.${value}`)}
              checked={times?.includes(value) ?? false}
              disabled={disabled}
              onChange={(checked) =>
                onTimesChange(toggleChoice(times, PLAYING_TIMES, value, checked))
              }
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

function AvailabilityChoice({
  name,
  value,
  label,
  checked,
  disabled,
  onChange
}: {
  name: string;
  value: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      {...stylex.props(
        ui.availabilityChoice,
        checked && ui.availabilityChoiceSelected,
        disabled && ui.availabilityChoiceDisabled
      )}
    >
      <input
        type="checkbox"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        {...stylex.props(ui.radio)}
      />
      <span
        aria-hidden="true"
        {...stylex.props(ui.availabilityChoiceMark, !checked && ui.availabilityChoiceMarkHidden)}
      >
        ✓
      </span>
      {label}
    </label>
  );
}
