import {
  createUpdateController,
  type UpdateController,
  type UpdateSnapshot
} from './update-controller';
import { isUpdateBlocked, subscribeUpdateGuard } from './update-guard';

const IDLE: UpdateSnapshot = { phase: 'idle' };

// Browser binding of the update controller for React: the controller (and its service-worker
// registration) exists only while the store has a subscriber, i.e. on the client in production.
export function createBrowserUpdateStore() {
  let controller: UpdateController | null = null;
  return {
    subscribe: (listener: () => void) => {
      if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return () => undefined;
      const active = createUpdateController({
        container: navigator.serviceWorker,
        isBlocked: isUpdateBlocked,
        subscribeBlocked: subscribeUpdateGuard,
        reload: () => window.location.reload()
      });
      controller = active;
      const unsubscribe = active.subscribe(listener);
      void active.start();
      return () => {
        unsubscribe();
        active.dispose();
        controller = null;
      };
    },
    getSnapshot: () => controller?.getSnapshot() ?? IDLE,
    getServerSnapshot: () => IDLE,
    apply: () => controller?.apply(),
    dismiss: () => controller?.dismiss()
  };
}
