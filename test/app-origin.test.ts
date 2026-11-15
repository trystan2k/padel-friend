import { describe, expect, it } from 'vitest';
import { requireAppOrigin } from '../src/lib/app-origin.server';

describe('trusted invitation origin', () => {
  it.each([
    'https://app.example.com',
    'http://localhost:3000',
    'http://127.0.0.1:4173',
    'http://[::1]:3000'
  ])('accepts %s', (origin) => {
    expect(requireAppOrigin(origin)).toBe(origin);
    expect(requireAppOrigin(origin + '/')).toBe(origin);
  });
  it.each([
    undefined,
    '',
    'not a url',
    'null',
    'data:text/html,x',
    'ftp://example.com',
    'http://example.com',
    'http://localhost.evil.test',
    'https://user:pass@example.com',
    'https://example.com/path',
    'https://example.com?next=x',
    'https://example.com#x',
    ' https://example.com',
    'https://example.com/?',
    'https://example.com/#'
  ])('rejects unsafe configuration %s', (origin) => {
    expect(() => requireAppOrigin(origin)).toThrow('APP_ORIGIN_UNAVAILABLE');
  });
});
