import { describe, expect, it } from 'vitest';
import { normalizeReturnPath } from '../src/features/auth/return-path';

describe('normalizeReturnPath', () => {
  it('keeps relative app paths including query and hash', () => {
    expect(normalizeReturnPath('/dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('/matches?tab=history#top')).toBe('/matches?tab=history#top');
    expect(normalizeReturnPath('/dashboard?src=e2e#top')).toBe('/dashboard?src=e2e#top');
    expect(normalizeReturnPath('/community/nearby')).toBe('/community/nearby');
  });

  it('keeps encoded query and fragment delimiters verbatim as user data', () => {
    // Percent-encoded delimiters in the query/fragment are user data (e.g. a search term
    // containing "&"): the return path must round-trip them without decoding or rewriting.
    expect(normalizeReturnPath('/dashboard?term=rock%26roll')).toBe('/dashboard?term=rock%26roll');
    expect(normalizeReturnPath('/dashboard?tag=village%23west')).toBe(
      '/dashboard?tag=village%23west'
    );
    expect(normalizeReturnPath('/dashboard?discount=50%25')).toBe('/dashboard?discount=50%25');
    expect(normalizeReturnPath('/dashboard?q=what%3Fnext')).toBe('/dashboard?q=what%3Fnext');
    // Mixed delimiters across query and fragment survive together.
    expect(normalizeReturnPath('/matches?term=rock%26roll%3Fwild#anch%23or%252')).toBe(
      '/matches?term=rock%26roll%3Fwild#anch%23or%252'
    );
    // Encoded delimiters stay intact on a nested return path hop too.
    expect(normalizeReturnPath('/deep/link?next=%2Fdashboard%3Fsrc%3De2e%26keep%3D1')).toBe(
      '/deep/link?next=%2Fdashboard%3Fsrc%3De2e%26keep%3D1'
    );
  });

  it('accepts long but safe paths', () => {
    expect(normalizeReturnPath(`/${'a'.repeat(2047)}`)).toBe(`/${'a'.repeat(2047)}`);
  });

  it('falls back to /dashboard for protocol-relative and external targets', () => {
    expect(normalizeReturnPath('//evil.com')).toBe('/dashboard');
    expect(normalizeReturnPath('https://evil.com/dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('http://127.0.0.1:4173/dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('javascript:alert(1)')).toBe('/dashboard');
  });

  it('falls back for backslashes, control characters and C1 ranges', () => {
    expect(normalizeReturnPath('/\\evil.com')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\nbar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\rbar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\tbar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\x7Fbar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\x85bar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo\x9Fbar')).toBe('/dashboard');
  });

  it('rejects encoded traversal, encoded slashes and encoded control characters after decoding', () => {
    expect(normalizeReturnPath('/%2F%2Fevil.com')).toBe('/dashboard');
    expect(normalizeReturnPath('%2F%2Fevil.com')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo%0Abar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo%5Cbar')).toBe('/dashboard');
    expect(normalizeReturnPath('/foo%')).toBe('/dashboard');
  });

  it('never returns authentication loop targets', () => {
    expect(normalizeReturnPath('/login')).toBe('/dashboard');
    expect(normalizeReturnPath('/login?next=/dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('/login/extra')).toBe('/dashboard');
    expect(normalizeReturnPath('/login%2F')).toBe('/dashboard');
    expect(normalizeReturnPath('/LOGIN')).toBe('/dashboard');
    expect(normalizeReturnPath('/onboarding')).toBe('/dashboard');
    expect(normalizeReturnPath('/onboarding?step=2')).toBe('/dashboard');
    expect(normalizeReturnPath('/auth/callback')).toBe('/dashboard');
    expect(normalizeReturnPath('/auth/callback?code=abc&next=/dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('/auth/callback/')).toBe('/dashboard');
  });

  it('falls back for oversized input', () => {
    expect(normalizeReturnPath('a'.repeat(2049))).toBe('/dashboard');
    expect(normalizeReturnPath(`/${'a'.repeat(2048)}`)).toBe('/dashboard');
    expect(normalizeReturnPath(`/${'a'.repeat(5000)}`)).toBe('/dashboard');
  });

  it('falls back for non-string and malformed values', () => {
    for (const value of [null, undefined, 42, true, {}, ['/dashboard'], '']) {
      expect(normalizeReturnPath(value)).toBe('/dashboard');
    }
  });

  it('falls back when the value does not start with a single slash', () => {
    expect(normalizeReturnPath('dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath(' /dashboard')).toBe('/dashboard');
    expect(normalizeReturnPath('dashboard?x=1')).toBe('/dashboard');
  });
});
