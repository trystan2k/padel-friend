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
  type LevelReviewAdjustmentPreview,
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
  previewLevelReviewApproval,
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
  // Loader data is the source of truth. A local result (mutation response, manual refresh)
  // only overrides it until the next revalidation hands this component a new loader snapshot.
  const [local, setLocal] = useState<{
    base: LevelReviewAdminDetail;
    value: LevelReviewAdminDetail;
  } | null>(null);
  const detail = local?.base === initial ? local.value : initial;
  const latest = useRef({ initial, detail });
  latest.current = { initial, detail };
  const override = (value: LevelReviewAdminDetail) =>
    setLocal({ base: latest.current.initial, value });
  const [preview, setPreview] = useState<{
    value: LevelReviewAdjustmentPreview;
    payload: Omit<
      Extract<ResolveLevelReviewInput, { decision: 'approve' }>,
      'command_id' | 'expected_revision'
    >;
  } | null>(null);
  const previewGeneration = useRef(0);
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
  const auditId = detail.adjustment ? 'adjustment-' + detail.adjustment.id : undefined;

  // A revalidation that moved the rating revision invalidates the server preview: the
  // confirmation closes and the admin must see the refreshed state and confirm again.
  const livePreview =
    preview && preview.value.revision === current?.revision ? preview.value : null;
  const approvalLocked = pending || (decision === 'approve' && !!livePreview);
  function discardPreview() {
    previewGeneration.current += 1;
    setPreview(null);
    setDecision(null);
  }
  const notice = message || (preview && !livePreview ? t('levelReview.adminDecision.stale') : '');

  function openAudit(event: { preventDefault: () => void }) {
    event.preventDefault();
    const section = auditId ? document.getElementById(auditId) : null;
    section?.focus();
    section?.scrollIntoView?.({ block: 'start' });
  }

  async function showPreview(level: number) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    const generation = previewGeneration.current;
    const reliability =
      mode === 'preserve'
        ? ({ mode } as const)
        : mode === 'reset'
          ? ({ mode, justification: justification.trim() } as const)
          : ({ mode, target: Number(reduction), justification: justification.trim() } as const);
    const payload = {
      request_id: request.id,
      decision: 'approve' as const,
      note: note.trim(),
      target_level: level,
      reliability
    };
    try {
      const value = await previewLevelReviewApproval({
        data: {
          request_id: request.id,
          target_level: level,
          reliability: mode === 'reduce' ? { mode, target: Number(reduction) } : { mode }
        }
      });
      if (generation !== previewGeneration.current) return;
      if (value.revision !== latest.current.detail.current?.revision) {
        // The rating moved since this page was loaded: show the refreshed state first.
        await refresh();
        setMessage(t('levelReview.adminDecision.stale'));
        return;
      }
      setPreview({ value, payload });
      setDecision('approve');
    } catch (cause) {
      const code = levelReviewErrorCode(cause);
      if (code === 'LEVEL_REVIEW_TARGET_OUT_OF_RANGE') {
        setErrors({ target: t('levelReview.adminDecision.targetError') });
        document.getElementById(fieldId('target'))?.focus();
      } else if (code === 'LEVEL_REVIEW_RELIABILITY_INVALID') {
        const field = mode === 'reduce' ? 'reduction' : 'justification';
        setErrors({
          [field]: t(
            mode === 'reduce'
              ? 'levelReview.adminDecision.reductionError'
              : 'levelReview.adminDecision.resetError'
          )
        });
        document.getElementById(fieldId(field))?.focus();
      } else if (
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
      } else setMessage(t('levelReview.adminDecision.previewFailed'));
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

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
    if (next === 'reject') setDecision(next);
    else if (parsed.ok) void showPreview(parsed.value);
  }

  async function refresh() {
    const value = await getLevelReviewAdminDetail({ data: { request_id: request.id } });
    override(value);
    await onRevalidate();
  }
  async function mark() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setMessage('');
    try {
      const result = await markLevelReviewRequestUnderReview({ data: { request_id: request.id } });
      override({ ...latest.current.detail, request: result.request });
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
    let payload:
      | Omit<Extract<ResolveLevelReviewInput, { decision: 'reject' }>, 'command_id'>
      | Omit<Extract<ResolveLevelReviewInput, { decision: 'approve' }>, 'command_id'>;
    if (decision === 'reject') payload = { request_id: request.id, decision, note: note.trim() };
    else {
      if (!livePreview || !preview) return;
      payload = { ...preview.payload, expected_revision: livePreview.revision };
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
      override({
        ...latest.current.detail,
        request: result.request,
        adjustment: result.adjustment
      });
      setPreview(null);
      setDecision(null);
      setMessage(t('levelReview.adminDecision.resolved'));
      void Promise.resolve(onRevalidate()).catch(() => {});
    } catch (cause) {
      const code = levelReviewErrorCode(cause);
      if (code === 'LEVEL_REVIEW_STALE_RATING') {
        setDecision(null);
        setPreview(null);
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
      <section aria-labelledby={id + '-recent'} {...stylex.props(s.card)}>
        <h2 id={id + '-recent'} {...stylex.props(s.cardTitle)}>
          {t('levelReview.adminDecision.recentHistory')}
        </h2>
        {detail.recent_history.length === 0 ? (
          <p {...stylex.props(s.muted)}>{t('levelReview.adminDecision.recentEmpty')}</p>
        ) : (
          <ul {...stylex.props(s.list)}>
            {detail.recent_history.map((entry, index) => (
              <li key={entry.played_at + index} {...stylex.props(s.text)}>
                {t('levelReview.adminDecision.recentItem', {
                  date: formatReviewDate(entry.played_at, i18n.language),
                  before: formatLevel(entry.before_display_level, i18n.language),
                  after: formatLevel(entry.after_display_level, i18n.language),
                  reliability: entry.after_reliability_percent
                })}
              </li>
            ))}
          </ul>
        )}
      </section>
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
              {auditId ? (
                <a href={'#' + auditId} onClick={openAudit} {...stylex.props(s.actionLink)}>
                  {t('levelReview.adminDecision.event', { id: request.adjustment_id })}
                </a>
              ) : (
                t('levelReview.adminDecision.event', { id: request.adjustment_id })
              )}
            </p>
          )}
        </section>
      )}
      {detail.adjustment && auditId && (
        <section
          id={auditId}
          tabIndex={-1}
          aria-labelledby={auditId + '-title'}
          {...stylex.props(s.card)}
        >
          <h2 id={auditId + '-title'} {...stylex.props(s.cardTitle)}>
            {t('levelReview.adminDecision.auditHeading')}
          </h2>
          <p {...stylex.props(s.muted)}>{t('levelReview.adminDecision.auditNote')}</p>
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.auditLevel', {
              before: formatLevel(detail.adjustment.before_display_level, i18n.language),
              beforeMu: formatInternal(detail.adjustment.before_mu, i18n.language),
              after: formatLevel(detail.adjustment.after_display_level, i18n.language),
              afterMu: formatInternal(detail.adjustment.after_mu, i18n.language)
            })}
          </p>
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.auditReliability', {
              before: detail.adjustment.before_reliability_percent,
              after: detail.adjustment.after_reliability_percent,
              mode: t(`levelReview.adminDecision.${detail.adjustment.reliability_mode}`)
            })}
          </p>
          {detail.adjustment.exception_justification && (
            <p {...stylex.props(s.userText)}>
              {t('levelReview.adminDecision.auditJustification', {
                text: detail.adjustment.exception_justification
              })}
            </p>
          )}
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.auditDecided', {
              date: formatReviewDate(detail.adjustment.decided_at, i18n.language),
              actor: detail.adjustment.actor_id
            })}
          </p>
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.auditRevision', {
              revision: detail.adjustment.projection_revision,
              before: detail.adjustment.before_engine_version,
              after: detail.adjustment.after_engine_version
            })}
          </p>
          <p {...stylex.props(s.text)}>
            {t('levelReview.adminDecision.auditBoundary', {
              date: formatReviewDate(detail.adjustment.boundary_played_at, i18n.language),
              basis: t(`levelReview.adminDecision.basis.${detail.adjustment.boundary_basis}`)
            })}
          </p>
        </section>
      )}
      {active && (
        <section {...stylex.props(s.card)}>
          <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.adminDecision.forwardHeading')}</h2>
          <p {...stylex.props(s.text)}>{t('levelReview.adminDecision.forward')}</p>
          <p {...stylex.props(s.text)}>{t('levelReview.adminDecision.forwardAudit')}</p>
        </section>
      )}
      <output aria-live="polite" {...stylex.props(notice ? s.notice : s.srOnly)}>
        {notice}
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
                disabled={approvalLocked}
                inputMode="decimal"
                error={errors.target}
                onChange={(event) => {
                  discardPreview();
                  setTarget(event.target.value);
                }}
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
                        disabled={approvalLocked}
                        onChange={() => {
                          discardPreview();
                          setMode(choice);
                        }}
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
                  disabled={approvalLocked}
                  inputMode="numeric"
                  error={errors.reduction}
                  onChange={(event) => {
                    discardPreview();
                    setReduction(event.target.value);
                  }}
                />
              )}
              {mode !== 'preserve' && (
                <TextField
                  id={fieldId('justification')}
                  label={t('levelReview.adminDecision.justification')}
                  value={justification}
                  disabled={approvalLocked}
                  error={errors.justification}
                  onChange={(event) => {
                    discardPreview();
                    setJustification(event.target.value);
                  }}
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
            disabled={approvalLocked}
            error={errors.note}
            onChange={(event) => {
              discardPreview();
              setNote(event.target.value);
            }}
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
        open={decision === 'reject' || (decision === 'approve' && livePreview !== null)}
        onOpenChange={(open) => {
          if (!open && !pending) discardPreview();
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
              {decision === 'approve' && livePreview
                ? t('levelReview.adminDecision.after', {
                    beforeLevel: formatLevel(livePreview.before.display_level, i18n.language),
                    beforeMu: formatInternal(livePreview.before.mu, i18n.language),
                    afterLevel: formatLevel(livePreview.after.display_level, i18n.language),
                    afterMu: formatInternal(livePreview.after.mu, i18n.language),
                    reliabilityBefore: livePreview.before.reliability_percent,
                    reliabilityAfter: livePreview.after.reliability_percent
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
function formatInternal(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 20,
    useGrouping: false
  }).format(value);
}
function authorizeField(id: string, field: Field) {
  return id + '-' + field;
}
