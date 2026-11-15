import { useCallback, useState } from 'react';

// Cloudflare Turnstile is opt-in: with no public site key (local dev, TEST stack) no widget
// renders, no token is sent and the CSP gains no Turnstile origin. The matching secret lives only
// in the Supabase Auth settings (see INITIAL_SETUP.md), never in a VITE_ variable.
export function getTurnstileSiteKey(): string | undefined {
  const key = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : undefined;
}

export type CaptchaState = {
  enabled: boolean;
  token: string | null;
  failed: boolean;
  /** Options to merge into a supabase.auth call; empty when captcha is off. */
  authOptions: { captchaToken?: string };
  /** Tokens are single-use: call after every submit attempt. */
  reset: () => void;
  widgetProps: {
    resetCount: number;
    onToken: (token: string | null) => void;
    onError: () => void;
  };
};

export function useCaptcha(): CaptchaState {
  const [token, setToken] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [resetCount, setResetCount] = useState(0);
  const reset = useCallback(() => {
    setToken(null);
    setResetCount((count) => count + 1);
  }, []);
  const onToken = useCallback((value: string | null) => {
    setToken(value);
    if (value) setFailed(false);
  }, []);
  const onError = useCallback(() => {
    setToken(null);
    setFailed(true);
  }, []);
  return {
    enabled: getTurnstileSiteKey() !== undefined,
    token,
    failed,
    authOptions: token ? { captchaToken: token } : {},
    reset,
    widgetProps: { resetCount, onToken, onError }
  };
}
