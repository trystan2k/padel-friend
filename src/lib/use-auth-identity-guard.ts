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
 * module-global store. The baseline is the first session this view observes.
 */
export function useAuthIdentityGuard(retire: () => void = restartFromPublicEntry) {
  useEffect(() => {
    const client = getBrowserClient();
    let baseline: string | null = null;
    let disposed = false;
    void client.auth.getSession().then(({ data }) => {
      if (!disposed) baseline ??= data.session?.user.id ?? null;
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null;
      if (isIdentityReplaced(baseline, { event, userId })) retire();
      else baseline ??= userId;
    });
    return () => {
      disposed = true;
      data.subscription.unsubscribe();
    };
  }, [retire]);
}
