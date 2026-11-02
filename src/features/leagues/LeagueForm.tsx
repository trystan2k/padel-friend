import { Field } from '@base-ui/react/field';
import { Radio } from '@base-ui/react/radio';
import { RadioGroup } from '@base-ui/react/radio-group';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import {
  LEAGUE_DESCRIPTION_MAX,
  LEAGUE_MINIMUM_MATCHES_MAX,
  LEAGUE_MINIMUM_MATCHES_MIN,
  LEAGUE_NAME_MAX,
  type LeagueErrorCode
} from './league-contracts';
import {
  LEAGUE_FORM_FIELD_ORDER,
  formatLeagueDay,
  leagueFormFieldForError,
  validateLeagueForm,
  type LeagueFormErrors,
  type LeagueFormField,
  type LeagueFormInput,
  type LeagueFormValues
} from './league-form';
import { styles } from './league.styles';

export type LeagueFormProps = {
  initialValues: LeagueFormValues;
  /** Community-local today (`YYYY-MM-DD`): the earliest allowed start date. */
  today: string;
  submitLabel: string;
  submittingLabel: string;
  /** Start date is exempt from the not-in-the-past rule when unchanged (edited Leagues). */
  originalStartDate?: string;
  /** Start/end mode/end can no longer change (League closed or referenced by events). */
  periodLocked?: boolean;
  /** Only the start date is frozen (an Active League has already started). */
  startLocked?: boolean;
  /** Returns the server rejection, or null on success. */
  onSubmit: (input: LeagueFormInput) => Promise<LeagueErrorCode | null>;
};

const fieldId = (base: string, field: LeagueFormField) => `${base}-${field}`;

export function LeagueForm({
  initialValues,
  today,
  submitLabel,
  submittingLabel,
  originalStartDate,
  periodLocked = false,
  startLocked = false,
  onSubmit
}: LeagueFormProps) {
  const { t, i18n } = useTranslation();
  const base = useId();
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<LeagueFormErrors>({});
  const [formError, setFormError] = useState<LeagueErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{
    field: LeagueFormField;
    nonce: number;
  } | null>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!focusRequest) return;
    document.getElementById(fieldId(base, focusRequest.field))?.focus();
  }, [base, focusRequest]);
  useEffect(() => {
    if (formError) formErrorRef.current?.focus();
  }, [formError]);

  const update = <K extends keyof LeagueFormValues>(key: K, value: LeagueFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFormError(null);
    if (key !== 'endMode')
      setErrors((current) => {
        const { [key]: _removed, ...rest } = current;
        return rest;
      });
  };
  const focusFirstInvalid = (found: LeagueFormErrors) => {
    const first = LEAGUE_FORM_FIELD_ORDER.find((field) => found[field]);
    if (first) setFocusRequest({ field: first, nonce: Date.now() });
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const result = validateLeagueForm(values, today, originalStartDate);
    setErrors(result.errors);
    setFormError(null);
    if (!result.input) {
      focusFirstInvalid(result.errors);
      return;
    }
    setBusy(true);
    try {
      const code = await onSubmit(result.input);
      if (!code) return;
      const mapped = leagueFormFieldForError(code);
      if (mapped) {
        const found = { [mapped.field]: mapped.key } satisfies LeagueFormErrors;
        setErrors(found);
        focusFirstInvalid(found);
      } else setFormError(code);
    } finally {
      setBusy(false);
    }
  };

  const errorText = (field: LeagueFormField) =>
    errors[field] ? t(`leagues.form.errors.${errors[field]}`) : undefined;
  const dateLocale = i18n.language;
  const summary =
    values.startDate && (values.endMode === 'manual' || values.endDate)
      ? values.endMode === 'manual'
        ? t('leagues.form.summaryManual', { start: formatLeagueDay(values.startDate, dateLocale) })
        : t('leagues.form.summaryFixed', {
            start: formatLeagueDay(values.startDate, dateLocale),
            end: formatLeagueDay(values.endDate, dateLocale)
          })
      : null;
  const descriptionId = fieldId(base, 'description');

  return (
    <form noValidate onSubmit={submit} {...stylex.props(styles.content)}>
      <SurfaceCard xstyle={styles.card}>
        <TextField
          id={fieldId(base, 'name')}
          label={t('leagues.form.nameLabel')}
          placeholder={t('leagues.form.namePlaceholder')}
          value={values.name}
          maxLength={LEAGUE_NAME_MAX * 2}
          autoComplete="off"
          required
          error={errorText('name')}
          onChange={(event) => update('name', event.target.value)}
        />
        <Field.Root invalid={Boolean(errors.description)} {...stylex.props(styles.fieldset)}>
          <Field.Label htmlFor={descriptionId} {...stylex.props(styles.legend)}>
            {t('leagues.form.descriptionLabel')}
          </Field.Label>
          <Field.Control
            render={
              <textarea
                id={descriptionId}
                rows={3}
                value={values.description}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={errors.description ? `${descriptionId}-error` : undefined}
                maxLength={LEAGUE_DESCRIPTION_MAX * 2}
                onChange={(event) => update('description', event.target.value)}
                {...stylex.props(styles.textarea)}
              />
            }
          />
          {errors.description && (
            <Field.Error
              id={`${descriptionId}-error`}
              match
              role="alert"
              {...stylex.props(styles.errorText)}
            >
              {errorText('description')}
            </Field.Error>
          )}
        </Field.Root>
      </SurfaceCard>

      <SurfaceCard xstyle={styles.datesCard}>
        <fieldset {...stylex.props(styles.fieldset)} disabled={periodLocked}>
          <legend {...stylex.props(styles.legend)}>{t('leagues.form.endModeLegend')}</legend>
          <RadioGroup
            name="end_mode"
            value={values.endMode}
            disabled={periodLocked}
            aria-label={t('leagues.form.endModeLegend')}
            onValueChange={(value) => update('endMode', value)}
            {...stylex.props(styles.modeGroup)}
          >
            {(['fixed_date', 'manual'] as const).map((mode) => (
              <label
                key={mode}
                htmlFor={`${base}-mode-${mode}`}
                {...stylex.props(
                  styles.mode,
                  values.endMode === mode && styles.modeSelected,
                  periodLocked && styles.modeDisabled
                )}
              >
                <Radio.Root
                  id={`${base}-mode-${mode}`}
                  value={mode}
                  {...stylex.props(styles.radio)}
                />
                <span {...stylex.props(styles.modeText)}>
                  <span {...stylex.props(styles.modeTitle)}>{t(`leagues.form.mode.${mode}`)}</span>
                  <span {...stylex.props(styles.modeHelp)}>
                    {t(`leagues.form.mode.${mode}Help`)}
                  </span>
                </span>
              </label>
            ))}
          </RadioGroup>
          <TextField
            id={fieldId(base, 'startDate')}
            type="date"
            label={t('leagues.form.startDateLabel')}
            value={values.startDate}
            min={originalStartDate && originalStartDate < today ? undefined : today}
            disabled={periodLocked || startLocked}
            required
            error={errorText('startDate')}
            onChange={(event) => update('startDate', event.target.value)}
          />
          {values.endMode === 'fixed_date' && (
            <TextField
              id={fieldId(base, 'endDate')}
              type="date"
              label={t('leagues.form.endDateLabel')}
              helper={t('leagues.form.endDateHelp')}
              value={values.endDate}
              min={values.startDate || today}
              disabled={periodLocked}
              required
              error={errorText('endDate')}
              onChange={(event) => update('endDate', event.target.value)}
            />
          )}
          {summary && <p {...stylex.props(styles.summary)}>{summary}</p>}
          {periodLocked && <p {...stylex.props(styles.muted)}>{t('leagues.form.periodLocked')}</p>}
        </fieldset>
      </SurfaceCard>

      <SurfaceCard xstyle={styles.card}>
        <TextField
          id={fieldId(base, 'minimumMatches')}
          type="number"
          inputMode="numeric"
          label={t('leagues.form.minimumLabel')}
          helper={t('leagues.form.minimumHelp')}
          min={LEAGUE_MINIMUM_MATCHES_MIN}
          max={LEAGUE_MINIMUM_MATCHES_MAX}
          value={values.minimumMatches}
          required
          error={errorText('minimumMatches')}
          onChange={(event) => update('minimumMatches', event.target.value)}
        />
      </SurfaceCard>

      {formError && (
        <p ref={formErrorRef} role="alert" tabIndex={-1} {...stylex.props(styles.errorText)}>
          {t(`leagues.errors.${formError}`)}
        </p>
      )}
      <Button type="submit" size="large" busy={busy}>
        {busy ? submittingLabel : submitLabel}
      </Button>
    </form>
  );
}
