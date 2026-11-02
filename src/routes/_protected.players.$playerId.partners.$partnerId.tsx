import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PairStatistics } from '../features/statistics/PairStatistics';
import type { StatisticsErrorCode } from '../features/statistics/statistics-history-contracts';
import { parseFilterSearch } from '../features/statistics/statistics-links';
import { getPairStatistics } from '../features/statistics/statistics-relationships.functions';
import { validateStatisticsRelationshipInput } from '../features/statistics/statistics.validators';
import { createI18n, resolveLocale } from '../i18n/config';

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

export const Route = createFileRoute('/_protected/players/$playerId/partners/$partnerId')({
  // The focal player stays in the path; filters stay in the URL so every link keeps its scope.
  validateSearch: parseFilterSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps, context }) => {
    let input;
    try {
      input = validateStatisticsRelationshipInput({
        playerId: params.playerId,
        otherId: params.partnerId,
        ...deps
      });
    } catch {
      return {
        result: { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const },
        locale: context.locale
      };
    }
    const result = await getPairStatistics({
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
        title: createI18n(resolveLocale(loaderData?.locale)).t(
          'statistics.relationships.pair.title'
        )
      }
    ]
  }),
  component: PairStatisticsPage
});

function PairStatisticsPage() {
  const { result } = Route.useLoaderData();
  const { t } = useTranslation();
  const router = useRouter();
  if (result.status === 'ok') return <PairStatistics pair={result.value} />;
  return (
    <main>
      <h1>{t('statistics.relationships.pair.title')}</h1>
      <div role="alert">
        <p>{t(`statistics.errors.${result.code}`)}</p>
        {RETRYABLE.includes(result.code) && (
          <button type="button" onClick={() => void router.invalidate()}>
            {t('statistics.history.retry')}
          </button>
        )}
      </div>
    </main>
  );
}
