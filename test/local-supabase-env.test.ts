import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertLocalSupabaseEnvInCi, localSupabaseEnv } from './helpers/local-supabase-env';
import { TEST_TUPLE } from './helpers/test-stack-status';

const devPair = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'dev-publishable-key'
};

describe('local Supabase test environment', () => {
  it('accepts only the complete validated TEST tuple from the environment', () => {
    expect(localSupabaseEnv({ env: { ...TEST_TUPLE } }).env).toEqual({
      url: TEST_TUPLE.VITE_SUPABASE_URL,
      key: TEST_TUPLE.VITE_SUPABASE_PUBLISHABLE_KEY,
      source: 'environment'
    });
  });

  it('rejects the dev pair even though it is a valid loopback pair', () => {
    const result = localSupabaseEnv({ env: { ...TEST_TUPLE, ...devPair } });
    expect(result.env).toBeNull();
    expect(result.reason).toContain('VITE_SUPABASE_URL');
    expect(result.reason).not.toContain('dev-publishable-key');
  });

  it('rejects a bare public pair: the tuple is used together, never independently', () => {
    expect(
      localSupabaseEnv({
        env: {
          VITE_SUPABASE_URL: TEST_TUPLE.VITE_SUPABASE_URL,
          VITE_SUPABASE_PUBLISHABLE_KEY: TEST_TUPLE.VITE_SUPABASE_PUBLISHABLE_KEY
        }
      }).env
    ).toBeNull();
  });

  it.each([
    ['wrong API port', { VITE_SUPABASE_URL: 'http://127.0.0.1:55321' }],
    ['wrong DB port', { DATABASE_URL: 'postgresql://postgres:x@127.0.0.1:55322/postgres' }],
    ['wrong mail port', { MAILPIT_URL: 'http://127.0.0.1:55324' }],
    ['remote API', { VITE_SUPABASE_URL: 'https://project.supabase.co' }],
    ['malformed API URL', { VITE_SUPABASE_URL: 'not a url' }],
    ['empty key', { VITE_SUPABASE_PUBLISHABLE_KEY: '' }],
    ['placeholder key', { VITE_SUPABASE_PUBLISHABLE_KEY: 'replace-with-key' }],
    ['empty service key', { SUPABASE_SERVICE_ROLE_KEY: '' }]
  ])('rejects %s without leaking the supplied values', (_label, patch) => {
    const result = localSupabaseEnv({ env: { ...TEST_TUPLE, ...patch } });
    expect(result.env).toBeNull();
    for (const value of Object.values(patch).filter(Boolean))
      expect(result.reason).not.toContain(value);
  });

  it('reads process env by default and never a root .env file', () => {
    // A stray root .env cannot rescue a missing tuple: there is no file reader left.
    expect(localSupabaseEnv({ env: {} }).env).toBeNull();
    const source = readFileSync('test/helpers/local-supabase-env.ts', 'utf8');
    expect(source).not.toMatch(/readFileSync|\.env['"]\)|readFile\b/);
  });

  it('fails closed in CI when local credentials are unavailable', () => {
    expect(() => assertLocalSupabaseEnvInCi(null, 'true')).toThrow(
      'Local Supabase credentials are required in CI'
    );
    expect(() => assertLocalSupabaseEnvInCi(null, undefined)).not.toThrow();
  });
});
