import { useEffect } from 'react';
import { isIdentityReplaced } from './auth-identity';
import { getBrowserClient } from './supabase/client';

function restartFromPublicEntry() {
  window.location.assign('/');
}

/**
 * Retires a mounted private view when its identity ends or is replaced (sign-out, or a different
 * account in another tab of the same browser). A full document load drops every refresh scope,
 * loader seed and component DTO before the next identity renders; nothing private is kept in a
 * module-global store. The baseline is the authenticated identity the server rendered this view
 * for, never the first browser session observed: another tab may already have switched account
 * before this view mounted.
 */
export function useAuthIdentityGuard(
  baseline: string | null,
  retire: () => void = restartFromPublicEntry
) {
  useEffect(() => {
    const client = getBrowserClient();
    let disposed = false;
    void client.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id ?? null;
      if (!disposed && isIdentityReplaced(baseline, { event: 'INITIAL_SESSION', userId })) retire();
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      if (isIdentityReplaced(baseline, { event, userId })) retire();
    });
    return () => {
      disposed = true;
      data.subscription.unsubscribe();
    };
  }, [baseline, retire]);
}
