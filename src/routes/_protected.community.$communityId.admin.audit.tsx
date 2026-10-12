import { createFileRoute } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminScreen
} from '../features/community/CommunityAdmin';
import {
  getCommunityAdminContext,
  listCommunityAudit
} from '../features/community/community-admin.functions';

export const Route = createFileRoute('/_protected/community/$communityId/admin/audit')({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const audit = await listCommunityAudit({
      data: { community_id: params.communityId, offset: 0, limit: 3 }
    });
    return { community, audit };
  },
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: () => {
    const data = Route.useLoaderData();
    return <CommunityAdminScreen screen="audit" community={data.community} audit={data.audit} />;
  }
});
