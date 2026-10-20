import type { Database } from '../../lib/supabase/database.types';
import type { CommunityAdminDefaults, CommunityTimezone } from './community-settings';

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

export type CommunityAdminCommunity = Pick<
  Database['public']['Tables']['communities']['Row'],
  'id' | 'name' | 'city_label' | 'description' | 'visibility' | 'join_policy'
>;
export type CommunityAdminMember = CommunityMemberSearchResult;
export type CommunityMemberMatchSummary =
  | { status: 'available'; count: number }
  | { status: 'unsupported'; count: null; reason: 'match_source_unavailable' };
export function unsupportedCommunityMatchSummary(): CommunityMemberMatchSummary {
  return { status: 'unsupported', count: null, reason: 'match_source_unavailable' };
}
export type CommunityAdminVenue = Pick<
  Database['public']['Tables']['community_venues']['Row'],
  | 'id'
  | 'community_id'
  | 'name'
  | 'address'
  | 'maps_url'
  | 'created_at'
  | 'updated_at'
  | 'archived_at'
> & { photo_signed_url: string | null };
export type CommunityAdminAudit = Pick<
  Database['public']['Tables']['community_audit_log']['Row'],
  'id' | 'actor_user_id' | 'entity' | 'entity_id' | 'action' | 'details' | 'occurred_at'
>;

type CommunityProps = { community: CommunityAdminCommunity };
type MemberCollectionProps = CommunityProps & { members: CommunityAdminMember[] };
export type CommunityAdminScreenProps =
  | (MemberCollectionProps & {
      screen: 'requests';
      timezone: CommunityTimezone;
      datasetGeneration: number;
    })
  | (MemberCollectionProps & { screen: 'members' })
  | (CommunityProps & {
      screen: 'member';
      member: CommunityAdminMember;
      membershipId: string;
    })
  | (CommunityProps & { screen: 'settings'; defaults: CommunityAdminDefaults })
  | (CommunityProps & { screen: 'venues'; venues: CommunityAdminVenue[] })
  | (CommunityProps & { screen: 'audit'; audit: CommunityAdminAudit[] });
