import * as stylex from '@stylexjs/stylex';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { getBrowserClient } from '../../lib/supabase/client';
import { ui } from './player-ui.styles';

type ValidationError = 'short' | 'mismatch' | null;

/**
 * The claim drops any password the identity carried, so a claimant who proved the
 * mailbox through a recovery or invite link finishes without one. A verified
 * provider identity is a working sign-in method, so only then may the step be skipped.
 */
export function ClaimPasswordStep({
  canSkip,
  onDone,
  onSessionLost
}: {
  canSkip: boolean;
  onDone: () => void;
  onSessionLost: () => void;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError>(null);
  const [requestFailed, setRequestFailed] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const passwordValue = form.get('password');
    const confirmationValue = form.get('confirmation');
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const confirmation = typeof confirmationValue === 'string' ? confirmationValue : '';
    if (password.length < 8) {
      setValidationError('short');
      return;
    }
    if (password !== confirmation) {
      setValidationError('mismatch');
      return;
    }
    setBusy(true);
    setValidationError(null);
    setRequestFailed(false);
    try {
      const { error } = await getBrowserClient().auth.updateUser({ password });
      if (error) {
        if (error.name === 'AuthSessionMissingError' || error.status === 401) {
          onSessionLost();
          return;
        }
        setRequestFailed(true);
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setRequestFailed(true);
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(ui.page, ui.onboardingPage)}>
      <header {...stylex.props(ui.header)}>
        <h1 {...stylex.props(ui.title)}>{t('auth.claim.passwordTitle')}</h1>
        <p {...stylex.props(ui.subtitle)}>{t('auth.claim.passwordSubtitle')}</p>
      </header>
      <form onSubmit={(event) => void submit(event)} noValidate {...stylex.props(ui.stack)}>
        <PasswordField
          id="claim-password"
          name="password"
          label={t('auth.resetNewPasswordLabel')}
          placeholder={t('auth.resetNewPasswordPlaceholder')}
          autoComplete="new-password"
          required
          disabled={busy}
          error={validationError === 'short' ? t('auth.resetInvalid') : undefined}
          onChange={() => setValidationError(null)}
        />
        <PasswordField
          id="claim-password-confirmation"
          name="confirmation"
          label={t('auth.resetConfirmPasswordLabel')}
          placeholder={t('auth.resetConfirmPlaceholder')}
          autoComplete="new-password"
          required
          disabled={busy}
          helper={t('auth.resetRequirements')}
          error={validationError === 'mismatch' ? t('auth.resetMismatch') : undefined}
          onChange={() => setValidationError(null)}
        />
        {requestFailed && (
          <p role="alert" {...stylex.props(ui.error)}>
            {t('auth.resetFailed')}
          </p>
        )}
        <Button type="submit" busy={busy}>
          {t('auth.resetSubmit')}
        </Button>
        {canSkip && (
          <>
            <p {...stylex.props(ui.muted)}>{t('auth.claim.passwordSkipHelp')}</p>
            <Button type="button" variant="secondary" disabled={busy} onClick={onDone}>
              {t('auth.claim.passwordSkip')}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}
