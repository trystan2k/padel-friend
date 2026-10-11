import { describe, expect, it, vi } from 'vitest';
import { assertLocalSupabaseEnvInCi, localSupabaseEnv } from './helpers/local-supabase-env';

const localUrl = 'http://127.0.0.1:54321';
const localKey = 'local-publishable-key';
const filePath = '/project/.env';
const file = `VITE_SUPABASE_URL=${localUrl}\nVITE_SUPABASE_PUBLISHABLE_KEY=${localKey}`;

describe('local Supabase test environment', () => {
  it('uses valid environment credentials without reading a file', () => {
    const readFile = vi.fn<() => string>(() => file);
    expect(
      localSupabaseEnv({
        env: { VITE_SUPABASE_URL: localUrl, VITE_SUPABASE_PUBLISHABLE_KEY: localKey },
        filePath,
        readFile
      }).env
    ).toEqual({ url: localUrl, key: localKey, source: 'environment' });
    expect(readFile).not.toHaveBeenCalled();
  });

  it('accepts a quoted loopback URL', () => {
    expect(
      localSupabaseEnv({
        env: { VITE_SUPABASE_URL: `'${localUrl}'`, VITE_SUPABASE_PUBLISHABLE_KEY: localKey },
        filePath,
        readFile: vi.fn<() => string>()
      }).env?.url
    ).toBe(localUrl);
  });

  it('falls back to a valid local environment file when credentials are absent', () => {
    expect(localSupabaseEnv({ env: {}, filePath, readFile: () => file }).env).toEqual({
      url: localUrl,
      key: localKey,
      source: '.env file'
    });
  });

  it('reports a missing file without exposing credentials', () => {
    const result = localSupabaseEnv({
      env: {},
      filePath,
      readFile: () => {
        throw new Error(file);
      }
    });
    expect(result.env).toBeNull();
    expect(result.reason).not.toContain(localKey);
    expect(result.reason).not.toContain(localUrl);
  });

  it.each(['not a url', 'https://example.com'])('rejects malformed or remote URL %s', (url) => {
    const result = localSupabaseEnv({
      env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: localKey },
      filePath,
      readFile: vi.fn<() => string>()
    });
    expect(result.env).toBeNull();
    expect(result.reason).not.toContain(url);
  });

  it('does not fall back when a complete remote environment pair is supplied', () => {
    const readFile = vi.fn<() => string>(() => file);
    expect(
      localSupabaseEnv({
        env: { VITE_SUPABASE_URL: 'https://example.com', VITE_SUPABASE_PUBLISHABLE_KEY: localKey },
        filePath,
        readFile
      }).env
    ).toBeNull();
    expect(readFile).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { VITE_SUPABASE_URL: localUrl },
    { VITE_SUPABASE_PUBLISHABLE_KEY: localKey },
    { VITE_SUPABASE_URL: localUrl, VITE_SUPABASE_PUBLISHABLE_KEY: 'replace-with-key' }
  ])('rejects missing or placeholder environment credentials %#', (env) => {
    expect(localSupabaseEnv({ env, filePath, readFile: () => '' }).env).toBeNull();
  });

  it('fails closed in CI when local credentials are unavailable', () => {
    expect(() => assertLocalSupabaseEnvInCi(null, 'true')).toThrow(
      'Local Supabase credentials are required in CI'
    );
    expect(() => assertLocalSupabaseEnvInCi(null, undefined)).not.toThrow();
  });
});
