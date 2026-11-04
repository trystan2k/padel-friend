import { Collapsible } from '@base-ui/react/collapsible';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { MAX_LEVEL, MIN_LEVEL } from '../player/rating-config';
import { formatLevel, formatPercentPoints } from '../player/rating-format';
import { RatingError } from '../player/RatingError';
import { LEVEL_REVIEW_EVIDENCE_MAX, LEVEL_REVIEW_TEXT_MAX } from './level-review-contracts';
import { levelReviewErrorCode } from './level-review-errors';
import {
  codePointLength,
  exampleLevel,
  isActiveLevelReview,
  levelReviewErrorKind,
  levelReviewFingerprint,
  validateLevelReviewForm,
  type LevelMode,
  type LevelReviewErrorKind,
  type LevelReviewFormError,
  type LevelReviewFormField,
  type LevelReviewFormValues
} from './level-review-form';
import { listMyLevelReviewRequests, submitLevelReviewRequest } from './level-review.functions';
import { type CurrentLevelLoad } from './level-review-view';
import { levelReview as s } from './level-review.styles';

type Failure = {
  kind: LevelReviewErrorKind | 'offline' | 'unconfirmed';
  existingId?: string | null;
};

const FOCUS_ATTEMPTS = 10;
const EMPTY: LevelReviewFormValues = {
  mode: 'exact',
  exact: '',
  min: '',
  max: '',
  reason: '',
  evidence: ''
};

/**
 * Player level review request form (Pencil frame qWosG). The current level is read-only and
 * server-owned; the player states an exact level or a range, a reason and optional evidence.
 * A submit keeps one command id while its content is unchanged, so a retry after a lost
 * response can never create a second request, and success is only claimed once the server
 * answers with the stored request.
 */
export function PlayerLevelReviewRequest({
  current,
  onSubmitted,
  onRetryCurrent
}: {
  current: CurrentLevelLoad;
  onSubmitted: (requestId: string) => void;
  onRetryCurrent: () => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const id = useId();
  const [values, setValues] = useState<LevelReviewFormValues>(EMPTY);
  const [errors, setErrors] = useState<LevelReviewFormError[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'pending' | 'done'>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [focusRequest, setFocusRequest] = useState<{ field: LevelReviewFormField } | null>(null);
  const inFlight = useRef(false);
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const fieldId = (field: LevelReviewFormField) => `${id}-${field}`;

  // The target may only become focusable a frame after the evidence section opens, so retry.
  useEffect(() => {
    if (!focusRequest) return undefined;
    let frame = 0;
    let attempts = 0;
    const focus = () => {
      const target = document.getElementById(`${id}-${focusRequest.field}`);
      target?.focus();
      if ((target && document.activeElement === target) || ++attempts > FOCUS_ATTEMPTS) {
        setFocusRequest(null);
        return;
      }
      frame = requestAnimationFrame(focus);
    };
    focus();
    return () => cancelAnimationFrame(frame);
  }, [focusRequest, id]);

  const level = (value: number) => formatLevel(value, locale);
  const example = exampleLevel(locale);
  const bounds = { min: level(MIN_LEVEL), max: level(MAX_LEVEL) };
  const levelHelper = t('levelReview.request.levelHelper', { ...bounds, example });

  function errorFor(field: LevelReviewFormField): string | undefined {
    const found = errors.find((error) => error.field === field);
    if (!found) return undefined;
    const interpolation =
      found.key === 'reasonTooLong'
        ? { max: LEVEL_REVIEW_TEXT_MAX }
        : found.key === 'evidenceTooLong'
          ? { max: LEVEL_REVIEW_EVIDENCE_MAX }
          : { ...bounds, example };
    return t(`levelReview.validation.${found.key}`, interpolation);
  }

  function change(field: LevelReviewFormField | 'mode', value: string) {
    setValues((previous) => ({ ...previous, [field]: value }));
    setErrors((previous) =>
      field === 'mode' ? [] : previous.filter((error) => error.field !== field)
    );
  }

  async function findActiveRequest(): Promise<string | null> {
    try {
      const page = await listMyLevelReviewRequests({ data: { limit: 5 } });
      return page.items.find((item) => isActiveLevelReview(item.status))?.id ?? null;
    } catch {
      return null;
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || phase === 'done') return;
    const result = validateLevelReviewForm(values, locale);
    if (!result.ok) {
      setErrors(result.errors);
      setFailure(null);
      const first = result.errors[0];
      if (first) {
        if (first.field === 'evidence') setEvidenceOpen(true);
        setFocusRequest({ field: first.field });
      }
      return;
    }
    setErrors([]);
    setFailure(null);
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setFailure({ kind: 'offline' });
      return;
    }
    const fingerprint = levelReviewFingerprint(result.input);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setPhase('pending');
    try {
      const response = await submitLevelReviewRequest({
        data: { command_id: command.current.id, ...result.input }
      });
      setPhase('done');
      onSubmitted(response.request.id);
    } catch (cause) {
      const kind = levelReviewErrorKind(levelReviewErrorCode(cause));
      setPhase('idle');
      if (kind === 'duplicate') {
        setFailure({ kind, existingId: await findActiveRequest() });
      } else if (kind === 'unavailable') {
        // The write may or may not have happened: keep the command id so a retry is safe.
        setFailure({
          kind: 'unconfirmed'
        });
      } else {
        if (kind === 'conflict') command.current = null;
        setFailure({ kind });
      }
    } finally {
      inFlight.current = false;
    }
  }

  const reasonCount = codePointLength(values.reason);
  const evidenceCount = codePointLength(values.evidence);

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <div {...stylex.props(s.headingRow)}>
          <Link
            to="/dashboard"
            aria-label={t('levelReview.request.backLabel')}
            {...stylex.props(s.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(s.title)}>{t('levelReview.request.title')}</h1>
        </div>
        {current.status === 'ok' && current.current && (
          <p {...stylex.props(s.context)}>
            {t('levelReview.request.context', { level: level(current.current.display_level) })}
          </p>
        )}
      </header>
      {current.status === 'error' && (
        <section {...stylex.props(s.card)}>
          <RatingError
            code={current.code}
            onRetry={onRetryCurrent}
            returnPath="/level-reviews/new"
          />
        </section>
      )}
      {current.status === 'ok' && !current.current && (
        <p role="alert" {...stylex.props(s.alert, s.alertText)}>
          {t('levelReview.request.unavailable')}
        </p>
      )}
      {current.status === 'ok' && current.current && (
        <form noValidate onSubmit={(event) => void submit(event)} {...stylex.props(s.form)}>
          <section aria-labelledby={`${id}-current`} {...stylex.props(s.card)}>
            <h2 id={`${id}-current`} {...stylex.props(s.strong)}>
              {t('levelReview.request.currentLabel')}
            </h2>
            <p {...stylex.props(s.currentValue)}>
              {t('levelReview.request.currentValue', {
                level: level(current.current.display_level),
                reliability: formatPercentPoints(current.current.reliability_percent, locale)
              })}
            </p>
            <p {...stylex.props(s.muted)}>{t('levelReview.request.currentHelper')}</p>
          </section>
          <fieldset {...stylex.props(s.card, s.fieldset)}>
            <legend {...stylex.props(s.legend)}>{t('levelReview.request.modeLegend')}</legend>
            <div {...stylex.props(s.modes)}>
              {(['exact', 'range'] as const satisfies readonly LevelMode[]).map((mode) => (
                <label key={mode} {...stylex.props(s.mode, values.mode === mode && s.modeSelected)}>
                  <input
                    type="radio"
                    name={`${id}-mode`}
                    value={mode}
                    checked={values.mode === mode}
                    disabled={phase !== 'idle'}
                    onChange={() => change('mode', mode)}
                    {...stylex.props(s.radio)}
                  />
                  {t(
                    mode === 'exact'
                      ? 'levelReview.request.modeExact'
                      : 'levelReview.request.modeRange'
                  )}
                </label>
              ))}
            </div>
            <div {...stylex.props(s.levelFields)}>
              {values.mode === 'exact' ? (
                <TextField
                  id={fieldId('exact')}
                  label={t('levelReview.request.levelExact')}
                  helper={levelHelper}
                  error={errorFor('exact')}
                  value={values.exact}
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={phase !== 'idle'}
                  onChange={(event) => change('exact', event.target.value)}
                />
              ) : (
                <>
                  <TextField
                    id={fieldId('min')}
                    label={t('levelReview.request.levelMin')}
                    helper={levelHelper}
                    error={errorFor('min')}
                    value={values.min}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={phase !== 'idle'}
                    onChange={(event) => change('min', event.target.value)}
                  />
                  <TextField
                    id={fieldId('max')}
                    label={t('levelReview.request.levelMax')}
                    helper={levelHelper}
                    error={errorFor('max')}
                    value={values.max}
                    inputMode="decimal"
                    autoComplete="off"
                    disabled={phase !== 'idle'}
                    onChange={(event) => change('max', event.target.value)}
                  />
                </>
              )}
            </div>
          </fieldset>
          <section {...stylex.props(s.card)}>
            <TextField
              id={fieldId('reason')}
              label={t('levelReview.request.reasonLabel')}
              helper={t('levelReview.request.reasonHelper', {
                count: reasonCount,
                max: LEVEL_REVIEW_TEXT_MAX
              })}
              error={errorFor('reason')}
              placeholder={t('levelReview.request.reasonPlaceholder')}
              value={values.reason}
              disabled={phase !== 'idle'}
              onChange={(event) => change('reason', event.target.value)}
              render={<textarea rows={5} />}
              xstyle={s.textarea}
            />
          </section>
          <Collapsible.Root open={evidenceOpen} onOpenChange={setEvidenceOpen}>
            <Collapsible.Trigger {...stylex.props(s.disclosureTrigger)}>
              <span>
                {t(
                  evidenceOpen
                    ? 'levelReview.request.evidenceHide'
                    : 'levelReview.request.evidenceShow'
                )}
              </span>
              <span aria-hidden="true">{evidenceOpen ? '−' : '+'}</span>
            </Collapsible.Trigger>
            <Collapsible.Panel {...stylex.props(s.disclosurePanel)}>
              <TextField
                id={fieldId('evidence')}
                label={t('levelReview.request.evidenceLabel')}
                helper={t('levelReview.request.evidenceHelper', {
                  count: evidenceCount,
                  max: LEVEL_REVIEW_EVIDENCE_MAX
                })}
                error={errorFor('evidence')}
                value={values.evidence}
                disabled={phase !== 'idle'}
                onChange={(event) => change('evidence', event.target.value)}
                render={<textarea rows={4} />}
                xstyle={s.textarea}
              />
            </Collapsible.Panel>
          </Collapsible.Root>
          <p {...stylex.props(s.guidance)}>{t('levelReview.request.forwardOnly')}</p>
          <output aria-live="polite" {...stylex.props(phase === 'idle' ? s.srOnly : s.notice)}>
            {phase === 'pending'
              ? t('levelReview.request.submitting')
              : phase === 'done'
                ? t('levelReview.request.submitted')
                : ''}
          </output>
          {failure && (
            <div role="alert" {...stylex.props(s.alert)}>
              <p {...stylex.props(s.alertText)}>{t(`levelReview.errors.${failure.kind}`)}</p>
              <div {...stylex.props(s.actions)}>
                {failure.kind === 'duplicate' && failure.existingId && (
                  <Link
                    to="/level-reviews/$requestId"
                    params={{ requestId: failure.existingId }}
                    {...stylex.props(s.actionLink)}
                  >
                    {t('levelReview.errors.viewActive')}
                  </Link>
                )}
                {failure.kind === 'unconfirmed' && (
                  <Link to="/level-reviews" {...stylex.props(s.actionLink)}>
                    {t('levelReview.errors.checkRequests')}
                  </Link>
                )}
                {failure.kind === 'unauthenticated' && (
                  <button
                    type="button"
                    onClick={() => window.location.assign('/login?next=%2Flevel-reviews%2Fnew')}
                    {...stylex.props(s.textButton)}
                  >
                    {t('signIn')}
                  </button>
                )}
              </div>
            </div>
          )}
          <Button type="submit" size="large" busy={phase === 'pending'} disabled={phase === 'done'}>
            {t(
              phase === 'pending' ? 'levelReview.request.submitting' : 'levelReview.request.submit'
            )}
          </Button>
        </form>
      )}
    </main>
  );
}
