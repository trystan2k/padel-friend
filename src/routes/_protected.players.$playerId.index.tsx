import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { OpponentRecords } from '../features/statistics/OpponentRecords';
import { PartnerRecords } from '../features/statistics/PartnerRecords';
import { PlayerStatistics } from '../features/statistics/PlayerStatistics';
import type { StatisticsErrorCode } from '../features/statistics/statistics-history-contracts';
import { parseFilterSearch } from '../features/statistics/statistics-search';
import { getPlayerStatistics } from '../features/statistics/statistics-player.functions';
import {
  getOpponentRecords,
  getPartnerRecords
} from '../features/statistics/statistics-relationships.functions';
import { validateStatisticsPlayerInput } from '../features/statistics/statistics.validators';
import { createI18n, resolveLocale } from '../i18n/config';

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

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
      return { result: invalid, partners: invalid, opponents: invalid, locale: context.locale };
    }
    const unavailable = () => ({
      status: 'error' as const,
      code: 'STATISTICS_UNAVAILABLE' as const
    });
    const input = { data: { playerId: data.playerId, ...deps } };
    // Records fail on their own: a broken partner list never hides the player's statistics.
    const [result, partners, opponents] = await Promise.all([
      getPlayerStatistics(input).catch(unavailable),
      getPartnerRecords(input).catch(unavailable),
      getOpponentRecords(input).catch(unavailable)
    ]);
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, partners, opponents, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.player.title') }]
  }),
  component: PlayerStatisticsPage
});

function PlayerStatisticsPage() {
  const { result, partners, opponents } = Route.useLoaderData();
  const { t } = useTranslation();
  const router = useRouter();
  if (result.status === 'ok') {
    return (
      <PlayerStatistics stats={result.value}>
        <PartnerRecords response={partners} />
        <OpponentRecords response={opponents} />
      </PlayerStatistics>
    );
  }
  return (
    <main>
      <h1>{t('statistics.player.title')}</h1>
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
