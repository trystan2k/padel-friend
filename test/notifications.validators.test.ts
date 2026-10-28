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
        cursor: { sequence: 1, createdAt: '2026-01-01T00:00:00.000Z', id }
      })
    ).toMatchObject({ category: 'community', limit: 20 });
  });
  it('restarts pagination for a valid legacy cursor', () => {
    expect(
      validateListMyNotifications({
        cursor: { createdAt: '2026-01-01T00:00:00.000Z', id }
      })
    ).toMatchObject({ cursor: undefined });
  });
  it('accepts database ISO timestamps without changing offset or fractional precision', () => {
    for (const createdAt of [
      '2026-10-15T12:00:00.123456+00:00',
      '2026-10-15T12:00:00.123456-07:30',
      '2026-10-15T12:00:00.1+05:45',
      '2026-10-15T12:00:00Z',
      '2026-10-15T12:00:00.000Z'
    ]) {
      expect(
        validateListMyNotifications({ cursor: { sequence: 1, createdAt, id } }).cursor?.createdAt
      ).toBe(createdAt);
    }
  });
  it('rejects unknown fields, invalid category, oversized limit and bad cursor', () => {
    for (const input of [
      { recipientId: id },
      { category: 'other' },
      { limit: 51 },
      { cursor: { sequence: 0, createdAt: '2026-01-01T00:00:00.000Z', id } },
      { cursor: { sequence: 1.5, createdAt: '2026-01-01T00:00:00.000Z', id } },
      {
        cursor: { sequence: Number.MAX_SAFE_INTEGER + 1, createdAt: '2026-01-01T00:00:00.000Z', id }
      },
      { cursor: { sequence: 1, createdAt: 'bad', id } },
      { cursor: { sequence: 1, createdAt: '2026-02-30T12:00:00.123456+00:00', id } },
      { cursor: { sequence: 1, createdAt: '2026-10-15T12:00:00.1234567+00:00', id } },
      { cursor: { sequence: 1, createdAt: '2026-10-15T12:00:00+99:00', id } },
      { cursor: { createdAt: 'bad', id } },
      { cursor: { sequence: 1, createdAt: `${'2'.repeat(40)}garbage`, id } }
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
