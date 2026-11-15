import { createFileRoute } from '@tanstack/react-router';
import { InviteConfirmation } from '../features/auth/InviteConfirmation';
import { getInviteConfirmation } from '../features/auth/invite-confirmation.functions';

export const Route = createFileRoute('/auth/confirm-invite')({
  loader: () => getInviteConfirmation(),
  head: () => ({ meta: [{ name: 'referrer', content: 'no-referrer' }] }),
  component: ConfirmationRoute
});

function ConfirmationRoute() {
  return <InviteConfirmation confirmation={Route.useLoaderData()} />;
}
