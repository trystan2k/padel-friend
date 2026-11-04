import { Outlet, createFileRoute, useRouter } from '@tanstack/react-router';
import { LevelReviewLoadError } from '../features/level-reviews/LevelReviewStates';
import { levelReviewErrorCode } from '../features/level-reviews/level-review-errors';
import { getLevelReviewAccess } from '../features/level-reviews/level-review.functions';

export const Route = createFileRoute('/_protected/platform-admin')({
  beforeLoad: async () => {
    const access = await getLevelReviewAccess();
    if (!access.is_platform_admin) throw new Error('LEVEL_REVIEW_FORBIDDEN');
  },
  errorComponent: PlatformAdminError,
  component: () => <Outlet />
});

function PlatformAdminError({ error }: { error: unknown }) {
  const router = useRouter();
  return (
    <LevelReviewLoadError
      code={levelReviewErrorCode(error)}
      onRetry={() => void router.invalidate()}
    />
  );
}
