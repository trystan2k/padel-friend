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

// 'unavailable' = the provider script failed or stalled before the widget rendered, so no
// provider visuals exist and the status must be shown to sighted users too.
type WidgetStatus = 'loading' | 'ready' | 'error' | 'expired' | 'unavailable';

const STATUS_KEYS = {
  loading: 'auth.captchaLoading',
  error: 'auth.captchaError',
  expired: 'auth.captchaExpired',
  unavailable: 'auth.captchaError'
} as const;

const LOAD_TIMEOUT_MS = 15000;

// Once rendered, the Turnstile widget draws its own visual state; the status is announced to
// screen readers only, so it takes no layout space and nothing below can shift. The visible
// fallback reserves the standard Turnstile box (65px) so showing it adds no later shift.
const styles = stylex.create({
  fallback: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minBlockSize: 'calc(var(--space-40) + var(--space-20) + var(--space-5))',
    padding: 'var(--space-8)',
    borderWidth: 'var(--space-1)',
    borderStyle: 'solid',
    borderColor: 'var(--color-line)',
    borderRadius: 'var(--radius-8)',
    color: 'var(--color-text)',
    fontSize: 'var(--font-size-14)',
    textAlign: 'center'
  },
  visuallyHidden: {
    position: 'absolute',
    width: 'var(--space-1)',
    height: 'var(--space-1)',
    padding: 0,
    margin: 'calc(-1 * var(--space-1))',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0,
    borderStyle: 'none'
  }
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
    let rendered = false;
    const timer = window.setTimeout(() => {
      if (cancelled || rendered) return;
      setStatus('unavailable');
      onError();
    }, LOAD_TIMEOUT_MS);
    loadTurnstile()
      .then((turnstile) => {
        if (cancelled) return;
        window.clearTimeout(timer);
        rendered = true;
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
        window.clearTimeout(timer);
        setStatus(rendered ? 'error' : 'unavailable');
        onError();
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [siteKey, onToken, onError]);

  const key = status === 'ready' ? undefined : STATUS_KEYS[status];
  return (
    <>
      <div ref={containerRef} />
      <output
        aria-live="polite"
        {...stylex.props(status === 'unavailable' ? styles.fallback : styles.visuallyHidden)}
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
