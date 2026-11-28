import { createFileRoute } from '@tanstack/react-router';
import { AccountDeletionPage } from '../features/privacy-requests/AccountDeletionPage';
import { getMyDeletionRequest } from '../features/privacy-requests/privacy-request.functions';
import { createI18n, resolveLocale } from '../i18n/config';

// Own-account deletion pane, reached from the signed-in user's own profile (/me). A lost session
// propagates to the protected layout; any other read failure renders the in-page retry.
export const Route = createFileRoute('/_protected/account-deletion')({
  loader: async ({ context }) => {
    let request: Awaited<ReturnType<typeof getMyDeletionRequest>>;
    try {
      request = await getMyDeletionRequest();
    } catch (error) {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
      request = { status: 'error', code: 'unavailable' };
    }
    return { request, locale: context.locale };
  },
  head: ({ loaderData }) => ({
    meta: [{ title: createI18n(resolveLocale(loaderData?.locale)).t('accountDeletion.title') }]
  }),
  component: AccountDeletionRoute
});

function AccountDeletionRoute() {
  const { request } = Route.useLoaderData();
  return <AccountDeletionPage initial={request} />;
}
