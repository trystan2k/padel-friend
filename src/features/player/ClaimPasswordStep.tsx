import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { getBrowserClient } from '../../lib/supabase/client';
import { AuthActionBar, AuthTopBar } from '../auth/AuthChrome';
import { chromeStyles } from '../auth/auth-chrome.styles';
import { PasswordStrength } from '../auth/PasswordStrength';
import { PASSWORD_MIN_LENGTH, isPasswordValid } from '../auth/password-policy';
import { styles as ruleStyles } from '../auth/reset-password.styles';
import { normalizeReturnPath } from '../auth/return-path';
import { getPasswordSetupState } from './player.functions';

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
    <main {...stylex.props(chromeStyles.page)}>
      <AuthTopBar title={t('auth.claim.passwordBarTitle')} />
      <form
        onSubmit={(event) => void submit(event)}
        noValidate
        {...stylex.props(chromeStyles.form)}
      >
        <div {...stylex.props(chromeStyles.content, chromeStyles.contentTight)}>
          <header {...stylex.props(chromeStyles.heading)}>
            <h1
              ref={headingRef}
              tabIndex={-1}
              {...stylex.props(chromeStyles.title, chromeStyles.headingFocus)}
            >
              {t('auth.claim.passwordTitle')}
            </h1>
            <p {...stylex.props(chromeStyles.body)}>{t('auth.claim.passwordSubtitle')}</p>
          </header>
          <PasswordField
            id="claim-password"
            name="password"
            label={t('auth.resetNewPasswordLabel')}
            placeholder={t('auth.resetNewPasswordPlaceholder')}
            autoComplete="new-password"
            required
            disabled={busy}
            aria-describedby="claim-password-rules"
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
            id="claim-password-confirmation"
            name="confirmation"
            label={t('auth.resetConfirmPasswordLabel')}
            placeholder={t('auth.resetConfirmPlaceholder')}
            autoComplete="new-password"
            required
            disabled={busy}
            aria-describedby="claim-password-rules"
            error={validationError === 'mismatch' ? t('auth.resetMismatch') : undefined}
            onChange={(event) => {
              setTypedConfirmation(event.target.value);
              setValidationError(null);
            }}
          />
          <PasswordStrength password={typedPassword} />
          <ul id="claim-password-rules" {...stylex.props(ruleStyles.rules)}>
            {rules.map(({ key, met, label }) => (
              <li key={key} {...stylex.props(ruleStyles.rule, met && ruleStyles.ruleMet)}>
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
          <Button type="submit" busy={busy}>
            {t('auth.resetSubmit')}
          </Button>
          {canSkip && (
            <>
              <p {...stylex.props(chromeStyles.barNote)}>{t('auth.claim.passwordSkipHelp')}</p>
              <Button type="button" variant="secondary" disabled={busy} onClick={done}>
                {t('auth.claim.passwordSkip')}
              </Button>
            </>
          )}
        </AuthActionBar>
      </form>
    </main>
  );
}
