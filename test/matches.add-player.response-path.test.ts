import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { afterResponse } from '../src/lib/post-response.server';
import { addMatchPlayer } from '../src/features/matches/match-add-player.functions';

// The add command must answer before any invitation work and do the same work for every
// branch (F12). Timing is not asserted; code-path equality is: the response never awaits
// the delivery/sweep, and the post-response work is identical whatever the email is.
const mocks = vi.hoisted(() => ({
  authClient: vi.fn<() => unknown>(),
  admin: vi.fn<() => unknown>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validator: ((data: unknown) => unknown) | undefined;
    const builder = {
      validator: (value: (data: unknown) => unknown) => {
        validator = value;
        return builder;
      },
      handler:
        (handler: (context: { data: unknown }) => unknown) => async (call: { data: unknown }) =>
          handler({ data: validator ? await validator(call.data) : call.data })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({
  getRequestUrl: () => new URL('https://padel.example/matches/e1')
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: async () => ({ client: mocks.authClient() })
}));
vi.mock('../src/lib/supabase/admin.server', () => ({ getAdminClient: () => mocks.admin() }));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const input = (email: string) => ({
  event_id: EVENT_ID,
  display_name: 'Ana',
  email,
  estimated_level: 3,
  locale: 'en' as const,
  request_id: crypto.randomUUID()
});

function authClient(addResult: unknown) {
  return {
    auth: { getClaims: async () => ({ data: { claims: { sub: 'actor-1' } }, error: null }) },
    rpc: vi.fn<(name: string) => Promise<{ data: unknown; error: unknown }>>(async () => ({
      data: addResult,
      error: null
    }))
  };
}

/** Admin whose every RPC hangs: any response-path await on delivery or sweep would deadlock the test. */
function hangingAdmin() {
  return {
    rpc: vi.fn<(name: string) => Promise<never>>(() => new Promise<never>(() => undefined))
  };
}

describe('afterResponse', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('runs the task detached and never lets its failure reach the caller', async () => {
    const ran = vi.fn<() => void>();
    await expect(
      afterResponse(async () => {
        ran();
        throw new Error('boom');
      })
    ).resolves.toBeUndefined();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledTimes(1));
  });

  it('settles on registration alone: the task starts only after the response turn (F15)', async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const task = vi.fn<() => Promise<void>>(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    // A task that never finishes must not hold registration, and has not started when it is over.
    await afterResponse(task);
    expect(task).not.toHaveBeenCalled();
    // The response turn is over (next macrotask): only now does the task body run.
    await vi.advanceTimersByTimeAsync(1);
    expect(task).toHaveBeenCalledTimes(1);
    finish();
  });
});

describe('addMatchPlayer response path', () => {
  beforeEach(() => {
    mocks.authClient.mockReset();
    mocks.admin.mockReset();
  });

  it('answers before dispatch, Auth, settle or the sweep, identically for every email', async () => {
    const bodies: unknown[] = [];
    const calls: string[][] = [];
    for (const email of ['registered@test.local', 'provisional@test.local', 'new@test.local']) {
      const client = authClient({ status: 'ok' });
      const admin = hangingAdmin();
      mocks.authClient.mockReturnValue(client);
      mocks.admin.mockReturnValue(admin);
      bodies.push(await addMatchPlayer({ data: input(email) }));
      // Only the user-scoped command ran inside the response path.
      expect(client.rpc.mock.calls.map(([name]) => name)).toEqual(['add_match_player']);
      // Nothing ran on the response path itself: the task is gated behind the response turn.
      expect(admin.rpc).not.toHaveBeenCalled();
      // The same post-response work starts for every branch: dispatch first, nothing else yet.
      await vi.waitFor(() => expect(admin.rpc).toHaveBeenCalled());
      calls.push(admin.rpc.mock.calls.map(([name]) => name));
    }
    expect(bodies).toEqual(Array.from({ length: 3 }, () => ({ status: 'ok' })));
    expect(calls).toEqual(Array.from({ length: 3 }, () => ['dispatch_match_player_add']));
  });

  it('does not schedule delivery when the command was not accepted', async () => {
    const admin = hangingAdmin();
    mocks.admin.mockReturnValue(admin);
    mocks.authClient.mockReturnValue(authClient({ status: 'rate_limited' }));
    await expect(addMatchPlayer({ data: input('x@test.local') })).resolves.toEqual({
      status: 'error',
      code: 'rate_limited'
    });
    expect(admin.rpc).not.toHaveBeenCalled();
  });
});
