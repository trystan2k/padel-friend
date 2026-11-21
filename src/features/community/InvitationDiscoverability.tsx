import * as stylex from '@stylexjs/stylex';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { inboxStyles } from './community-inbox.styles';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
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
    gap: 'var(--space-12)',
    fontWeight: 'var(--font-weight-semibold)'
  },
  checkbox: {
    flexShrink: 0,
    width: 'var(--space-20)',
    height: 'var(--space-20)',
    accentColor: 'var(--color-green)'
  }
});

export function InvitationDiscoverability() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void getMyInviteeDiscoverability()
      .then(({ enabled: value }) => setEnabled(value))
      .catch(() => setError('discoverabilityError'))
      .finally(() => setBusy(false));
  }, []);
  async function change(value: boolean) {
    setSaved(false);
    setError('');
    if (isOffline()) {
      setError('discoverabilityOffline');
      return;
    }
    setBusy(true);
    try {
      const result = await setMyInviteeDiscoverability({ data: { enabled: value } });
      setEnabled(result.enabled);
      setSaved(true);
    } catch (cause) {
      setSaved(false);
      if (isTransportFailure(cause)) {
        // The write may have committed: show the stored preference instead of the optimistic one.
        setError('discoverabilityUnconfirmed');
        await getMyInviteeDiscoverability()
          .then(({ enabled: stored }) => setEnabled(stored))
          .catch(() => undefined);
      } else setError('discoverabilityError');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SurfaceCard aria-busy={busy} xstyle={inboxStyles.card}>
      <label {...stylex.props(styles.consentLabel)}>
        <input
          type="checkbox"
          {...stylex.props(styles.checkbox)}
          aria-describedby="invite-discoverability-help"
          checked={enabled}
          disabled={busy}
          onChange={(event) => void change(event.target.checked)}
        />{' '}
        {t('communityInvites.discoverableLabel')}
      </label>
      <p id="invite-discoverability-help" {...stylex.props(inboxStyles.notice)}>
        {t('communityInvites.discoverableHelp')}
      </p>
      {error && <p role="alert">{t(`communityInvites.${error}`)}</p>}
      {saved && <p aria-live="polite">{t('communityInvites.discoverabilitySaved')}</p>}
    </SurfaceCard>
  );
}
