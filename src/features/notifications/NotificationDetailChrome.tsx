import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { detailStyles as d } from './notification-detail.styles';

/** 48px back target and centered "Notifications" title (frames dkFFb / d0Qcrm); the target is named for assistive tech. */
export function NotificationDetailTopBar() {
  const { t } = useTranslation();
  return (
    <header {...stylex.props(d.topBar)}>
      <Link to="/notifications" {...stylex.props(d.backLink)}>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          {...stylex.props(d.backIcon)}
        >
          <path d="m15 18-6-6 6-6" />
        </svg>
        <span {...stylex.props(d.srOnly)}>{t('notifications.back')}</span>
      </Link>
      <p {...stylex.props(d.navTitle)}>{t('notifications.title')}</p>
    </header>
  );
}

/** Type tile, received time and the read chip (frames dkFFb unread / Z0gRd-style read twins). */
export function NotificationDetailMeta({
  symbol,
  receivedAt,
  read
}: {
  symbol: string;
  receivedAt: string | null;
  read: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div {...stylex.props(d.meta)}>
      <span aria-hidden="true" {...stylex.props(d.tile)}>
        {symbol}
      </span>
      <p {...stylex.props(d.received)}>{receivedAt}</p>
      <span {...stylex.props(d.chip, read ? d.chipMuted : d.chipGreen)}>
        {read ? (
          t('notifications.readRow')
        ) : (
          <>
            <span aria-hidden="true">●</span>
            {t('notifications.unreadRow')}
          </>
        )}
      </span>
    </div>
  );
}

/** Decorative arrow-up-right for the outlined 52px actions. */
export function NotificationDetailActionIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(d.actionIcon)}
    >
      <path d="M7 17 17 7M7 7h10v10" />
    </svg>
  );
}

/** Label on the left, bold value on the right (the frames' outcome rows). */
export function NotificationDetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <p {...stylex.props(d.row)}>
      <span {...stylex.props(d.label)}>{label}</span>
      <span {...stylex.props(d.value)}>{value}</span>
    </p>
  );
}
