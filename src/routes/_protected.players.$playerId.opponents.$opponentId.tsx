import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OpponentStatistics } from '../features/statistics/OpponentStatistics';
import { parseFilterSearch } from '../features/statistics/statistics-search';
import { getOpponentStatistics } from '../features/statistics/statistics-relationships.functions';
import { validateStatisticsRelationshipInput } from '../features/statistics/statistics.validators';
import { StatisticsError, StatisticsLoading } from '../features/statistics/StatisticsStates';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/players/$playerId/opponents/$opponentId')({
  // The focal player stays in the path; filters stay in the URL so every link keeps its scope.
  validateSearch: parseFilterSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps, context }) => {
    let input;
    try {
      input = validateStatisticsRelationshipInput({
        playerId: params.playerId,
        otherId: params.opponentId,
        ...deps
      });
    } catch {
      return {
        result: { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const },
        locale: context.locale
      };
    }
    const result = await getOpponentStatistics({
      data: { playerId: input.playerId, otherId: input.otherId, ...deps }
    }).catch(() => ({
      status: 'error' as const,
      code: 'STATISTICS_UNAVAILABLE' as const
    }));
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [
      {
        title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.navigation.opponent')
      }
    ]
  }),
  pendingComponent: StatisticsLoading,
  component: OpponentStatisticsPage
});

function OpponentStatisticsPage() {
  const { result } = Route.useLoaderData();
  const { t } = useTranslation();
  const router = useRouter();
  if (result.status === 'ok') return <OpponentStatistics opponent={result.value} />;
  return (
    <main>
      <h1>{t('statistics.navigation.opponent')}</h1>
      <StatisticsError code={result.code} onRetry={() => void router.invalidate()} />
    </main>
  );
}
