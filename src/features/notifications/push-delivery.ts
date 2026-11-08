import en from '../../locales/en/translation.json';
import ptBR from '../../locales/pt-BR/translation.json';
import es from '../../locales/es/translation.json';

export type PushCategory = 'community' | 'matches' | 'results' | 'rankings' | 'leagues';

export function pushPayload(
  notificationId: string,
  category: PushCategory,
  locale: string
): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(notificationId))
    throw new Error('PUSH_INVALID_ID');
  const messages = (locale === 'pt-BR' ? ptBR : locale === 'es' ? es : en).push.message;
  if (!Object.hasOwn(messages, category)) throw new Error('PUSH_INVALID_CATEGORY');
  return JSON.stringify({ notificationId, category, ...messages[category] });
}

export function classifyPushResponse(
  status: number
): 'accepted' | 'expired' | 'pending' | 'failed' | 'unavailable' {
  if (status >= 200 && status < 300) return 'accepted';
  if (status === 404 || status === 410) return 'expired';
  if (status === 401 || status === 403) return 'unavailable';
  if (status === 429 || status >= 500) return 'pending';
  return 'failed';
}

export function pushRetrySeconds(
  attempt: number,
  retryAfter: string | null,
  now = Date.now(),
  random = Math.random
): number {
  const seconds =
    retryAfter === null
      ? NaN
      : /^\d+$/.test(retryAfter)
        ? Number(retryAfter)
        : (Date.parse(retryAfter) - now) / 1000;
  const backoff = Math.min(21600, 300 * 2 ** Math.max(0, Math.min(6, attempt) - 1));
  return Math.min(
    21600,
    Math.max(
      1,
      Math.round(
        Number.isFinite(seconds) ? Math.max(seconds, backoff) : backoff * (0.8 + random() * 0.4)
      )
    )
  );
}
