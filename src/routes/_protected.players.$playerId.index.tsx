import { createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OpponentRecords } from '../features/statistics/OpponentRecords';
import { PartnerRecords } from '../features/statistics/PartnerRecords';
import { PlayerStatistics } from '../features/statistics/PlayerStatistics';
import {
  NO_FILTER_OPTIONS,
  readFilterOptions
} from '../features/statistics/statistics-filter-options';
import { filterSearch, parseFilterSearch } from '../features/statistics/statistics-search';
import { getStatisticsHistory } from '../features/statistics/statistics-history.functions';
import { getPlayerStatistics } from '../features/statistics/statistics-player.functions';
import {
  getOpponentRecords,
  getPartnerRecords
} from '../features/statistics/statistics-relationships.functions';
import { validateStatisticsPlayerInput } from '../features/statistics/statistics.validators';
import { StatisticsError, StatisticsLoading } from '../features/statistics/StatisticsStates';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/players/$playerId/')({
  // Filters live in the URL so a view is shareable; the server-side validator is the authority.
  validateSearch: parseFilterSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps, context }) => {
    try {
      validateStatisticsPlayerInput({ playerId: params.playerId });
    } catch {
      throw notFound();
    }
    let data;
    try {
      data = validateStatisticsPlayerInput({ playerId: params.playerId, ...deps });
    } catch {
      const invalid = { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const };
      return {
        result: invalid,
        partners: invalid,
        opponents: invalid,
        history: invalid,
        options: NO_FILTER_OPTIONS,
        locale: context.locale
      };
    }
    const unavailable = () => ({
      status: 'error' as const,
      code: 'STATISTICS_UNAVAILABLE' as const
    });
    const input = { data: { playerId: data.playerId, ...deps } };
    // Records fail on their own: a broken partner list never hides the player's statistics.
    const [result, partners, opponents, options, history] = await Promise.all([
      getPlayerStatistics(input).catch(unavailable),
      getPartnerRecords(input).catch(unavailable),
      getOpponentRecords(input).catch(unavailable),
      readFilterOptions(data.filters),
      getStatisticsHistory({ data: { ...deps, subjectPlayerId: data.playerId, limit: 3 } }).catch(
        unavailable
      )
    ]);
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, partners, opponents, options, history, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.navigation.player') }
    ]
  }),
  pendingComponent: StatisticsLoading,
  component: PlayerStatisticsPage
});

function PlayerStatisticsPage() {
  const { result, partners, opponents, options, history } = Route.useLoaderData();
  const { playerId } = Route.useParams();
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  if (result.status === 'ok') {
    return (
      <PlayerStatistics
        stats={result.value}
        recentHistory={history}
        onRecentRetry={() => void router.invalidate()}
        filterControls={{
          options,
          onRetry: () => void router.invalidate(),
          onApply: (next) =>
            void navigate({
              to: '/players/$playerId',
              params: { playerId },
              search: filterSearch(next)
            })
        }}
      >
        <PartnerRecords response={partners} onRetry={() => void router.invalidate()} />
        <OpponentRecords response={opponents} onRetry={() => void router.invalidate()} />
      </PlayerStatistics>
    );
  }
  return (
    <main>
      <h1>{t('statistics.navigation.player')}</h1>
      <StatisticsError code={result.code} onRetry={() => void router.invalidate()} />
    </main>
  );
}
