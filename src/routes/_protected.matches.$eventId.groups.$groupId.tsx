import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ConfirmedGroupDetail } from '../features/statistics/ConfirmedGroupDetail';
import { getStatisticsGroupDetail } from '../features/statistics/statistics-history.functions';
import { validateStatisticsGroupDetailInput } from '../features/statistics/statistics.validators';
import { StatisticsError, StatisticsLoading } from '../features/statistics/StatisticsStates';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/matches/$eventId/groups/$groupId')({
  loader: async ({ params, context }) => {
    let data: { eventId: string; groupId: string };
    try {
      data = validateStatisticsGroupDetailInput(params);
    } catch {
      throw notFound();
    }
    const result = await getStatisticsGroupDetail({ data }).catch(() => ({
      status: 'error' as const,
      code: 'STATISTICS_UNAVAILABLE' as const
    }));
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.detail.title') }]
  }),
  pendingComponent: StatisticsLoading,
  component: GroupDetailPage
});

function GroupDetailPage() {
  const { result } = Route.useLoaderData();
  const { t } = useTranslation();
  const router = useRouter();
  if (result.status === 'ok') return <ConfirmedGroupDetail detail={result.value} />;
  return (
    <main>
      <h1>{t('statistics.detail.title')}</h1>
      <StatisticsError code={result.code} onRetry={() => void router.invalidate()} />
    </main>
  );
}
