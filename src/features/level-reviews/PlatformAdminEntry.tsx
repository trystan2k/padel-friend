import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { me as s } from '../player/me.styles';

/**
 * Platform Admin entry on the Me destination (D5). `allowed` is the server-reported access
 * context (`get_level_review_access`), never a client role guess; the routes re-check it.
 */
export function PlatformAdminEntry({ allowed }: { allowed: boolean }) {
  const { t } = useTranslation();
  const queueId = useId();
  if (!allowed) return null;
  return (
    <section aria-labelledby="platform-admin-entry" {...stylex.props(s.stack)}>
      <h2 id="platform-admin-entry" {...stylex.props(s.sectionTitle)}>
        {t('levelReview.admin.entryTitle')}
      </h2>
      <ul {...stylex.props(s.list)}>
        <li {...stylex.props(s.listItem)}>
          <Link
            to="/platform-admin/level-reviews"
            aria-labelledby={`${queueId}-title`}
            aria-describedby={`${queueId}-description`}
            {...stylex.props(s.row)}
          >
            <span {...stylex.props(s.rowText)}>
              <span id={`${queueId}-title`} {...stylex.props(s.rowTitle)}>
                {t('levelReview.admin.entryLink')}
              </span>
              <span id={`${queueId}-description`} {...stylex.props(s.rowMeta)}>
                {t('levelReview.admin.entryDescription')}
              </span>
            </span>
            <span aria-hidden="true" {...stylex.props(s.chevron)}>
              ›
            </span>
          </Link>
        </li>
        <li {...stylex.props(s.listItem)}>
          <Link to="/platform-admin/result-repairs" {...stylex.props(s.row)}>
            <span {...stylex.props(s.rowText, s.rowTitle)}>
              {t('matches.corrections.diagnostics.entryLink')}
            </span>
            <span aria-hidden="true" {...stylex.props(s.chevron)}>
              ›
            </span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
