import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (v: unknown) => v;
    const builder = {
      validator: (fn: (v: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (ctx: { data: unknown }) => unknown) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({
    client: mocks.client,
    userId: '123e4567-e89b-12d3-a456-426614174000'
  })
}));
import {
  acceptMyNotificationInvitation,
  getMyNotificationPreferences,
  getMyNotificationTarget,
  getMyUnreadNotificationCount,
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  saveMyNotificationPreferences
} from '../src/features/notifications/notifications.functions';
const id = '123e4567-e89b-12d3-a456-426614174000';
describe('notification server functions', () => {
  it('uses the whole-store count RPC after authenticated access', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: number; error: null }>>()
      .mockResolvedValue({ data: 4, error: null });
    mocks.client = { rpc };
    await expect(getMyUnreadNotificationCount()).resolves.toBe(4);
    expect(rpc).toHaveBeenCalledWith('count_my_unread_notifications');
  });
  it('keeps mutation contracts recipient-free and validates unexpected data', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    mocks.client = { rpc };
    await markNotificationRead({ data: { notificationId: id } });
    expect(rpc).toHaveBeenCalledWith('mark_notification_read', { p_notification_id: id });
    expect(() => markNotificationRead({ data: { notificationId: id, recipientId: id } })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
    expect([
      listMyNotifications,
      markAllNotificationsRead,
      getMyNotificationPreferences,
      saveMyNotificationPreferences,
      getMyNotificationTarget,
      acceptMyNotificationInvitation
    ]).toHaveLength(6);
  });
});
