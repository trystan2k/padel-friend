import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { getServerClient } from '../../lib/supabase/server';

/**
 * Public homepage variant: only whether verified claims exist, never who they belong to.
 * Missing, invalid, expired or unreachable-auth claims all read as guest, so the page never
 * redirects or fails. The CTA target (/dashboard) re-authorizes through the protected gates.
 */
export const getPublicHomepageAuthenticated = createServerFn().handler(async () => {
  setResponseHeader('Cache-Control', 'private, no-store');
  const { data, error } = await getServerClient().auth.getClaims();
  return Boolean(!error && data?.claims?.sub);
});
