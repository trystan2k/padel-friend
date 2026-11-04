import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LevelReviewLoadError,
  LevelReviewLoading
} from '../features/level-reviews/LevelReviewStates';
import { PlatformLevelReviewQueue } from '../features/level-reviews/PlatformLevelReviewQueue';
import { levelReviewErrorCode } from '../features/level-reviews/level-review-errors';
import { listLevelReviewQueueRequests } from '../features/level-reviews/level-review.functions';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/platform-admin/level-reviews/')({
  loader: async ({ context }) => {
    try {
      return {
        result: {
          status: 'ok' as const,
          value: await listLevelReviewQueueRequests({ data: { limit: 20 } })
        },
        locale: context.locale
      };
    } catch (cause) {
      return {
        result: { status: 'error' as const, code: levelReviewErrorCode(cause) },
        locale: context.locale
      };
    }
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('levelReview.admin.title') }]
  }),
  pendingComponent: Pending,
  component: QueuePage
});
function Pending() {
  const { t } = useTranslation();
  return (
    <LevelReviewLoading
      title={t('levelReview.admin.title')}
      description={t('levelReview.admin.loading')}
    />
  );
}
function QueuePage() {
  const { result } = Route.useLoaderData();
  const router = useRouter();
  return result.status === 'error' ? (
    <LevelReviewLoadError
      code={result.code}
      returnPath="/platform-admin/level-reviews"
      onRetry={() => void router.invalidate()}
    />
  ) : (
    <PlatformLevelReviewQueue initial={result.value} />
  );
}
