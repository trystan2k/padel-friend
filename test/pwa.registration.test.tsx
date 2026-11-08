/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PwaRegistration } from '../src/components/PwaRegistration';
import { useUpdateGuard } from '../src/features/pwa/update-guard';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';

const copy = en.pwa.update;

class FakeWorker extends EventTarget {
  state = 'installed';
  postMessage = vi.fn<(message: unknown) => void>();
}
class FakeRegistration extends EventTarget {
  waiting: FakeWorker | null = new FakeWorker();
  installing: FakeWorker | null = null;
}
class FakeContainer extends EventTarget {
  controller: unknown = {};
  registration = new FakeRegistration();
  register = vi.fn<() => Promise<FakeRegistration>>(() => Promise.resolve(this.registration));
}

let container: FakeContainer;
let reload: ReturnType<typeof vi.fn<() => void>>;
const requestPermission = vi.fn<() => Promise<string>>();

function Dirty() {
  useUpdateGuard(true);
  return null;
}

async function mount(children?: React.ReactNode) {
  const view = render(
    <I18nextProvider i18n={createI18n('en')}>
      <PwaRegistration />
      {children}
    </I18nextProvider>
  );
  await act(async () => {
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  vi.stubEnv('PROD', true);
  container = new FakeContainer();
  reload = vi.fn<() => void>();
  Object.defineProperty(window.navigator, 'serviceWorker', {
    value: container,
    configurable: true
  });
  vi.stubGlobal('Notification', { requestPermission });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined
  }));
  Object.defineProperty(window, 'location', {
    value: { reload },
    configurable: true
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
  requestPermission.mockClear();
});

describe('PwaRegistration', () => {
  it('registers the worker without prompting for any permission or showing UI', async () => {
    container.registration.waiting = null;
    await mount();
    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
    expect(requestPermission).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('does not register outside production', async () => {
    vi.stubEnv('PROD', false);
    await mount();
    expect(container.register).not.toHaveBeenCalled();
  });

  it('survives a failing registration without throwing or showing an error', async () => {
    container.register.mockRejectedValueOnce(new Error('insecure'));
    await mount();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('announces a waiting worker and activates it only after the user confirms', async () => {
    const worker = container.registration.waiting!;
    await mount();
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(copy.available);
    expect(worker.postMessage).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: copy.apply }));
    expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'SKIP_WAITING' });
    expect(screen.getByRole('status').getAttribute('aria-busy')).toBe('true');
    act(() => {
      container.dispatchEvent(new Event('controllerchange'));
      container.dispatchEvent(new Event('controllerchange'));
    });
    expect(reload).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('lets the user postpone the update', async () => {
    const worker = container.registration.waiting!;
    await mount();
    await userEvent.click(screen.getByRole('button', { name: copy.later }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('defers the update while an unsaved form or pending mutation is active, then offers it again', async () => {
    const worker = container.registration.waiting!;
    const view = await mount(<Dirty />);
    await userEvent.click(screen.getByRole('button', { name: copy.apply }));
    expect(screen.getByRole('status').textContent).toContain(copy.dirtyForm);
    expect(screen.queryByRole('button', { name: copy.apply })).toBeNull();
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    view.rerender(
      <I18nextProvider i18n={createI18n('en')}>
        <PwaRegistration />
      </I18nextProvider>
    );
    expect(screen.getByRole('button', { name: copy.apply })).toBeTruthy();
    expect(worker.postMessage).not.toHaveBeenCalled();
  });

  it('shows an assertive error when the update fails', async () => {
    const worker = container.registration.waiting!;
    await mount();
    await userEvent.click(screen.getByRole('button', { name: copy.apply }));
    act(() => {
      worker.state = 'redundant';
      worker.dispatchEvent(new Event('statechange'));
    });
    expect(screen.getByRole('alert').textContent).toContain(copy.error);
  });

  it('removes its listeners on unmount', async () => {
    const view = await mount();
    const worker = container.registration.waiting!;
    await userEvent.click(screen.getByRole('button', { name: copy.apply }));
    view.unmount();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).not.toHaveBeenCalled();
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
  });
});
