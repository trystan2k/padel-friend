import { Button } from '@base-ui/react/button';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { promptInstall, useInstallState } from './install-state';
import { pwaStyles as styles } from './pwa.styles';

// Inline install guidance for the notification preferences area. It never prompts on its own and
// renders nothing until the client has detected the device, so SSR and hydration agree.
export function PwaInstallPanel() {
  const { t } = useTranslation();
  const state = useInstallState();
  const [failed, setFailed] = useState(false);
  if (!state.ready) return null;
  const message = state.installed
    ? 'pwa.install.installed'
    : !state.supported
      ? 'pwa.install.unsupported'
      : state.ios
        ? 'pwa.install.iosInstructions'
        : 'pwa.install.browserInstructions';
  return (
    <section aria-labelledby="pwa-install-title" {...stylex.props(styles.install)}>
      <h2
        id="pwa-install-title"
        {...stylex.props(styles.installTitle, state.installed && styles.installedTitle)}
      >
        {t('pwa.install.title')}
      </h2>
      {!state.canPrompt && <p {...stylex.props(styles.copy)}>{t(message)}</p>}
      {failed && (
        <p role="alert" {...stylex.props(styles.copy, styles.alert)}>
          {t('pwa.install.unavailable')}
        </p>
      )}
      {state.canPrompt && (
        <Button
          type="button"
          {...stylex.props(styles.action)}
          onClick={() => {
            void promptInstall().then((outcome) => setFailed(outcome === 'unavailable'));
          }}
        >
          {t('pwa.install.action')}
        </Button>
      )}
    </section>
  );
}
