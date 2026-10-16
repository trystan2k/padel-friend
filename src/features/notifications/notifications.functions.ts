import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  validateListMyNotifications,
  validateMarkAllNotificationsRead,
  validateNotificationId,
  validateNotificationPreferences
} from './notifications.validators';
import { toNotificationDto } from './notification-model';
const columns = 'id,kind,category,target_type,target_id,community_id,created_at,read_at' as const;
export const listMyNotifications = createServerFn({ method: 'GET' })
  .validator(validateListMyNotifications)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    // Mark-all validates against the database clock; keep the read cutoff on that same clock.
    const { data: asOf, error: asOfError } = await client.rpc('get_my_notifications_as_of');
    if (asOfError) throw asOfError;
    if (typeof asOf !== 'string') throw new Error('INVALID_NOTIFICATION_CUTOFF');
    let query = client.from('notifications').select(columns).lte('created_at', asOf);
    if (data.category !== 'all') query = query.eq('category', data.category);
    if (data.cursor)
      query = query.or(
        `created_at.lt.${data.cursor.createdAt},and(created_at.eq.${data.cursor.createdAt},id.lt.${data.cursor.id})`
      );
    const [{ data: rows, error }, { data: count, error: countError }] = await Promise.all([
      query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(data.limit + 1),
      client.rpc('count_my_unread_notifications')
    ]);
    if (error) throw error;
    if (countError) throw countError;
    const page = rows ?? [];
    const hasMore = page.length > data.limit;
    const items = page.slice(0, data.limit);
    const last = items.at(-1);
    return {
      items: items.map(toNotificationDto),
      nextCursor: hasMore && last ? { createdAt: last.created_at, id: last.id } : null,
      unreadCount: count ?? 0,
      asOf
    };
  });
export const getMyUnreadNotificationCount = createServerFn({ method: 'GET' }).handler(async () => {
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.rpc('count_my_unread_notifications');
  if (error) throw error;
  return data ?? 0;
});
export const markNotificationRead = createServerFn({ method: 'POST' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('mark_notification_read', {
      p_notification_id: data.notificationId
    });
    if (error) throw error;
    return result;
  });
export const markAllNotificationsRead = createServerFn({ method: 'POST' })
  .validator(validateMarkAllNotificationsRead)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('mark_all_notifications_read', {
      p_before: data.before
    });
    if (error) throw error;
    return result;
  });
export const getMyNotificationPreferences = createServerFn({ method: 'GET' }).handler(async () => {
  const { client, userId } = await requireAuthenticatedClient();
  const { data, error } = await client
    .from('notification_preferences')
    .select(
      'push_enabled,push_community,push_matches,push_results,push_rankings,push_leagues,critical_in_app_enabled,updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data;
});
export const saveMyNotificationPreferences = createServerFn({ method: 'POST' })
  .validator(validateNotificationPreferences)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('set_my_notification_preferences', {
      p_push_enabled: data.push_enabled ?? false,
      p_push_community: data.push_community ?? true,
      p_push_matches: data.push_matches ?? true,
      p_push_results: data.push_results ?? true,
      p_push_rankings: data.push_rankings ?? true,
      p_push_leagues: data.push_leagues ?? true
    });
    if (error) throw error;
    return result;
  });
export const getMyNotificationTarget = createServerFn({ method: 'GET' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client
      .rpc('get_my_notification_target', { p_notification_id: data.notificationId })
      .single();
    if (error) throw error;
    return result;
  });
export const acceptMyNotificationInvitation = createServerFn({ method: 'POST' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client
      .rpc('accept_my_notification_invitation', { p_notification_id: data.notificationId })
      .single();
    if (error) throw error;
    return result;
  });
