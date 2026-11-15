import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  currentNonce,
  newCspNonce,
  runWithNonce,
  securityHeaders,
  supabaseCspOrigins
} from '../src/lib/security-headers.server';

const HOSTED = 'https://abc.supabase.co';
const LOCAL = 'http://127.0.0.1:55421';

describe('CSP nonce', () => {
  it('is unique and unguessable-looking per request', () => {
    const nonces = new Set(Array.from({ length: 200 }, () => newCspNonce()));
    expect(nonces.size).toBe(200);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
  it('is scoped to the running request, never module-global', async () => {
    const seen = await Promise.all(
      ['a', 'b'].map((nonce, index) =>
        runWithNonce(nonce, async () => {
          await new Promise((resolve) => setTimeout(resolve, index === 0 ? 5 : 0));
          return currentNonce();
        })
      )
    );
    expect(seen).toEqual(['a', 'b']);
    expect(currentNonce()).toBeUndefined();
  });
});

describe('supabaseCspOrigins', () => {
  it('derives https and wss from a hosted URL', () => {
    expect(supabaseCspOrigins(`${HOSTED}/`)).toEqual([
      { http: HOSTED, ws: 'wss://abc.supabase.co' }
    ]);
  });
  it('allows http/ws only for loopback', () => {
    expect(supabaseCspOrigins(LOCAL)).toEqual([{ http: LOCAL, ws: 'ws://127.0.0.1:55421' }]);
    expect(supabaseCspOrigins('http://evil.example')).toEqual([]);
  });
  it.each([undefined, '', 'not a url', 'ftp://x.example', 'https://user:pw@abc.supabase.co'])(
    'ignores invalid value %s',
    (value) => {
      expect(supabaseCspOrigins(value)).toEqual([]);
    }
  );
});

describe('buildCsp', () => {
  const policy = buildCsp('NONCE', HOSTED);
  const directive = (name: string) =>
    policy.split('; ').find((entry) => entry.startsWith(`${name} `));
  it('nonces scripts and never allows inline/eval/wildcards in script-src', () => {
    expect(directive('script-src')).toBe("script-src 'self' 'nonce-NONCE'");
    expect(policy).not.toContain('*');
  });
  it('limits connect-src to self plus exact Supabase origins', () => {
    expect(directive('connect-src')).toBe(
      "connect-src 'self' https://abc.supabase.co wss://abc.supabase.co"
    );
  });
  it('locks down framing, objects, base and forms', () => {
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
  });
});

describe('securityHeaders', () => {
  it('sends the Report-Only CSP (not the enforcing one) with the fixed header set', () => {
    const headers = securityHeaders('https://app.example/x', 'N', HOSTED);
    expect(headers['Content-Security-Policy-Report-Only']).toContain("'nonce-N'");
    expect(headers['Content-Security-Policy']).toBeUndefined();
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });
  it('sends HSTS only over https', () => {
    expect(securityHeaders('https://app.example/', 'N', HOSTED)['Strict-Transport-Security']).toBe(
      'max-age=31536000'
    );
    expect(
      securityHeaders('http://localhost:3000/', 'N', LOCAL)['Strict-Transport-Security']
    ).toBeUndefined();
  });
});
