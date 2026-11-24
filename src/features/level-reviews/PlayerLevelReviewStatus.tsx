import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { Button } from '../../components/ui/Button';
import { TopBar } from '../../components/ui/TopBar';
import { formatLevel, formatPercentPoints } from '../player/rating-format';
import { RatingError } from '../player/RatingError';
import type { LevelReviewDto, LevelReviewStatus } from './level-review-contracts';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { isActiveLevelReview, levelReviewErrorKind, levelReviewShortId } from './level-review-form';
import { cancelLevelReview, type CurrentLevelLoad } from './level-review-view';
import { levelReviewClubhouse as c } from './level-review-clubhouse.styles';

const TONE = {
  pending: c.toneAmber,
  under_review: c.toneAmber,
  approved: c.toneGreen,
  rejected: c.toneRed,
  canceled: c.toneMuted
} as const satisfies Record<LevelReviewStatus, unknown>;

type CancelFailure = 'unconfirmed' | ReturnType<typeof levelReviewErrorKind>;

/**
 * Owner view of one level review request (Pencil frame OKYtp): the real state of this request
 * (never a stack of example states), the request snapshot next to the current level, the
 * decision note, and an owner-only cancel that is confirmed in a dialog. A cancel is only
 * reported once the server returns the closed request; the loader data is then revalidated.
 */
export function PlayerLevelReviewStatus({
  request: initial,
  current,
  onRevalidate
}: {
  request: LevelReviewDto;
  current: CurrentLevelLoad;
  onRevalidate: () => Promise<unknown> | void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const headingId = useId();
  const [override, setOverride] = useState<{
    source: LevelReviewDto;
    value: LevelReviewDto;
  } | null>(null);
  const request = override && override.source === initial ? override.value : initial;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CancelFailure | null>(null);
  const [canceled, setCanceled] = useState(false);
  const [stale, setStale] = useState(false);
  const inFlight = useRef(false);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const status = useRef<HTMLHeadingElement | null>(null);

  async function revalidate() {
    try {
      await onRevalidate();
      setStale(false);
    } catch {
      setStale(true);
    }
  }

  async function confirmCancel() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setFailure(null);
    try {
      const result = await cancelLevelReview(request.id);
      if (result.status === 'ok') {
        setOverride({ source: initial, value: result.value });
        setCanceled(true);
        setDialogOpen(false);
        await revalidate();
        return;
      }
      const kind = levelReviewErrorKind(result.code);
      if (kind === 'unavailable') setFailure('unconfirmed');
      else setFailure(kind);
      // The request may have been closed elsewhere: re-read it either way.
      if (kind === 'invalidTransition') await revalidate();
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const active = isActiveLevelReview(request.status);
  const decided = request.status === 'approved' || request.status === 'rejected';
  const submitted = formatReviewDate(request.created_at, locale);
  const requested = formatRequestedRange(request, locale, t);
  const reviewedAt = request.under_review_at;
  const marks = { pending: '◷', under_review: '◷', approved: '✓', rejected: '✕', canceled: '✕' };

  return (
    <main data-route-chrome="navigation" {...stylex.props(c.page)}>
      <TopBar
        xstyle={c.barFrame}
        title={t('levelReview.detail.title')}
        back={{ to: '/level-reviews', label: t('levelReview.detail.back') }}
      />
      <section aria-labelledby={headingId} {...stylex.props(c.statusNotice, TONE[request.status])}>
        <span aria-hidden="true" {...stylex.props(c.noticeGlyph)}>
          {marks[request.status]}
        </span>
        <div {...stylex.props(c.noticeCopy)}>
          <h2 id={headingId} ref={status} tabIndex={-1} {...stylex.props(c.statusLabel)}>
            {t(`levelReview.status.${request.status}`)}
          </h2>
          <p {...stylex.props(c.statusText)}>{t(`levelReview.status.detail.${request.status}`)}</p>
          <p {...stylex.props(c.statusText)}>
            {t('levelReview.detail.summary', {
              from: formatLevel(request.snapshot_display_level, locale),
              to: requested,
              id: levelReviewShortId(request)
            })}
          </p>
        </div>
      </section>
      <output aria-live="polite" {...stylex.props(canceled || stale ? c.notice : c.srOnly)}>
        {canceled ? t('levelReview.detail.canceled') : ''}
        {stale ? t('levelReview.detail.refreshFailed') : ''}
      </output>
      {stale && (
        <button type="button" onClick={() => void revalidate()} {...stylex.props(c.textButton)}>
          {t('levelReview.detail.refresh')}
        </button>
      )}
      <ol aria-label={t('levelReview.detail.timelineHeading')} {...stylex.props(c.timeline)}>
        <TimelineStep
          mark="done"
          title={t('levelReview.detail.timelineSubmitted', { date: submitted })}
        />
        {reviewedAt && (
          <TimelineStep
            mark={active ? 'current' : 'done'}
            title={t('levelReview.detail.timelineReview', {
              date: formatReviewDate(reviewedAt, locale)
            })}
          />
        )}
        {request.status === 'pending' && (
          <TimelineStep mark="current" title={t('levelReview.detail.timelineWaiting')} />
        )}
        {request.canceled_at && (
          <TimelineStep
            mark="canceled"
            title={t('levelReview.detail.timelineCanceled', {
              date: formatReviewDate(request.canceled_at, locale)
            })}
          />
        )}
        {decided && request.decided_at && (
          <TimelineStep
            mark="done"
            title={t('levelReview.detail.timelineDecided', {
              date: formatReviewDate(request.decided_at, locale)
            })}
          />
        )}
        {active && (
          <TimelineStep
            mark="pending"
            title={t('levelReview.detail.timelineDecision')}
            meta={t('levelReview.detail.timelineNotify')}
          />
        )}
      </ol>
      <SurfaceCard xstyle={c.card}>
        <h2 {...stylex.props(c.cardTitle)}>{t('levelReview.detail.requestHeading')}</h2>
        <dl {...stylex.props(c.facts)}>
          <dt {...stylex.props(c.factLabel)}>{t('levelReview.detail.snapshotLevel')}</dt>
          <dd {...stylex.props(c.factValue)}>
            {formatLevel(request.snapshot_display_level, locale)}
          </dd>
          <dt {...stylex.props(c.factLabel)}>{t('levelReview.detail.snapshotReliability')}</dt>
          <dd {...stylex.props(c.factValue)}>
            {formatPercentPoints(request.snapshot_reliability_percent, locale)}
          </dd>
          <dt {...stylex.props(c.factLabel)}>{t('levelReview.detail.requested')}</dt>
          <dd {...stylex.props(c.factValue)}>{requested}</dd>
          <dt {...stylex.props(c.factLabel)}>{t('levelReview.detail.currentNow')}</dt>
          <dd {...stylex.props(c.factValue)}>
            {current.status === 'ok' && current.current
              ? t('levelReview.request.currentValue', {
                  level: formatLevel(current.current.display_level, locale),
                  reliability: formatPercentPoints(current.current.reliability_percent, locale)
                })
              : '—'}
          </dd>
        </dl>
        {current.status === 'error' && <RatingError code={current.code} />}
        <h3 {...stylex.props(c.label)}>{t('levelReview.detail.reasonLabel')}</h3>
        <p {...stylex.props(c.userText)}>{request.reason}</p>
        <h3 {...stylex.props(c.label)}>{t('levelReview.detail.evidenceLabel')}</h3>
        {request.evidence ? (
          <p {...stylex.props(c.userText)}>{request.evidence}</p>
        ) : (
          <p {...stylex.props(c.meta)}>{t('levelReview.detail.noEvidence')}</p>
        )}
      </SurfaceCard>
      {decided && (
        <SurfaceCard xstyle={c.card}>
          <h2 {...stylex.props(c.cardTitle)}>{t('levelReview.detail.decisionHeading')}</h2>
          {request.approved_level !== null && (
            <dl {...stylex.props(c.facts)}>
              <dt {...stylex.props(c.factLabel)}>{t('levelReview.detail.approvedLevel')}</dt>
              <dd {...stylex.props(c.factValue)}>{formatLevel(request.approved_level, locale)}</dd>
            </dl>
          )}
          <h3 {...stylex.props(c.label)}>{t('levelReview.detail.decisionNote')}</h3>
          <p {...stylex.props(c.userText)}>{request.decision_note ?? '—'}</p>
          {request.status === 'approved' && request.adjustment_id && (
            <Link to="/me" {...stylex.props(c.actionLink)}>
              {t('levelReview.detail.appliedLink')}
            </Link>
          )}
        </SurfaceCard>
      )}
      {active && (
        <>
          <OutcomeCard
            approved
            title={t('levelReview.detail.ifApprovedTitle')}
            body={t('levelReview.detail.ifApprovedBody')}
          />
          <OutcomeCard
            title={t('levelReview.detail.ifRejectedTitle')}
            body={t('levelReview.detail.ifRejectedBody')}
          />
        </>
      )}
      <p {...stylex.props(c.meta)}>{t('levelReview.detail.annotation')}</p>
      {active && (
        <div {...stylex.props(c.footer)}>
          <Button
            variant="secondary"
            ref={trigger}
            onClick={() => {
              setFailure(null);
              setDialogOpen(true);
            }}
          >
            {t('levelReview.detail.cancel')}
          </Button>
        </div>
      )}
      <AlertDialog.Root open={dialogOpen} onOpenChange={(open) => !pending && setDialogOpen(open)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(c.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() => (trigger.current?.isConnected ? trigger.current : status.current)}
            {...stylex.props(c.popup)}
          >
            <AlertDialog.Title {...stylex.props(c.popupTitle)}>
              {t('levelReview.cancelDialog.title')}
            </AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(c.popupBody)}>
              {t('levelReview.cancelDialog.description')}
            </AlertDialog.Description>
            {failure && (
              <p role="alert" {...stylex.props(c.alertText)}>
                {t(`levelReview.errors.${failure}`)}
              </p>
            )}
            <div {...stylex.props(c.actions)}>
              <AlertDialog.Close
                disabled={pending}
                render={<Button variant="secondary">{t('levelReview.cancelDialog.keep')}</Button>}
              />
              <Button busy={pending} onClick={() => void confirmCancel()}>
                {t(
                  pending
                    ? 'levelReview.cancelDialog.canceling'
                    : 'levelReview.cancelDialog.confirm'
                )}
              </Button>
            </div>
          </AlertDialog.Popup>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </main>
  );
}

type StepMark = 'done' | 'current' | 'pending' | 'canceled';

const STEP_MARK = {
  done: [c.markDone, '✓'],
  current: [c.markCurrent, ''],
  pending: [null, ''],
  canceled: [c.markCanceled, '✕']
} as const satisfies Record<StepMark, readonly [unknown, string]>;

/** One timeline row (frame Step): a 24px mark and a 15/700 title with an optional muted meta. */
function TimelineStep({ mark, title, meta }: { mark: StepMark; title: string; meta?: string }) {
  const [markStyle, glyph] = STEP_MARK[mark];
  return (
    <li {...stylex.props(c.step)}>
      <span aria-hidden="true" {...stylex.props(c.mark, markStyle)}>
        {glyph}
      </span>
      <div {...stylex.props(c.stepCopy)}>
        <span {...stylex.props(c.stepTitle, mark === 'pending' && c.stepTitleMuted)}>{title}</span>
        {meta && <span {...stylex.props(c.meta)}>{meta}</span>}
      </div>
    </li>
  );
}

/** "If approved" / "If rejected" explanation card (frame OKYtp): 40px glyph, title and body. */
function OutcomeCard({
  approved,
  title,
  body
}: {
  approved?: boolean;
  title: string;
  body: string;
}) {
  return (
    <SurfaceCard xstyle={c.outcome}>
      <span
        aria-hidden="true"
        {...stylex.props(c.outcomeGlyph, approved && c.outcomeGlyphApproved)}
      >
        {approved ? '✓' : '✕'}
      </span>
      <div {...stylex.props(c.outcomeCopy)}>
        <h3 {...stylex.props(c.cardTitle)}>{title}</h3>
        <p {...stylex.props(c.meta)}>{body}</p>
      </div>
    </SurfaceCard>
  );
}
