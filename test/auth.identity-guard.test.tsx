/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Listener = (event: string, session: { user: { id: string } } | null) => void;
const mocks = vi.hoisted(() => ({
  listener: undefined as Listener | undefined,
  unsubscribe: vi.fn<() => void>(),
  sessionUser: 'a' as string | null
}));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: () => ({
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: mocks.sessionUser ? { user: { id: mocks.sessionUser } } : null }
        }),
      onAuthStateChange: (listener: Listener) => {
        mocks.listener = listener;
        return { data: { subscription: { unsubscribe: mocks.unsubscribe } } };
      }
    }
  })
}));
import { useAuthIdentityGuard } from '../src/lib/use-auth-identity-guard';

const retire = vi.fn<() => void>();
function Probe({ ssrUser = 'a' }: { ssrUser?: string | null }) {
  useAuthIdentityGuard(ssrUser, retire);
  return null;
}

beforeEach(() => {
  mocks.listener = undefined;
  mocks.sessionUser = 'a';
  mocks.unsubscribe.mockReset();
  retire.mockReset();
});
afterEach(cleanup);

it('retires the private view on sign-out and on a different account, never on same-user refresh', async () => {
  render(<Probe />);
  await Promise.resolve();
  mocks.listener?.('TOKEN_REFRESHED', { user: { id: 'a' } });
  expect(retire).not.toHaveBeenCalled();
  mocks.listener?.('SIGNED_IN', { user: { id: 'b' } });
  expect(retire).toHaveBeenCalledTimes(1);
  mocks.listener?.('SIGNED_OUT', null);
  expect(retire).toHaveBeenCalledTimes(2);
});

it('retires a view rendered for A when the browser session already belongs to B at mount', async () => {
  mocks.sessionUser = 'b';
  render(<Probe ssrUser="a" />);
  await Promise.resolve();
  await Promise.resolve();
  expect(retire).toHaveBeenCalledTimes(1);
});

it('retires a view rendered for A when A already signed out in another tab before mount', async () => {
  mocks.sessionUser = null;
  render(<Probe ssrUser="a" />);
  await Promise.resolve();
  await Promise.resolve();
  expect(retire).toHaveBeenCalledTimes(1);
});

it('does not retire a view with no SSR identity when the session is null', async () => {
  mocks.sessionUser = null;
  render(<Probe ssrUser={null} />);
  await Promise.resolve();
  await Promise.resolve();
  expect(retire).not.toHaveBeenCalled();
});

it('retires when B signs in before any session lookup resolves', () => {
  render(<Probe ssrUser="a" />);
  mocks.listener?.('SIGNED_IN', { user: { id: 'b' } });
  expect(retire).toHaveBeenCalledTimes(1);
});

it('unsubscribes on unmount', () => {
  const view = render(<Probe />);
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
