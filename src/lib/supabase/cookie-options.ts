// Auth cookies get the Secure flag whenever the page is served over HTTPS (production Workers),
// and stay non-Secure on the local http dev/preview servers, where browsers would drop them.
// httpOnly is deliberately left alone: the @supabase/ssr cookie contract needs script access.
export function authCookieOptions(protocol: string) {
  return { secure: protocol === 'https:' };
}
