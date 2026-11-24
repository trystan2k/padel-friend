import { createFileRoute } from '@tanstack/react-router';
import { CommunityAdminScreen } from '../features/community/CommunityAdmin';
import { CommunityAdminMemberError } from '../features/community/CommunityAdminViews';
import {
  getCommunityAdminContext,
  getCommunityMemberById
} from '../features/community/community-admin.functions';

export const Route = createFileRoute(
  '/_protected/community/$communityId/admin/members/$membershipId'
)({
  loader: async ({ params }) => {
    const community = await getCommunityAdminContext({
      data: { community_id: params.communityId }
    });
    const member = await getCommunityMemberById({
      data: { community_id: params.communityId, membership_id: params.membershipId }
    });
    return { community, member, membershipId: params.membershipId };
  },
  // The sheet opens over the live roster: no loading screen, errors render as a sheet.
  pendingComponent: () => null,
  errorComponent: CommunityAdminMemberError,
  component: () => {
    const data = Route.useLoaderData();
    return (
      <CommunityAdminScreen
        screen="member"
        community={data.community}
        member={data.member}
        membershipId={data.membershipId}
      />
    );
  }
});
