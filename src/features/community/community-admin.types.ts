import type { Database } from '../../lib/supabase/database.types';

type GeneratedMemberSearchResult =
  Database['public']['Functions']['search_community_members']['Returns'][number];

export type CommunityMemberSearchResult = Omit<
  GeneratedMemberSearchResult,
  'valid_until' | 'activated_at' | 'display_level' | 'reliability_percent'
> & {
  valid_until: string | null;
  activated_at: string | null;
  display_level: number | null;
  reliability_percent: number | null;
};
