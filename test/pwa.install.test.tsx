/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToString } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import {
  captureInstallPrompt,
  detectPwaCapabilities,
  promptInstall
} from '../src/features/pwa/install-state';
import { PwaInstallPanel } from '../src/features/pwa/PwaInstallPanel';
import en from '../src/locales/en/translation.json';

const copy = en.pwa.install;

type Media = { matches: boolean; listeners: Set<() => void> };
let media: Media;

function mockEnvironment(
  options: { standalone?: boolean; userAgent?: string; secure?: boolean } = {}
) {
  media = { matches: options.standalone ?? false, listeners: new Set() };
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return media.matches;
    },
    addEventListener: (_type: string, listener: () => void) => media.listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => media.listeners.delete(listener)
  }));
  vi.stubGlobal('isSecureContext', options.secure ?? true);
  if (options.userAgent)
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(options.userAgent);
}

function mount() {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <PwaInstallPanel />
    </I18nextProvider>
  );
}

function installPromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true });
  const prompt = vi.fn<() => Promise<void>>(() => Promise.resolve());
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome }) });
  return { event, prompt };
}

beforeEach(() => {
  Object.defineProperty(window.navigator, 'serviceWorker', { value: {}, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window.navigator, 'serviceWorker');
});

describe('detectPwaCapabilities', () => {
  const fakeWindow = (overrides: Record<string, unknown>, nav: Record<string, unknown> = {}) => {
    const double = {
      isSecureContext: true,
      matchMedia: () => ({ matches: false }),
      navigator: {
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
        platform: 'Linux',
        maxTouchPoints: 0,
        ...nav
      },
      ...overrides
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a partial Window double is enough for capability probes
    return double as unknown as Window;
  };

  it('feature-detects secure context, ServiceWorker, PushManager and Notification', () => {
    expect(detectPwaCapabilities(fakeWindow({}))).toEqual({
      secureContext: true,
      serviceWorker: false,
      pushManager: false,
      notification: false,
      standalone: false,
      ios: false
    });
    expect(
      detectPwaCapabilities(
        fakeWindow({ PushManager: {}, Notification: {} }, { serviceWorker: {} })
      )
    ).toMatchObject({ serviceWorker: true, pushManager: true, notification: true });
    expect(detectPwaCapabilities(fakeWindow({ isSecureContext: false })).secureContext).toBe(false);
  });

  it('detects standalone through display-mode and the legacy iOS flag', () => {
    expect(
      detectPwaCapabilities(fakeWindow({ matchMedia: () => ({ matches: true }) })).standalone
    ).toBe(true);
    expect(detectPwaCapabilities(fakeWindow({}, { standalone: true })).standalone).toBe(true);
  });

  it('identifies iPhone, iPad and iPadOS desktop-mode devices', () => {
    expect(
      detectPwaCapabilities(
        fakeWindow({}, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })
      ).ios
    ).toBe(true);
    expect(
      detectPwaCapabilities(fakeWindow({}, { platform: 'MacIntel', maxTouchPoints: 5 })).ios
    ).toBe(true);
    expect(
      detectPwaCapabilities(fakeWindow({}, { platform: 'MacIntel', maxTouchPoints: 0 })).ios
    ).toBe(false);
  });
});

describe('PwaInstallPanel', () => {
  it('renders nothing on the server so hydration always matches', () => {
    mockEnvironment();
    const html = renderToString(
      <I18nextProvider i18n={createI18n('en')}>
        <PwaInstallPanel />
      </I18nextProvider>
    );
    expect(html).toBe('');
  });

  it('shows manual browser guidance when no install event is available', () => {
    mockEnvironment();
    mount();
    expect(screen.getByRole('heading', { name: copy.title })).toBeTruthy();
    expect(screen.getByText(copy.browserInstructions)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows Home Screen guidance on iOS and unsupported guidance without a worker-capable context', () => {
    mockEnvironment({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    mount();
    expect(screen.getByText(copy.iosInstructions)).toBeTruthy();
    cleanup();
    mockEnvironment({ secure: false });
    mount();
    expect(screen.getByText(copy.unsupported)).toBeTruthy();
  });

  it('reports an installed app from display-mode and reacts to later changes', () => {
    mockEnvironment({ standalone: true });
    mount();
    expect(screen.getByText(copy.installed)).toBeTruthy();
    act(() => {
      media.matches = false;
      media.listeners.forEach((listener) => listener());
    });
    expect(screen.getByText(copy.browserInstructions)).toBeTruthy();
  });

  it('offers install through beforeinstallprompt, prompts only on click and consumes the event', async () => {
    mockEnvironment();
    mount();
    const { event, prompt } = installPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: copy.action }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: copy.action })).toBeNull();
    expect(await promptInstall()).toBe('unavailable');
  });

  it('activates install from the keyboard and keeps the control a native focusable button', async () => {
    mockEnvironment();
    mount();
    const { event, prompt } = installPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    const button = screen.getByRole('button', { name: copy.action });
    expect(button.tagName).toBe('BUTTON');
    button.focus();
    expect(document.activeElement).toBe(button);
    await userEvent.keyboard('{Enter}');
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it('shows the failure alert when the prompt cannot be shown', async () => {
    mockEnvironment();
    mount();
    const { event, prompt } = installPromptEvent();
    prompt.mockRejectedValueOnce(new Error('blocked'));
    act(() => {
      window.dispatchEvent(event);
    });
    await userEvent.click(screen.getByRole('button', { name: copy.action }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.unavailable);
  });

  it('switches to installed on appinstalled', () => {
    mockEnvironment();
    mount();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.getByText(copy.installed)).toBeTruthy();
  });

  it('retains an early beforeinstallprompt for a panel mounted later and consumes it once', async () => {
    mockEnvironment();
    const release = captureInstallPrompt();
    const { event, prompt } = installPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    mount();
    await userEvent.click(screen.getByRole('button', { name: copy.action }));
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(await promptInstall()).toBe('unavailable');
    release();
  });

  it('keeps the initiating button mounted and focused while the native prompt is open, then restores focus to the panel heading', async () => {
    mockEnvironment();
    mount();
    const { event, prompt } = installPromptEvent('dismissed');
    let settle: () => void = () => undefined;
    prompt.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        })
    );
    act(() => {
      window.dispatchEvent(event);
    });
    const button = screen.getByRole('button', { name: copy.action });
    button.focus();
    await userEvent.click(button);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: copy.action })).toBe(button);
    expect(document.activeElement).toBe(button);
    await act(async () => {
      settle();
    });
    expect(screen.queryByRole('button', { name: copy.action })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.title }));
  });

  it('attaches listeners only while mounted', async () => {
    mockEnvironment();
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    const view = mount();
    const types = ['beforeinstallprompt', 'appinstalled'];
    for (const type of types) expect(added.mock.calls.some(([name]) => name === type)).toBe(true);
    expect(media.listeners.size).toBe(1);
    const { event } = installPromptEvent();
    act(() => {
      window.dispatchEvent(event);
    });
    expect(screen.getByRole('button', { name: copy.action })).toBeTruthy();
    view.unmount();
    for (const type of types) expect(removed.mock.calls.some(([name]) => name === type)).toBe(true);
    expect(media.listeners.size).toBe(0);
    // A prompt captured after teardown is ignored: nothing is retained.
    expect(await promptInstall()).toBe('unavailable');
  });
});
