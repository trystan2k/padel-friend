import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { getBrowserClient } from '../../lib/supabase/client';
import { styles } from './reset-password.styles';

type ValidationError = 'short' | 'mismatch' | null;

export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError>(null);
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => setReady(true), []);

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
        setRequestFailed(true);
        setBusy(false);
        return;
      }
      await navigate({ to: '/dashboard' });
    } catch {
      setRequestFailed(true);
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
        <h1 {...stylex.props(styles.title)}>{t('auth.resetTitle')}</h1>
        <p {...stylex.props(styles.subtitle)}>{t('auth.resetDescription')}</p>
      </header>

      <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.form)}>
        <PasswordField
          id="reset-password"
          name="password"
          label={t('auth.resetNewPasswordLabel')}
          placeholder={t('auth.resetNewPasswordPlaceholder')}
          autoComplete="new-password"
          required
          disabled={!ready || busy}
          error={validationError === 'short' ? t('auth.resetInvalid') : undefined}
          onChange={() => setValidationError(null)}
        />
        <PasswordField
          id="reset-password-confirmation"
          name="confirmation"
          label={t('auth.resetConfirmPasswordLabel')}
          placeholder={t('auth.resetConfirmPlaceholder')}
          autoComplete="new-password"
          required
          disabled={!ready || busy}
          helper={t('auth.resetRequirements')}
          helperXstyle={styles.requirementsHelper}
          error={validationError === 'mismatch' ? t('auth.resetMismatch') : undefined}
          onChange={() => setValidationError(null)}
        />
        <Button type="submit" size="large" disabled={!ready} busy={busy}>
          {t('auth.resetSubmit')}
        </Button>
        {requestFailed && (
          <p role="alert" {...stylex.props(styles.error)}>
            {t('auth.resetFailed')}
          </p>
        )}
      </form>
    </main>
  );
}
