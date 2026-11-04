import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { formatLevel } from '../player/rating-format';
import {
  LEVEL_REVIEW_TEXT_MAX,
  type LevelReviewAdminDetail,
  type LevelReviewReliabilityMode,
  type ResolveLevelReviewInput
} from './level-review-contracts';
import { levelReviewErrorCode } from './level-review-errors';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { codePointLength, isActiveLevelReview, parseLevelInput } from './level-review-form';
import {
  getLevelReviewAdminDetail,
  markLevelReviewRequestUnderReview,
  resolveLevelReviewRequest
} from './level-review.functions';
import { levelReview as s } from './level-review.styles';

type Decision = 'approve' | 'reject';
type Field = 'target' | 'note' | 'reduction' | 'justification';

export function PlatformLevelReviewDetail({
  initial,
  onRevalidate
}: {
  initial: LevelReviewAdminDetail;
  onRevalidate: () => Promise<unknown> | void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [detail, setDetail] = useState(initial);
  const [target, setTarget] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<LevelReviewReliabilityMode>('preserve');
  const [reduction, setReduction] = useState('');
  const [justification, setJustification] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [closed, setClosed] = useState(false);
  const inFlight = useRef(false);
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const request = detail.request;
  const current = detail.current;
  const active = isActiveLevelReview(request.status) && !closed;
  const fieldId = (field: Field) => authorizeField(id, field);

  function prepare(next: Decision, button: HTMLButtonElement) {
    const found: Partial<Record<Field, string>> = {};
    const parsed = parseLevelInput(target, i18n.language);
    if (next === 'approve') {
      if (
        !current ||
        !parsed.ok ||
        parsed.value < request.requested_min_level ||
        parsed.value > request.requested_max_level
      )
        found.target = t('levelReview.adminDecision.targetError');
      if (
        mode === 'reduce' &&
        (!/^\d+$/.test(reduction) || !current || Number(reduction) >= current.reliability_percent)
      )
        found.reduction = t('levelReview.adminDecision.reductionError');
      if (
        mode !== 'preserve' &&
        (!justification.trim() || codePointLength(justification.trim()) > LEVEL_REVIEW_TEXT_MAX)
      )
        found.justification = t('levelReview.adminDecision.justificationError');
      if (mode === 'reset' && current && current.reliability_percent <= 10)
        found.justification = t('levelReview.adminDecision.resetError');
    }
    if (!note.trim() || codePointLength(note.trim()) > LEVEL_REVIEW_TEXT_MAX)
      found.note = t('levelReview.adminDecision.noteError');
    setErrors(found);
    const first = (['target', 'reduction', 'justification', 'note'] as const).find(
      (field) => found[field]
    );
    if (first) {
      document.getElementById(fieldId(first))?.focus();
      return;
    }
    setMessage('');
    trigger.current = button;
    setDecision(next);
  }

  async function refresh() {
    const value = await getLevelReviewAdminDetail({ data: { request_id: request.id } });
    setDetail(value);
    await onRevalidate();
  }
  async function mark() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await markLevelReviewRequestUnderReview({ data: { request_id: request.id } });
      setDetail((previous) => ({ ...previous, request: result.request }));
      setMessage(t('levelReview.adminDecision.marked'));
      void Promise.resolve(onRevalidate()).catch(() => {});
    } catch (cause) {
      const code = levelReviewErrorCode(cause);
      if (
        code === 'LEVEL_REVIEW_INVALID_TRANSITION' ||
        code === 'LEVEL_REVIEW_RESOLUTION_CONFLICT'
      ) {
        setClosed(true);
        setMessage(t('levelReview.adminDecision.conflict'));
      } else if (code === 'LEVEL_REVIEW_FORBIDDEN' || code === 'PROVISIONAL_PLAYER_RESTRICTED') {
        setClosed(true);
        setMessage(t('levelReview.errors.forbidden'));
      } else if (code === 'UNAUTHENTICATED' || code === 'LEVEL_REVIEW_UNAUTHENTICATED') {
        setClosed(true);
        setMessage(t('levelReview.errors.unauthenticated'));
      } else setMessage(t('levelReview.adminDecision.unconfirmed'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  async function confirm() {
    if (inFlight.current || !decision) return;
    const parsed = parseLevelInput(target, i18n.language);
    let payload:
      | Omit<Extract<ResolveLevelReviewInput, { decision: 'reject' }>, 'command_id'>
      | Omit<Extract<ResolveLevelReviewInput, { decision: 'approve' }>, 'command_id'>;
    if (decision === 'reject') payload = { request_id: request.id, decision, note: note.trim() };
    else {
      if (!current || !parsed.ok) return;
      const reliability =
        mode === 'preserve'
          ? ({ mode } as const)
          : mode === 'reset'
            ? ({ mode, justification: justification.trim() } as const)
            : ({ mode, target: Number(reduction), justification: justification.trim() } as const);
      payload = {
        request_id: request.id,
        decision,
        note: note.trim(),
        target_level: parsed.value,
        expected_revision: current.revision,
        reliability
      };
    }
    const fingerprint = JSON.stringify(payload);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await resolveLevelReviewRequest({
        data: { ...payload, command_id: command.current.id }
      });
      setDetail((previous) => ({
        ...previous,
        request: result.request,
        adjustment: result.adjustment
      }));
      setDecision(null);
      setMessage(t('levelReview.adminDecision.resolved'));
      void Promise.resolve(onRevalidate()).catch(() => {});
    } catch (cause) {
      const code = levelReviewErrorCode(cause);
      if (code === 'LEVEL_REVIEW_STALE_RATING') {
        setDecision(null);
        command.current = null;
        try {
          await refresh();
          setMessage(t('levelReview.adminDecision.stale'));
        } catch {
          setClosed(true);
          setMessage(t('levelReview.adminDecision.refreshFailed'));
        }
      } else if (
        code === 'LEVEL_REVIEW_RESOLUTION_CONFLICT' ||
        code === 'LEVEL_REVIEW_INVALID_TRANSITION' ||
        code === 'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT'
      ) {
        setDecision(null);
        setClosed(true);
        setMessage(t('levelReview.adminDecision.conflict'));
      } else if (code === 'LEVEL_REVIEW_FORBIDDEN' || code === 'PROVISIONAL_PLAYER_RESTRICTED') {
        setDecision(null);
        setClosed(true);
        setMessage(t('levelReview.errors.forbidden'));
      } else if (code === 'UNAUTHENTICATED' || code === 'LEVEL_REVIEW_UNAUTHENTICATED') {
        setDecision(null);
        setClosed(true);
        setMessage(t('levelReview.errors.unauthenticated'));
      } else setMessage(t('levelReview.adminDecision.unconfirmed'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <main {...stylex.props(s.page)}>
      <Link to="/platform-admin/level-reviews" {...stylex.props(s.actionLink)}>
        {t('levelReview.admin.back')}
      </Link>
      <h1 ref={heading} tabIndex={-1} {...stylex.props(s.title)}>
        {t('levelReview.admin.detail')}
      </h1>
      <section {...stylex.props(s.card)}>
        <h2 {...stylex.props(s.cardTitle)}>{request.owner_display_name || request.owner_id}</h2>
        {!closed && (
          <p {...stylex.props(s.statusLabel)}>{t(`levelReview.status.${request.status}`)}</p>
        )}
        <p {...stylex.props(s.text)}>
          {t('levelReview.admin.current', {
            level: formatLevel(request.snapshot_display_level, i18n.language),
            reliability: request.snapshot_reliability_percent
          })}
        </p>
        <p {...stylex.props(s.text)}>
          {t('levelReview.history.itemRequested', {
            range: formatRequestedRange(request, i18n.language, t)
          })}
        </p>
        <p {...stylex.props(s.muted)}>
          {t('levelReview.history.itemSubmitted', {
            date: formatReviewDate(request.created_at, i18n.language)
          })}
        </p>
        {request.under_review_at && (
          <p {...stylex.props(s.muted)}>
            {t('levelReview.admin.reviewedAt', {
              date: formatReviewDate(request.under_review_at, i18n.language)
            })}
          </p>
        )}
        {request.canceled_at && (
          <p {...stylex.props(s.muted)}>
            {t('levelReview.admin.canceledAt', {
              date: formatReviewDate(request.canceled_at, i18n.language)
            })}
          </p>
        )}
        <h3 {...stylex.props(s.strong)}>{t('levelReview.admin.reason')}</h3>
        <p {...stylex.props(s.userText)}>{request.reason}</p>
        {request.evidence && (
          <>
            <h3 {...stylex.props(s.strong)}>{t('levelReview.admin.evidence')}</h3>
            <p {...stylex.props(s.userText)}>{request.evidence}</p>
          </>
        )}
      </section>
      {current && (
        <section {...stylex.props(s.card)}>
          <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.adminDecision.preview')}</h2>
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.before', {
              level: formatLevel(current.display_level, i18n.language),
              mu: current.mu,
              reliability: current.reliability_percent,
              revision: current.revision,
              groups: current.confirmed_competitive_game_groups
            })}
          </p>
        </section>
      )}
      {(request.status === 'approved' || request.status === 'rejected') && (
        <section {...stylex.props(s.card)}>
          <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.detail.decisionHeading')}</h2>
          <p {...stylex.props(s.userText)}>{request.decision_note}</p>
          {request.decided_at && (
            <p {...stylex.props(s.text)}>
              {t('levelReview.admin.decidedAt', {
                date: formatReviewDate(request.decided_at, i18n.language)
              })}
            </p>
          )}
          {request.adjustment_id && (
            <p {...stylex.props(s.text)}>
              {t('levelReview.adminDecision.event', { id: request.adjustment_id })}
            </p>
          )}
        </section>
      )}
      <output aria-live="polite" {...stylex.props(message ? s.notice : s.srOnly)}>
        {message}
      </output>
      {active && (
        <section {...stylex.props(s.card)}>
          {request.status === 'pending' && (
            <Button disabled={pending} onClick={() => void mark()}>
              {t('levelReview.adminDecision.mark')}
            </Button>
          )}
          {current && (
            <>
              <TextField
                id={fieldId('target')}
                label={t('levelReview.adminDecision.target')}
                value={target}
                inputMode="decimal"
                error={errors.target}
                onChange={(event) => setTarget(event.target.value)}
              />
              <fieldset {...stylex.props(s.fieldset)}>
                <legend {...stylex.props(s.legend)}>
                  {t('levelReview.adminDecision.reliability')}
                </legend>
                <div {...stylex.props(s.modes)}>
                  {(['preserve', 'reset', 'reduce'] as const).map((choice) => (
                    <label
                      key={choice}
                      {...stylex.props(s.mode, mode === choice && s.modeSelected)}
                    >
                      <input
                        type="radio"
                        name={id}
                        checked={mode === choice}
                        onChange={() => setMode(choice)}
                        {...stylex.props(s.radio)}
                      />
                      {t(`levelReview.adminDecision.${choice}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {mode === 'reduce' && (
                <TextField
                  id={fieldId('reduction')}
                  label={t('levelReview.adminDecision.reduction')}
                  value={reduction}
                  inputMode="numeric"
                  error={errors.reduction}
                  onChange={(event) => setReduction(event.target.value)}
                />
              )}
              {mode !== 'preserve' && (
                <TextField
                  id={fieldId('justification')}
                  label={t('levelReview.adminDecision.justification')}
                  value={justification}
                  error={errors.justification}
                  onChange={(event) => setJustification(event.target.value)}
                  render={<textarea rows={3} />}
                  xstyle={s.textarea}
                />
              )}
            </>
          )}
          <TextField
            id={fieldId('note')}
            label={t('levelReview.adminDecision.note')}
            value={note}
            error={errors.note}
            onChange={(event) => setNote(event.target.value)}
            render={<textarea rows={4} />}
            xstyle={s.textarea}
          />
          <div {...stylex.props(s.actions)}>
            {current && (
              <Button
                disabled={pending}
                onClick={(event) => prepare('approve', event.currentTarget)}
              >
                {t('levelReview.adminDecision.approve')}
              </Button>
            )}
            <Button
              disabled={pending}
              variant="secondary"
              onClick={(event) => prepare('reject', event.currentTarget)}
            >
              {t('levelReview.adminDecision.reject')}
            </Button>
          </div>
        </section>
      )}
      <AlertDialog.Root
        open={decision !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setDecision(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(s.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() => (trigger.current?.isConnected ? trigger.current : heading.current)}
            {...stylex.props(s.popup)}
          >
            <AlertDialog.Title {...stylex.props(s.popupTitle)}>
              {decision === 'approve'
                ? t('levelReview.adminDecision.confirmApprove')
                : t('levelReview.adminDecision.confirmReject')}
            </AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(s.text)}>
              {decision === 'approve' && current
                ? t('levelReview.adminDecision.after', {
                    before: current.display_level,
                    beforeMu: current.mu,
                    after: target,
                    reliabilityBefore: current.reliability_percent,
                    reliabilityAfter:
                      mode === 'preserve'
                        ? current.reliability_percent
                        : mode === 'reset'
                          ? 10
                          : reduction
                  })
                : t('levelReview.adminDecision.rejectDescription')}
            </AlertDialog.Description>
            {decision === 'approve' && (
              <p {...stylex.props(s.guidance)}>{t('levelReview.adminDecision.forward')}</p>
            )}
            {message && (
              <p role="alert" {...stylex.props(s.alertText)}>
                {message}
              </p>
            )}
            <div {...stylex.props(s.actions)}>
              <AlertDialog.Close
                disabled={pending}
                render={
                  <Button variant="secondary">{t('levelReview.adminDecision.cancel')}</Button>
                }
              />
              <Button busy={pending} onClick={() => void confirm()}>
                {t('levelReview.adminDecision.confirm')}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}
function authorizeField(id: string, field: Field) {
  return id + '-' + field;
}
