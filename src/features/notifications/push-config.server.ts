// Server-only Web Push enrollment config. Only the public VAPID key and the enabled flag ever reach the
// browser; the private key and subject are read by the delivery unit and never here.
export type PushConfig = { enabled: boolean; publicKey: string | null };

const publicKeyPattern = /^[A-Za-z0-9_-]{87}$/;

function isUncompressedP256Point(value: string): boolean {
  if (!publicKeyPattern.test(value)) return false;
  const first = Buffer.from(value, 'base64url')[0];
  return first === 4;
}

export function readPushConfig(env: Record<string, string | undefined> = process.env) {
  const publicKey = env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? '';
  const keyId = env.WEB_PUSH_VAPID_KEY_ID?.trim() ?? '';
  const enabled =
    env.WEB_PUSH_ENABLED === 'true' &&
    isUncompressedP256Point(publicKey) &&
    keyId.length > 0 &&
    keyId.length <= 64;
  return { enabled, publicKey: enabled ? publicKey : null, keyId: enabled ? keyId : null };
}

export function toPublicPushConfig(config: ReturnType<typeof readPushConfig>): PushConfig {
  return { enabled: config.enabled, publicKey: config.publicKey };
}
