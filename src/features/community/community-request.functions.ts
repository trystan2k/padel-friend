import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  validateNotificationId,
  validateNotificationPage,
  validateSendCommunityRequestMessage
} from './community-request.validators';
import { COMMUNITY_TIMEZONES } from './community-settings';

function isCommunityTimezone(value: string | null): value is (typeof COMMUNITY_TIMEZONES)[number] {
  return value !== null && COMMUNITY_TIMEZONES.some((supported) => supported === value);
}

export const sendCommunityRequestMessage = createServerFn({ method: 'POST' })
  .validator(validateSendCommunityRequestMessage)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client
      .rpc('send_community_request_message', {
        p_community_id: data.community_id,
        p_membership_id: data.membership_id,
        p_body: data.body,
        p_client_request_id: data.client_request_id
      })
      .single();
    if (error)
      throw new Error(error.code === '22023' ? 'REQUEST_NOT_PENDING' : 'REQUEST_MESSAGE_FAILED');
    return result;
  });

export const listMyCommunityNotifications = createServerFn({ method: 'GET' })
  .validator(validateNotificationPage)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: rows, error } = await client
      .from('community_notifications')
      .select(
        'id,created_at,read_at,request_message_id,community_request_messages!inner(id,body,created_at)'
      )
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw error;
    const notificationRows = rows ?? [];
    if (notificationRows.length === 0) return [];

    const { data: timeZones, error: timezoneError } = await client.rpc(
      'get_my_community_notification_timezones',
      { p_notification_ids: notificationRows.map((row) => row.id) }
    );
    if (timezoneError) throw timezoneError;

    const timeZonesByNotificationId = new Map<string, string>();
    for (const row of timeZones ?? [])
      timeZonesByNotificationId.set(row.notification_id, row.time_zone);

    return notificationRows.map((row) => {
      const message = row.community_request_messages;
      const timeZone = timeZonesByNotificationId.get(row.id) ?? null;
      if (!isCommunityTimezone(timeZone)) throw new Error('NOTIFICATION_TIMEZONE_UNAVAILABLE');
      return {
        notification_id: row.id,
        message_id: message.id,
        body: message.body,
        created_at: message.created_at,
        read_at: row.read_at,
        time_zone: timeZone
      };
    });
  });

export const markCommunityNotificationRead = createServerFn({ method: 'POST' })
  .validator(validateNotificationId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client
      .rpc('mark_community_notification_read', { p_notification_id: data.notification_id })
      .single();
    if (error) throw error;
    return result;
  });
