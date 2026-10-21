import type { Database } from '../../lib/supabase/database.types';

type CommunityRow = Database['public']['Tables']['communities']['Row'];

export type CommunitySettingsUpdateResult = Pick<
  CommunityRow,
  | 'id'
  | 'name'
  | 'visibility'
  | 'join_policy'
  | 'description'
  | 'city_label'
  | 'logo_path'
  | 'settings'
  | 'updated_at'
>;

// get_community_settings intentionally returns only id/settings; the update RPC
// has a wider projection. Generated RPC nullability is not authoritative here.
export type CommunitySettingsReadResult = Pick<CommunityRow, 'id' | 'settings'>;
