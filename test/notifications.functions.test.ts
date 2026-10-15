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

  it('returns missing-row defaults and selects the authenticated preference row', async () => {
    const maybeSingle = vi
      .fn<() => Promise<{ data: null; error: null }>>()
      .mockResolvedValue({ data: null, error: null });
    const eq = vi.fn<(...args: unknown[]) => { maybeSingle: typeof maybeSingle }>(() => ({
      maybeSingle
    }));
    const select = vi.fn<(...args: unknown[]) => { eq: typeof eq }>(() => ({ eq }));
    const from = vi.fn<(...args: unknown[]) => { select: typeof select }>(() => ({ select }));
    mocks.client = { from };
    await expect(getMyNotificationPreferences()).resolves.toBeNull();
    expect(mocks.client).toBeTruthy();
    expect(select).toHaveBeenCalledWith(
      'push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled,updated_at'
    );
    expect(eq).toHaveBeenCalledWith('user_id', id);
  });

  it('returns the stored preference row unchanged', async () => {
    const row = {
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false,
      critical_in_app_enabled: true,
      updated_at: '2026-10-15T00:00:00.000Z'
    };
    const maybeSingle = vi
      .fn<() => Promise<{ data: typeof row; error: null }>>()
      .mockResolvedValue({ data: row, error: null });
    const eq = vi.fn<(...args: unknown[]) => { maybeSingle: typeof maybeSingle }>(() => ({
      maybeSingle
    }));
    const select = vi.fn<(...args: unknown[]) => { eq: typeof eq }>(() => ({ eq }));
    const from = vi.fn<(...args: unknown[]) => { select: typeof select }>(() => ({ select }));
    mocks.client = { from };
    await expect(getMyNotificationPreferences()).resolves.toEqual(row);
  });

  it('forwards exactly six validated booleans to the preferences RPC', async () => {
    const rpc = vi
      .fn<(...args: unknown[]) => Promise<{ data: { push_enabled: boolean }; error: null }>>()
      .mockResolvedValue({ data: { push_enabled: true }, error: null });
    mocks.client = { rpc };
    const values = {
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false
    };
    await saveMyNotificationPreferences({ data: values });
    expect(rpc).toHaveBeenCalledWith('set_my_notification_preferences', {
      p_push_enabled: true,
      p_push_community: false,
      p_push_matches: true,
      p_push_results: false,
      p_push_rankings: true,
      p_push_leagues: false
    });
    expect(() =>
      saveMyNotificationPreferences({ data: { ...values, critical_in_app_enabled: false } })
    ).toThrow('INVALID_COMMUNITY_INPUT');
  });
});
