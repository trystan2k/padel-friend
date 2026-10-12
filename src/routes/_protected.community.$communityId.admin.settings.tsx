import { createFileRoute } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminScreen
} from '../features/community/CommunityAdmin';
import { getCommunityAdminContext } from '../features/community/community-admin.functions';

export const Route = createFileRoute('/_protected/community/$communityId/admin/settings')({
  loader: ({ params }) => getCommunityAdminContext({ data: { community_id: params.communityId } }),
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: () => {
    const community = Route.useLoaderData();
    return <CommunityAdminScreen screen="settings" community={community} />;
  }
});
