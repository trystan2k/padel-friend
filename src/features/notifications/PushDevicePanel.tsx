import { Button } from '@base-ui/react/button';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { preferenceStyles as styles } from './notification-preferences.styles';
import type { PushStatus } from './push-controller';
import { usePushDevice } from './use-push-device';

const ENABLE_STATUSES: PushStatus[] = [
  'permissionDefault',
  'grantedNotSubscribed',
  'expired',
  'keyChanged',
  'deviceDisabled'
];
const FAILURE_STATUSES: PushStatus[] = ['subscriptionFailed', 'saveFailed', 'cleanupFailed'];
// States that cannot deliver Web Push: the in-app fallback line is repeated so it stays visible.
const FALLBACK_STATUSES: PushStatus[] = [
  ...FAILURE_STATUSES,
  'configUnavailable',
  'unsupported',
  'installRequired',
  'denied'
];

// Device-level Web Push control. The saved preference is intent only; "enabled" is shown from the
// native subscription and registry state. Permission is requested solely by the Enable button.
export function PushDevicePanel({ savedIntent }: { savedIntent: boolean }) {
  const { t } = useTranslation();
  const { controller, snapshot } = usePushDevice();
  const { status, pending, otherDevices } = snapshot;
  const failed = FAILURE_STATUSES.includes(status);
  const message = status === 'enabled' && !savedIntent ? 'intentOff' : status;
  const busy = pending !== null;
  const retry =
    status === 'cleanupFailed'
      ? () => void controller.disableDevice()
      : status === 'configUnavailable'
        ? () => void controller.reconcile()
        : () => void controller.enable();
  return (
    <section aria-labelledby="push-device-title" aria-busy={busy} {...stylex.props(styles.device)}>
      <h2
        id="push-device-title"
        {...stylex.props(
          styles.deviceTitle,
          status === 'enabled' && styles.deviceTitleOk,
          (failed || status === 'denied') && styles.deviceTitleFailed
        )}
      >
        {t('push.title')}
      </h2>
      <output aria-live="polite" {...stylex.props(styles.deviceCopy)}>
        {failed ? '' : t(`push.${message}`)}
      </output>
      {failed && (
        <p role="alert" {...stylex.props(styles.deviceCopy, styles.deviceAlert)}>
          {t(`push.${status}`)}
        </p>
      )}
      {FALLBACK_STATUSES.includes(status) && (
        <p {...stylex.props(styles.deviceCopy, styles.deviceFallback)}>{t('push.fallback')}</p>
      )}
      {otherDevices > 0 && (
        <p {...stylex.props(styles.deviceCopy)}>
          {t('push.otherDevices', { count: otherDevices })}
        </p>
      )}
      {(ENABLE_STATUSES.includes(status) || (pending === 'enabling' && !failed)) && (
        <Button
          type="button"
          disabled={busy}
          focusableWhenDisabled
          onClick={() => void controller.enable()}
          {...stylex.props(styles.deviceAction, busy && styles.disabledLook)}
        >
          {pending === 'enabling' ? t('push.enabling') : t('push.enable')}
        </Button>
      )}
      {(status === 'enabled' || (pending === 'disabling' && !failed)) && (
        <Button
          type="button"
          disabled={busy}
          focusableWhenDisabled
          onClick={() => void controller.disableDevice()}
          {...stylex.props(
            styles.deviceAction,
            styles.deviceSecondary,
            busy && styles.disabledLook
          )}
        >
          {pending === 'disabling' ? t('push.disabling') : t('push.disableDevice')}
        </Button>
      )}
      {(failed || status === 'configUnavailable') && (
        <Button
          type="button"
          disabled={busy}
          focusableWhenDisabled
          onClick={retry}
          {...stylex.props(styles.deviceAction, busy && styles.disabledLook)}
        >
          {pending
            ? t(pending === 'enabling' ? 'push.enabling' : 'push.disabling')
            : t('push.retry')}
        </Button>
      )}
    </section>
  );
}
