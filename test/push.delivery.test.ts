import { describe, expect, it, vi } from 'vitest';
import webPush from 'web-push';
import {
  classifyPushResponse,
  pushPayload,
  pushRetrySeconds
} from '../src/features/notifications/push-delivery';
import {
  createPushTransport,
  validatePushEndpoint
} from '../src/features/notifications/push-transport.server';
import { readPushKeyring } from '../src/features/notifications/push-keyring.server';

const id = 'f74b5d16-a581-4b51-b006-805cddca5abe';
describe('Push delivery contracts', () => {
  it.each([200, 201, 204, 299])('maps %s to provider accepted', (status) =>
    expect(classifyPushResponse(status)).toBe('accepted')
  );
  it.each([
    [404, 'expired'],
    [410, 'expired'],
    [429, 'pending'],
    [500, 'pending'],
    [503, 'pending'],
    [400, 'failed'],
    [401, 'unavailable'],
    [403, 'unavailable'],
    [302, 'failed']
  ])('maps HTTP %s safely', (status, state) => expect(classifyPushResponse(status)).toBe(state));
  it('bounds Retry-After, exponential backoff and jitter', () => {
    expect(pushRetrySeconds(1, '900', 0)).toBe(900);
    expect(pushRetrySeconds(1, 'Fri, 01 Jan 2027 00:00:00 GMT', 0)).toBe(21600);
    expect(pushRetrySeconds(1, 'bad', 0, () => 0)).toBe(240);
    expect(pushRetrySeconds(6, null, 0, () => 1)).toBe(11520);
    expect(pushRetrySeconds(1, '0')).toBe(300);
  });
  it('localizes generic payload with English fallback and no private domain data', () => {
    for (const category of ['community', 'matches', 'results', 'rankings', 'leagues'] as const) {
      const payload = JSON.parse(pushPayload(id, category, 'pt-BR'));
      expect(Object.keys(payload).sort()).toEqual(['body', 'category', 'notificationId', 'title']);
      expect(payload.body).toContain('notificação');
      expect(pushPayload(id, category, 'unknown')).toBe(pushPayload(id, category, 'en'));
      expect(pushPayload(id, category, 'es')).not.toBe(pushPayload(id, category, 'en'));
    }
    expect(() => pushPayload('bad', 'matches', 'en')).toThrow('PUSH_INVALID_ID');
  });
  it.each([
    'https://fcm.googleapis.com/fcm/send/a',
    'https://updates.push.services.mozilla.com/wpush/v2/a',
    'https://web.push.apple.com/a',
    'https://a.web.push.apple.com/a'
  ])('allows supported host %s', (url) =>
    expect(() => validatePushEndpoint(url)).not.toThrow('PUSH_INVALID_ENDPOINT')
  );
  it.each([
    'not-a-url',
    'https://fcm.googleapis.com:invalid/a',
    'http://fcm.googleapis.com/a',
    'https://fcm.googleapis.com:444/a',
    'https://u:p@fcm.googleapis.com/a',
    'https://127.0.0.1/a',
    'https://[::1]/a',
    'https://169.254.169.254/a',
    'https://fcm.googleapis.com.evil.test/a',
    'https://evil.test/a',
    'https://web.push.apple.com/a#secret'
  ])('rejects SSRF %s', (url) =>
    expect(() => validatePushEndpoint(url)).toThrow('PUSH_INVALID_ENDPOINT')
  );
  it('rejects oversized payload before crypto or HTTP', async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      createPushTransport(request)(
        { endpoint: 'https://fcm.googleapis.com/a', p256dh: '', auth: '' },
        'x'.repeat(3001),
        { publicKey: '', privateKey: '', subject: '' }
      )
    ).rejects.toThrow('PUSH_PAYLOAD_TOO_LARGE');
    expect(request).not.toHaveBeenCalled();
  });
  it('never follows provider redirects and bounds the actual HTTP request', async () => {
    const key = webPush.generateVAPIDKeys();
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } })
      );
    const result = await createPushTransport(request)(
      {
        endpoint: 'https://fcm.googleapis.com/send/vector',
        p256dh: key.publicKey,
        auth: Buffer.alloc(16, 7).toString('base64url')
      },
      pushPayload(id, 'matches', 'en'),
      { ...key, subject: 'mailto:test@example.test' }
    );
    expect(result.status).toBe(302);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![1]).toMatchObject({
      redirect: 'manual',
      method: 'POST',
      signal: expect.any(AbortSignal)
    });
  });
  it('malformed device crypto fails terminally without HTTP', async () => {
    const key = webPush.generateVAPIDKeys();
    const request = vi.fn<typeof fetch>();
    await expect(
      createPushTransport(request)(
        { endpoint: 'https://fcm.googleapis.com/send/vector', p256dh: 'invalid', auth: 'invalid' },
        'payload',
        { ...key, subject: 'mailto:test@example.test' }
      )
    ).rejects.toThrow('PUSH_INVALID_SUBSCRIPTION');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps old keys during routine rotation and removes emergency revoked ids', () => {
    const old = webPush.generateVAPIDKeys();
    const current = webPush.generateVAPIDKeys();
    const env = {
      WEB_PUSH_ENABLED: 'true',
      WEB_PUSH_VAPID_SUBJECT: 'mailto:operator@example.test',
      WEB_PUSH_VAPID_KEY_ID: 'new',
      WEB_PUSH_VAPID_PUBLIC_KEY: current.publicKey,
      WEB_PUSH_VAPID_PRIVATE_KEY: current.privateKey,
      WEB_PUSH_VAPID_PRIVATE_KEYS: JSON.stringify({ old: old.privateKey })
    };
    expect([...readPushKeyring(env)!.keys.keys()].sort()).toEqual(['new', 'old']);
    expect(readPushKeyring({ ...env, WEB_PUSH_REVOKED_KEY_IDS: 'old' })!.keys.has('old')).toBe(
      false
    );
    expect(readPushKeyring({ ...env, WEB_PUSH_ENABLED: 'false' })).toBeNull();
    expect(() => readPushKeyring({ ...env, WEB_PUSH_VAPID_PUBLIC_KEY: old.publicKey })).toThrow(
      'PUSH_CONFIG_UNAVAILABLE'
    );
  });
});
