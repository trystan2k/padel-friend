import { createFileRoute } from '@tanstack/react-router';
import { CreateMatchPage } from '../features/matches/CreateMatchPage';
export const Route = createFileRoute('/_protected/matches/create')({
  // A context-scoped entry (community overview) hands over the selected community; the page
  // validates it against the caller's memberships before using it.
  validateSearch: (search: Record<string, unknown>): { communityId?: string } =>
    typeof search.communityId === 'string' && search.communityId
      ? { communityId: search.communityId }
      : {},
  component: () => <CreateMatchPage initialCommunityId={Route.useSearch().communityId} />
});
