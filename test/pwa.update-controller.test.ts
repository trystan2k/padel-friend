import { describe, expect, it, vi } from 'vitest';
import { createUpdateController } from '../src/features/pwa/update-controller';

class FakeWorker extends EventTarget {
  state = 'installed';
  postMessage = vi.fn<(message: unknown) => void>();
}
class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = null;
  installing: FakeWorker | null = null;
}
class FakeContainer extends EventTarget {
  controller: unknown = {};
  registration = new FakeRegistration();
  register = vi.fn<() => Promise<FakeRegistration>>(() => Promise.resolve(this.registration));
}

function setup(options: { controlled?: boolean; blocked?: boolean } = {}) {
  const container = new FakeContainer();
  if (options.controlled === false) container.controller = null;
  const guard = { blocked: options.blocked ?? false, listeners: new Set<() => void>() };
  const reload = vi.fn<() => void>();
  const controller = createUpdateController({
    container,
    isBlocked: () => guard.blocked,
    subscribeBlocked: (listener) => {
      guard.listeners.add(listener);
      return () => guard.listeners.delete(listener);
    },
    reload
  });
  const setBlocked = (value: boolean) => {
    guard.blocked = value;
    guard.listeners.forEach((listener) => listener());
  };
  return { container, controller, reload, guard, setBlocked };
}

describe('update controller', () => {
  it('registers /sw.js at scope / and survives registration failure', async () => {
    const { container, controller } = setup();
    await controller.start();
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });

    const failing = setup();
    failing.container.register.mockRejectedValueOnce(new Error('denied'));
    await expect(failing.controller.start()).resolves.toBeUndefined();
    expect(failing.controller.getSnapshot().phase).toBe('idle');
  });

  it('offers an already-waiting worker only when a worker currently controls the page', async () => {
    const waiting = setup();
    waiting.container.registration.waiting = new FakeWorker();
    await waiting.controller.start();
    expect(waiting.controller.getSnapshot().phase).toBe('available');

    const firstInstall = setup({ controlled: false });
    firstInstall.container.registration.waiting = new FakeWorker();
    await firstInstall.controller.start();
    expect(firstInstall.controller.getSnapshot().phase).toBe('idle');
  });

  it('offers a worker that finishes installing after updatefound, never activating it by itself', async () => {
    const { container, controller, reload } = setup();
    await controller.start();
    const worker = new FakeWorker();
    worker.state = 'installing';
    container.registration.installing = worker;
    container.registration.dispatchEvent(new Event('updatefound'));
    expect(controller.getSnapshot().phase).toBe('idle');
    worker.state = 'installed';
    worker.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('available');
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('sends SKIP_WAITING only on confirmation and reloads exactly once', async () => {
    const { container, controller, reload } = setup();
    const worker = new FakeWorker();
    container.registration.waiting = worker;
    await controller.start();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(worker.postMessage).not.toHaveBeenCalled();

    controller.apply();
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(controller.getSnapshot().phase).toBe('applying');
    container.dispatchEvent(new Event('controllerchange'));
    container.dispatchEvent(new Event('controllerchange'));
    controller.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores controllerchange events nobody asked for', async () => {
    const { container, controller, reload } = setup();
    await controller.start();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });

  it('defers the update while work is pending and offers it again once the guard clears', async () => {
    const { container, controller, reload, setBlocked } = setup({ blocked: true });
    const worker = new FakeWorker();
    container.registration.waiting = worker;
    await controller.start();
    controller.apply();
    expect(controller.getSnapshot().phase).toBe('blocked');
    expect(worker.postMessage).not.toHaveBeenCalled();
    setBlocked(false);
    expect(controller.getSnapshot().phase).toBe('available');
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the page when work starts after confirmation and reloads only after a second confirmation', async () => {
    const { container, controller, reload, setBlocked } = setup();
    container.registration.waiting = new FakeWorker();
    await controller.start();
    controller.apply();
    setBlocked(true);
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('blocked');
    controller.apply();
    expect(reload).not.toHaveBeenCalled();
    setBlocked(false);
    expect(reload).not.toHaveBeenCalled();
    expect(controller.getSnapshot().phase).toBe('available');
    controller.apply();
    controller.apply();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reports an error when the waiting worker is discarded after confirmation', async () => {
    const { container, controller } = setup();
    const worker = new FakeWorker();
    container.registration.waiting = worker;
    await controller.start();
    controller.apply();
    worker.state = 'redundant';
    worker.dispatchEvent(new Event('statechange'));
    expect(controller.getSnapshot().phase).toBe('error');
  });

  it('lets the user dismiss the offer without sending anything', async () => {
    const { container, controller } = setup();
    const worker = new FakeWorker();
    container.registration.waiting = worker;
    await controller.start();
    controller.dismiss();
    expect(controller.getSnapshot().phase).toBe('idle');
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('removes every listener on dispose', async () => {
    const { container, controller, reload, guard } = setup();
    const worker = new FakeWorker();
    container.registration.waiting = worker;
    await controller.start();
    controller.apply();
    controller.dispose();
    expect(guard.listeners.size).toBe(0);
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
  });
});
