import { createFileRoute, Outlet, useRouterState } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminScreen
} from '../features/community/CommunityAdmin';
import {
  getCommunityAdminContext,
  searchCommunityMembers
} from '../features/community/community-admin.functions';

export const Route = createFileRoute('/_protected/community/$communityId/admin/members')({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const members = await searchCommunityMembers({
      data: { community_id: params.communityId, query: '', offset: 0, limit: 50 }
    });
    return { community, members };
  },
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: MembersRoute
});

function MembersRoute() {
  const data = Route.useLoaderData();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname.endsWith('/members') ? (
    <CommunityAdminScreen {...data} screen="members" />
  ) : (
    <Outlet />
  );
}
