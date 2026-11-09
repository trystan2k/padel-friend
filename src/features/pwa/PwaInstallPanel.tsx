import { Button } from '@base-ui/react/button';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { promptInstall, useInstallState } from './install-state';
import { pwaStyles as styles } from './pwa.styles';

// Inline install guidance for the notification preferences area. It never prompts on its own and
// renders nothing until the client has detected the device, so SSR and hydration agree.
export function PwaInstallPanel() {
  const { t } = useTranslation();
  const state = useInstallState();
  const [failed, setFailed] = useState(false);
  const [prompting, setPrompting] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
        ref={titleRef}
        tabIndex={-1}
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
          {...stylex.props(styles.action, prompting && styles.disabledLook)}
          disabled={prompting}
          focusableWhenDisabled
          onClick={(event) => {
            if (prompting) return;
            // The offer is withdrawn once the outcome is known. Focus moves to the persistent heading only
            // if the trigger held it and it was lost with the trigger; focus the user moved elsewhere stays.
            const trigger = event.currentTarget;
            const hadFocus = document.activeElement === trigger;
            setPrompting(true);
            void promptInstall().then((outcome) => {
              setPrompting(false);
              setFailed(outcome === 'unavailable');
              const owner = document.activeElement;
              const lost =
                !owner || owner === document.body || owner === trigger || !owner.isConnected;
              if (hadFocus && lost) titleRef.current?.focus();
            });
          }}
        >
          {t('pwa.install.action')}
        </Button>
      )}
    </section>
  );
}
