import { describe, expect, it } from 'vitest';
import { normalizeReturnPath } from '../src/features/auth/return-path';
import {
  validateListMyNotifications,
  validateMarkAllNotificationsRead,
  validateNotificationId
} from '../src/features/notifications/notifications.validators';
const id = '123e4567-e89b-12d3-a456-426614174000';
describe('notification validators', () => {
  it('accepts supported list input and cursor', () => {
    expect(
      validateListMyNotifications({
        category: 'community',
        cursor: { createdAt: '2026-01-01T00:00:00.000Z', id }
      })
    ).toMatchObject({ category: 'community', limit: 20 });
  });
  it('rejects unknown fields, invalid category, oversized limit and bad cursor', () => {
    for (const input of [
      { recipientId: id },
      { category: 'other' },
      { limit: 51 },
      { cursor: { createdAt: 'bad', id } }
    ])
      expect(() => validateListMyNotifications(input)).toThrow('INVALID_COMMUNITY_INPUT');
  });
  it('validates IDs and timestamps', () => {
    expect(() => validateNotificationId({ notificationId: 'bad' })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
    expect(() => validateMarkAllNotificationsRead({ before: 'now' })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
  });
  it('allows real browser detail path and rejects hostile paths', () => {
    expect(normalizeReturnPath(`/notifications/${id}`)).toBe(`/notifications/${id}`);
    for (const path of [
      'https://evil.test/x',
      '//evil.test/x',
      '/%2f%2fevil.test',
      '/%252f%252fevil.test'
    ])
      expect(normalizeReturnPath(path)).toBe('/dashboard');
  });
});
