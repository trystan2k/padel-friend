import { describe, expect, it } from 'vitest';
import { applyPrivateResponsePolicy } from '../src/lib/private-response';

const get = (path: string, headers: HeadersInit = {}) =>
  new Request('http://localhost' + path, { headers });
const html = (extra: Record<string, string> = {}) =>
  new Response('<html></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8', ...extra }
  });

describe('applyPrivateResponsePolicy', () => {
  it('makes SSR documents private/no-store and varies the representation', () => {
    const response = applyPrivateResponsePolicy(get('/login'), html());
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('vary')).toContain('Cookie');
    expect(response.headers.get('vary')).toContain('Accept-Language');
  });

  it('covers authenticated redirects and auth errors that set no header themselves', () => {
    const redirect = Response.redirect('http://localhost/login', 302);
    const authed = get('/dashboard', { cookie: 'sb-abc-auth-token=1' });
    expect(applyPrivateResponsePolicy(authed, redirect).headers.get('cache-control')).toBe(
      'private, no-store'
    );
    const failure = new Response('{}', {
      status: 401,
      headers: { 'content-type': 'application/json' }
    });
    for (const path of ['/_serverFn/abc', '/auth/callback', '/api/me.js'])
      expect(applyPrivateResponsePolicy(get(path), failure).headers.get('cache-control')).toBe(
        'private, no-store'
      );
  });

  it('overrides a shared cache directive on a response that sets a session cookie', () => {
    const response = applyPrivateResponsePolicy(
      get('/anything'),
      new Response('x', {
        headers: { 'set-cookie': 'sb-a=1', 'cache-control': 'public, max-age=60' }
      })
    );
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('keeps the body stream and every Set-Cookie', async () => {
    const headers = new Headers({ 'content-type': 'text/html' });
    headers.append('set-cookie', 'sb-a-auth-token.0=1; Path=/');
    headers.append('set-cookie', 'sb-a-auth-token.1=2; Path=/');
    const response = applyPrivateResponsePolicy(
      get('/dashboard'),
      new Response('body', { status: 201, headers })
    );
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toHaveLength(2);
    expect(await response.text()).toBe('body');
  });

  it('leaves public assets and already private responses untouched', () => {
    const asset = new Response('js', {
      headers: {
        'content-type': 'text/javascript',
        'cache-control': 'public, max-age=31536000, immutable'
      }
    });
    expect(applyPrivateResponsePolicy(get('/assets/app-1.js'), asset)).toBe(asset);
    const done = html({ 'cache-control': 'private, no-store', vary: 'Cookie' });
    expect(applyPrivateResponsePolicy(get('/x'), done)).toBe(done);
  });
});
