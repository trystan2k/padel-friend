/** Trusted email-link origin. Never derive this from Host or forwarded request headers. */
export function requireAppOrigin(value: string | undefined): string {
  const url = value && URL.canParse(value) ? new URL(value) : undefined;
  if (
    !url ||
    value !== value?.trim() ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    (value !== url.origin && value !== `${url.origin}/`) ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new Error('APP_ORIGIN_UNAVAILABLE');
  return url.origin;
}
