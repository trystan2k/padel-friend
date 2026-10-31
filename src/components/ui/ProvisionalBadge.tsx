import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { styles } from './provisional-badge.styles';
import { StatusBadge } from './StatusBadge';

/** Text + icon, so the provisional state never relies on color alone. */
export function ProvisionalBadge() {
  const { t } = useTranslation();
  return (
    <StatusBadge tone="provisional">
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        {...stylex.props(styles.glyph)}
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
      {t('player.provisional.badge')}
    </StatusBadge>
  );
}
