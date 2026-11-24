import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { getBrowserClient } from '../../lib/supabase/client';
import { useHydrated } from '../../lib/use-hydrated';
import { PASSWORD_MIN_LENGTH, isPasswordValid } from './password-policy';
import { AuthActionBar, AuthTopBar } from './AuthChrome';
import { chromeStyles } from './auth-chrome.styles';
import { styles } from './reset-password.styles';

type ValidationError = 'short' | 'mismatch' | null;

export function ResetPassword() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ready = useHydrated();
  const [busy, setBusy] = useState(false);
  const [validationError, setValidationError] = useState<ValidationError>(null);
  const [requestFailed, setRequestFailed] = useState(false);
  const [typedPassword, setTypedPassword] = useState('');
  const [typedConfirmation, setTypedConfirmation] = useState('');
  // Presentation only: submit() still validates with isPasswordValid and the match check.
  const rules = [
    {
      key: 'policy',
      met: isPasswordValid(typedPassword),
      label: t('auth.passwordRequirements', { min: PASSWORD_MIN_LENGTH })
    },
    {
      key: 'match',
      met: typedConfirmation !== '' && typedConfirmation === typedPassword,
      label: t('auth.resetRuleMatch')
    }
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const passwordValue = form.get('password');
    const confirmationValue = form.get('confirmation');
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const confirmation = typeof confirmationValue === 'string' ? confirmationValue : '';

    if (!isPasswordValid(password)) {
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
    <main {...stylex.props(chromeStyles.page)}>
      <AuthTopBar title={t('auth.resetBarTitle')} />
      <form onSubmit={(event) => void submit(event)} {...stylex.props(chromeStyles.form)}>
        <div {...stylex.props(chromeStyles.content)}>
          <h1 {...stylex.props(chromeStyles.title)}>{t('auth.resetTitle')}</h1>
          <PasswordField
            id="reset-password"
            name="password"
            label={t('auth.resetNewPasswordLabel')}
            placeholder={t('auth.resetNewPasswordPlaceholder')}
            autoComplete="new-password"
            required
            disabled={!ready || busy}
            aria-describedby="reset-password-rules"
            error={
              validationError === 'short'
                ? t('auth.passwordInvalid', { min: PASSWORD_MIN_LENGTH })
                : undefined
            }
            onChange={(event) => {
              setTypedPassword(event.target.value);
              setValidationError(null);
            }}
          />
          <PasswordField
            id="reset-password-confirmation"
            name="confirmation"
            label={t('auth.resetConfirmPasswordLabel')}
            placeholder={t('auth.resetConfirmPlaceholder')}
            autoComplete="new-password"
            required
            disabled={!ready || busy}
            aria-describedby="reset-password-rules"
            error={validationError === 'mismatch' ? t('auth.resetMismatch') : undefined}
            onChange={(event) => {
              setTypedConfirmation(event.target.value);
              setValidationError(null);
            }}
          />
          <ul id="reset-password-rules" {...stylex.props(styles.rules)}>
            {rules.map(({ key, met, label }) => (
              <li key={key} {...stylex.props(styles.rule, met && styles.ruleMet)}>
                <span aria-hidden="true">{met ? '✓' : '○'}</span>
                <span>
                  {label}
                  <span {...stylex.props(chromeStyles.srOnly)}>
                    {' '}
                    {t(met ? 'auth.ruleMet' : 'auth.ruleUnmet')}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {requestFailed && (
            <p role="alert" {...stylex.props(chromeStyles.error)}>
              {t('auth.resetFailed')}
            </p>
          )}
        </div>
        <AuthActionBar>
          <Button type="submit" disabled={!ready} busy={busy}>
            {t('auth.resetSubmit')}
          </Button>
        </AuthActionBar>
      </form>
    </main>
  );
}
