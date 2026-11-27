import { getRequestHeader, getRequestUrl } from '@tanstack/react-start/server';

/**
 * Mutating privacy commands accept only same-origin browser POSTs. A browser always sends Origin on a
 * cross-site POST, so a missing or different Origin is rejected (CSRF defence in depth on top of
 * the SameSite session cookie).
 */
export function requireSameOrigin(): void {
  const origin = getRequestHeader('origin');
  if (!origin || origin !== getRequestUrl().origin) throw new Error('ORIGIN_REJECTED');
}
