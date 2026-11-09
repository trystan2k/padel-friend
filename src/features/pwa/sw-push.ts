// Push is a display-only channel: no account lookup, fetch, cache or read mutation.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const categories = new Set(['community', 'matches', 'results', 'rankings', 'leagues']);

type PushPayload = {
  version: 1;
  notificationId: string;
  category: string;
  title: string;
  body: string;
};

export function decodePushPayload(value: unknown): PushPayload | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const version: unknown = Reflect.get(value, 'version');
  const notificationId: unknown = Reflect.get(value, 'notificationId');
  const category: unknown = Reflect.get(value, 'category');
  const title: unknown = Reflect.get(value, 'title');
  const body: unknown = Reflect.get(value, 'body');
  if (
    version !== 1 ||
    typeof notificationId !== 'string' ||
    !uuidPattern.test(notificationId) ||
    typeof category !== 'string' ||
    !categories.has(category) ||
    typeof title !== 'string' ||
    !title.trim() ||
    title.length > 160 ||
    typeof body !== 'string' ||
    !body.trim() ||
    body.length > 500
  )
    return null;
  return { version, notificationId, category, title, body };
}

export async function displayPush(
  data: { json(): unknown } | null,
  registration: {
    showNotification(
      title: string,
      options: NotificationOptions & { renotify: boolean }
    ): Promise<void>;
  }
) {
  try {
    const payload = decodePushPayload(data?.json());
    if (!payload) return;
    await registration.showNotification(payload.title, {
      body: payload.body,
      tag: 'notification:' + payload.notificationId,
      renotify: false,
      data: { notificationId: payload.notificationId, category: payload.category }
    });
  } catch {
    // Malformed/encrypted payloads and unavailable OS notification UI must not crash the worker.
  }
}

type AppWindow = {
  url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
};
type AppClients = {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly AppWindow[]>;
  openWindow(url: string): Promise<unknown>;
};

export async function openPushNotification(data: unknown, origin: string, clients: AppClients) {
  if (typeof data !== 'object' || data === null) return;
  const notificationId: unknown = Reflect.get(data, 'notificationId');
  if (typeof notificationId !== 'string' || !uuidPattern.test(notificationId)) return;
  const destination = new URL('/notifications/' + notificationId, origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of windows) {
    try {
      if (new URL(client.url).origin !== origin) continue;
      await client.focus();
      const navigated = await client.navigate(destination);
      if (navigated !== null) return;
    } catch {
      // A tab may close while the notification is being handled; try another or open one.
    }
  }
  await clients.openWindow(destination);
}
