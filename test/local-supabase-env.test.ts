import { describe, expect, it, vi } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

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

  it('strips quotes from an environment-supplied publishable key', () => {
    expect(
      localSupabaseEnv({
        env: { VITE_SUPABASE_URL: localUrl, VITE_SUPABASE_PUBLISHABLE_KEY: `"${localKey}"` },
        filePath,
        readFile: vi.fn<() => string>()
      }).env
    ).toEqual({ url: localUrl, key: localKey, source: 'environment' });
  });

  it('rejects a quoted placeholder key instead of treating the quotes as content', () => {
    const result = localSupabaseEnv({
      env: { VITE_SUPABASE_URL: localUrl, VITE_SUPABASE_PUBLISHABLE_KEY: `'replace-with-key'` },
      filePath,
      readFile: () => ''
    });
    expect(result.env).toBeNull();
  });

  it('strips quotes from both values in a .env file', () => {
    const quotedFile = `VITE_SUPABASE_URL="${localUrl}"\nVITE_SUPABASE_PUBLISHABLE_KEY='${localKey}'`;
    expect(localSupabaseEnv({ env: {}, filePath, readFile: () => quotedFile }).env).toEqual({
      url: localUrl,
      key: localKey,
      source: '.env file'
    });
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

describe('dotEnvPathFromImportMetaUrl', () => {
  it('decodes percent-encoded spaces and unicode segments into real paths', () => {
    expect(
      dotEnvPathFromImportMetaUrl(
        'file:///Users/dev/my%20repos/p%C3%A1del-friend/test/suite.test.ts'
      )
    ).toBe('/Users/dev/my repos/pádel-friend/.env');
  });

  it('loads .env through the decoded path where the raw percent-encoded pathname cannot', () => {
    const encodedUrl = 'file:///Users/dev/my%20repos/test/suite.test.ts';
    const decoded = dotEnvPathFromImportMetaUrl(encodedUrl);
    const rawPathname = new URL('../.env', encodedUrl).pathname;
    expect(rawPathname).toContain('%20');
    const readFile = (path: string) => {
      if (path === decoded) return file;
      throw new Error(`ENOENT: ${path}`);
    };
    expect(localSupabaseEnv({ env: {}, filePath: decoded, readFile }).env).toEqual({
      url: localUrl,
      key: localKey,
      source: '.env file'
    });
    expect(localSupabaseEnv({ env: {}, filePath: rawPathname, readFile }).env).toBeNull();
  });
});
