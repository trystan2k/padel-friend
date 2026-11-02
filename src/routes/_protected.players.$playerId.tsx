import { createFileRoute, notFound, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlayerStatistics } from '../features/statistics/PlayerStatistics';
import type { StatisticsErrorCode } from '../features/statistics/statistics-history-contracts';
import { getPlayerStatistics } from '../features/statistics/statistics-player.functions';
import { validateStatisticsPlayerInput } from '../features/statistics/statistics.validators';
import { createI18n, resolveLocale } from '../i18n/config';

const FILTER_KEYS = ['communityId', 'leagueId', 'type', 'from', 'through'] as const;
type PlayerStatisticsSearch = Partial<Record<(typeof FILTER_KEYS)[number], string>>;

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

export const Route = createFileRoute('/_protected/players/$playerId')({
  // Filters live in the URL so a view is shareable; the server-side validator is the authority.
  validateSearch: (search: Record<string, unknown>): PlayerStatisticsSearch =>
    Object.fromEntries(
      FILTER_KEYS.flatMap((key) => {
        const value = search[key];
        return typeof value === 'string' && value !== '' ? [[key, value]] : [];
      })
    ),
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
      return {
        result: { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const },
        locale: context.locale
      };
    }
    const result = await getPlayerStatistics({
      data: { playerId: data.playerId, ...deps }
    }).catch(() => ({
      status: 'error' as const,
      code: 'STATISTICS_UNAVAILABLE' as const
    }));
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.player.title') }]
  }),
  component: PlayerStatisticsPage
});

function PlayerStatisticsPage() {
  const { result } = Route.useLoaderData();
  const { t } = useTranslation();
  const router = useRouter();
  if (result.status === 'ok') return <PlayerStatistics stats={result.value} />;
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
