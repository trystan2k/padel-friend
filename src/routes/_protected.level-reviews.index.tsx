import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  LevelReviewLoadError,
  LevelReviewLoading
} from '../features/level-reviews/LevelReviewStates';
import { PlayerLevelReviewHistory } from '../features/level-reviews/PlayerLevelReviewHistory';
import { loadLevelReviewHistory } from '../features/level-reviews/level-review-view';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/level-reviews/')({
  loader: async ({ context }) => ({
    result: await loadLevelReviewHistory(),
    locale: context.locale
  }),
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('levelReview.history.title') }]
  }),
  pendingComponent: Pending,
  component: LevelReviewHistoryPage
});

function Pending() {
  const { t } = useTranslation();
  return (
    <LevelReviewLoading
      title={t('levelReview.history.loadingTitle')}
      description={t('levelReview.history.loading')}
    />
  );
}

function LevelReviewHistoryPage() {
  const { result } = Route.useLoaderData();
  const router = useRouter();
  if (result.status === 'error')
    return <LevelReviewLoadError code={result.code} onRetry={() => void router.invalidate()} />;
  return (
    <PlayerLevelReviewHistory initial={result.value.items} nextCursor={result.value.next_cursor} />
  );
}
