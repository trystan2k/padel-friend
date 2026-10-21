import { describe, expect, it } from 'vitest';
import {
  communityDateLabel,
  dateLabel,
  failed,
  initials
} from '../src/features/community/community-admin.helpers';

describe('community admin helpers', () => {
  it('formats UTC dates and community-zone timestamps across a day boundary', () => {
    expect(dateLabel('2026-01-01T00:30:00.000Z', 'en')).toBe('Jan 1, 2026');
    expect(communityDateLabel('2026-01-01T00:30:00.000Z', 'en', 'Europe/Madrid')).toBe(
      'Jan 1, 2026, 1:30 AM GMT+1'
    );
    expect(communityDateLabel('2026-01-01T00:30:00.000Z', 'en', 'UTC')).toBe(
      'Jan 1, 2026, 12:30 AM UTC'
    );
  });

  it('derives initials from empty, trimmed, and multi-word names', () => {
    expect(initials('')).toBe('');
    expect(initials('  ada  ')).toBe('A');
    expect(initials('  ada   lovelace byron ')).toBe('AL');
  });

  it('maps known admin errors to translation keys and falls back for other inputs', () => {
    expect(failed(new Error('UNAUTHENTICATED'))).toBe('session');
    expect(failed(new Error('FINAL_COMMUNITY_ADMIN'))).toBe('finalAdmin');
    expect(failed(new Error('INVALID_MEMBERSHIP_TRANSITION'))).toBe('transition');
    expect(failed(new Error('unexpected'))).toBe('generic');
    expect(failed('UNAUTHENTICATED')).toBe('generic');
  });
});
