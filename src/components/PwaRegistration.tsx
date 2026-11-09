import { Button } from '@base-ui/react/button';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { captureInstallPrompt } from '../features/pwa/install-state';
import { pwaStyles as styles } from '../features/pwa/pwa.styles';
import { createBrowserUpdateStore } from '../features/pwa/update-store';

export function PwaRegistration() {
  const { t } = useTranslation();
  const [store] = useState(createBrowserUpdateStore);
  // Keeps the install listeners alive for the app lifetime so an early beforeinstallprompt is retained
  // until the install panel consumes it.
  useEffect(captureInstallPrompt, []);
  const { phase } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
  if (phase === 'idle') return null;
  const message =
    phase === 'blocked'
      ? 'pwa.update.dirtyForm'
      : phase === 'error'
        ? 'pwa.update.error'
        : 'pwa.update.available';
  return (
    <section
      role={phase === 'error' ? 'alert' : 'status'}
      aria-live={phase === 'error' ? 'assertive' : 'polite'}
      aria-busy={phase === 'applying'}
      {...stylex.props(styles.banner)}
    >
      <p {...stylex.props(styles.copy)}>{t(message)}</p>
      <div {...stylex.props(styles.actions)}>
        {(phase === 'available' || phase === 'applying') && (
          <Button
            type="button"
            disabled={phase === 'applying'}
            {...stylex.props(styles.action)}
            onClick={() => store.apply()}
          >
            {t('pwa.update.apply')}
          </Button>
        )}
        <Button
          type="button"
          {...stylex.props(styles.action, styles.secondary)}
          onClick={() => store.dismiss()}
        >
          {t('pwa.update.later')}
        </Button>
      </div>
    </section>
  );
}
