export const pushLocales = ['en', 'pt-BR', 'es'] as const;
export type PushLocale = (typeof pushLocales)[number];
export const clientRetireReasons = [
  'user_disabled',
  'logout',
  'key_changed',
  'permission_revoked',
  'expired'
] as const;
export type PushRetireReason = (typeof clientRetireReasons)[number];

export type PushSubscriptionInput = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  expirationTime: number | null;
};

const base64Url = (length: number) => new RegExp(`^[A-Za-z0-9_-]{${length}}$`);
const p256dhPattern = base64Url(87);
const authPattern = base64Url(22);
const endpointPattern = /^https:\/\/[^/@\s]+(\/\S*)?$/;

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('INVALID_PUSH_INPUT');
  return Object.fromEntries(Object.entries(value));
}

export function isPushLocale(value: unknown): value is PushLocale {
  return pushLocales.some((locale) => locale === value);
}

function parseEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2048 || !endpointPattern.test(value))
    throw new Error('INVALID_PUSH_INPUT');
  return value;
}

function parseLocale(value: unknown): PushLocale {
  if (!isPushLocale(value)) throw new Error('INVALID_PUSH_INPUT');
  return value;
}

export function validateRegisterPushSubscription(value: unknown) {
  const input = object(value, ['subscription', 'locale']);
  const raw = object(input.subscription, ['endpoint', 'keys', 'expirationTime']);
  const keys = object(raw.keys, ['p256dh', 'auth']);
  const { p256dh, auth } = keys;
  const expiration = raw.expirationTime ?? null;
  if (
    typeof p256dh !== 'string' ||
    !p256dhPattern.test(p256dh) ||
    typeof auth !== 'string' ||
    !authPattern.test(auth) ||
    (expiration !== null && (typeof expiration !== 'number' || !Number.isSafeInteger(expiration)))
  )
    throw new Error('INVALID_PUSH_INPUT');
  const subscription: PushSubscriptionInput = {
    endpoint: parseEndpoint(raw.endpoint),
    keys: { p256dh, auth },
    expirationTime: expiration
  };
  return { subscription, locale: parseLocale(input.locale) };
}

export function validateReconcilePushDevices(value: unknown) {
  const input = object(value, ['endpoint', 'locale']);
  return {
    endpoint: input.endpoint === null ? null : parseEndpoint(input.endpoint),
    locale: parseLocale(input.locale)
  };
}

export function validateRetirePushSubscription(value: unknown) {
  const input = object(value, ['endpoint', 'reason']);
  const reason = clientRetireReasons.find((candidate) => candidate === input.reason);
  if (!reason) throw new Error('INVALID_PUSH_INPUT');
  return { endpoint: parseEndpoint(input.endpoint), reason };
}
