import { createFileRoute, useRouter } from '@tanstack/react-router';
import { ResultRepairDiagnostics } from '../features/result-repairs/ResultRepairDiagnostics';
import { ResultRepairLoadError } from '../features/result-repairs/ResultRepairLoadError';
import { getResultRepairDiagnostics } from '../features/result-repairs/repair.functions';
import { createI18n, resolveLocale } from '../i18n/config';

export const Route = createFileRoute('/_protected/platform-admin/result-repairs')({
  loader: async ({ context }) => ({
    result: await getResultRepairDiagnostics({ data: { community_id: null } }).catch(() => ({
      status: 'error' as const,
      code: 'unavailable' as const
    })),
    locale: context.locale
  }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: createI18n(resolveLocale(loaderData?.locale)).t(
          'matches.corrections.diagnostics.title'
        )
      }
    ]
  }),
  component: PlatformRepairsPage
});

function PlatformRepairsPage() {
  const { result } = Route.useLoaderData();
  const router = useRouter();
  const refresh = () => router.invalidate();
  return result.status === 'ok' ? (
    <ResultRepairDiagnostics
      diagnostics={result.value}
      scope={{ kind: 'platform' }}
      onRefresh={refresh}
    />
  ) : (
    <ResultRepairLoadError code={result.code} onRetry={() => void refresh()} />
  );
}
