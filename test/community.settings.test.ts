import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMUNITY_ADMIN_DEFAULTS,
  formatCommunityCurrencyPreview,
  formatCommunityRequestTimestamp,
  isCommunityAdminDefaults,
  parseCommunityAdminDefaults
} from '../src/features/community/community-settings';

describe('community admin defaults validation', () => {
  it('provides effective defaults when the namespace is absent', () => {
    expect(DEFAULT_COMMUNITY_ADMIN_DEFAULTS).toEqual({
      timezone: 'Europe/Madrid',
      currency: 'EUR',
      member_created_leagues_enabled: true
    });
  });

  it('accepts only the exact supported shape', () => {
    expect(isCommunityAdminDefaults(DEFAULT_COMMUNITY_ADMIN_DEFAULTS)).toBe(true);
    expect(isCommunityAdminDefaults({ ...DEFAULT_COMMUNITY_ADMIN_DEFAULTS, extra: true })).toBe(
      false
    );
    expect(isCommunityAdminDefaults({ ...DEFAULT_COMMUNITY_ADMIN_DEFAULTS, currency: 'USD' })).toBe(
      false
    );
    expect(
      isCommunityAdminDefaults({ ...DEFAULT_COMMUNITY_ADMIN_DEFAULTS, timezone: 'Not/AZone' })
    ).toBe(false);
    expect(
      isCommunityAdminDefaults({
        ...DEFAULT_COMMUNITY_ADMIN_DEFAULTS,
        member_created_leagues_enabled: 'true'
      })
    ).toBe(false);
    expect(isCommunityAdminDefaults(null)).toBe(false);
  });

  it('throws for malformed values', () => {
    expect(() => parseCommunityAdminDefaults({})).toThrow('INVALID_COMMUNITY_ADMIN_DEFAULTS');
  });

  it('formats currency by locale and request time across the Madrid DST boundary', () => {
    expect(formatCommunityCurrencyPreview('de-DE', 'EUR')).toContain('€');
    const before = formatCommunityRequestTimestamp(
      '2026-03-29T00:30:00Z',
      'en-GB',
      'Europe/Madrid'
    );
    const after = formatCommunityRequestTimestamp('2026-03-29T01:30:00Z', 'en-GB', 'Europe/Madrid');
    expect(before).not.toEqual(after);
    expect(before).toMatch(/GMT|CET/);
    expect(after).toMatch(/GMT|CEST/);
  });
});
