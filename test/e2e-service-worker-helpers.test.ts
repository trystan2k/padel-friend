import { describe, expect, it } from 'vitest';
import {
  assertBuiltRegistration,
  isBuiltWorkerUrl,
  type RegistrationSnapshot
} from '../e2e/service-worker-helpers';

const built: RegistrationSnapshot = {
  scope: 'http://127.0.0.1:4173/',
  scriptUrl: 'http://127.0.0.1:4173/sw.js',
  state: 'activated'
};

describe('isBuiltWorkerUrl', () => {
  it('matches the built worker script regardless of origin or query', () => {
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/sw.js')).toBe(true);
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/sw.js?v=1')).toBe(true);
  });

  it('rejects other scripts and malformed URLs', () => {
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/assets/sw.js')).toBe(false);
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/other.js')).toBe(false);
    expect(isBuiltWorkerUrl('not a url')).toBe(false);
  });
});

describe('assertBuiltRegistration', () => {
  it('accepts the activated built worker at the root scope', () => {
    expect(() => assertBuiltRegistration(built)).not.toThrow();
  });

  it('rejects a wrong scope', () => {
    expect(() =>
      assertBuiltRegistration({ ...built, scope: 'http://127.0.0.1:4173/app/' })
    ).toThrow(/scope/);
    expect(() => assertBuiltRegistration({ ...built, scope: null })).toThrow(/scope/);
  });

  it('rejects a wrong or missing script', () => {
    expect(() =>
      assertBuiltRegistration({ ...built, scriptUrl: 'http://127.0.0.1:4173/x.js' })
    ).toThrow(/script/);
    expect(() => assertBuiltRegistration({ ...built, scriptUrl: null })).toThrow(/script/);
  });

  it('rejects a worker that is not yet activated', () => {
    for (const state of ['installing', 'installed', 'activating', null])
      expect(() => assertBuiltRegistration({ ...built, state })).toThrow(/not activated/);
  });
});
