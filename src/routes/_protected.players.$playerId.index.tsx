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
import { getMyPlayerProfile } from '../features/player/player.functions';
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
        isOwn: false,
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
    const viewerId = getMyPlayerProfile().then(
      (profile) => profile.user_id,
      () => null
    );
    // Another player's matches are only readable inside a shared community; without one the
    // reader would deny, so the request is skipped and the card shows a neutral state.
    const readHistory = async () => {
      const isOwn = (await viewerId) === data.playerId;
      if (!isOwn && !deps.communityId) return null;
      return getStatisticsHistory({
        data: { ...deps, subjectPlayerId: data.playerId, limit: 3 }
      }).catch(unavailable);
    };
    const [result, partners, opponents, options, history, viewer] = await Promise.all([
      getPlayerStatistics(input).catch(unavailable),
      getPartnerRecords(input).catch(unavailable),
      getOpponentRecords(input).catch(unavailable),
      readFilterOptions(data.filters),
      readHistory(),
      viewerId
    ]);
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return {
      result,
      partners,
      opponents,
      options,
      history,
      isOwn: viewer === data.playerId,
      locale: context.locale
    };
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
  const { result, partners, opponents, options, history, isOwn } = Route.useLoaderData();
  const { playerId } = Route.useParams();
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  if (result.status === 'ok') {
    return (
      <PlayerStatistics
        stats={result.value}
        recentHistory={history}
        recentIsOwn={isOwn}
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
