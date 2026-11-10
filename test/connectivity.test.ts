/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from 'vitest';
import { isOffline, isTransportFailure } from '../src/lib/connectivity';
import { leagueErrorCode } from '../src/features/leagues/league-errors';

afterEach(() => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('connectivity guard', () => {
  it('reads navigator status at invocation', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    expect(isOffline()).toBe(true);
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    expect(isOffline()).toBe(false);
  });

  it('treats only a missing HTTP response as an unknown outcome', () => {
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
    expect(isTransportFailure(new Error('LEAGUE_VERSION_CONFLICT'))).toBe(false);
    expect(isTransportFailure('x')).toBe(false);
    expect(leagueErrorCode(new TypeError('Load failed'))).toBe('LEAGUE_UNCONFIRMED');
    expect(leagueErrorCode(new Error('LEAGUE_VERSION_CONFLICT'))).toBe('LEAGUE_VERSION_CONFLICT');
  });
});
