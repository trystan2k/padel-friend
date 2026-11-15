/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTurnstileSiteKey, useCaptcha } from '../src/lib/captcha';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('captcha gating', () => {
  it('is off without a site key: no token options are produced', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
    expect(getTurnstileSiteKey()).toBeUndefined();
    const { result } = renderHook(() => useCaptcha());
    expect(result.current.enabled).toBe(false);
    expect(result.current.authOptions).toEqual({});
  });

  it('is on with a site key and propagates the token, clearing it on reset', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', ' site-key ');
    expect(getTurnstileSiteKey()).toBe('site-key');
    const { result } = renderHook(() => useCaptcha());
    expect(result.current.enabled).toBe(true);
    expect(result.current.authOptions).toEqual({});

    act(() => result.current.widgetProps.onToken('token-1'));
    expect(result.current.authOptions).toEqual({ captchaToken: 'token-1' });

    act(() => result.current.reset());
    expect(result.current.token).toBeNull();
    expect(result.current.widgetProps.resetCount).toBe(1);
  });

  it('records a provider error and clears it once a token arrives', () => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    const { result } = renderHook(() => useCaptcha());
    act(() => result.current.widgetProps.onError());
    expect(result.current.failed).toBe(true);
    act(() => result.current.widgetProps.onToken('token-2'));
    expect(result.current.failed).toBe(false);
  });
});
