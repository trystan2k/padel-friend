import { useEffect, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { createBrowserPushDeps } from './push-browser';
import { createPushController, type PushSnapshot } from './push-controller';

const SERVER_SNAPSHOT: PushSnapshot = { status: 'loading', pending: null, otherDevices: 0 };

// Reconciles the device on entry, on focus/visibility, on connectivity changes, on locale change and
// when the browser reports a permission change. Nothing here ever requests permission.
export function usePushDevice() {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const [controller] = useState(() =>
    createPushController(createBrowserPushDeps(() => i18n.language))
  );
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    () => SERVER_SNAPSHOT
  );
  useEffect(() => {
    const reconcile = () => void controller.reconcile();
    const onVisible = () => {
      if (document.visibilityState === 'visible') reconcile();
    };
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    window.addEventListener('offline', reconcile);
    document.addEventListener('visibilitychange', onVisible);
    let permissionStatus: PermissionStatus | null = null;
    let disposed = false;
    void navigator.permissions
      ?.query({ name: 'notifications' })
      .then((status) => {
        if (disposed) return;
        permissionStatus = status;
        status.addEventListener('change', reconcile);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      window.removeEventListener('offline', reconcile);
      document.removeEventListener('visibilitychange', onVisible);
      permissionStatus?.removeEventListener('change', reconcile);
      controller.dispose();
    };
  }, [controller]);
  // Mount and locale change: refresh the registration (and its stored locale) without resubscribing.
  useEffect(() => {
    if (language) void controller.reconcile();
  }, [controller, language]);
  return { controller, snapshot };
}
