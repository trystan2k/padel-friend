import { describe, expect, it } from 'vitest';
import {
  readPushConfig,
  toPublicPushConfig
} from '../src/features/notifications/push-config.server';
import {
  validateReconcilePushDevices,
  validateRegisterPushSubscription,
  validateRetirePushSubscription
} from '../src/features/notifications/push.validators';

const KEY =
  'BD7OaBbljzNT-T8qXAyjFDuSUf2_-pfv05bxZB1_OrzgHgV80uBt_sSLXNrA6H8f30I7GDmv0_9SYBSQsCeZjEw';
const subscription = {
  endpoint: 'https://push.example/send/abc',
  expirationTime: null,
  keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }
};

describe('push validators', () => {
  it('accepts a well-formed subscription and strips nothing it needs', () => {
    expect(validateRegisterPushSubscription({ subscription, locale: 'pt-BR' })).toEqual({
      subscription,
      locale: 'pt-BR'
    });
  });

  it.each([
    ['http endpoint', { ...subscription, endpoint: 'http://push.example/x' }],
    ['credentialed endpoint', { ...subscription, endpoint: 'https://user@push.example/x' }],
    [
      'oversized endpoint',
      { ...subscription, endpoint: `https://push.example/${'x'.repeat(2048)}` }
    ],
    ['short p256dh', { ...subscription, keys: { ...subscription.keys, p256dh: 'p'.repeat(86) } }],
    ['bad auth chars', { ...subscription, keys: { ...subscription.keys, auth: '+'.repeat(22) } }],
    ['extra field', { ...subscription, userId: 'x' }],
    ['float expiry', { ...subscription, expirationTime: 1.5 }]
  ])('rejects %s', (_name, bad) => {
    expect(() => validateRegisterPushSubscription({ subscription: bad, locale: 'en' })).toThrow(
      'INVALID_PUSH_INPUT'
    );
  });

  it('rejects unknown locales and arbitrary top-level fields such as user ids', () => {
    expect(() => validateRegisterPushSubscription({ subscription, locale: 'fr' })).toThrow(
      'INVALID_PUSH_INPUT'
    );
    expect(() =>
      validateRegisterPushSubscription({ subscription, locale: 'en', userId: crypto.randomUUID() })
    ).toThrow('INVALID_PUSH_INPUT');
    expect(() => validateRegisterPushSubscription(null)).toThrow('INVALID_PUSH_INPUT');
  });

  it('validates reconcile and retire inputs', () => {
    expect(validateReconcilePushDevices({ endpoint: null, locale: 'es' })).toEqual({
      endpoint: null,
      locale: 'es'
    });
    expect(() => validateReconcilePushDevices({ endpoint: 'ftp://x', locale: 'es' })).toThrow(
      'INVALID_PUSH_INPUT'
    );
    expect(
      validateRetirePushSubscription({ endpoint: subscription.endpoint, reason: 'logout' })
    ).toEqual({ endpoint: subscription.endpoint, reason: 'logout' });
    expect(() =>
      validateRetirePushSubscription({ endpoint: subscription.endpoint, reason: 'endpoint_gone' })
    ).toThrow('INVALID_PUSH_INPUT');
  });
});

describe('push config', () => {
  const base = {
    WEB_PUSH_ENABLED: 'true',
    WEB_PUSH_VAPID_PUBLIC_KEY: KEY,
    WEB_PUSH_VAPID_KEY_ID: 'k1',
    WEB_PUSH_VAPID_PRIVATE_KEY: 'private-canary',
    WEB_PUSH_VAPID_SUBJECT: 'mailto:ops@example.test'
  };

  it('exposes only the enabled flag and public key', () => {
    const publicConfig = toPublicPushConfig(readPushConfig(base));
    expect(publicConfig).toEqual({ enabled: true, publicKey: KEY });
    expect(JSON.stringify(publicConfig)).not.toMatch(/private-canary|mailto|k1/);
  });

  it.each([
    ['disabled flag', { ...base, WEB_PUSH_ENABLED: 'false' }],
    ['missing key', { ...base, WEB_PUSH_VAPID_PUBLIC_KEY: undefined }],
    ['malformed key', { ...base, WEB_PUSH_VAPID_PUBLIC_KEY: 'short' }],
    ['missing key id', { ...base, WEB_PUSH_VAPID_KEY_ID: undefined }]
  ])('reports unavailable for %s', (_name, env) => {
    expect(toPublicPushConfig(readPushConfig(env))).toEqual({ enabled: false, publicKey: null });
  });
});
