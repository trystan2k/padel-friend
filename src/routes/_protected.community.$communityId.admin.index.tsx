import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/_protected/community/$communityId/admin/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/community/$communityId/admin/requests', params });
  }
});
