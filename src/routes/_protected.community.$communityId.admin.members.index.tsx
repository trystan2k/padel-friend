import { createFileRoute } from '@tanstack/react-router';

// No content of its own: the roster is rendered by the members layout route.
export const Route = createFileRoute('/_protected/community/$communityId/admin/members/')({
  component: () => null
});
