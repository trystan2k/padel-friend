import { describe, expect, it } from 'vitest';
import { authCookieOptions } from '../src/lib/supabase/cookie-options';

describe('authCookieOptions', () => {
  it('marks auth cookies Secure over https', () => {
    expect(authCookieOptions('https:')).toEqual({ secure: true });
  });
  it.each(['http:', ''])('keeps local http (%s) working', (protocol) => {
    expect(authCookieOptions(protocol)).toEqual({ secure: false });
  });
  it('does not touch httpOnly (ssr cookie contract)', () => {
    expect(authCookieOptions('https:')).not.toHaveProperty('httpOnly');
  });
});
