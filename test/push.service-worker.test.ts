import { describe, expect, it, vi } from 'vitest';
import { decodePushPayload, displayPush, openPushNotification } from '../src/features/pwa/sw-push';
import { pushPayload } from '../src/features/notifications/push-delivery';

type Clients = Parameters<typeof openPushNotification>[2];
const notificationId = 'd7381c74-c888-4fb3-8e6f-6d46113cb949';
const origin = 'https://padel.example';
const payload = {
  version: 1,
  notificationId,
  category: 'matches',
  title: 'Match update',
  body: 'Open the app.'
};

describe('push service worker', () => {
  it.each(['en', 'pt-BR', 'es', 'unknown'])(
    'accepts versioned server-localized payload %s',
    (locale) => {
      expect(
        decodePushPayload(JSON.parse(pushPayload(notificationId, 'matches', locale)))
      ).toMatchObject({ version: 1, notificationId, category: 'matches' });
    }
  );
  it.each([
    null,
    undefined,
    [],
    {},
    { ...payload, version: 2 },
    { ...payload, notificationId: '../login' },
    { ...payload, category: 'private' },
    { ...payload, title: '' },
    { ...payload, body: 'x'.repeat(501) }
  ])('safely drops malformed payload %j', async (value) => {
    const showNotification = vi.fn<(...args: unknown[]) => Promise<void>>();
    await displayPush({ json: () => value }, { showNotification });
    expect(showNotification).not.toHaveBeenCalled();
  });
  it('handles empty events, JSON failure and OS display failure without rejecting', async () => {
    const showNotification = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockRejectedValue(new Error('OS unavailable'));
    await expect(displayPush(null, { showNotification })).resolves.toBeUndefined();
    await expect(
      displayPush(
        {
          json: () => {
            throw new SyntaxError();
          }
        },
        { showNotification }
      )
    ).resolves.toBeUndefined();
    await expect(
      displayPush({ json: () => payload }, { showNotification })
    ).resolves.toBeUndefined();
  });
  it('shows localized copy with stable tag, no renotify and minimal click data', async () => {
    const showNotification = vi
      .fn<(...args: unknown[]) => Promise<void>>()
      .mockResolvedValue(undefined);
    await displayPush(
      { json: () => ({ ...payload, href: 'https://evil.example' }) },
      { showNotification }
    );
    expect(showNotification).toHaveBeenCalledWith(payload.title, {
      body: payload.body,
      tag: 'notification:' + notificationId,
      renotify: false,
      data: { notificationId, category: 'matches' }
    });
  });
  it('focuses same-origin window then navigates to derived UUID path, ignoring payload URL', async () => {
    const focus = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const navigate = vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined);
    const foreign = {
      url: 'https://evil.example',
      focus: vi.fn<(...args: unknown[]) => Promise<void>>(),
      navigate: vi.fn<(...args: unknown[]) => Promise<void>>()
    };
    const clients = {
      matchAll: vi
        .fn<Clients['matchAll']>()
        .mockResolvedValue([foreign, { url: origin + '/dashboard', focus, navigate }]),
      openWindow: vi.fn<(...args: unknown[]) => Promise<void>>()
    };
    await openPushNotification({ notificationId, href: 'https://evil.example' }, origin, clients);
    expect(focus).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(origin + '/notifications/' + notificationId);
    expect(foreign.focus).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
    expect(focus.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
  });
  it('opens a new window when none is usable, including a closed tab', async () => {
    const clients = {
      matchAll: vi.fn<Clients['matchAll']>().mockResolvedValue([
        {
          url: origin,
          focus: vi
            .fn<(...args: unknown[]) => Promise<void>>()
            .mockRejectedValue(new Error('closed')),
          navigate: vi.fn<(...args: unknown[]) => Promise<void>>()
        }
      ]),
      openWindow: vi.fn<(...args: unknown[]) => Promise<void>>().mockResolvedValue(undefined)
    };
    await openPushNotification({ notificationId }, origin, clients);
    expect(clients.openWindow).toHaveBeenCalledWith(origin + '/notifications/' + notificationId);
    clients.matchAll.mockResolvedValue([]);
    await openPushNotification({ notificationId }, origin, clients);
    expect(clients.openWindow).toHaveBeenCalledTimes(2);
  });
  it('opens a new window if an existing tab reports an aborted navigation', async () => {
    const clients = {
      matchAll: vi
        .fn<Clients['matchAll']>()
        .mockResolvedValue([
          { url: origin, focus: () => Promise.resolve(), navigate: () => Promise.resolve(null) }
        ]),
      openWindow: vi.fn<Clients['openWindow']>().mockResolvedValue(undefined)
    };
    await openPushNotification({ notificationId }, origin, clients);
    expect(clients.openWindow).toHaveBeenCalledWith(origin + '/notifications/' + notificationId);
  });
  it.each([
    null,
    {},
    { notificationId: '//evil.example' },
    { notificationId: notificationId + '?next=//evil.example' }
  ])('never navigates invalid click data %j', async (value) => {
    const clients = {
      matchAll: vi.fn<Clients['matchAll']>(),
      openWindow: vi.fn<(...args: unknown[]) => Promise<void>>()
    };
    await openPushNotification(value, origin, clients);
    expect(clients.matchAll).not.toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
});
