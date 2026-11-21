import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { formatLevel, formatRatingDate } from '../player/rating-format';
import { formatRequestedRange } from '../level-reviews/level-review-format';
import { NotificationDetailActionIcon, NotificationDetailRow } from './NotificationDetailChrome';
import { detailStyles as d } from './notification-detail.styles';
import type { LevelReviewNotificationContext } from './notification-target';

/**
 * Resolution notice for a player level review (frames d0Qcrm / U3UJJj): outcome title and body, a
 * hairline card with the real requested range, approved level, decision date and note, and the
 * way to the request. The previous level is not in the notification context, so it is not drawn.
 */
export function NotificationLevelReviewOutcome({
  context
}: {
  context: LevelReviewNotificationContext;
}) {
  const { t, i18n } = useTranslation();
  const approved = context.outcome === 'approved';
  return (
    <>
      <h1 {...stylex.props(d.title)}>
        {t(
          approved
            ? 'notifications.kinds.level_review_approved'
            : 'notifications.kinds.level_review_rejected'
        )}
      </h1>
      <p {...stylex.props(d.body)}>
        {approved && context.approved_level !== null
          ? t('notifications.levelReview.approvedBody', {
              level: formatLevel(context.approved_level, i18n.language)
            })
          : t('notifications.levelReview.rejectedBody')}
      </p>
      <SurfaceCard xstyle={d.card}>
        <div {...stylex.props(d.cardHeader)}>
          <h2 {...stylex.props(d.cardTitle)}>{t('notifications.levelReview.cardTitle')}</h2>
          <span {...stylex.props(d.chip, approved ? d.chipGreen : d.chipRed)}>
            <span aria-hidden="true">{approved ? '✓' : '×'}</span>
            {t(approved ? 'levelReview.status.approved' : 'levelReview.status.rejected')}
          </span>
        </div>
        <hr {...stylex.props(d.divider)} />
        <NotificationDetailRow
          label={t('notifications.levelReview.requestedLabel')}
          value={formatRequestedRange(context, i18n.language, t)}
        />
        {approved && context.approved_level !== null && (
          <NotificationDetailRow
            label={t('notifications.levelReview.updatedLabel')}
            value={formatLevel(context.approved_level, i18n.language)}
          />
        )}
        <NotificationDetailRow
          label={t('notifications.levelReview.decidedLabel')}
          value={formatRatingDate(context.decided_at, i18n.language)}
        />
        <p {...stylex.props(d.note)}>
          {t('notifications.levelReview.note', { note: context.decision_note })}
        </p>
      </SurfaceCard>
      <Link
        {...stylex.props(d.action)}
        to="/level-reviews/$requestId"
        params={{ requestId: context.request_id }}
      >
        <NotificationDetailActionIcon />
        {t('notifications.levelReview.open')}
      </Link>
    </>
  );
}
