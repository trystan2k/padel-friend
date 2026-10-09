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

export const Route = createFileRoute('/_protected/community/$communityId/admin/requests')({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const members = await searchCommunityMembers({
      data: { community_id: params.communityId, query: '', status: 'pending', offset: 0, limit: 50 }
    });
    return { community, members };
  },
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: () => {
    const data = Route.useLoaderData();
    return <CommunityAdminScreen screen="requests" {...data} />;
  }
});
