import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { StepBadge } from '../../components/ui/StepBadge';
import { getBrowserClient } from '../../lib/supabase/client';
import { ui } from './player-ui.styles';

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
    <main {...stylex.props(ui.page, ui.onboardingPage)}>
      <div {...stylex.props(ui.topContent)}>
        <StepBadge>{t('auth.claim.step')}</StepBadge>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>{t('auth.claim.verifyTitle')}</h1>
          <p {...stylex.props(ui.subtitle)}>{t('auth.claim.verifySubtitle')}</p>
        </header>
      </div>
      <HeroCard>
        <h2 {...stylex.props(ui.heroTitle)}>{t('auth.claim.verifyOptionsTitle')}</h2>
        <p {...stylex.props(ui.heroCopy)}>{t('auth.claim.verifyOptions')}</p>
      </HeroCard>
      {failed && (
        <p role="alert" {...stylex.props(ui.error)}>
          {t('auth.claim.verifyFailed')}
        </p>
      )}
      <Button type="button" busy={busy} onClick={() => void startRecovery()}>
        {t('auth.claim.verifyAction')}
      </Button>
    </main>
  );
}
