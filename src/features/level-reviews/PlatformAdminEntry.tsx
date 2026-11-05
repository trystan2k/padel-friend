import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ui } from '../player/player-ui.styles';
import { levelReview as s } from './level-review.styles';

/**
 * Entry to the Platform Admin level review queue. `allowed` is the server-reported access
 * context (`get_level_review_access`), never a client role guess; the route re-checks it.
 */
export function PlatformAdminEntry({ allowed }: { allowed: boolean }) {
  const { t } = useTranslation();
  if (!allowed) return null;
  return (
    <section aria-labelledby="platform-admin-entry" {...stylex.props(ui.card, ui.profileCard)}>
      <h2 id="platform-admin-entry" {...stylex.props(s.cardTitle)}>
        {t('levelReview.admin.entryTitle')}
      </h2>
      <p {...stylex.props(s.muted)}>{t('levelReview.admin.entryDescription')}</p>
      <div {...stylex.props(s.actions)}>
        <Link to="/platform-admin/level-reviews" {...stylex.props(s.primaryLink)}>
          {t('levelReview.admin.entryLink')}
        </Link>
      </div>
    </section>
  );
}
