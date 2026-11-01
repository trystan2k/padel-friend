import * as stylex from '@stylexjs/stylex';
import { Link, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { leagueErrorCode } from './league-errors';
import { styles } from './league.styles';

export function LeagueLoading() {
  const { t } = useTranslation();
  return (
    <main {...stylex.props(styles.page)}>
      <output {...stylex.props(styles.context)}>{t('leagues.loading')}</output>
    </main>
  );
}

export function LeagueRouteError({ error, reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const code = leagueErrorCode(error);
  const denied = code === 'LEAGUE_FORBIDDEN' || code === 'LEAGUE_NOT_FOUND';
  const retry = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await router.invalidate();
      reset();
    } catch {
      // Keep the error boundary visible when refresh fails.
    } finally {
      setBusy(false);
    }
  };
  return (
    <main {...stylex.props(styles.page)}>
      <SurfaceCard role="alert" xstyle={styles.card}>
        <h1 {...stylex.props(styles.title)}>
          {t(denied ? 'leagues.deniedTitle' : 'leagues.errorTitle')}
        </h1>
        <p {...stylex.props(styles.text)}>
          {t(`leagues.errors.${denied ? code : 'LEAGUE_UNAVAILABLE'}`)}
        </p>
        <div {...stylex.props(styles.actions)}>
          {!denied && (
            <Button variant="secondary" busy={busy} onClick={retry}>
              {t('leagues.retry')}
            </Button>
          )}
          <Link to="/dashboard" {...stylex.props(styles.actionLink)}>
            {t('leagues.backToDashboard')}
          </Link>
        </div>
      </SurfaceCard>
    </main>
  );
}
