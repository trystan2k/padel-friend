import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import type { LeagueDto, LeagueStatus } from './league-contracts';
import { formatLeagueDay } from './league-form';
import { styles } from './league.styles';

const STATUS_TONE: Record<LeagueStatus, StatusBadgeTone> = {
  active: 'positive',
  upcoming: 'neutral',
  closed: 'muted'
};

export function LeagueStatusBadge({ status }: { status: LeagueStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={STATUS_TONE[status]}>{t(`leagues.status.${status}`)}</StatusBadge>;
}

/** Chevron for the top-bar back link (frames: 24px, decorative; the link carries the label). */
export function LeagueBackIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(styles.backIcon)}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

/** "01 Oct 2026 → 20 Dec 2026", or the open-ended Manual form. */
export function useLeaguePeriodText(league: LeagueDto): string {
  const { t, i18n } = useTranslation();
  const start = formatLeagueDay(league.start_date, i18n.language);
  return league.end_date
    ? t('leagues.period.fixed', { start, end: formatLeagueDay(league.end_date, i18n.language) })
    : t('leagues.period.manual', { start });
}
