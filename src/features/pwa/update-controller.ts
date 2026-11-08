import { SKIP_WAITING_MESSAGE } from './sw-policy';

export type UpdatePhase = 'idle' | 'available' | 'applying' | 'blocked' | 'error';
export type UpdateSnapshot = { phase: UpdatePhase };

type WorkerLike = EventTarget & {
  state: string;
  postMessage(message: unknown): void;
};
type RegistrationLike = EventTarget & {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
};
type ContainerLike = EventTarget & {
  controller: unknown;
  register(scriptUrl: string, options: { scope: string }): Promise<RegistrationLike>;
};

export type UpdateController = ReturnType<typeof createUpdateController>;

// Owns the service-worker update lifecycle: registration, waiting-worker detection, the user-confirmed
// SKIP_WAITING and exactly one reload. A reload is never automatic while the guard reports pending
// work: the offer is deferred (phase "blocked") and the page keeps its state.
export function createUpdateController({
  container,
  isBlocked,
  subscribeBlocked,
  reload,
  scriptUrl = '/sw.js'
}: {
  container: ContainerLike;
  isBlocked: () => boolean;
  subscribeBlocked: (listener: () => void) => () => void;
  reload: () => void;
  scriptUrl?: string;
}) {
  let snapshot: UpdateSnapshot = { phase: 'idle' };
  let waiting: WorkerLike | null = null;
  let requested = false;
  let reloadPending = false;
  let reloaded = false;
  let disposed = false;
  const listeners = new Set<() => void>();
  const cleanups: Array<() => void> = [];

  const setPhase = (phase: UpdatePhase) => {
    if (snapshot.phase === phase) return;
    snapshot = { phase };
    listeners.forEach((listener) => listener());
  };
  const listen = (target: EventTarget, type: string, handler: () => void) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };
  const doReload = () => {
    if (reloaded) return;
    reloaded = true;
    reload();
  };
  const offer = (worker: WorkerLike) => {
    waiting = worker;
    listen(worker, 'statechange', () => {
      if (worker.state === 'redundant' && requested) {
        requested = false;
        setPhase('error');
      }
    });
    setPhase('available');
  };
  const track = (registration: RegistrationLike) => {
    if (registration.waiting && container.controller) offer(registration.waiting);
    listen(registration, 'updatefound', () => {
      const installing = registration.installing;
      if (!installing) return;
      listen(installing, 'statechange', () => {
        if (installing.state === 'installed' && container.controller) offer(installing);
      });
    });
  };

  listen(container, 'controllerchange', () => {
    if (!requested || reloaded) return;
    requested = false;
    if (isBlocked()) {
      reloadPending = true;
      setPhase('blocked');
      return;
    }
    doReload();
  });
  cleanups.push(
    subscribeBlocked(() => {
      if (snapshot.phase === 'blocked' && !isBlocked()) setPhase('available');
    })
  );

  return {
    async start() {
      try {
        const registration = await container.register(scriptUrl, { scope: '/' });
        if (!disposed) track(registration);
      } catch {
        // Registration is progressive enhancement: the app keeps working online without a worker.
      }
    },
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply() {
      if (isBlocked()) {
        setPhase('blocked');
        return;
      }
      if (reloadPending) {
        doReload();
        return;
      }
      if (!waiting) {
        setPhase('error');
        return;
      }
      requested = true;
      setPhase('applying');
      waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
    },
    dismiss() {
      setPhase('idle');
    },
    dispose() {
      disposed = true;
      cleanups.splice(0).forEach((cleanup) => cleanup());
      listeners.clear();
    }
  };
}
