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
function Probe() {
  useAuthIdentityGuard(retire);
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

it('unsubscribes on unmount', () => {
  const view = render(<Probe />);
  view.unmount();
  expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
});
