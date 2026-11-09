import { createECDH } from 'node:crypto';
import type { VapidKey } from './push-transport.server';

export function readPushKeyring(env: Record<string, string | undefined> = process.env) {
  if (env.WEB_PUSH_ENABLED !== 'true') return null;
  const subject = env.WEB_PUSH_VAPID_SUBJECT ?? '';
  if (!/^mailto:[^\s@]+@[^\s@]+$/.test(subject) && !/^https:\/\/[^\s]+$/.test(subject))
    throw new Error('PUSH_CONFIG_UNAVAILABLE');
  const currentId = env.WEB_PUSH_VAPID_KEY_ID ?? '';
  if (!currentId || currentId.length > 64) throw new Error('PUSH_CONFIG_UNAVAILABLE');
  const raw: unknown = env.WEB_PUSH_VAPID_PRIVATE_KEYS
    ? JSON.parse(env.WEB_PUSH_VAPID_PRIVATE_KEYS)
    : {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('PUSH_CONFIG_UNAVAILABLE');
  const privateKeys: Record<string, unknown> = { ...raw };
  if (env.WEB_PUSH_VAPID_PRIVATE_KEY) privateKeys[currentId] = env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const keys = new Map<string, VapidKey>();
  for (const [id, value] of Object.entries(privateKeys)) {
    if (!id || id.length > 64 || typeof value !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new Error('PUSH_CONFIG_UNAVAILABLE');
    const curve = createECDH('prime256v1');
    curve.setPrivateKey(Buffer.from(value, 'base64url'));
    keys.set(id, {
      publicKey: curve.getPublicKey().toString('base64url'),
      privateKey: value,
      subject
    });
  }
  if (!keys.has(currentId) || keys.get(currentId)!.publicKey !== env.WEB_PUSH_VAPID_PUBLIC_KEY)
    throw new Error('PUSH_CONFIG_UNAVAILABLE');
  const revoked = (env.WEB_PUSH_REVOKED_KEY_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of revoked) keys.delete(id);
  return { keys, revoked };
}
