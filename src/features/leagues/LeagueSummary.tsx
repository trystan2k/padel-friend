import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import type { LeagueDto, LeagueStatus } from './league-contracts';
import { formatLeagueDay } from './league-form';

const STATUS_TONE: Record<LeagueStatus, StatusBadgeTone> = {
  active: 'positive',
  upcoming: 'neutral',
  closed: 'muted'
};

export function LeagueStatusBadge({ status }: { status: LeagueStatus }) {
  const { t } = useTranslation();
  return <StatusBadge tone={STATUS_TONE[status]}>{t(`leagues.status.${status}`)}</StatusBadge>;
}

/** "01 Oct 2026 → 20 Dec 2026", or the open-ended Manual form. */
export function useLeaguePeriodText(league: LeagueDto): string {
  const { t, i18n } = useTranslation();
  const start = formatLeagueDay(league.start_date, i18n.language);
  return league.end_date
    ? t('leagues.period.fixed', { start, end: formatLeagueDay(league.end_date, i18n.language) })
    : t('leagues.period.manual', { start });
}
