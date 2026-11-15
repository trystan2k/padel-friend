import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

type WidgetStatus = 'loading' | 'ready' | 'error' | 'expired';

const STATUS_KEYS = {
  loading: 'auth.captchaLoading',
  error: 'auth.captchaError',
  expired: 'auth.captchaExpired'
} as const;

// Static text only: no motion, so prefers-reduced-motion needs no special handling.
const styles = stylex.create({
  status: {
    margin: 0,
    color: 'var(--color-muted)',
    fontSize: 'var(--font-size-12)',
    lineHeight: 'var(--font-line-height-body)',
    // Reserve two status lines: the longest translations wrap at narrow widths, and the status
    // appearing/clearing must never shift the controls below.
    minHeight: 'calc(var(--font-size-12) * var(--font-line-height-body) * 2)'
  },
  statusError: { color: 'var(--color-red)' }
});

type MountProps = Pick<CaptchaState['widgetProps'], 'onToken' | 'onError'> & { siteKey: string };

function TurnstileMount({ siteKey, onToken, onError }: MountProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<WidgetStatus>('loading');

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
          callback: (token) => {
            setStatus('ready');
            onToken(token);
          },
          'expired-callback': () => {
            setStatus('expired');
            onToken(null);
          },
          'error-callback': () => {
            setStatus('error');
            onError();
          }
        });
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
        onError();
      });
    return () => {
      cancelled = true;
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onToken, onError]);

  const key = status === 'ready' ? undefined : STATUS_KEYS[status];
  return (
    <>
      <div ref={containerRef} />
      <output
        aria-live="polite"
        {...stylex.props(styles.status, status === 'error' && styles.statusError)}
      >
        {key ? t(key) : ''}
      </output>
    </>
  );
}

/** Renders nothing unless a Turnstile site key is configured. */
export function TurnstileWidget({ resetCount, onToken, onError }: CaptchaState['widgetProps']) {
  const siteKey = getTurnstileSiteKey();
  if (!siteKey) return null;
  // A new resetCount remounts the widget, which issues a fresh single-use token.
  return <TurnstileMount key={resetCount} siteKey={siteKey} onToken={onToken} onError={onError} />;
}
