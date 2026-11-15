import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';

// Runtime proof that the TEST stack's GoTrue enforces the password policy and the anonymous
// sign-in switch configured in test/stack/supabase/config.toml (a silently ignored key would
// otherwise pass the CLI parser unnoticed).
const environment = localSupabaseEnv();
if (!environment.env)
  process.stderr.write(`[auth.password-policy] suite NOT RUN: ${environment.reason}\n`);

describe('auth password policy — CI backend guard', () => {
  it('fails closed without local backend in CI', () => {
    expect(process.env.CI === undefined || environment.env !== null).toBe(true);
  });
});

describe.skipIf(environment.env === null)('auth password policy (local Supabase Auth)', () => {
  const client = () => {
    if (!environment.env) throw new Error(environment.reason);
    return createClient(environment.env.url, environment.env.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  };
  const email = (label: string) => `${label}-${crypto.randomUUID()}@test.local`;

  it.each([
    ['too short with no composition', '123456'],
    ['10+ chars but no symbol', 'Password123']
  ])('rejects a policy-violating password: %s', async (_label, password) => {
    const result = await client().auth.signUp({ email: email('pwpolicy-weak'), password });
    expect(result.data.user).toBeNull();
    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('weak_password');
  });

  it('accepts a compliant password', async () => {
    const result = await client().auth.signUp({
      email: email('pwpolicy-ok'),
      password: 'Password123!'
    });
    expect(result.error).toBeNull();
    expect(result.data.user?.id).toBeTruthy();
  });

  it('rejects anonymous sign-in', async () => {
    const result = await client().auth.signInAnonymously();
    expect(result.data.session).toBeNull();
    expect(result.error?.code).toBe('anonymous_provider_disabled');
  });
});
