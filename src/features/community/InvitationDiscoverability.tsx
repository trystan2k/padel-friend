import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getMyInviteeDiscoverability,
  setMyInviteeDiscoverability
} from './community-invitee.functions';

export function InvitationDiscoverability() {
  const { t } = useTranslation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    void getMyInviteeDiscoverability()
      .then(({ enabled: value }) => setEnabled(value))
      .catch(() => setError(true))
      .finally(() => setBusy(false));
  }, []);
  async function change(value: boolean) {
    setBusy(true);
    setError(false);
    try {
      const result = await setMyInviteeDiscoverability({ data: { enabled: value } });
      setEnabled(result.enabled);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-busy={busy}>
      <label>
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
      {!busy && !error && <p aria-live="polite">{t('communityInvites.discoverabilitySaved')}</p>}
    </section>
  );
}
