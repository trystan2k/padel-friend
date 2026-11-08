/** @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';
import { createI18n } from '../src/i18n/config';
import type { PushSnapshot, PushStatus } from '../src/features/notifications/push-controller';

const mocks = vi.hoisted(() => ({
  snapshot: { status: 'loading', pending: null, otherDevices: 0 } as PushSnapshot,
  controller: {
    enable: vi.fn<() => Promise<void>>(),
    disableDevice: vi.fn<() => Promise<void>>(),
    reconcile: vi.fn<() => Promise<void>>()
  }
}));
vi.mock('../src/features/notifications/use-push-device', () => ({
  usePushDevice: () => ({ controller: mocks.controller, snapshot: mocks.snapshot })
}));
import { PushDevicePanel } from '../src/features/notifications/PushDevicePanel';

const copy = en.push;
function mount(status: PushStatus, extra: Partial<PushSnapshot> = {}, savedIntent = true) {
  mocks.snapshot = { status, pending: null, otherDevices: 0, ...extra };
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <PushDevicePanel savedIntent={savedIntent} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  for (const fn of Object.values(mocks.controller)) fn.mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('push device panel states', () => {
  it.each([
    ['loading', copy.loading],
    ['permissionDefault', copy.permissionDefault],
    ['grantedNotSubscribed', copy.grantedNotSubscribed],
    ['denied', copy.denied],
    ['unsupported', copy.unsupported],
    ['installRequired', copy.installRequired],
    ['offline', copy.offline],
    ['expired', copy.expired],
    ['keyChanged', copy.keyChanged],
    ['deviceDisabled', copy.deviceDisabled],
    ['enabled', copy.enabled]
  ] as const)('announces %s through the polite status region', (status, text) => {
    mount(status);
    expect(screen.getByRole('region', { name: copy.title })).toBeTruthy();
    const live = screen.getByRole('status');
    expect(live.textContent).toBe(text);
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('never shows enabled from saved intent alone, and flags a registered device with intent off', () => {
    mount('permissionDefault', {}, true);
    expect(screen.queryByText(copy.enabled)).toBeNull();
    cleanup();
    mount('enabled', {}, false);
    expect(screen.getByRole('status').textContent).toBe(copy.intentOff);
    cleanup();
    mount('enabled', {}, true);
    expect(screen.getByRole('status').textContent).toBe(copy.enabled);
  });

  it('shows no push action while denied, unsupported, install-required, offline or loading', () => {
    for (const status of [
      'denied',
      'unsupported',
      'installRequired',
      'offline',
      'loading'
    ] as const) {
      mount(status);
      expect(screen.queryByRole('button')).toBeNull();
      cleanup();
    }
  });

  it.each(['subscriptionFailed', 'saveFailed', 'cleanupFailed'] as const)(
    'uses an alert and a retry action for %s, keeping the in-app fallback visible',
    async (status) => {
      mount(status);
      expect(screen.getByRole('alert').textContent).toBe(copy[status]);
      expect(screen.getByText(copy.fallback)).toBeTruthy();
      await userEvent.setup().click(screen.getByRole('button', { name: copy.retry }));
      const target =
        status === 'cleanupFailed' ? mocks.controller.disableDevice : mocks.controller.enable;
      expect(target).toHaveBeenCalledTimes(1);
    }
  );

  it('offers a retry that re-checks when the config is unavailable', async () => {
    mount('configUnavailable');
    await userEvent.setup().click(screen.getByRole('button', { name: copy.retry }));
    expect(mocks.controller.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.controller.enable).not.toHaveBeenCalled();
  });

  it('shows the number of other registered devices with a plural-safe message', () => {
    mount('enabled', { otherDevices: 1 });
    expect(screen.getByText('1 other device is registered for Web Push.')).toBeTruthy();
    cleanup();
    mount('enabled', { otherDevices: 3 });
    expect(screen.getByText('3 other devices are registered for Web Push.')).toBeTruthy();
  });
});

describe('push device panel actions', () => {
  it('enables only on an explicit activation, by mouse and keyboard', async () => {
    const user = userEvent.setup();
    mount('permissionDefault');
    expect(mocks.controller.enable).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: copy.enable }));
    expect(mocks.controller.enable).toHaveBeenCalledTimes(1);

    await user.tab();
    screen.getByRole('button', { name: copy.enable }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(mocks.controller.enable).toHaveBeenCalledTimes(3);
  });

  it('disables this device only from the enabled state', async () => {
    mount('enabled');
    await userEvent.setup().click(screen.getByRole('button', { name: copy.disableDevice }));
    expect(mocks.controller.disableDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: copy.enable })).toBeNull();
  });

  it('marks the section busy and keeps the pending button focusable but inert', async () => {
    mount('permissionDefault', { pending: 'enabling' });
    expect(screen.getByRole('region', { name: copy.title }).getAttribute('aria-busy')).toBe('true');
    const button = screen.getByRole('button', { name: copy.enabling });
    expect(button.getAttribute('aria-disabled') ?? button.getAttribute('disabled')).not.toBeNull();
    await userEvent.setup().click(button);
    expect(mocks.controller.enable).not.toHaveBeenCalled();
  });
});

describe('push locale parity', () => {
  it('has the same push keys in en, pt-BR and es', () => {
    const keys = Object.keys(en.push).sort();
    expect(Object.keys(ptBR.push).sort()).toEqual(keys);
    expect(Object.keys(es.push).sort()).toEqual(keys);
    for (const status of ['loading', 'enabled', 'denied', 'installRequired', 'offline'] as const)
      expect(copy[status]).toBeTruthy();
  });
});
