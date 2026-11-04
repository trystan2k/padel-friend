import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { formatLevel, formatRatingDate } from '../player/rating-format';
import { formatRequestedRange } from '../level-reviews/level-review-format';
import { styles } from './notifications.styles';
import type { LevelReviewNotificationContext } from './notification-target';

/** Resolution notice for a player level review: outcome, note and the way to the request. */
export function NotificationLevelReviewOutcome({
  context
}: {
  context: LevelReviewNotificationContext;
}) {
  const { t, i18n } = useTranslation();
  const approved = context.outcome === 'approved';
  return (
    <>
      <h1>
        {t(
          approved
            ? 'notifications.kinds.level_review_approved'
            : 'notifications.kinds.level_review_rejected'
        )}
      </h1>
      <p>
        {approved && context.approved_level !== null
          ? t('notifications.levelReview.approvedBody', {
              level: formatLevel(context.approved_level, i18n.language)
            })
          : t('notifications.levelReview.rejectedBody')}
      </p>
      <p>
        {t('notifications.levelReview.requested', {
          range: formatRequestedRange(context, i18n.language, t)
        })}
      </p>
      <p>
        {t('notifications.levelReview.note')}: {context.decision_note}
      </p>
      <p>
        {t('notifications.levelReview.decided', {
          date: formatRatingDate(context.decided_at, i18n.language)
        })}
      </p>
      <Link
        {...stylex.props(styles.link)}
        to="/level-reviews/$requestId"
        params={{ requestId: context.request_id }}
      >
        {t('notifications.levelReview.open')}
      </Link>
    </>
  );
}
