import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { getBrowserClient } from '../../lib/supabase/client';
import { AuthActionBar, AuthTopBar } from '../auth/AuthChrome';
import { chromeStyles } from '../auth/auth-chrome.styles';
import { styles } from './provisional-claim-verify.styles';

/**
 * Shown to a provisional session whose mailbox ownership is not established
 * (password or unverified-signup session). Claiming needs the invitation link,
 * Google, or the password-recovery email, so this step signs out and hands over to
 * the existing recovery flow, which verifies the address and returns here.
 */
export function ProvisionalClaimVerify() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function startRecovery() {
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await getBrowserClient().auth.signOut();
      if (error) throw error;
      window.location.assign('/forgot-password');
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(chromeStyles.page)}>
      <AuthTopBar title={t('auth.claim.verifyBarTitle')} />
      <div {...stylex.props(chromeStyles.content, chromeStyles.contentTight)}>
        <StepBadge>{t('auth.claim.step')}</StepBadge>
        <header {...stylex.props(chromeStyles.heading)}>
          <h1 {...stylex.props(chromeStyles.title)}>{t('auth.claim.verifyTitle')}</h1>
          <p {...stylex.props(chromeStyles.body)}>{t('auth.claim.verifySubtitle')}</p>
        </header>
        <SurfaceCard xstyle={styles.optionsCard}>
          <h2 {...stylex.props(styles.optionsTitle)}>{t('auth.claim.verifyOptionsTitle')}</h2>
          <p {...stylex.props(styles.optionsCopy)}>{t('auth.claim.verifyOptions')}</p>
        </SurfaceCard>
        {failed && (
          <p role="alert" {...stylex.props(chromeStyles.error)}>
            {t('auth.claim.verifyFailed')}
          </p>
        )}
      </div>
      <AuthActionBar>
        <Button type="button" busy={busy} onClick={() => void startRecovery()}>
          {t('auth.claim.verifyAction')}
        </Button>
      </AuthActionBar>
    </main>
  );
}
