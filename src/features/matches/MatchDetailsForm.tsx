import * as stylex from '@stylexjs/stylex';
import { useId, useState, type HTMLInputTypeAttribute, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchCreationOptions, MatchDraft } from './match-contracts';
import { createMatchStyles as s } from './create-match.styles';
import { matchEditStyles as edit } from './match-edit.styles';
import { MatchChoiceGroup } from './MatchChoiceGroup';
import { MatchCompetitionField } from './MatchCompetitionField';
import { matchDatePresets } from './match-date-presets';
import type { MatchCompetitionState } from './match-league-selection';

type TextField =
  | 'date'
  | 'startTime'
  | 'venueName'
  | 'mapsUrl'
  | 'courtNotes'
  | 'duration'
  | 'notes'
  | 'minLevel'
  | 'maxLevel'
  | 'price'
  | 'paymentNote'
  | 'maximumRegistrations'
  | 'cutoff';
type DraftChange = <K extends keyof MatchDraft>(key: K, value: MatchDraft[K]) => void;

const eventTypes = ['friendly', 'competitive'] as const satisfies readonly MatchDraft['type'][];
const currencies = ['BRL', 'USD', 'EUR'] as const satisfies readonly MatchDraft['currency'][];

export function MatchDetailTextField({
  name,
  value,
  onChange,
  error,
  type = 'text',
  constraints = {},
  fieldStyle,
  inputStyle,
  placeholder
}: {
  name: TextField | 'startsAt';
  value: string;
  onChange: (value: string) => void;
  error?: string;
  type?: HTMLInputTypeAttribute;
  constraints?: Pick<InputHTMLAttributes<HTMLInputElement>, 'min' | 'max' | 'step'>;
  fieldStyle?: stylex.StyleXStyles;
  inputStyle?: stylex.StyleXStyles;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <label {...stylex.props(fieldStyle ? edit.sharedField : s.field, fieldStyle)}>
      {t(`matchCreate.fields.${name}`)}
      <input
        {...stylex.props(inputStyle ? edit.sharedInput : s.input, inputStyle)}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...constraints}
      />
      {error && (
        <span id={`${id}-error`} role="alert" {...stylex.props(!fieldStyle && s.fieldError)}>
          {t(`matchCreate.errors.${error}`)}
        </span>
      )}
    </label>
  );
}
export function MatchDetailCurrencyField({
  value,
  onChange,
  error,
  fieldStyle,
  inputStyle
}: {
  value: MatchDraft['currency'];
  onChange: (value: MatchDraft['currency']) => void;
  error?: string;
  fieldStyle?: stylex.StyleXStyles;
  inputStyle?: stylex.StyleXStyles;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <label {...stylex.props(fieldStyle ? edit.sharedField : s.field, fieldStyle)}>
      {t('matchCreate.fields.currency')}
      <select
        {...stylex.props(inputStyle ? edit.sharedInput : s.input, inputStyle)}
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          const selected = currencies.find((candidate) => candidate === event.currentTarget.value);
          if (selected) onChange(selected);
        }}
      >
        {currencies.map((currency) => (
          <option key={currency}>{currency}</option>
        ))}
      </select>
      {error && (
        <span id={`${id}-error`} role="alert" {...stylex.props(!fieldStyle && s.fieldError)}>
          {t(`matchCreate.errors.${error}`)}
        </span>
      )}
    </label>
  );
}

function fieldValue(value: MatchDraft, key: TextField): string {
  return value[key];
}

export function MatchDetailsForm({
  value,
  change,
  options,
  errors,
  competition
}: {
  value: MatchDraft;
  change: DraftChange;
  options: MatchCreationOptions;
  errors: Record<string, string>;
  competition: MatchCompetitionState;
}) {
  const { t, i18n } = useTranslation();
  // Presets are relative to the moment the step mounts; the date input covers every other day.
  const [now] = useState(Date.now);
  const field = (
    key: TextField,
    type: HTMLInputTypeAttribute = 'text',
    constraints: Pick<InputHTMLAttributes<HTMLInputElement>, 'min' | 'max' | 'step'> = {}
  ) => (
    <MatchDetailTextField
      key={key}
      name={key}
      type={type}
      value={fieldValue(value, key)}
      onChange={(next) => change(key, next)}
      error={errors[key]}
      constraints={constraints}
    />
  );
  const community = options.communities.find((item) => item.id === value.community_id);
  const datePresets = matchDatePresets(now, community?.timezone ?? 'UTC', i18n.language);

  return (
    <div {...stylex.props(s.fields)}>
      <label {...stylex.props(s.field)}>
        {t('matchCreate.fields.community')}
        <select
          {...stylex.props(s.input)}
          value={value.community_id}
          onChange={(event) => change('community_id', event.currentTarget.value)}
        >
          {options.communities.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <MatchChoiceGroup
        variant="segmented"
        legend={t('matchCreate.fields.type')}
        value={value.type}
        choices={eventTypes.map((type) => ({ value: type, label: t(`matches.type.${type}`) }))}
        onChange={(next) => {
          const selected = eventTypes.find((candidate) => candidate === next);
          if (selected) change('type', selected);
        }}
      />
      {value.type === 'competitive' && (
        <MatchCompetitionField
          competition={competition}
          choice={value.competitionChoice}
          change={change}
          error={errors.competition}
        />
      )}
      {datePresets.length > 0 && (
        <MatchChoiceGroup
          variant="chips"
          legend={t('matchCreate.helpers.suggestedDays')}
          value={value.date}
          choices={datePresets.map((preset) => ({ value: preset.date, label: preset.label }))}
          onChange={(next) => change('date', next)}
        />
      )}
      {field('date', 'date')}
      <p {...stylex.props(s.muted)}>
        {t('matchCreate.fields.timezone')}: {community?.timezone ?? ''}
      </p>
      <div {...stylex.props(s.pair)}>
        {field('startTime', 'time')}
        {field('price', 'number', { min: 0, step: '0.01' })}
      </div>
      <MatchDetailCurrencyField
        value={value.currency}
        onChange={(next) => change('currency', next)}
        error={errors.currency}
      />
      <label {...stylex.props(s.field)}>
        {t('matchCreate.fields.savedVenue')}
        <select
          {...stylex.props(s.input)}
          value={value.savedVenue}
          onChange={(event) => change('savedVenue', event.currentTarget.value)}
        >
          <option value="">{t('matchCreate.helpers.optional')}</option>
          {options.saved_venues.map((venue) => (
            <option key={venue.id} value={venue.id}>
              {venue.name}
            </option>
          ))}
        </select>
      </label>
      {field('venueName')}
      {field('mapsUrl', 'url')}
      {field('courtNotes')}
      {field('duration', 'number', { min: 1, step: 1 })}
      {field('notes')}
      <label {...stylex.props(s.touchLabel)}>
        <input
          type="checkbox"
          {...stylex.props(s.check)}
          checked={value.courtBooked}
          onChange={(event) => change('courtBooked', event.currentTarget.checked)}
        />
        {t('matchCreate.fields.courtBooked')}
      </label>
      {field('paymentNote')}
      {field('cutoff', 'datetime-local')}
    </div>
  );
}
