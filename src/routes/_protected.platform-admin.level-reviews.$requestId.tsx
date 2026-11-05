import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LevelReviewLoadError,
  LevelReviewLoading
} from '../features/level-reviews/LevelReviewStates';
import { PlatformLevelReviewDetail } from '../features/level-reviews/PlatformLevelReviewDetail';
import { levelReviewErrorCode } from '../features/level-reviews/level-review-errors';
import { getLevelReviewAdminDetail } from '../features/level-reviews/level-review.functions';
import { isUuid } from '../features/player/rating-contracts';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/platform-admin/level-reviews/$requestId')({
  loader: async ({ params, context }) => {
    try {
      if (!isUuid(params.requestId)) throw new Error('LEVEL_REVIEW_NOT_FOUND');
      return {
        result: {
          status: 'ok' as const,
          value: await getLevelReviewAdminDetail({ data: { request_id: params.requestId } })
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
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('levelReview.admin.detail') }]
  }),
  pendingComponent: Pending,
  component: DetailPage
});
function Pending() {
  const { t } = useTranslation();
  return (
    <LevelReviewLoading
      title={t('levelReview.admin.detail')}
      description={t('levelReview.admin.loading')}
    />
  );
}
function DetailPage() {
  const { result } = Route.useLoaderData();
  const router = useRouter();
  const { requestId } = Route.useParams();
  if (result.status === 'error')
    return (
      <LevelReviewLoadError
        code={result.code}
        returnPath={'/platform-admin/level-reviews/' + requestId}
        onRetry={() => void router.invalidate()}
      />
    );
  return (
    <PlatformLevelReviewDetail
      key={requestId}
      initial={result.value}
      onRevalidate={() => router.invalidate()}
    />
  );
}
