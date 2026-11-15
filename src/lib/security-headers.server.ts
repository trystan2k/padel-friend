import { AsyncLocalStorage } from 'node:async_hooks';
import { getTurnstileSiteKey } from './captcha';

// Worker-level security headers. Every response (pages, assets, redirects, server functions,
// caught errors) is finalized here so no route has to remember them.
//
// ROLLOUT: the CSP ships in Report-Only mode. Review browser-reported violations, then flip
// ENFORCE_CSP to true (one-line change, see INITIAL_SETUP.md "Security response headers") to send
// Content-Security-Policy instead. Only one of the two headers is ever emitted.
export const ENFORCE_CSP = false;

const CSP_HEADER = 'Content-Security-Policy';
const CSP_REPORT_ONLY_HEADER = 'Content-Security-Policy-Report-Only';
const HSTS_VALUE = 'max-age=31536000'; // 1 year; no includeSubDomains/preload without domain review.
const PERMISSIONS_POLICY =
  'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()';

const nonceStorage = new AsyncLocalStorage<string>();

/** Unpredictable per-request value (128 bits, Web Crypto), safe inside a CSP source and an attribute. */
export function newCspNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/** Request-scoped, never module-global: concurrent requests on one isolate see only their own nonce. */
export function runWithNonce<T>(nonce: string, task: () => T): T {
  return nonceStorage.run(nonce, task);
}

export function currentNonce(): string | undefined {
  return nonceStorage.getStore();
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Exact connect/img origins for the configured Supabase URL: https + wss in hosted setups, http +
 * ws only for an explicit loopback URL (local stack). Anything else yields no extra origin, so a
 * malformed or non-loopback http value never widens the policy.
 */
export function supabaseCspOrigins(rawUrl: string | undefined): { http: string; ws: string }[] {
  if (!rawUrl) return [];
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return [];
  }
  if (url.username || url.password) return [];
  if (url.protocol === 'https:') return [{ http: url.origin, ws: `wss://${url.host}` }];
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) {
    return [{ http: url.origin, ws: `ws://${url.host}` }];
  }
  return [];
}

// Cloudflare Turnstile loads its script, renders in an iframe and calls home; added only when a
// site key is configured so a captcha-free build keeps the tighter policy.
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

export function buildCsp(
  nonce: string,
  supabaseUrl: string | undefined,
  captchaEnabled = false
): string {
  const supabase = supabaseCspOrigins(supabaseUrl);
  const turnstile = captchaEnabled ? [TURNSTILE_ORIGIN] : [];
  const connect = [
    "'self'",
    ...supabase.flatMap((origin) => [origin.http, origin.ws]),
    ...turnstile
  ];
  const images = ["'self'", 'data:', 'blob:', ...supabase.map((origin) => origin.http)];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${turnstile.map((origin) => ` ${origin}`).join('')}`,
    // StyleX ships static CSS files; React/Base UI set style attributes, which need inline styles.
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(' ')}`,
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "manifest-src 'self'",
    ...(captchaEnabled ? [`frame-src 'self' ${TURNSTILE_ORIGIN}`] : []),
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join('; ');
}

/** Header set for one request; HSTS only when the request actually arrived over HTTPS. */
export function securityHeaders(
  requestUrl: string,
  nonce: string,
  supabaseUrl: string | undefined = import.meta.env.VITE_SUPABASE_URL,
  captchaEnabled = getTurnstileSiteKey() !== undefined
): Record<string, string> {
  const headers: Record<string, string> = {
    [ENFORCE_CSP ? CSP_HEADER : CSP_REPORT_ONLY_HEADER]: buildCsp(
      nonce,
      supabaseUrl,
      captchaEnabled
    ),
    // frame-ancestors is not honoured in Report-Only mode, so framing is denied separately.
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': PERMISSIONS_POLICY
  };
  if (new URL(requestUrl).protocol === 'https:') headers['Strict-Transport-Security'] = HSTS_VALUE;
  return headers;
}
