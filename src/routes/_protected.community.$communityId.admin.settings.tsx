import { createFileRoute } from '@tanstack/react-router';
import {
  CommunityAdminDenied,
  CommunityAdminLoading,
  CommunityAdminScreen
} from '../features/community/CommunityAdmin';
import {
  getCommunityAdminContext,
  getCommunityAdminDefaults
} from '../features/community/community-admin.functions';

export const Route = createFileRoute('/_protected/community/$communityId/admin/settings')({
  loader: async ({ params }) => {
    const data = { community_id: params.communityId };
    const [community, defaults] = await Promise.all([
      getCommunityAdminContext({ data }),
      getCommunityAdminDefaults({ data })
    ]);
    return { community, defaults };
  },
  pendingComponent: CommunityAdminLoading,
  errorComponent: CommunityAdminDenied,
  component: () => {
    const { community, defaults } = Route.useLoaderData();
    return <CommunityAdminScreen screen="settings" community={community} defaults={defaults} />;
  }
});
