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

// The roster is the single mounted background of the members index and the member sheet, so it
// owns the authorized list read. Kept fresh while the sheet opens and closes (no reload between
// the two child routes), dropped on leave so every entry from elsewhere reads again.
export const Route = createFileRoute('/_protected/community/$communityId/admin/members')({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const members = await searchCommunityMembers({
      data: { community_id: params.communityId, query: '', status: 'active', offset: 0, limit: 50 }
    });
    return { community, members };
  },
  shouldReload: false,
  gcTime: 0,
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: MembersLayoutRoute
});

function MembersLayoutRoute() {
  const data = Route.useLoaderData();
  return (
    <CommunityAdminScreen screen="members" community={data.community} members={data.members} />
  );
}
