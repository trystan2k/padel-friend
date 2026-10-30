import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  validateListMyNotifications,
  validateMarkAllNotificationsRead,
  validateNotificationId,
  validateNotificationPreferences
} from './notifications.validators';
import { toNotificationDto } from './notification-model';
import { decodeNotificationTarget, decodeResultNotificationContext } from './notification-target';
const columns =
  'id,kind,category,target_type,target_id,community_id,sequence,created_at,read_at' as const;
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
    if (data.cursor) {
      const { sequence, createdAt, id } = data.cursor;
      const beforeCursor = [
        `sequence.lt.${sequence}`,
        `and(sequence.eq.${sequence},created_at.lt.${createdAt})`,
        `and(sequence.eq.${sequence},created_at.eq.${createdAt},id.lt.${id})`
      ].join(',');
      query = query.or(beforeCursor);
    }
    const [{ data: rows, error }, { data: count, error: countError }] = await Promise.all([
      query
        .order('sequence', { ascending: false })
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
    const matchIds = items
      .filter((row) => row.target_type === 'match_event' && row.kind !== 'result_entry_ready')
      .map((row) => row.id);
    const resultIds = items
      .filter((row) => row.target_type === 'result_available' || row.kind === 'result_entry_ready')
      .map((row) => row.id);
    const [matchContextResult, resultContextResult] = await Promise.all([
      matchIds.length
        ? client.rpc('get_my_match_notification_contexts', { p_notification_ids: matchIds })
        : Promise.resolve({ data: [], error: null }),
      resultIds.length
        ? client.rpc('get_my_result_notification_contexts', { p_notification_ids: resultIds })
        : Promise.resolve({ data: [], error: null })
    ]);
    if (matchContextResult.error) throw matchContextResult.error;
    if (resultContextResult.error) throw resultContextResult.error;
    const matchContexts = new Map(
      (matchContextResult.data ?? []).map((context) => [context.notification_id, context])
    );
    const resultContexts = new Map(
      (resultContextResult.data ?? []).map((context) => [
        context.notification_id,
        decodeResultNotificationContext(context)
      ])
    );
    return {
      items: items.map((row) => {
        const matchContext = matchContexts.get(row.id);
        const resultContext = resultContexts.get(row.id);
        return {
          ...toNotificationDto(row),
          ...(matchContext ? { matchContext } : {}),
          ...(resultContext ? { resultContext } : {})
        };
      }),
      nextCursor:
        hasMore && last
          ? { sequence: last.sequence, createdAt: last.created_at, id: last.id }
          : null,
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
export const getMyNotificationTargetV3 = createServerFn({ method: 'GET' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client
      .rpc('get_my_notification_target_v3', { p_notification_id: data.notificationId })
      .single();
    if (error) throw error;
    return decodeNotificationTarget(result);
  });
export const getMyMatchNotificationContext = createServerFn({ method: 'GET' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: contexts, error } = await client.rpc('get_my_match_notification_contexts', {
      p_notification_ids: [data.notificationId]
    });
    if (error) throw error;
    return contexts?.[0] ?? null;
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
