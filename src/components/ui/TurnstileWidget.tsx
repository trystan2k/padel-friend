import { useEffect, useRef } from 'react';
import { getTurnstileSiteKey, type CaptchaState } from '../../lib/captcha';

type TurnstileApi = {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    }
  ) => string;
  remove: (widgetId: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let scriptPromise: Promise<TurnstileApi> | undefined;

function loadTurnstile(): Promise<TurnstileApi> {
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () =>
      window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile unavailable'));
    script.onerror = () => {
      scriptPromise = undefined;
      reject(new Error('turnstile failed to load'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

type MountProps = Pick<CaptchaState['widgetProps'], 'onToken' | 'onError'> & { siteKey: string };

function TurnstileMount({ siteKey, onToken, onError }: MountProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    let widgetId: string | undefined;
    let cancelled = false;
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        widgetId = turnstile.render(container, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': onError
        });
      })
      .catch(onError);
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onToken, onError]);

  return <div ref={containerRef} />;
}

/** Renders nothing unless a Turnstile site key is configured. */
export function TurnstileWidget({ resetCount, onToken, onError }: CaptchaState['widgetProps']) {
  const siteKey = getTurnstileSiteKey();
  if (!siteKey) return null;
  // A new resetCount remounts the widget, which issues a fresh single-use token.
  return <TurnstileMount key={resetCount} siteKey={siteKey} onToken={onToken} onError={onError} />;
}
