import type { Database } from '../../lib/supabase/database.types';
export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type NotificationDto = Pick<
  NotificationRow,
  'id' | 'kind' | 'category' | 'created_at' | 'read_at'
>;
export function toNotificationDto(
  row: Pick<NotificationRow, 'id' | 'kind' | 'category' | 'created_at' | 'read_at'>
): NotificationDto {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    created_at: row.created_at,
    read_at: row.read_at
  };
}
