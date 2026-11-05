import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { LevelReviewLoading } from '../features/level-reviews/LevelReviewStates';
import { PlayerLevelReviewRequest } from '../features/level-reviews/PlayerLevelReviewRequest';
import { loadCurrentLevel } from '../features/level-reviews/level-review-view';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/level-reviews/new')({
  loader: async ({ context }) => ({ current: await loadCurrentLevel(), locale: context.locale }),
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('levelReview.request.title') }]
  }),
  pendingComponent: Pending,
  component: NewLevelReviewPage
});

function Pending() {
  const { t } = useTranslation();
  return (
    <LevelReviewLoading
      title={t('levelReview.request.title')}
      description={t('levelReview.request.loading')}
    />
  );
}

function NewLevelReviewPage() {
  const { current } = Route.useLoaderData();
  const router = useRouter();
  const navigate = useNavigate();
  return (
    <PlayerLevelReviewRequest
      current={current}
      onRetryCurrent={() => void router.invalidate()}
      onSubmitted={(requestId) =>
        void navigate({ to: '/level-reviews/$requestId', params: { requestId } })
      }
    />
  );
}
