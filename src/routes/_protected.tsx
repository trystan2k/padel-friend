import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { getIdentity } from '../features/notes/notes.functions';

export const Route = createFileRoute('/_protected')({
  beforeLoad: async () => {
    if (!(await getIdentity())) throw redirect({ to: '/login' });
  },
  component: () => <Outlet />
});
