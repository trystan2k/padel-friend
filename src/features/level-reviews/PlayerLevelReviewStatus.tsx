import { AlertDialog } from '@base-ui/react/alert-dialog';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { Button } from '../../components/ui/Button';
import { formatLevel, formatPercentPoints } from '../player/rating-format';
import { RatingError } from '../player/RatingError';
import type { LevelReviewDto, LevelReviewStatus } from './level-review-contracts';
import { formatRequestedRange, formatReviewDate } from './level-review-format';
import { isActiveLevelReview, levelReviewErrorKind, levelReviewShortId } from './level-review-form';
import { cancelLevelReview, type CurrentLevelLoad } from './level-review-view';
import { levelReview as s } from './level-review.styles';

const TONE = {
  pending: s.toneAmber,
  under_review: s.toneGreen,
  approved: s.toneGreen,
  rejected: s.toneRed,
  canceled: s.toneMuted
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

  return (
    <main {...stylex.props(s.page)}>
      <header {...stylex.props(s.header)}>
        <div {...stylex.props(s.headingRow)}>
          <Link
            to="/level-reviews"
            aria-label={t('levelReview.detail.back')}
            {...stylex.props(s.backLink)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(s.title)}>{t('levelReview.detail.title')}</h1>
        </div>
        <p {...stylex.props(s.context)}>
          {t('levelReview.detail.context', { id: levelReviewShortId(request), date: submitted })}
        </p>
      </header>
      <section aria-labelledby={headingId} {...stylex.props(s.statusPanel)}>
        <h2
          id={headingId}
          ref={status}
          tabIndex={-1}
          {...stylex.props(s.statusLabel, TONE[request.status])}
        >
          {t(`levelReview.status.${request.status}`)}
        </h2>
        <p {...stylex.props(s.text)}>{t(`levelReview.status.detail.${request.status}`)}</p>
      </section>
      <output aria-live="polite" {...stylex.props(canceled || stale ? s.notice : s.srOnly)}>
        {canceled ? t('levelReview.detail.canceled') : ''}
        {stale ? t('levelReview.detail.refreshFailed') : ''}
      </output>
      {stale && (
        <button type="button" onClick={() => void revalidate()} {...stylex.props(s.textButton)}>
          {t('levelReview.detail.refresh')}
        </button>
      )}
      <SurfaceCard xstyle={s.card}>
        <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.detail.requestHeading')}</h2>
        <dl {...stylex.props(s.facts)}>
          <dt {...stylex.props(s.factLabel)}>{t('levelReview.detail.snapshotLevel')}</dt>
          <dd {...stylex.props(s.factValue)}>
            {formatLevel(request.snapshot_display_level, locale)}
          </dd>
          <dt {...stylex.props(s.factLabel)}>{t('levelReview.detail.snapshotReliability')}</dt>
          <dd {...stylex.props(s.factValue)}>
            {formatPercentPoints(request.snapshot_reliability_percent, locale)}
          </dd>
          <dt {...stylex.props(s.factLabel)}>{t('levelReview.detail.requested')}</dt>
          <dd {...stylex.props(s.factValue)}>{formatRequestedRange(request, locale, t)}</dd>
          <dt {...stylex.props(s.factLabel)}>{t('levelReview.detail.currentNow')}</dt>
          <dd {...stylex.props(s.factValue)}>
            {current.status === 'ok' && current.current
              ? t('levelReview.request.currentValue', {
                  level: formatLevel(current.current.display_level, locale),
                  reliability: formatPercentPoints(current.current.reliability_percent, locale)
                })
              : '—'}
          </dd>
        </dl>
        {current.status === 'error' && <RatingError code={current.code} />}
        <h3 {...stylex.props(s.strong)}>{t('levelReview.detail.reasonLabel')}</h3>
        <p {...stylex.props(s.userText)}>{request.reason}</p>
        <h3 {...stylex.props(s.strong)}>{t('levelReview.detail.evidenceLabel')}</h3>
        {request.evidence ? (
          <p {...stylex.props(s.userText)}>{request.evidence}</p>
        ) : (
          <p {...stylex.props(s.muted)}>{t('levelReview.detail.noEvidence')}</p>
        )}
        <h3 {...stylex.props(s.strong)}>{t('levelReview.detail.timelineHeading')}</h3>
        <ul {...stylex.props(s.timeline)}>
          <li>{t('levelReview.detail.timelineSubmitted', { date: submitted })}</li>
          {request.under_review_at && (
            <li>
              {t('levelReview.detail.timelineReview', {
                date: formatReviewDate(request.under_review_at, locale)
              })}
            </li>
          )}
          {request.canceled_at && (
            <li>
              {t('levelReview.detail.timelineCanceled', {
                date: formatReviewDate(request.canceled_at, locale)
              })}
            </li>
          )}
          {decided && request.decided_at && (
            <li>
              {t('levelReview.detail.timelineDecided', {
                date: formatReviewDate(request.decided_at, locale)
              })}
            </li>
          )}
        </ul>
      </SurfaceCard>
      {decided && (
        <SurfaceCard xstyle={s.card}>
          <h2 {...stylex.props(s.cardTitle)}>{t('levelReview.detail.decisionHeading')}</h2>
          {request.approved_level !== null && (
            <dl {...stylex.props(s.facts)}>
              <dt {...stylex.props(s.factLabel)}>{t('levelReview.detail.approvedLevel')}</dt>
              <dd {...stylex.props(s.factValue)}>{formatLevel(request.approved_level, locale)}</dd>
            </dl>
          )}
          <h3 {...stylex.props(s.strong)}>{t('levelReview.detail.decisionNote')}</h3>
          <p {...stylex.props(s.userText)}>{request.decision_note ?? '—'}</p>
          {request.status === 'approved' && request.adjustment_id && (
            <Link to="/dashboard" {...stylex.props(s.actionLink)}>
              {t('levelReview.detail.appliedLink')}
            </Link>
          )}
        </SurfaceCard>
      )}
      <p {...stylex.props(s.guidance)}>{t('levelReview.detail.annotation')}</p>
      {active && (
        <div {...stylex.props(s.footer)}>
          <button
            type="button"
            ref={trigger}
            onClick={() => {
              setFailure(null);
              setDialogOpen(true);
            }}
            {...stylex.props(s.dangerButton)}
          >
            {t('levelReview.detail.cancel')}
          </button>
        </div>
      )}
      <AlertDialog.Root open={dialogOpen} onOpenChange={(open) => !pending && setDialogOpen(open)}>
        <AlertDialog.Portal>
          <AlertDialog.Backdrop {...stylex.props(s.backdrop)} />
          <AlertDialog.Popup
            finalFocus={() => (trigger.current?.isConnected ? trigger.current : status.current)}
            {...stylex.props(s.popup)}
          >
            <AlertDialog.Title {...stylex.props(s.popupTitle)}>
              {t('levelReview.cancelDialog.title')}
            </AlertDialog.Title>
            <AlertDialog.Description {...stylex.props(s.text)}>
              {t('levelReview.cancelDialog.description')}
            </AlertDialog.Description>
            {failure && (
              <p role="alert" {...stylex.props(s.alertText)}>
                {t(`levelReview.errors.${failure}`)}
              </p>
            )}
            <div {...stylex.props(s.actions)}>
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
