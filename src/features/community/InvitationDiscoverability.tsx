import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMyInviteeDiscoverability,
  setMyInviteeDiscoverability
} from './community-invitee.functions';

const styles = stylex.create({
  consentLabel: {
    boxSizing: 'border-box',
    minHeight: 'calc(var(--space-40) + var(--space-4))',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-6)'
  }
});

export function InvitationDiscoverability() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getMyInviteeDiscoverability()
      .then(({ enabled: value }) => setEnabled(value))
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }, []);
  async function change(value: boolean) {
    setSaved(false);
    setBusy(true);
    setError(false);
    try {
      const result = await setMyInviteeDiscoverability({ data: { enabled: value } });
      setEnabled(result.enabled);
      setSaved(true);
    } catch {
      setSaved(false);
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-busy={busy}>
      <label {...stylex.props(styles.consentLabel)}>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />{' '}
        {t('communityInvites.discoverableLabel')}
      </label>
      <p>{t('communityInvites.discoverableHelp')}</p>
      {error && <p role="alert">{t('communityInvites.discoverabilityError')}</p>}
      {saved && <p aria-live="polite">{t('communityInvites.discoverabilitySaved')}</p>}
    </section>
  );
}
