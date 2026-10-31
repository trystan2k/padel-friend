import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { getBrowserClient } from '../../lib/supabase/client';
import { normalizeReturnPath } from '../auth/return-path';
import { getPasswordSetupState } from './player.functions';
import { ui } from './player-ui.styles';

type ValidationError = 'short' | 'mismatch' | null;

/**
 * The claim drops any password the identity carried, so a claimant who proved the
 * mailbox through a recovery or invite link finishes without one. The server keeps
 * that debt (getOnboardingStatus) until it sees a password, so this step comes back
 * after a reload until it is done. `canSkip` must come from the server (a verified
 * provider identity exists), never from inspecting identities in the browser.
 */
export function ClaimPasswordStep({ canSkip = false, next }: { canSkip?: boolean; next?: string }) {
  const { t } = useTranslation();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError>(null);
  const [requestFailed, setRequestFailed] = useState(false);

  // The step replaces the claim form (or a whole page): move focus to its heading.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  const done = () => window.location.assign(normalizeReturnPath(next));

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
          window.location.assign('/login?expired=1');
          return;
        }
        setRequestFailed(true);
        setBusy(false);
        return;
      }
      // The server confirms the password took effect; it clears the debt itself.
      if ((await getPasswordSetupState()).pending) {
        setRequestFailed(true);
        setBusy(false);
        return;
      }
      done();
    } catch {
      setRequestFailed(true);
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(ui.page, ui.onboardingPage)}>
      <header {...stylex.props(ui.header)}>
        <h1 ref={headingRef} tabIndex={-1} {...stylex.props(ui.title)}>
          {t('auth.claim.passwordTitle')}
        </h1>
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
            <Button type="button" variant="secondary" disabled={busy} onClick={done}>
              {t('auth.claim.passwordSkip')}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}
