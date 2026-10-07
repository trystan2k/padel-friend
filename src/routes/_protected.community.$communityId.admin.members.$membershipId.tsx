import { createFileRoute } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminScreen
} from '../features/community/CommunityAdmin';
import {
  getCommunityAdminContext,
  searchCommunityMembers
} from '../features/community/community-admin.functions';

export const Route = createFileRoute(
  '/_protected/community/$communityId/admin/members/$membershipId'
)({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const members = await searchCommunityMembers({
      data: { community_id: params.communityId, query: '', offset: 0, limit: 50 }
    });
    return { community, members, membershipId: params.membershipId };
  },
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: () => <CommunityAdminScreen {...Route.useLoaderData()} screen="member" />
});
