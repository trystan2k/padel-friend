import { createFileRoute } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminShell
} from '../features/community/CommunityAdmin';
import { getCommunityAdminContext } from '../features/community/community-admin.functions';

export const Route = createFileRoute('/_protected/community/$communityId/admin')({
  loader: ({ params }) => getCommunityAdminContext({ data: { community_id: params.communityId } }),
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: AdminLayout
});

function AdminLayout() {
  Route.useLoaderData();
  return <CommunityAdminShell />;
}
