import webPush from 'web-push';

export type VapidKey = { publicKey: string; privateKey: string; subject: string };
export type PushDevice = { endpoint: string; p256dh: string; auth: string };
export type PushResponse = { status: number; retryAfter: string | null };
export type PushTransport = (
  device: PushDevice,
  payload: string,
  key: VapidKey
) => Promise<PushResponse>;

export function validatePushEndpoint(endpoint: string): void {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('PUSH_INVALID_ENDPOINT');
  }
  const supported =
    url.hostname === 'fcm.googleapis.com' ||
    url.hostname === 'updates.push.services.mozilla.com' ||
    /^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(url.hostname) ||
    url.hostname === 'web.push.apple.com' ||
    /^[a-z0-9-]+\.web\.push\.apple\.com$/.test(url.hostname);
  if (
    !supported ||
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.hash ||
    endpoint.length > 2048
  ) {
    throw new Error('PUSH_INVALID_ENDPOINT');
  }
}

// web-push supplies RFC8291 encryption and RFC8292 VAPID; native fetch supplies Workers HTTP,
// bounded timeout and explicit redirect rejection (node https follows a different compatibility path).
// Injection is internal-only: no public send route or environment-configured test provider.
export function createPushTransport(request: typeof fetch = fetch): PushTransport {
  return async (device, payload, key) => {
    validatePushEndpoint(device.endpoint);
    if (new TextEncoder().encode(payload).byteLength > 3000)
      throw new Error('PUSH_PAYLOAD_TOO_LARGE');
    let encrypted: ReturnType<typeof webPush.generateRequestDetails>;
    try {
      encrypted = webPush.generateRequestDetails(
        { endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload,
        { vapidDetails: key, contentEncoding: 'aes128gcm', TTL: 86400, urgency: 'normal' }
      );
    } catch {
      // Signing keyring is prevalidated by the scheduler; malformed device crypto is terminal.
      throw new Error('PUSH_INVALID_SUBSCRIPTION');
    }
    if (!encrypted.body) throw new Error('PUSH_INVALID_PAYLOAD');
    const headers = new Headers();
    for (const [name, value] of Object.entries(encrypted.headers)) headers.set(name, value);
    const response = await request(device.endpoint, {
      method: 'POST',
      headers,
      body: new Uint8Array(encrypted.body),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    });
    // Never retain/log provider response bodies (some echo the sensitive endpoint).
    await response.body?.cancel();
    return { status: response.status, retryAfter: response.headers.get('Retry-After') };
  };
}
