import { createFileRoute, notFound, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { CommunityStatistics } from '../features/statistics/CommunityStatistics';
import { getCommunityStatistics } from '../features/statistics/statistics-community.functions';
import type { StatisticsErrorCode } from '../features/statistics/statistics-history-contracts';
import {
  communityScopeFilters,
  filterSearch,
  parseCommunitySearch
} from '../features/statistics/statistics-search';
import { createI18n, resolveLocale } from '../i18n/config';

const RETRYABLE: readonly StatisticsErrorCode[] = [
  'STATISTICS_UNAVAILABLE',
  'INVALID_STATISTICS_RESPONSE',
  'STATISTICS_STALE_REVISION'
];

export const Route = createFileRoute('/_protected/community/$communityId/statistics')({
  // The community lives in the path; League, type
  // and UTC dates live in the URL so reload, back/forward and deep links agree.
  validateSearch: parseCommunitySearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ params, deps, context }) => {
    const unavailable = { status: 'error' as const, code: 'STATISTICS_UNAVAILABLE' as const };
    const input = communityScopeFilters(params.communityId, deps);
    if (input === null) {
      return {
        result: { status: 'error' as const, code: 'INVALID_STATISTICS_INPUT' as const },
        locale: context.locale
      };
    }
    const result = await getCommunityStatistics({ data: input }).catch(() => unavailable);
    if (result.status === 'error' && result.code === 'STATISTICS_NOT_FOUND') throw notFound();
    return { result, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('statistics.community.title') }]
  }),
  component: CommunityStatisticsPage
});

function CommunityStatisticsPage() {
  const { result } = Route.useLoaderData();
  const { communityId } = Route.useParams();
  const { t } = useTranslation();
  const router = useRouter();
  const navigate = useNavigate();
  if (result.status === 'ok') {
    return (
      <CommunityStatistics
        stats={result.value}
        onApply={(next) =>
          void navigate({
            to: '/community/$communityId/statistics',
            params: { communityId },
            search: filterSearch({ ...next, communityId: null })
          })
        }
      />
    );
  }
  return (
    <main>
      <h1>{t('statistics.community.title')}</h1>
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
