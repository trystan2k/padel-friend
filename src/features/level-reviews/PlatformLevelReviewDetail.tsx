import { useUpdateGuard } from '../pwa/update-guard';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TopBar } from '../../components/ui/TopBar';
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
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';
import { LevelReviewAvatar, LevelReviewStatusChip } from './LevelReviewParts';

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
  useUpdateGuard(pending || (active && !!(target || note || reduction || justification)));
  function rejectOffline() {
    if (navigator.onLine) return false;
    setMessage(t('pwa.offline.unsent'));
    return true;
  }
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
    if (rejectOffline()) return;
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
    if (rejectOffline()) return;
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
    if (rejectOffline()) return;
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
    if (rejectOffline()) return;
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
    <main data-route-chrome="navigation" {...stylex.props(c.page)}>
      <TopBar
        xstyle={c.barFrame}
        headingRef={heading}
        title={t('levelReview.admin.detail')}
        back={{ to: '/platform-admin/level-reviews', label: t('levelReview.admin.back') }}
      />
      <SurfaceCard xstyle={c.card}>
        <div {...stylex.props(c.cardHeader)}>
          <LevelReviewAvatar
            name={request.owner_display_name || request.owner_id}
            locale={i18n.language}
            large
          />
          <div {...stylex.props(c.player)}>
            <h2 {...stylex.props(c.playerName, c.playerNameLarge)}>
              {request.owner_display_name || request.owner_id}
            </h2>
          </div>
          {!closed && <LevelReviewStatusChip status={request.status} />}
        </div>
        <hr {...stylex.props(c.divider)} />
        <p {...stylex.props(c.levelRow)}>
          <span {...stylex.props(c.meta)}>{t('levelReview.admin.submittedLevel')}</span>
          <span {...stylex.props(c.rowValue)}>
            {t('levelReview.admin.submittedLevelValue', {
              level: formatLevel(request.snapshot_display_level, i18n.language),
              reliability: request.snapshot_reliability_percent
            })}
          </span>
        </p>
        <p {...stylex.props(c.levelRow)}>
          <span {...stylex.props(c.meta)}>{t('levelReview.admin.requestedRange')}</span>
          <span {...stylex.props(c.rowValue)}>
            {formatRequestedRange(request, i18n.language, t)}
          </span>
        </p>
        <p {...stylex.props(c.levelRow)}>
          <span {...stylex.props(c.meta)}>{t('levelReview.admin.submittedLabel')}</span>
          <span {...stylex.props(c.rowValue)}>
            {formatReviewDate(request.created_at, i18n.language)}
          </span>
        </p>
        {request.under_review_at && (
          <p {...stylex.props(c.meta)}>
            {t('levelReview.admin.reviewedAt', {
              date: formatReviewDate(request.under_review_at, i18n.language)
            })}
          </p>
        )}
        {request.canceled_at && (
          <p {...stylex.props(c.meta)}>
            {t('levelReview.admin.canceledAt', {
              date: formatReviewDate(request.canceled_at, i18n.language)
            })}
          </p>
        )}
        <hr {...stylex.props(c.divider)} />
        <h3 {...stylex.props(c.label)}>{t('levelReview.admin.reason')}</h3>
        <p {...stylex.props(c.userText)}>{request.reason}</p>
        {request.evidence && (
          <>
            <h3 {...stylex.props(c.label)}>{t('levelReview.admin.evidence')}</h3>
            <p {...stylex.props(c.userText)}>{request.evidence}</p>
          </>
        )}
      </SurfaceCard>
      {current && (
        <SurfaceCard xstyle={c.card}>
          <h2 {...stylex.props(c.cardHeading)}>{t('levelReview.adminDecision.preview')}</h2>
          <p {...stylex.props(c.meta)}>
            {t('levelReview.adminDecision.before', {
              level: formatLevel(current.display_level, i18n.language),
              mu: current.mu,
              reliability: current.reliability_percent,
              revision: current.revision,
              groups: current.confirmed_competitive_game_groups
            })}
          </p>
        </SurfaceCard>
      )}
      <SurfaceCard xstyle={c.card}>
        <h2 id={id + '-recent'} {...stylex.props(c.cardHeading)}>
          {t('levelReview.adminDecision.recentHistory')}
        </h2>
        {detail.recent_history.length === 0 ? (
          <p {...stylex.props(c.meta)}>{t('levelReview.adminDecision.recentEmpty')}</p>
        ) : (
          <ul {...stylex.props(c.section)}>
            {detail.recent_history.map((entry, index) => (
              <li key={entry.played_at + index} {...stylex.props(c.meta)}>
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
      </SurfaceCard>
      {(request.status === 'approved' || request.status === 'rejected') && (
        <SurfaceCard xstyle={c.card}>
          <h2 {...stylex.props(c.cardHeading)}>{t('levelReview.detail.decisionHeading')}</h2>
          <p {...stylex.props(c.userText)}>{request.decision_note}</p>
          {request.decided_at && (
            <p {...stylex.props(c.meta)}>
              {t('levelReview.admin.decidedAt', {
                date: formatReviewDate(request.decided_at, i18n.language)
              })}
            </p>
          )}
          {request.adjustment_id && (
            <p {...stylex.props(c.meta)}>
              {auditId ? (
                <a href={'#' + auditId} onClick={openAudit} {...stylex.props(c.actionLink)}>
                  {t('levelReview.adminDecision.event', { id: request.adjustment_id })}
                </a>
              ) : (
                t('levelReview.adminDecision.event', { id: request.adjustment_id })
              )}
            </p>
          )}
        </SurfaceCard>
      )}
      {active && (
        <SurfaceCard xstyle={c.card}>
          <h2 {...stylex.props(c.cardHeading)}>{t('levelReview.adminDecision.forwardHeading')}</h2>
          <p {...stylex.props(c.meta)}>{t('levelReview.adminDecision.forward')}</p>
          <p {...stylex.props(c.meta)}>{t('levelReview.adminDecision.forwardAudit')}</p>
        </SurfaceCard>
      )}
      <output aria-live="polite" {...stylex.props(notice ? c.notice : c.srOnly)}>
        {notice}
      </output>
      {active && (
        <section {...stylex.props(c.section)}>
          <h2 {...stylex.props(c.sectionTitle)}>{t('levelReview.detail.decisionHeading')}</h2>
          {request.status === 'pending' && (
            <Button disabled={pending} variant="secondary" onClick={() => void mark()}>
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
              <fieldset {...stylex.props(c.fieldset)}>
                <legend {...stylex.props(c.legend)}>
                  {t('levelReview.adminDecision.reliability')}
                </legend>
                <div {...stylex.props(c.modes)}>
                  {(['preserve', 'reset', 'reduce'] as const).map((choice) => (
                    <label
                      key={choice}
                      {...stylex.props(c.mode, mode === choice && c.modeSelected)}
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
                        {...stylex.props(c.radio)}
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
                  xstyle={c.textarea}
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
            xstyle={c.textarea}
          />
        </section>
      )}
      <section aria-labelledby={id + '-trail'} {...stylex.props(c.section)}>
        <h2 id={id + '-trail'} {...stylex.props(c.sectionTitle)}>
          {t('levelReview.adminDecision.trailHeading')}
        </h2>
        <SurfaceCard xstyle={c.card}>
          <div {...stylex.props(c.auditItem)}>
            <span aria-hidden="true" {...stylex.props(c.auditTile)}>
              ◷
            </span>
            <div {...stylex.props(c.stack)}>
              <p {...stylex.props(c.eventTitle)}>{t('levelReview.adminDecision.trailSubmitted')}</p>
              <p {...stylex.props(c.meta)}>{formatReviewDate(request.created_at, i18n.language)}</p>
            </div>
          </div>
        </SurfaceCard>
        {detail.adjustment && auditId && (
          <SurfaceCard xstyle={c.card}>
            <section
              id={auditId}
              tabIndex={-1}
              aria-labelledby={auditId + '-title'}
              {...stylex.props(c.section)}
            >
              <h3 id={auditId + '-title'} {...stylex.props(c.label)}>
                {t('levelReview.adminDecision.auditHeading')}
              </h3>
              <p {...stylex.props(c.meta)}>{t('levelReview.adminDecision.auditNote')}</p>
              <p {...stylex.props(c.meta)}>
                {t('levelReview.adminDecision.auditLevel', {
                  before: formatLevel(detail.adjustment.before_display_level, i18n.language),
                  beforeMu: formatInternal(detail.adjustment.before_mu, i18n.language),
                  after: formatLevel(detail.adjustment.after_display_level, i18n.language),
                  afterMu: formatInternal(detail.adjustment.after_mu, i18n.language)
                })}
              </p>
              <p {...stylex.props(c.meta)}>
                {t('levelReview.adminDecision.auditReliability', {
                  before: detail.adjustment.before_reliability_percent,
                  after: detail.adjustment.after_reliability_percent,
                  mode: t(`levelReview.adminDecision.${detail.adjustment.reliability_mode}`)
                })}
              </p>
              {detail.adjustment.exception_justification && (
                <p {...stylex.props(c.userText)}>
                  {t('levelReview.adminDecision.auditJustification', {
                    text: detail.adjustment.exception_justification
                  })}
                </p>
              )}
              <p {...stylex.props(c.meta)}>
                {t('levelReview.adminDecision.auditDecided', {
                  date: formatReviewDate(detail.adjustment.decided_at, i18n.language),
                  actor: detail.adjustment.actor_id
                })}
              </p>
              <p {...stylex.props(c.meta)}>
                {t('levelReview.adminDecision.auditRevision', {
                  revision: detail.adjustment.projection_revision,
                  before: detail.adjustment.before_engine_version,
                  after: detail.adjustment.after_engine_version
                })}
              </p>
              <p {...stylex.props(c.meta)}>
                {t('levelReview.adminDecision.auditBoundary', {
                  date: formatReviewDate(detail.adjustment.boundary_played_at, i18n.language),
                  basis: t(`levelReview.adminDecision.basis.${detail.adjustment.boundary_basis}`)
                })}
              </p>
            </section>
          </SurfaceCard>
        )}
      </section>
      {active && (
        <div {...stylex.props(c.actionBar)}>
          <Button
            variant="destructive"
            disabled={pending}
            xstyle={current ? c.barSecondary : c.barPrimary}
            onClick={(event) => prepare('reject', event.currentTarget)}
          >
            {t('levelReview.adminDecision.reject')}
          </Button>
          {current && (
            <Button
              disabled={pending}
              xstyle={c.barPrimary}
              onClick={(event) => prepare('approve', event.currentTarget)}
            >
              {t('levelReview.adminDecision.approve')}
            </Button>
          )}
        </div>
      )}
      <AlertDialog.Root
        open={decision === 'reject' || (decision === 'approve' && livePreview !== null)}
        onOpenChange={(open) => {
          if (!open && !pending) discardPreview();
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(c.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() => (trigger.current?.isConnected ? trigger.current : heading.current)}
            {...stylex.props(c.sheet)}
          >
            <AlertDialog.Title {...stylex.props(c.sectionTitle)}>
              {decision === 'approve'
                ? t('levelReview.adminDecision.confirmApprove')
                : t('levelReview.adminDecision.confirmReject')}
            </AlertDialog.Title>
            {decision === 'approve' && livePreview && (
              <>
                <p {...stylex.props(c.levelRow)}>
                  <span {...stylex.props(c.meta)}>{t('levelReview.adminDecision.levelAfter')}</span>
                  <span {...stylex.props(c.rowValue)}>
                    {formatLevel(livePreview.after.display_level, i18n.language)}
                  </span>
                </p>
                <p {...stylex.props(c.levelRow)}>
                  <span {...stylex.props(c.meta)}>
                    {t('levelReview.adminDecision.reliability')}
                  </span>
                  <span {...stylex.props(c.rowValue)}>
                    {livePreview.after.reliability_percent}%
                    {livePreview.after.reliability_percent ===
                      livePreview.before.reliability_percent &&
                      ` · ${t('levelReview.adminDecision.reliabilityUnchanged')}`}
                  </span>
                </p>
              </>
            )}
            <AlertDialog.Description {...stylex.props(c.meta)}>
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
              <p {...stylex.props(c.body)}>{t('levelReview.adminDecision.forward')}</p>
            )}
            <div {...stylex.props(c.section)}>
              <p {...stylex.props(c.label)}>{t('levelReview.adminDecision.note')}</p>
              <p {...stylex.props(c.sheetNote)}>{note.trim()}</p>
            </div>
            {message && (
              <p role="alert" {...stylex.props(c.alertText)}>
                {message}
              </p>
            )}
            <div {...stylex.props(c.sheetActions)}>
              <AlertDialog.Close
                disabled={pending}
                render={
                  <Button variant="secondary" xstyle={c.barSecondary}>
                    {t('levelReview.adminDecision.cancel')}
                  </Button>
                }
              />
              <Button
                busy={pending}
                variant={decision === 'reject' ? 'destructive' : 'primary'}
                xstyle={c.barPrimary}
                onClick={() => void confirm()}
              >
                {t(
                  decision === 'reject'
                    ? 'levelReview.adminDecision.confirmDenial'
                    : 'levelReview.adminDecision.confirmApproval'
                )}
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
