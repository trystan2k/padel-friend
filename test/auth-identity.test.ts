import { describe, expect, it } from 'vitest';
import { isIdentityReplaced } from '../src/lib/auth-identity';

describe('isIdentityReplaced', () => {
  it('retires on sign-out, with or without a known baseline', () => {
    expect(isIdentityReplaced('a', { event: 'SIGNED_OUT', userId: null })).toBe(true);
    expect(isIdentityReplaced(null, { event: 'SIGNED_OUT', userId: null })).toBe(true);
  });

  it('retires when a different account signs in', () => {
    expect(isIdentityReplaced('a', { event: 'SIGNED_IN', userId: 'b' })).toBe(true);
    expect(isIdentityReplaced('a', { event: 'TOKEN_REFRESHED', userId: 'b' })).toBe(true);
  });

  it('keeps the view for same-user refresh, replay and unknown baseline', () => {
    expect(isIdentityReplaced('a', { event: 'TOKEN_REFRESHED', userId: 'a' })).toBe(false);
    expect(isIdentityReplaced('a', { event: 'INITIAL_SESSION', userId: 'a' })).toBe(false);
    expect(isIdentityReplaced(null, { event: 'SIGNED_IN', userId: 'a' })).toBe(false);
  });
});
