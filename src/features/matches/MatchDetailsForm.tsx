import * as stylex from '@stylexjs/stylex';
import { useId, type HTMLInputTypeAttribute, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchCreationOptions, MatchDraft } from './match-contracts';
import { createMatchStyles as s } from './create-match.styles';

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

const eventTypes = ['competitive', 'friendly'] as const satisfies readonly MatchDraft['type'][];
const visibilities = [
  'community_open',
  'invite_only'
] as const satisfies readonly MatchDraft['visibility'][];
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
    <label {...stylex.props(s.field, fieldStyle)}>
      {t(`matchCreate.fields.${name}`)}
      <input
        {...stylex.props(s.input, inputStyle)}
        placeholder={placeholder}
        type={type}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        {...constraints}
      />
      {error && (
        <span id={`${id}-error`} role="alert">
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
    <label {...stylex.props(s.field, fieldStyle)}>
      {t('matchCreate.fields.currency')}
      <select
        {...stylex.props(s.input, inputStyle)}
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
        <span id={`${id}-error`} role="alert">
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
  errors
}: {
  value: MatchDraft;
  change: DraftChange;
  options: MatchCreationOptions;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
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
  const enumSelect = <K extends 'type' | 'visibility'>(
    key: K,
    values: readonly MatchDraft[K][]
  ) => (
    <label key={key} {...stylex.props(s.field)}>
      {t(`matchCreate.fields.${key}`)}
      <select
        {...stylex.props(s.input)}
        value={value[key]}
        onChange={(event) => {
          const selected = values.find((candidate) => candidate === event.currentTarget.value);
          if (selected !== undefined) change(key, selected);
        }}
      >
        {values.map((option) => (
          <option key={option} value={option}>
            {t(`matches.${key === 'type' ? 'type' : 'visibility'}.${option}`)}
          </option>
        ))}
      </select>
    </label>
  );
  const community = options.communities.find((item) => item.id === value.community_id);

  return (
    <div {...stylex.props(s.fields, s.section)}>
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
      {field('date', 'date')}
      {field('startTime', 'time')}
      <p>
        {t('matchCreate.fields.timezone')}: {community?.timezone ?? ''}
      </p>
      {enumSelect('type', eventTypes)}
      {enumSelect('visibility', visibilities)}
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
      <fieldset>
        <legend>{t('matchCreate.fields.levelRestriction')}</legend>
        <label {...stylex.props(s.touchLabel)}>
          <input
            type="checkbox"
            checked={value.levelRestriction}
            onChange={(event) => change('levelRestriction', event.currentTarget.checked)}
          />
          {t('matchCreate.fields.levelRestriction')}
        </label>
        {value.levelRestriction && (
          <div {...stylex.props(s.row)}>
            {field('minLevel', 'number', { step: 0.5, min: 0, max: 7 })}
            {field('maxLevel', 'number', { step: 0.5, min: 0, max: 7 })}
          </div>
        )}
      </fieldset>
      <label {...stylex.props(s.touchLabel)}>
        <input
          type="checkbox"
          checked={value.courtBooked}
          onChange={(event) => change('courtBooked', event.currentTarget.checked)}
        />
        {t('matchCreate.fields.courtBooked')}
      </label>
      {field('price', 'number', { min: 0, step: '0.01' })}
      <MatchDetailCurrencyField
        value={value.currency}
        onChange={(next) => change('currency', next)}
        error={errors.currency}
      />
      {field('paymentNote')}
      {field('maximumRegistrations', 'number', { min: 1, step: 1 })}
      {field('cutoff', 'datetime-local')}
    </div>
  );
}
