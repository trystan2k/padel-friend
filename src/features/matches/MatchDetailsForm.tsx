import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { createMatchStyles as s } from './create-match.styles';

export type Draft = Record<string, any>;
export function MatchDetailsForm({
  value,
  change,
  options,
  errors
}: {
  value: Draft;
  change: (key: string, value: unknown) => void;
  options: any;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const field = (key: string, type = 'text', extra: Record<string, unknown> = {}) => (
    <label {...stylex.props(s.field)} key={key}>
      {t(`matchCreate.fields.${key}`)}
      <input
        {...stylex.props(s.input)}
        type={type}
        value={value[key] ?? ''}
        onChange={(event) => change(key, event.target.value)}
        aria-invalid={Boolean(errors[key])}
        aria-describedby={errors[key] ? `${key}-error` : undefined}
        {...extra}
      />
      {errors[key] && (
        <span id={`${key}-error`} role="alert">
          {t(`matchCreate.errors.${errors[key]}`)}
        </span>
      )}
    </label>
  );
  return (
    <div {...stylex.props(s.fields)}>
      <label {...stylex.props(s.field)}>
        {t('matchCreate.fields.community')}
        <select
          {...stylex.props(s.input)}
          value={value.community_id ?? ''}
          onChange={(e) => change('community_id', e.target.value)}
        >
          {options.communities.map((c: any) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {field('date', 'date')}
      {field('startTime', 'time')}
      <p>
        {t('matchCreate.fields.timezone')}:{' '}
        {options.communities.find((c: any) => c.id === value.community_id)?.timezone ?? ''}
      </p>
      {(['type', 'visibility'] as const).map((key) => (
        <label key={key} {...stylex.props(s.field)}>
          {t(`matchCreate.fields.${key}`)}
          <select
            {...stylex.props(s.input)}
            value={value[key] ?? (key === 'type' ? 'friendly' : 'community_open')}
            onChange={(e) => change(key, e.target.value)}
          >
            {(key === 'type' ? ['competitive', 'friendly'] : ['community_open', 'invite_only']).map(
              (v) => (
                <option key={v} value={v}>
                  {t(`matches.${key === 'type' ? 'type' : 'visibility'}.${v}`)}
                </option>
              )
            )}
          </select>
        </label>
      ))}
      <label {...stylex.props(s.field)}>
        {t('matchCreate.fields.savedVenue')}
        <select
          {...stylex.props(s.input)}
          value={value.savedVenue ?? ''}
          onChange={(e) => change('savedVenue', e.target.value)}
        >
          <option value="">{t('matchCreate.helpers.optional')}</option>
          {options.saved_venues.map((venue: any) => (
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
        <label>
          <input
            type="checkbox"
            checked={value.levelRestriction !== false}
            onChange={(e) => change('levelRestriction', e.target.checked)}
          />
          {t('matchCreate.fields.levelRestriction')}
        </label>
        {value.levelRestriction !== false && (
          <div {...stylex.props(s.row)}>
            {field('minLevel', 'number', { step: 0.5, min: 0, max: 7 })}
            {field('maxLevel', 'number', { step: 0.5, min: 0, max: 7 })}
          </div>
        )}
      </fieldset>
      <label {...stylex.props(s.field)}>
        <input
          type="checkbox"
          checked={Boolean(value.courtBooked)}
          onChange={(e) => change('courtBooked', e.target.checked)}
        />
        {t('matchCreate.fields.courtBooked')}
      </label>
      {field('price', 'number', { min: 0, step: '0.01' })}
      <label {...stylex.props(s.field)}>
        {t('matchCreate.fields.currency')}
        <select
          {...stylex.props(s.input)}
          aria-invalid={Boolean(errors.currency)}
          aria-describedby={errors.currency ? 'currency-error' : undefined}
          value={value.currency ?? 'EUR'}
          onChange={(e) => change('currency', e.target.value)}
        >
          {['BRL', 'USD', 'EUR'].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {errors.currency && (
          <span id="currency-error" role="alert">
            {t(`matchCreate.errors.${errors.currency}`)}
          </span>
        )}
      </label>
      {field('paymentNote')}
      {field('maximumRegistrations', 'number', { min: 1, step: 1 })}
      {field('cutoff', 'datetime-local')}
    </div>
  );
}
