import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LevelReviewLoadError,
  LevelReviewLoading
} from '../features/level-reviews/LevelReviewStates';
import { PlayerLevelReviewStatus } from '../features/level-reviews/PlayerLevelReviewStatus';
import {
  loadCurrentLevel,
  loadLevelReviewDetail
} from '../features/level-reviews/level-review-view';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/level-reviews/$requestId')({
  loader: async ({ params, context }) => {
    const [result, current] = await Promise.all([
      loadLevelReviewDetail(params.requestId),
      loadCurrentLevel()
    ]);
    return { result, current, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('levelReview.detail.title') }]
  }),
  pendingComponent: Pending,
  component: LevelReviewDetailPage
});

function Pending() {
  const { t } = useTranslation();
  return (
    <LevelReviewLoading
      title={t('levelReview.detail.loadingTitle')}
      description={t('levelReview.detail.loading')}
    />
  );
}

function LevelReviewDetailPage() {
  const { result, current } = Route.useLoaderData();
  const { requestId } = Route.useParams();
  const router = useRouter();
  if (result.status === 'error')
    return (
      <LevelReviewLoadError
        code={result.code}
        backTo="/level-reviews"
        returnPath={`/level-reviews/${requestId}`}
        onRetry={() => void router.invalidate()}
      />
    );
  return (
    <PlayerLevelReviewStatus
      request={result.value}
      current={current}
      onRevalidate={() => router.invalidate()}
    />
  );
}
